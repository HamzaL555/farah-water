import * as Keychain from 'react-native-keychain';

/**
 * Token storage backed by the Android Keystore.
 *
 * Tokens are deliberately NOT kept in AsyncStorage: on a rooted or
 * backup-restored device, plain SharedPreferences/AsyncStorage is readable by
 * other apps. Keychain stores them in the hardware-backed keystore.
 */

const SERVICE = 'az.farah.water.auth';

interface StoredTokens {
  accessToken: string;
  refreshToken: string;
}

let memoryCache: StoredTokens | null = null;

export async function saveTokens(tokens: StoredTokens): Promise<void> {
  memoryCache = tokens;
  await Keychain.setGenericPassword('session', JSON.stringify(tokens), {
    service: SERVICE,
    accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    // Not syncable to cloud backups: a restored backup must not resurrect a session.
    securityLevel: Keychain.SECURITY_LEVEL.SECURE_SOFTWARE,
    storage: Keychain.STORAGE_TYPE.AES_GCM_NO_AUTH,
  });
}

export async function loadTokens(): Promise<StoredTokens | null> {
  if (memoryCache) return memoryCache;
  try {
    const creds = await Keychain.getGenericPassword({ service: SERVICE });
    if (!creds) return null;
    const parsed = JSON.parse(creds.password) as StoredTokens;
    if (!parsed?.accessToken || !parsed?.refreshToken) return null;
    memoryCache = parsed;
    return parsed;
  } catch {
    return null;
  }
}

export async function clearTokens(): Promise<void> {
  memoryCache = null;
  try {
    await Keychain.resetGenericPassword({ service: SERVICE });
  } catch {
    // Nothing to clear.
  }
}
