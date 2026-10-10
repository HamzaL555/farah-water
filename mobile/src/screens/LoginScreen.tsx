import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, KeyboardAvoidingView, Platform, Pressable } from 'react-native';
import { Button, TextInput as PaperInput, HelperText, Snackbar, IconButton, Icon } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../context/AuthContext';
import { colors, spacing, radius } from '../theme';
import { ApiError } from '../services/types';

/**
 * Login screen.
 *
 * Accepts username, e-mail OR phone in one field, as specified. All
 * authentication failures surface a clear Azerbaijani message; the server
 * never reveals whether an account exists.
 */
export const LoginScreen: React.FC = () => {
  const { login, isConnected } = useAuth();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [secure, setSecure] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  const identifierError = touched && !identifier.trim() ? 'İstifadəçi adı, e-mail və ya telefon yazın.' : null;
  const passwordError = touched && !password ? 'Şifrəni yazın.' : null;

  const onSubmit = async () => {
    setTouched(true);
    if (!identifier.trim() || !password) return;

    setLoading(true);
    setError(null);
    try {
      await login(identifier.trim(), password);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Giriş alınmadı. Yenidən cəhd edin.',
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.brand}>
            <View style={styles.logo}>
              <Text style={styles.logoText}>💧</Text>
            </View>
            <Text style={styles.title}>Farah Su Şirkəti</Text>
            <Text style={styles.subtitle}>İdarəetmə sistemi</Text>
          </View>

          {!isConnected ? (
            <View style={styles.offlineBox}>
              <Text style={styles.offlineText}>
                📴 Bağlantı yoxdur. Giriş üçün internet tələb olunur.
              </Text>
            </View>
          ) : null}

          <PaperInput
            label="İstifadəçi adı / e-mail / telefon"
            value={identifier}
            onChangeText={setIdentifier}
            mode="outlined"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="username"
            error={Boolean(identifierError)}
            style={styles.input}
            testID="login-identifier"
          />
          {identifierError ? <HelperText type="error">{identifierError}</HelperText> : null}

          <PaperInput
            label="Şifrə"
            value={password}
            onChangeText={setPassword}
            mode="outlined"
            secureTextEntry={secure}
            autoCapitalize="none"
            textContentType="password"
            error={Boolean(passwordError)}
            style={styles.input}
            testID="login-password"
            // Pressable wrapper: Paper's Icon is display-only, so it cannot
            // host the tap handler that the eye toggle needs.
            right={
              <Pressable
                onPress={() => setSecure((s) => !s)}
                style={styles.eyeButton}
                accessibilityLabel={secure ? 'Şifrəni göstər' : 'Şifrəni gizlət'}
                testID="toggle-password-visibility"
              >
                <Icon source={secure ? 'eye' : 'eye-off'} size={20} />
              </Pressable>
            }
          />
          {passwordError ? <HelperText type="error">{passwordError}</HelperText> : null}

          <Button
            mode="contained"
            onPress={onSubmit}
            loading={loading}
            disabled={loading}
            style={styles.button}
            contentStyle={styles.buttonContent}
            testID="login-submit"
          >
            Daxil ol
          </Button>

          <View style={styles.helpRow}>
            <IconButton
              icon="help-circle-outline"
              size={18}
              onPress={() =>
                setError('Şifrənizi unutmusunuz? Administratorınıza müraciət edin — şifrəni sıfırlaya bilər.')
              }
            />
            <Text style={styles.helpText}>Şifrəni unutmuşam</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <Snackbar visible={Boolean(error)} onDismiss={() => setError(null)} duration={6000} action={{ label: 'Bağla', onPress: () => setError(null) }}>
        {error ?? ''}
      </Snackbar>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: spacing.lg, gap: spacing.xs },
  brand: { alignItems: 'center', marginBottom: spacing.xl, gap: spacing.xs },
  logo: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  logoText: { fontSize: 34 },
  title: { fontSize: 22, fontWeight: '700', color: colors.primaryDark },
  subtitle: { fontSize: 13, color: colors.textMuted },
  offlineBox: {
    backgroundColor: colors.warningBg,
    borderColor: colors.warning,
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  offlineText: { color: colors.warning, fontSize: 12, textAlign: 'center' },
  input: { marginTop: spacing.sm, backgroundColor: colors.surface },
  eyeButton: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, justifyContent: 'center' },
  button: { marginTop: spacing.lg },
  buttonContent: { height: 48 },
  helpRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: spacing.sm },
  helpText: { fontSize: 12, color: colors.primary, marginLeft: -spacing.sm },
});
