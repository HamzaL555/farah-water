import React, { useState } from 'react';
import { View, ScrollView, StyleSheet, KeyboardAvoidingView, Platform, Text } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  Button,
  TextInput as PaperInput,
  HelperText,
  Snackbar,
  Switch,
  Portal,
  Dialog,
} from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAsync, useSubmit } from '../hooks/useAsync';
import { usersApi } from '../services/endpoints';
import { colors, spacing, radius } from '../theme';
import type { AdminStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<AdminStackParamList, 'WorkerForm'>;
type Nav = NativeStackNavigationProp<AdminStackParamList>;

/**
 * Create or edit a worker.
 *
 * A worker is never given an explicit role: the API has no field for it, so
 * privilege escalation is impossible from this screen.
 */
export const WorkerFormScreen: React.FC<Props> = ({ route }) => {
  const navigation = useNavigation<Nav>();
  const editingId = route.params?.workerId;

  const { data: existing } = useAsync(
    () => (editingId ? usersApi.detail(editingId).then((r) => r.data) : Promise.resolve(null)),
    [editingId],
  );

  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [touched, setTouched] = useState(false);
  const [snack, setSnack] = useState<string | null>(null);
  const [generatedPassword, setGeneratedPassword] = useState<string | null>(null);

  // Seed the form once the existing worker loads.
  const [seeded, setSeeded] = useState(false);
  if (existing && !seeded) {
    setFullName(existing.fullName);
    setUsername(existing.username);
    setPhone(existing.phone ?? '');
    setEmail(existing.email ?? '');
    setIsActive(existing.isActive);
    setSeeded(true);
  }

  const nameError = touched && fullName.trim().length < 2 ? 'Ad və soyad tələb olunur.' : null;
  const usernameError = touched
    ? username.trim().length < 3
      ? 'İstifadəçi adı ən azı 3 simvol olmalıdır.'
      : !/^[a-z0-9._-]+$/.test(username.trim().toLowerCase())
        ? 'Yalnız kiçik hərf, rəqəm, . _ - ola bilər.'
        : null
    : null;
  const passwordError =
    touched && password && (password.length < 8 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password))
      ? 'Şifrə ən azı 8 simvol, hərf və rəqəm olmalıdır.'
      : null;

  const createAction = useSubmit(async () => {
    const res = await usersApi.create({
      fullName: fullName.trim(),
      username: username.trim().toLowerCase(),
      phone: phone.trim() || undefined,
      email: email.trim() || undefined,
      // An empty password means "let the system generate one".
      password: password.trim() ? password.trim() : undefined,
    });
    return res.data;
  });

  const updateAction = useSubmit(async () => {
    await usersApi.update(editingId!, {
      fullName: fullName.trim(),
      phone: phone.trim() || null,
      email: email.trim() || null,
      isActive,
    });
    return true;
  });

  const onSave = async () => {
    setTouched(true);
    if (fullName.trim().length < 2 || username.trim().length < 3) return;

    if (editingId) {
      const result = await updateAction.submit();
      if (!result) return;
      setSnack('Məlumatlar yeniləndi.');
      setTimeout(() => navigation.goBack(), 600);
      return;
    }

    const result = await createAction.submit();
    if (!result) return;
    if (result.temporaryPassword) {
      setGeneratedPassword(result.temporaryPassword);
    } else {
      setSnack('İşçi hesabı yaradıldı.');
      setTimeout(() => navigation.goBack(), 600);
    }
  };

  const error = createAction.error ?? updateAction.error;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <PaperInput
            label="Ad və soyad"
            value={fullName}
            onChangeText={setFullName}
            mode="outlined"
            error={Boolean(nameError)}
            style={styles.input}
          />
          {nameError ? <HelperText type="error">{nameError}</HelperText> : null}

          <PaperInput
            label="İstifadəçi adı"
            value={username}
            onChangeText={(t) => setUsername(t.toLowerCase())}
            mode="outlined"
            autoCapitalize="none"
            editable={!editingId}
            error={Boolean(usernameError)}
            style={styles.input}
          />
          {editingId ? <HelperText type="info">İstifadəçi adı dəyişdirilə bilməz.</HelperText> : null}
          {usernameError ? <HelperText type="error">{usernameError}</HelperText> : null}

          <PaperInput
            label="Telefon"
            value={phone}
            onChangeText={setPhone}
            mode="outlined"
            keyboardType="phone-pad"
            style={styles.input}
          />

          <PaperInput
            label="E-mail (istəyə bağlı)"
            value={email}
            onChangeText={setEmail}
            mode="outlined"
            keyboardType="email-address"
            autoCapitalize="none"
            style={styles.input}
          />

          {!editingId ? (
            <>
              <PaperInput
                label="Şifrə (boş qoysan, sistem yaradacaq)"
                value={password}
                onChangeText={(t) => setPassword(t.replace(/\s/g, ''))}
                mode="outlined"
                secureTextEntry
                autoCapitalize="none"
                error={Boolean(passwordError)}
                style={styles.input}
              />
              {passwordError ? <HelperText type="error">{passwordError}</HelperText> : null}
            </>
          ) : (
            <View style={styles.switchRow}>
              <View style={styles.flex}>
                <Text style={styles.switchLabel}>Hesab aktiv</Text>
                <Text style={styles.switchHint}>Deaktiv hesab daxil ola bilmir.</Text>
              </View>
              <Switch value={isActive} onValueChange={setIsActive} />
            </View>
          )}

          <Button
            mode="contained"
            onPress={onSave}
            loading={createAction.submitting || updateAction.submitting}
            contentStyle={styles.saveContent}
            style={styles.save}
          >
            {editingId ? 'Yadda saxla' : 'İşçi yarat'}
          </Button>
        </ScrollView>
      </KeyboardAvoidingView>

      <Portal>
        <Dialog visible={Boolean(generatedPassword)} onDismiss={() => setGeneratedPassword(null)}>
          <Dialog.Title>Müvəqqəti şifrə</Dialog.Title>
          <Dialog.Content>
            <Text style={styles.dialogText}>
              Bu şifrəni işçiyə təhlükəsiz şəkildə ötürün. İlk daxil olmada dəyişmək tələb olunacaq.
            </Text>
            <Text style={styles.passwordBox} selectable>
              {generatedPassword}
            </Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button
              onPress={() => {
                setGeneratedPassword(null);
                navigation.goBack();
              }}
            >
              Tamam
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      <Snackbar
        visible={Boolean(snack ?? error)}
        onDismiss={() => {
          setSnack(null);
          createAction.clearError();
          updateAction.clearError();
        }}
        duration={5000}
      >
        {snack ?? error ?? ''}
      </Snackbar>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  scroll: { padding: spacing.md },
  input: { backgroundColor: colors.surface, marginBottom: spacing.xs },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  switchLabel: { fontSize: 14, fontWeight: '600', color: colors.text },
  switchHint: { fontSize: 11, color: colors.textMuted },
  save: { marginTop: spacing.lg },
  saveContent: { height: 50 },
  dialogText: { fontSize: 13, color: colors.text, lineHeight: 19 },
  passwordBox: {
    fontFamily: 'monospace',
    fontSize: 18,
    fontWeight: '700',
    color: colors.primary,
    backgroundColor: colors.surfaceVariant,
    padding: spacing.md,
    borderRadius: radius.sm,
    textAlign: 'center',
    marginTop: spacing.md,
  },
});
