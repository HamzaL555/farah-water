import React, { useState } from 'react';
import { View, ScrollView, StyleSheet, KeyboardAvoidingView, Platform, Text } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button, TextInput as PaperInput, HelperText, Snackbar } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSubmit } from '../hooks/useAsync';
import { authApi } from '../services/endpoints';
import { clearTokens } from '../services/secureStorage';
import { useAuth } from '../context/AuthContext';
import { colors, spacing } from '../theme';
import type { AdminStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<AdminStackParamList>;

/** Password change. Forces re-authentication on every device afterwards. */
export const ChangePasswordScreen: React.FC = () => {
  const navigation = useNavigation<Nav>();
  const { user } = useAuth();

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [touched, setTouched] = useState(false);
  const [snack, setSnack] = useState<string | null>(null);

  const currentError = touched && !current ? 'Cari şifrəni yazın.' : null;
  const nextError = touched
    ? next.length < 8
      ? 'Şifrə ən azı 8 simvol olmalıdır.'
      : !/[A-Za-z]/.test(next) || !/[0-9]/.test(next)
        ? 'Şifrədə hərf və rəqəm olmalıdır.'
        : null
    : null;
  const confirmError = touched && confirm !== next ? 'Şifrələr uyğun gəlmir.' : null;

  const action = useSubmit(async () => {
    await authApi.changePassword(current, next);
    return true;
  });

  const onSubmit = async () => {
    setTouched(true);
    if (!current || next.length < 8 || confirm !== next) return;

    const result = await action.submit();
    if (!result) return;

    // Every session was revoked server-side, so the app returns to login.
    await clearTokens();
    setSnack('Şifrə dəyişildi. Yenidən daxil olun.');
    setTimeout(() => navigation.goBack(), 1200);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Text style={styles.info}>
            Şifrənizi dəyişdikdə bütün cihazlardakı sessiyalar bağlanacaq və yenidən daxil olmaq tələb olunacaq.
          </Text>

          <PaperInput
            label="Cari şifrə"
            value={current}
            onChangeText={setCurrent}
            mode="outlined"
            secureTextEntry
            autoCapitalize="none"
            error={Boolean(currentError)}
            style={styles.input}
          />
          {currentError ? <HelperText type="error">{currentError}</HelperText> : null}

          <PaperInput
            label="Yeni şifrə"
            value={next}
            onChangeText={setNext}
            mode="outlined"
            secureTextEntry
            autoCapitalize="none"
            error={Boolean(nextError)}
            style={styles.input}
          />
          {nextError ? <HelperText type="error">{nextError}</HelperText> : null}

          <PaperInput
            label="Yeni şifrə (təkrar)"
            value={confirm}
            onChangeText={setConfirm}
            mode="outlined"
            secureTextEntry
            autoCapitalize="none"
            error={Boolean(confirmError)}
            style={styles.input}
          />
          {confirmError ? <HelperText type="error">{confirmError}</HelperText> : null}

          {action.error ? <HelperText type="error">{action.error}</HelperText> : null}

          <Button
            mode="contained"
            onPress={onSubmit}
            loading={action.submitting}
            contentStyle={styles.buttonContent}
            style={styles.button}
          >
            Şifrəni dəyiş
          </Button>
          <Text style={styles.userHint}>{user?.fullName}</Text>
        </ScrollView>
      </KeyboardAvoidingView>

      <Snackbar visible={Boolean(snack)} onDismiss={() => setSnack(null)} duration={3000}>
        {snack ?? ''}
      </Snackbar>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  scroll: { padding: spacing.md },
  info: { fontSize: 12, color: colors.textMuted, lineHeight: 18, marginBottom: spacing.md },
  input: { backgroundColor: colors.surface, marginBottom: spacing.xs },
  button: { marginTop: spacing.lg },
  buttonContent: { height: 50 },
  userHint: { textAlign: 'center', fontSize: 11, color: colors.textMuted, marginTop: spacing.sm },
});
