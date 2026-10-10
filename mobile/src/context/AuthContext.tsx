import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { authApi } from '../services/endpoints';
import { saveTokens, loadTokens, clearTokens } from '../services/secureStorage';
import { flush, loadQueue, onNetworkChange } from '../services/offlineQueue';
import { apiClient } from '../services/api';
import type { User } from '../types';

interface AuthState {
  user: User | null;
  booting: boolean;
  isConnected: boolean;
  login: (identifier: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  /** True when the session was restored from secure storage on cold start. */
  restored: boolean;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [booting, setBooting] = useState(true);
  const [isConnected, setIsConnected] = useState(true);
  const [restored, setRestored] = useState(false);

  // The API client must clear local tokens when a refresh finally fails.
  useEffect(() => {
    apiClient.onUnauthorized = () => {
      void clearTokens();
      setUser(null);
    };
  }, []);

  /** Silent session restore: read the keystore, validate the token, fetch /me. */
  const bootstrap = useCallback(async () => {
    try {
      await loadQueue();
      const tokens = await loadTokens();
      if (!tokens) {
        setUser(null);
        return;
      }

      // Touch an authenticated endpoint: this also exercises the refresh path.
      const { data } = await authApi.me();
      setUser(data);
      setRestored(true);

      // Push anything queued from a previous offline session.
      void flush();
    } catch {
      // Expired/invalid session: fall back to the login screen.
      await clearTokens();
      setUser(null);
      setRestored(false);
    } finally {
      setBooting(false);
    }
  }, []);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  // Re-validate the session when the app returns to the foreground.
  //
  // NOTE: this MUST NOT use useFocusEffect. AuthProvider is rendered above
  // RootNavigator, so it sits outside <NavigationContainer>, and any
  // navigation hook there throws "Couldn't find a navigation object" and takes
  // the whole app down on launch. AppState works at any level of the tree.
  useEffect(() => {
    const onChange = (state: AppStateStatus) => {
      if (state !== 'active') return;
      void flush();
      // Only re-check when we already had a session; otherwise a failed check
      // would bounce the user to the login screen unnecessarily.
      void (async () => {
        try {
          const { data } = await authApi.me();
          setUser(data);
        } catch {
          /* keep the current session; the API client handles hard failures */
        }
      })();
    };
    const sub = AppState.addEventListener('change', onChange);
    return () => sub.remove();
  }, []);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      const online = state.isConnected === true;
      setIsConnected(online);
      if (online) {
        // Connectivity restored -> drain the offline queue and re-validate.
        void flush();
      }
    });
    const netOff = NetInfo.addEventListener(onNetworkChange);
    return () => {
      unsubscribe();
      netOff();
    };
  }, []);

  const login = useCallback(async (identifier: string, password: string) => {
    const result = await authApi.login(identifier, password);
    await saveTokens({
      accessToken: result.tokens.accessToken,
      refreshToken: result.tokens.refreshToken,
    });
    setUser(result.user);
    setRestored(false);
    void flush();
  }, []);

  const logout = useCallback(async () => {
    const tokens = await loadTokens();
    await authApi.logout(tokens?.refreshToken);
    setUser(null);
    setRestored(false);
  }, []);

  const refreshUser = useCallback(async () => {
    if (!user) return;
    const { data } = await authApi.me();
    setUser(data);
  }, [user]);

  const value = useMemo(
    () => ({ user, booting, isConnected, login, logout, refreshUser, restored }),
    [user, booting, isConnected, login, logout, refreshUser, restored],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

/** Convenience: the signed-in user's role. */
export function useRole() {
  const { user } = useAuth();
  return user?.role ?? null;
}
