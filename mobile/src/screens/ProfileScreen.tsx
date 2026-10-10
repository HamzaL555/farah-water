import React, { useState, useEffect, useCallback } from 'react';
import { View, ScrollView, StyleSheet, Text } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button, Dialog, Portal, TextInput as PaperInput, HelperText, Snackbar, Chip, Switch } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SectionCard } from '../components/SectionCard';
import { KeyValueRow } from '../components/KeyValueRow';
import { useAsync, useSubmit } from '../hooks/useAsync';
import { useAuth } from '../context/AuthContext';
import { authApi, settingsApi } from '../services/endpoints';
import { failedItems, pendingCount, retryFailed, discardFailed } from '../services/offlineQueue';
import { getQueueSnapshot } from '../services/offlineQueue';
import { formatDateTime, INVENTORY_TYPE_LABEL } from '../utils/format';
import { colors, spacing, radius } from '../theme';
import type { AdminStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<AdminStackParamList>;

/** Profile, session, app settings and the offline-queue inspector. */
export const ProfileScreen: React.FC = () => {
  const navigation = useNavigation<Nav>();
  const { user, logout, isConnected } = useAuth();

  const { data: settings } = useAsync(() => settingsApi.get().then((r) => r.data), []);

  const [editOpen, setEditOpen] = useState(false);
  const [fullName, setFullName] = useState(user?.fullName ?? '');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [snack, setSnack] = useState<string | null>(null);
  const [queueOpen, setQueueOpen] = useState(false);
  const [queue, setQueue] = useState(getQueueSnapshot());

  useEffect(() => {
    setFullName(user?.fullName ?? '');
    setPhone(user?.phone ?? '');
  }, [user]);

  const refreshQueue = useCallback(() => setQueue(getQueueSnapshot()), []);
  useFocusEffect(
    useCallback(() => {
      refreshQueue();
    }, [refreshQueue]),
  );

  const updateAction = useSubmit(async () => {
    const res = await authApi.updateProfile({
      fullName: fullName.trim(),
      phone: phone.trim() || null,
    });
    return res.data;
  });

  const [companyName, setCompanyName] = useState('');
  useEffect(() => {
    if (settings) setCompanyName(settings.companyName);
  }, [settings]);

  const [defaultPrice, setDefaultPrice] = useState('');
  useEffect(() => {
    if (settings) setDefaultPrice(String(settings.defaultBottlePrice));
  }, [settings]);

  const settingsAction = useSubmit(async () => {
    const res = await settingsApi.update({
      companyName: companyName.trim(),
      defaultBottlePrice: Number(defaultPrice) || 0,
    });
    return res.data;
  });

  const isAdmin = user?.role === 'ADMIN';
  const pending = pendingCount();
  const failed = failedItems().length;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <SectionCard title={user?.fullName ?? ''} subtitle={user?.username ?? ''}>
          <View style={styles.chipRow}>
            <Chip style={isAdmin ? styles.adminChip : styles.workerChip}>
              {isAdmin ? 'Administrator' : 'İşçi'}
            </Chip>
            <Chip style={user?.isActive ? styles.activeChip : styles.inactiveChip}>
              {user?.isActive ? 'Aktiv' : 'Deaktiv'}
            </Chip>
          </View>
          <KeyValueRow label="Telefon" value={user?.phone ?? '-'} />
          <KeyValueRow label="E-mail" value={user?.email ?? '-'} />
          <KeyValueRow label="Son giriş" value={formatDateTime(user?.lastLoginAt)} />
          <KeyValueRow label="Server" value={isConnected ? 'Qoşulub' : 'Yoxdur'} valueColor={isConnected ? colors.success : colors.danger} />
        </SectionCard>

        <SectionCard title="Təhlükəsizlik">
          <Button mode="outlined" icon="lock" onPress={() => navigation.navigate('ChangePassword')}>
            Şifrəni dəyiş
          </Button>
          {user?.mustChangePassword ? (
            <Text style={styles.warning}>
              İlk daxil olmada şifrənizi dəyişmək tələb olunur.
            </Text>
          ) : null}
        </SectionCard>

        <SectionCard title="Gözləyən əməliyyatlar" subtitle={`${pending} gözləyən · ${failed} təsdiqlənməyən`}>
          <Button mode="outlined" icon="cloud-upload" onPress={() => setQueueOpen(true)}>
            Detallı bax
          </Button>
          {failed > 0 ? (
            <View style={styles.queueActions}>
              <Button compact onPress={() => void retryFailed().then(refreshQueue)}>
                Yenidən cəhd et
              </Button>
              <Button compact textColor={colors.danger} onPress={() => void discardFailed().then(refreshQueue)}>
                Sil
              </Button>
            </View>
          ) : null}
        </SectionCard>

        <SectionCard title="Sistem parametrləri" subtitle={isAdmin ? 'Administrator dəyişə bilər' : 'Yalnız administrator dəyişə bilər'}>
          <PaperInput label="Şirkət adı" value={companyName} onChangeText={setCompanyName} mode="outlined" editable={isAdmin} style={styles.input} />
          <PaperInput
            label="Standart bidon qiyməti"
            value={defaultPrice}
            onChangeText={setDefaultPrice}
            mode="outlined"
            keyboardType="decimal-pad"
            editable={isAdmin}
            style={styles.input}
          />
          <KeyValueRow label="Valyuta" value={settings?.currency ?? 'AZN'} />
          {isAdmin ? (
            <Button mode="contained-tonal" loading={settingsAction.submitting} onPress={() => void settingsAction.submit()}>
              Yadda saxla
            </Button>
          ) : null}
          {settingsAction.error ? <HelperText type="error">{settingsAction.error}</HelperText> : null}
        </SectionCard>

        <SectionCard title="Tətbiq haqqında">
          <KeyValueRow label="Tətbiq" value="Farah Su Şirkəti" />
          <KeyValueRow label="Versiya" value="1.0.0" />
          <KeyValueRow label="Məlumat mənbəyi" value="PostgreSQL (server)" />
        </SectionCard>

        <Button
          mode="outlined"
          icon="logout"
          textColor={colors.danger}
          onPress={() => void logout()}
          style={styles.logout}
        >
          Çıxış et
        </Button>
      </ScrollView>

      <Portal>
        <Dialog visible={editOpen} onDismiss={() => setEditOpen(false)}>
          <Dialog.Title>Profili redaktə et</Dialog.Title>
          <Dialog.Content>
            <PaperInput label="Ad və soyad" value={fullName} onChangeText={setFullName} mode="outlined" style={styles.input} />
            <PaperInput label="Telefon" value={phone} onChangeText={setPhone} mode="outlined" keyboardType="phone-pad" style={styles.input} />
            {updateAction.error ? <HelperText type="error">{updateAction.error}</HelperText> : null}
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setEditOpen(false)}>Ləğv et</Button>
            <Button
              onPress={() => {
                void updateAction.submit().then((r) => {
                  if (r) {
                    setEditOpen(false);
                    setSnack('Profil yeniləndi.');
                  }
                });
              }}
            >
              Yadda saxla
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      <Portal>
        <Dialog visible={queueOpen} onDismiss={() => setQueueOpen(false)}>
          <Dialog.Title>Gözləyən əməliyyatlar</Dialog.Title>
          <Dialog.ScrollArea style={styles.scrollArea}>
            <ScrollView>
              {queue.length === 0 ? (
                <Text style={styles.emptyQueue}>Növbə boşdur.</Text>
              ) : (
                queue.map((item) => (
                  <View key={item.id} style={styles.queueRow}>
                    <Text style={styles.queueLabel}>{item.label}</Text>
                    <Text style={styles.queueMeta}>
                      {INVENTORY_TYPE_LABEL[item.kind === 'delivery' ? 'OUT_DELIVERY' : 'INBOUND']} ·{' '}
                      {formatDateTime(item.createdAt)}
                    </Text>
                    {item.lastError ? <Text style={styles.queueError}>{item.lastError}</Text> : null}
                    <Chip compact style={item.permanentlyFailed ? styles.failedChip : styles.pendingChip}>
                      {item.permanentlyFailed ? 'Təsdiqlənmədi' : `${item.attempts} cəhd`}
                    </Chip>
                  </View>
                ))
              )}
            </ScrollView>
          </Dialog.ScrollArea>
          <Dialog.Actions>
            <Button onPress={() => setQueueOpen(false)}>Bağla</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      <Snackbar visible={Boolean(snack)} onDismiss={() => setSnack(null)} duration={3000}>
        {snack ?? ''}
      </Snackbar>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: spacing.md, paddingBottom: spacing.xxl },
  chipRow: { flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.sm },
  adminChip: { backgroundColor: colors.primary },
  workerChip: { backgroundColor: colors.infoBg },
  activeChip: { backgroundColor: colors.successBg },
  inactiveChip: { backgroundColor: colors.dangerBg },
  input: { backgroundColor: colors.surface, marginBottom: spacing.xs },
  warning: { fontSize: 12, color: colors.warning, marginTop: spacing.xs },
  queueActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  logout: { marginTop: spacing.md },
  scrollArea: { height: 360 },
  emptyQueue: { fontSize: 13, color: colors.textMuted, textAlign: 'center', paddingVertical: spacing.lg },
  queueRow: {
    backgroundColor: colors.background,
    borderRadius: radius.sm,
    padding: spacing.md,
    marginBottom: spacing.xs,
    gap: 2,
  },
  queueLabel: { fontSize: 13, fontWeight: '600', color: colors.text },
  queueMeta: { fontSize: 11, color: colors.textMuted },
  queueError: { fontSize: 11, color: colors.danger },
  failedChip: { backgroundColor: colors.dangerBg, alignSelf: 'flex-start', marginTop: 2 },
  pendingChip: { backgroundColor: colors.infoBg, alignSelf: 'flex-start', marginTop: 2 },
});
