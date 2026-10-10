import React, { useState, useCallback } from 'react';
import { View, ScrollView, StyleSheet, RefreshControl, Text, Pressable } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Searchbar, Button, ActivityIndicator, Chip, FAB, Dialog, Portal, Snackbar, HelperText } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { EmptyState } from '../components/EmptyState';
import { useAsync, useSubmit } from '../hooks/useAsync';
import { usersApi } from '../services/endpoints';
import { formatMoney } from '../utils/format';
import { colors, spacing, radius } from '../theme';
import type { WorkerStats } from '../types';
import type { AdminStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<AdminStackParamList>;

/**
 * Admin worker management.
 *
 * Shows live per-worker figures from the server. Deactivating a worker revokes
 * their sessions immediately (server-side), so the button takes effect at once.
 */
export const WorkersScreen: React.FC = () => {
  const navigation = useNavigation<Nav>();
  const [query, setQuery] = useState('');
  const [snack, setSnack] = useState<string | null>(null);
  const [toggleTarget, setToggleTarget] = useState<WorkerStats | null>(null);
  const [resetTarget, setResetTarget] = useState<WorkerStats | null>(null);
  const [newPassword, setNewPassword] = useState<string | null>(null);

  const { data, loading, error, run } = useAsync(
    () => usersApi.stats().then((r) => r.data),
    [],
  );

  useFocusEffect(
    useCallback(() => {
      void run(false);
    }, [run]),
  );

  const toggleAction = useSubmit(async (worker: WorkerStats, active: boolean) => {
    await usersApi.update(worker.id, { isActive: active });
    return worker.fullName;
  });

  const resetAction = useSubmit(async (worker: WorkerStats) => {
    const res = await usersApi.resetPassword(worker.id);
    return res.data.temporaryPassword;
  });

  const onToggle = async () => {
    if (!toggleTarget) return;
    const name = await toggleAction.submit(toggleTarget, !toggleTarget.isActive);
    setToggleTarget(null);
    if (name) {
      setSnack(
        toggleTarget.isActive
          ? `${name} hesabı deaktiv edildi. Sessiyalar dərhal bağlandı.`
          : `${name} hesabı aktivləşdirildi.`,
      );
      void run(false);
    }
  };

  const onReset = async () => {
    if (!resetTarget) return;
    const pwd = await resetAction.submit(resetTarget);
    setResetTarget(null);
    if (pwd) {
      setNewPassword(pwd);
      void run(false);
    }
  };

  const filtered = (data ?? []).filter((w) =>
    query
      ? w.fullName.toLowerCase().includes(query.toLowerCase()) ||
        w.username.toLowerCase().includes(query.toLowerCase()) ||
        (w.phone ?? '').includes(query)
      : true,
  );

  const totals = (data ?? []).reduce(
    (acc, w) => ({
      bottles: acc.bottles + w.assignedBottles,
      debt: acc.debt + w.outstandingDebt,
      collected: acc.collected + w.todayCollected,
    }),
    { bottles: 0, debt: 0, collected: 0 },
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Searchbar placeholder="Ad, istifadəçi adı və ya telefon..." value={query} onChangeText={setQuery} style={styles.search} />
        <View style={styles.totalsRow}>
          <Text style={styles.totalText}>Əldə: {totals.bottles} bidon</Text>
          <Text style={styles.totalText}>Bu gün: {formatMoney(totals.collected)}</Text>
          <Text style={[styles.totalText, { color: colors.danger }]}>Borc: {formatMoney(totals.debt)}</Text>
        </View>
      </View>

      {loading && !data ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" />
        </View>
      ) : error ? (
        <EmptyState icon="⚠️" title="Yüklənmədi" message={error} actionLabel="Yenidən" onAction={() => void run()} />
      ) : (
        <ScrollView
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void run()} />}
        >
          {filtered.length === 0 ? (
            <EmptyState
              icon="👷"
              title="İşçi tapılmadı"
              message="Sağ altdakı düymə ilə yeni işçi hesabı yaradın."
            />
          ) : (
            filtered.map((w) => (
              <Pressable
                key={w.id}
                onPress={() => navigation.navigate('WorkerDetail', { workerId: w.id, workerName: w.fullName })}
                android_ripple={{ color: colors.surfaceVariant }}
                style={[styles.card, !w.isActive && styles.cardInactive]}
              >
                <View style={styles.cardTop}>
                  <View style={styles.flex}>
                    <Text style={styles.name}>{w.fullName}</Text>
                    <Text style={styles.meta}>
                      {w.username}
                      {w.phone ? ` · ${w.phone}` : ''}
                    </Text>
                  </View>
                  <Chip compact style={w.isActive ? styles.activeChip : styles.inactiveChip}>
                    {w.isActive ? 'Aktiv' : 'Deaktiv'}
                  </Chip>
                </View>

                <View style={styles.statGrid}>
                  <Stat label="Bu gün bidon" value={String(w.todayBottles)} />
                  <Stat label="Bu gün çatdırılma" value={String(w.todayDeliveries)} />
                  <Stat label="Bu gün pul" value={formatMoney(w.todayCollected)} valueColor={colors.success} />
                  <Stat label="Əlində" value={String(w.assignedBottles)} valueColor={colors.info} />
                  <Stat label="Ümumi çatdırılma" value={String(w.totalDeliveries)} />
                  <Stat label="Müştəri borcu" value={formatMoney(w.outstandingDebt)} valueColor={w.outstandingDebt > 0 ? colors.danger : colors.textMuted} />
                </View>

                <View style={styles.actions}>
                  <Button
                    compact
                    icon="pencil"
                    onPress={() => navigation.navigate('WorkerForm', { workerId: w.id })}
                  >
                    Redaktə
                  </Button>
                  <Button compact icon="key" onPress={() => setResetTarget(w)}>
                    Şifrə sıfırla
                  </Button>
                  <Button
                    compact
                    icon={w.isActive ? 'account-off' : 'account-check'}
                    textColor={w.isActive ? colors.danger : colors.success}
                    onPress={() => setToggleTarget(w)}
                  >
                    {w.isActive ? 'Deaktiv et' : 'Aktivləşdir'}
                  </Button>
                </View>
              </Pressable>
            ))
          )}
        </ScrollView>
      )}

      <FAB icon="account-plus" label="Yeni işçi" style={styles.fab} onPress={() => navigation.navigate('WorkerForm')} />

      <Portal>
        <Dialog visible={Boolean(toggleTarget)} onDismiss={() => setToggleTarget(null)}>
          <Dialog.Title>{toggleTarget?.isActive ? 'Hesabı deaktiv et' : 'Hesabı aktivləşdir'}</Dialog.Title>
          <Dialog.Content>
            <Text style={styles.dialogText}>
              {toggleTarget?.isActive
                ? `${toggleTarget?.fullName} hesabı deaktiv ediləcək və bütün sessiyaları dərhal bağlanacaq.`
                : `${toggleTarget?.fullName} yenidən daxil ola biləcək.`}
            </Text>
            {toggleAction.error ? <HelperText type="error">{toggleAction.error}</HelperText> : null}
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setToggleTarget(null)}>Ləğv et</Button>
            <Button
              onPress={onToggle}
              loading={toggleAction.submitting}
              textColor={toggleTarget?.isActive ? colors.danger : colors.success}
            >
              Təsdiqlə
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      <Portal>
        <Dialog visible={Boolean(resetTarget)} onDismiss={() => setResetTarget(null)}>
          <Dialog.Title>Şifrəni sıfırla</Dialog.Title>
          <Dialog.Content>
            <Text style={styles.dialogText}>
              {resetTarget?.fullName} üçün yeni müvəqqəti şifrə yaradılacaq. Şifrə bir dəfə göstərilir və
              ilk daxil olmada dəyişmək tələb olunacaq.
            </Text>
            {resetAction.error ? <HelperText type="error">{resetAction.error}</HelperText> : null}
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setResetTarget(null)}>Ləğv et</Button>
            <Button onPress={onReset} loading={resetAction.submitting}>
              Sıfırla
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      <Portal>
        <Dialog visible={Boolean(newPassword)} onDismiss={() => setNewPassword(null)}>
          <Dialog.Title>Müvəqqəti şifrə</Dialog.Title>
          <Dialog.Content>
            <Text style={styles.dialogText}>Bu şifrəni işçiyə təhlükəsiz şəkildə ötürün:</Text>
            <Text style={styles.passwordBox} selectable>
              {newPassword}
            </Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setNewPassword(null)}>Bağla</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      <Snackbar visible={Boolean(snack)} onDismiss={() => setSnack(null)} duration={4000}>
        {snack ?? ''}
      </Snackbar>
    </SafeAreaView>
  );
};

const Stat: React.FC<{ label: string; value: string; valueColor?: string }> = ({ label, value, valueColor = colors.text }) => (
  <View style={styles.stat}>
    <Text style={styles.statLabel}>{label}</Text>
    <Text style={[styles.statValue, { color: valueColor }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
      {value}
    </Text>
  </View>
);

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  center: { flex: 1, justifyContent: 'center' },
  header: { padding: spacing.md, gap: spacing.sm },
  search: { backgroundColor: colors.surface },
  totalsRow: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: colors.surfaceVariant, padding: spacing.sm, borderRadius: radius.sm },
  totalText: { fontSize: 11, color: colors.textMuted, fontWeight: '600' },
  list: { paddingHorizontal: spacing.md, paddingBottom: 90 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  cardInactive: { opacity: 0.6, backgroundColor: colors.background },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  name: { fontSize: 16, fontWeight: '600', color: colors.text },
  meta: { fontSize: 12, color: colors.textMuted },
  activeChip: { backgroundColor: colors.successBg },
  inactiveChip: { backgroundColor: colors.dangerBg },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: spacing.sm },
  stat: { width: '33%', gap: 1 },
  statLabel: { fontSize: 10, color: colors.textMuted },
  statValue: { fontSize: 13, fontWeight: '700' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  fab: { position: 'absolute', right: spacing.lg, bottom: spacing.lg, backgroundColor: colors.primary },
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
