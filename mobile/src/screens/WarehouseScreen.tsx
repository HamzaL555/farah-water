import React, { useState, useCallback } from 'react';
import { View, ScrollView, StyleSheet, RefreshControl, Text } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  Button,
  ActivityIndicator,
  Dialog,
  Portal,
  TextInput as PaperInput,
  HelperText,
  SegmentedButtons,
  Menu,
  Chip,
  Snackbar,
} from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatCard } from '../components/StatCard';
import { SectionCard } from '../components/SectionCard';
import { EmptyState } from '../components/EmptyState';
import { useAsync, useSubmit } from '../hooks/useAsync';
import { inventoryApi } from '../services/endpoints';
import { formatDateTime, INVENTORY_TYPE_LABEL } from '../utils/format';
import { colors, spacing, radius } from '../theme';
import type { InventoryTxType } from '../types';

type Mode = 'stockIn' | 'issue' | 'writeOff';

/** Admin warehouse: totals, per-worker holdings, and all stock movements. */
export const WarehouseScreen: React.FC = () => {
  const { data: summary, loading, error, run: runSummary } = useAsync(
    () => inventoryApi.summary().then((r) => r.data),
    [],
  );
  const { data: history, run: runHistory } = useAsync(
    () => inventoryApi.transactions({ pageSize: 40 }).then((r) => r.data),
    [],
  );

  const refreshAll = useCallback(async () => {
    await Promise.all([runSummary(), runHistory()]);
  }, [runSummary, runHistory]);

  useFocusEffect(
    useCallback(() => {
      void refreshAll();
    }, [refreshAll]),
  );

  const [dialogMode, setDialogMode] = useState<Mode | null>(null);
  const [count, setCount] = useState('');
  const [note, setNote] = useState('');
  const [workerId, setWorkerId] = useState<string | undefined>();
  const [workerMenu, setWorkerMenu] = useState(false);
  const [writeOffType, setWriteOffType] = useState<'DAMAGE' | 'LOSS'>('DAMAGE');
  const [touched, setTouched] = useState(false);
  const [snack, setSnack] = useState<string | null>(null);

  const countNum = parseInt(count || '0', 10);
  const selectedWorker = summary?.workers.find((w) => w.workerId === workerId);

  const countError = touched && countNum <= 0 ? 'Say daxil edin (tam ədəd).' : null;
  const noteError =
    touched && dialogMode === 'writeOff' && !note.trim() ? 'Səbəb yazılmalıdır.' : null;
  const workerError = touched && dialogMode === 'issue' && !workerId ? 'İşçi seçin.' : null;

  const action = useSubmit(async () => {
    const payload = {
      bottleCount: countNum,
      note: note.trim() || undefined,
      idempotencyKey: `${dialogMode}-${Date.now()}`,
    };
    if (dialogMode === 'stockIn') return (await inventoryApi.stockIn(payload)).data;
    if (dialogMode === 'issue') return (await inventoryApi.issue(workerId!, payload)).data;
    return (
      await inventoryApi.writeOff({
        type: writeOffType,
        bottleCount: countNum,
        note: note.trim(),
        workerId,
        idempotencyKey: `wo-${Date.now()}`,
      })
    ).data;
  });

  const onSubmit = async () => {
    setTouched(true);
    if (countNum <= 0) return;
    if (dialogMode === 'issue' && !workerId) return;
    if (dialogMode === 'writeOff' && !note.trim()) return;

    const result = await action.submit();
    if (!result) return;
    setDialogMode(null);
    setCount('');
    setNote('');
    setWorkerId(undefined);
    setTouched(false);
    setSnack(`Əməliyyat qeydə alındı. Yeni qalıq: ${result.newBalance}`);
    void refreshAll();
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={() => {
              void refreshAll();
            }}
          />
        }
      >
        <View style={styles.row}>
          <StatCard label="Anbarda" value={String(summary?.warehouseQuantity ?? 0)} icon="🏭" accent={colors.primary} />
          <StatCard label="İşçilərdə" value={String(summary?.inWorkersHands ?? 0)} icon="🧑‍🏭" accent={colors.info} background={colors.infoBg} />
        </View>

        <View style={styles.row}>
          <StatCard label="Bu gün daxil" value={String(summary?.todayInbound ?? 0)} icon="📥" accent={colors.success} background={colors.successBg} />
          <StatCard label="Bu gün çıxış" value={String(summary?.todayOutbound ?? 0)} icon="📤" accent={colors.warning} background={colors.warningBg} />
        </View>

        <View style={styles.row}>
          <StatCard label="Zədələnmiş" value={String(summary?.damagedTotal ?? 0)} icon="🔨" accent={colors.danger} background={colors.dangerBg} />
          <StatCard label="İtmiş" value={String(summary?.lostTotal ?? 0)} icon="❓" accent={colors.textMuted} />
        </View>

        <StatCard
          label="Sistemdə cəmi bidon"
          value={String(summary?.totalSystemQuantity ?? 0)}
          icon="🧮"
          accent={colors.primaryDark}
        />

        <View style={styles.actions}>
          <Button mode="contained" icon="tray-arrow-down" onPress={() => setDialogMode('stockIn')} style={styles.actionBtn}>
            Anbara qəbul
          </Button>
          <Button mode="contained-tonal" icon="tray-arrow-up" onPress={() => setDialogMode('issue')} style={styles.actionBtn}>
            İşçiyə təhvil
          </Button>
          <Button mode="outlined" icon="alert-circle" onPress={() => setDialogMode('writeOff')} style={styles.actionBtn}>
            Zədələnmiş/İtmiş
          </Button>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <SectionCard title="İşçilərin əlində" subtitle="Hər işçinin bidon sayı">
          {!summary || summary.workers.length === 0 ? (
            <EmptyState icon="👷" title="Məlumat yoxdur" message="Hələ bidon təhvil edilməyib." />
          ) : (
            summary.workers.map((w) => (
              <View key={w.workerId} style={styles.workerRow}>
                <View style={styles.flex}>
                  <Text style={styles.workerName}>{w.workerName}</Text>
                  <Text style={styles.workerMeta}>
                    {w.username}
                    {w.isActive ? '' : ' · deaktiv'}
                  </Text>
                </View>
                <View style={[styles.qtyBadge, w.quantity === 0 && { backgroundColor: colors.dangerBg }]}>
                  <Text style={[styles.qtyText, w.quantity === 0 && { color: colors.danger }]}>{w.quantity}</Text>
                </View>
              </View>
            ))
          )}
        </SectionCard>

        <SectionCard title="İnventar tarixçəsi" subtitle="Son əməliyyatlar">
          {loading && !history ? (
            <ActivityIndicator />
          ) : !history || history.items.length === 0 ? (
            <EmptyState icon="📋" title="Əməliyyat yoxdur" />
          ) : (
            history.items.map((t) => (
              <View key={t.id} style={styles.txRow}>
                <View
                  style={[styles.txBadge, { backgroundColor: t.signedCount > 0 ? colors.successBg : colors.dangerBg }]}
                >
                  <Text style={[styles.txBadgeText, { color: t.signedCount > 0 ? colors.success : colors.danger }]}>
                    {t.signedCount > 0 ? '+' : ''}
                    {t.signedCount}
                  </Text>
                </View>
                <View style={styles.flex}>
                  <Text style={styles.txType}>{INVENTORY_TYPE_LABEL[t.type as InventoryTxType]}</Text>
                  <Text style={styles.txMeta}>
                    {formatDateTime(t.occurredAt)}
                    {t.workerName ? ` · ${t.workerName}` : ''}
                    {t.note ? ` · ${t.note}` : ''}
                  </Text>
                </View>
              </View>
            ))
          )}
        </SectionCard>
      </ScrollView>

      <Portal>
        <Dialog visible={Boolean(dialogMode)} onDismiss={() => setDialogMode(null)}>
          <Dialog.Title>
            {dialogMode === 'stockIn' ? 'Anbara qəbul' : dialogMode === 'issue' ? 'İşçiyə təhvil' : 'Zədələnmiş / itmiş'}
          </Dialog.Title>
          <Dialog.Content>
            {dialogMode === 'stockIn' ? (
              <Text style={styles.dialogHint}>Yeni bidonlar şirkətə daxil olur.</Text>
            ) : dialogMode === 'issue' ? (
              <>
                <Text style={styles.dialogHint}>Bidonlar anbardan çıxıb işçinin hesabına keçir.</Text>
                <Menu
                  visible={workerMenu}
                  onDismiss={() => setWorkerMenu(false)}
                  anchor={
                    <Button
                      mode="outlined"
                      icon="account"
                      onPress={() => setWorkerMenu(true)}
                      style={styles.dialogInput}
                    >
                      {selectedWorker?.workerName ?? 'İşçi seçin'}
                    </Button>
                  }
                >
                  {summary?.workers.map((w) => (
                    <Menu.Item
                      key={w.workerId}
                      title={w.workerName}
                      onPress={() => {
                        setWorkerId(w.workerId);
                        setWorkerMenu(false);
                      }}
                    />
                  ))}
                </Menu>
                {workerError ? <HelperText type="error">{workerError}</HelperText> : null}
              </>
            ) : (
              <>
                <SegmentedButtons
                  value={writeOffType}
                  onValueChange={(v) => setWriteOffType(v as 'DAMAGE' | 'LOSS')}
                  buttons={[
                    { value: 'DAMAGE', label: 'Zədələnmiş' },
                    { value: 'LOSS', label: 'İtmiş' },
                  ]}
                  style={styles.dialogInput}
                />
                <Text style={styles.dialogHint}>
                  İşçi seçməsəniz, yazım anbardan aparılacaq.
                </Text>
                {summary?.workers.length ? (
                  <View style={styles.chipRow}>
                    {summary.workers.map((w) => (
                      <Chip
                        key={w.workerId}
                        compact
                        selected={workerId === w.workerId}
                        onPress={() => setWorkerId(workerId === w.workerId ? undefined : w.workerId)}
                      >
                        {w.workerName}
                      </Chip>
                    ))}
                  </View>
                ) : null}
              </>
            )}

            <PaperInput
              label="Bidon sayı"
              value={count}
              onChangeText={(t) => setCount(t.replace(/[^\d]/g, ''))}
              mode="outlined"
              keyboardType="number-pad"
              error={Boolean(countError)}
              style={styles.dialogInput}
            />
            {countError ? <HelperText type="error">{countError}</HelperText> : null}

            <PaperInput
              label={dialogMode === 'writeOff' ? 'Səbəb' : 'Qeyd (istəyə bağlı)'}
              value={note}
              onChangeText={setNote}
              mode="outlined"
              multiline={dialogMode === 'writeOff'}
              error={Boolean(noteError)}
              style={styles.dialogInput}
            />
            {noteError ? <HelperText type="error">{noteError}</HelperText> : null}

            {action.error ? <HelperText type="error">{action.error}</HelperText> : null}
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setDialogMode(null)}>Ləğv et</Button>
            <Button onPress={onSubmit} loading={action.submitting}>
              Təsdiqlə
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      <Snackbar visible={Boolean(snack)} onDismiss={() => setSnack(null)} duration={3500}>
        {snack ?? ''}
      </Snackbar>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  scroll: { padding: spacing.md, paddingBottom: spacing.xxl },
  row: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginVertical: spacing.md },
  actionBtn: { flexGrow: 1 },
  error: { color: colors.danger, fontSize: 12, marginBottom: spacing.sm },
  workerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.sm,
  },
  workerName: { fontSize: 14, fontWeight: '600', color: colors.text },
  workerMeta: { fontSize: 11, color: colors.textMuted },
  qtyBadge: { backgroundColor: colors.infoBg, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 4 },
  qtyText: { fontSize: 14, fontWeight: '700', color: colors.info },
  txRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs },
  txBadge: { minWidth: 44, paddingVertical: 4, paddingHorizontal: 6, borderRadius: radius.sm, alignItems: 'center' },
  txBadgeText: { fontSize: 13, fontWeight: '700' },
  txType: { fontSize: 13, fontWeight: '600', color: colors.text },
  txMeta: { fontSize: 11, color: colors.textMuted },
  dialogHint: { fontSize: 12, color: colors.textMuted, marginBottom: spacing.sm },
  dialogInput: { marginBottom: spacing.sm },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm },
});
