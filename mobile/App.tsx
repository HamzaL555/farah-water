import React from 'react';
import { StatusBar } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { PaperProvider } from 'react-native-paper';
import { RootNavigator } from './src/navigation/RootNavigator';
import { AuthProvider } from './src/context/AuthContext';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { theme } from './src/theme';

/**
 * Farah Su Şirkəti - root component.
 *
 * Providers, outermost first:
 *   ErrorBoundary        -> shows a crash on screen instead of a blank app
 *   SafeAreaProvider     -> correct insets on notched/small screens
 *   PaperProvider        -> Material 3 theme for all UI components
 *   AuthProvider         -> session state + connectivity + offline queue
 */
const App: React.FC = () => (
  <GestureHandlerRootView style={{ flex: 1 }}>
    <SafeAreaProvider>
      <PaperProvider theme={theme}>
        <ErrorBoundary>
          <AuthProvider>
            <StatusBar barStyle="light-content" backgroundColor={theme.colors.primary} />
            <RootNavigator />
          </AuthProvider>
        </ErrorBoundary>
      </PaperProvider>
    </SafeAreaProvider>
  </GestureHandlerRootView>
);

export default App;
