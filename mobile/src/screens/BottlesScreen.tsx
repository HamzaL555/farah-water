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
  Snackbar,
  Chip,
} from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatCard } from '../components/StatCard';
import { SectionCard } from '../components/SectionCard';
import { EmptyState } from '../components/EmptyState';
import { KeyValueRow } from '../components/KeyValueRow';
import { useAsync, useSubmit } from '../hooks/useAsync';
import { useAuth } from '../context/AuthContext';
import { inventoryApi } from '../services/endpoints';
import { formatDateTime, INVENTORY_TYPE_LABEL } from '../utils/format';
import { colors, spacing, radius } from '../theme';
import type { WaterType } from '../types';

type WriteOffType = 'DAMAGE' | 'LOSS';

/**
 * What the open dialog is about to do.
 *
 * IN/TAKE/RETURN move the caller's own stock; DISTRIBUTE is the anbardar
 * handing bottles to a named worker; the two WRITE_OFF cases record breakage,
 * one from the caller's hands and one straight out of the warehouse.
 */
type ActionKind =
  | 'IN'
  | 'TAKE'
  | 'RETURN'
  | 'DISTRIBUTE'
  | 'WRITE_OFF_SELF'
  | 'WRITE_OFF_WAREHOUSE';

const DIALOG_TITLE: Record<ActionKind, string> = {
  IN: 'Anbara qəbul',
  TAKE: 'Anbardan özümə götür',
  RETURN: 'Anbara qaytar',
  DISTRIBUTE: 'İşçiyə bidon ver',
  WRITE_OFF_SELF: 'Zədələnmiş / itmiş (özümdə)',
  WRITE_OFF_WAREHOUSE: 'Anbardan çıxar (zədə / itki)',
};

/**
 * Worker bottles screen.
 *
 * An anbardar runs the warehouse: receives stock, hands it to a named worker,
 * takes their own, returns it, and writes off breakage - every action names the
 * water type, so Bulaq and Filtr never share a number. A regular worker sees
 * only their own two balances and the history; every button that could touch
 * the warehouse is absent, and the server would refuse it anyway.
 */
export const BottlesScreen: React.FC = () => {
  const { user } = useAuth();
  const canManage = user?.role === 'ADMIN' || user?.workerType === 'WAREHOUSE_KEEPER';

  const { data, loading, error, run } = useAsync(() => inventoryApi.myStock().then((r) => r.data), []);
  const { data: history, run: runHistory } = useAsync(
    () => inventoryApi.transactions({ pageSize: 30 }).then((r) => r.data),
    [],
  );
  // A regular worker must never call /inventory/summary: the server refuses it,
  // and the failed request would replace the screen with an error banner.
  const { data: summary, run: runSummary } = useAsync(
    () => (canManage ? inventoryApi.summary().then((r) => r.data) : Promise.resolve(null)),
    [canManage],
  );

  const refreshAll = useCallback(async () => {
    await Promise.all([run(), runHistory(), canManage ? runSummary() : Promise.resolve()]);
  }, [run, runHistory, runSummary, canManage]);

  useFocusEffect(
    useCallback(() => {
      void refreshAll();
    }, [refreshAll]),
  );

  const [dialog, setDialog] = useState<ActionKind | null>(null);

  const [waterType, setWaterType] = useState<WaterType>('FILTERED');
  const [count, setCount] = useState('');
  const [note, setNote] = useState('');
  const [workerId, setWorkerId] = useState<string | null>(null);
  const [writeOffType, setWriteOffType] = useState<WriteOffType>('DAMAGE');
  const [snack, setSnack] = useState<string | null>(null);

  const open = (kind: ActionKind) => {
    setDialog(kind);
    setCount('');
    setNote('');
    setWorkerId(null);
    setWriteOffType('DAMAGE');
  };

  const close = () => setDialog(null);

  const myFiltered = data?.filteredQty ?? 0;
  const mySpring = data?.springQty ?? 0;
  const myTotal = data?.totalQty ?? myFiltered + mySpring;

  const whFiltered = summary?.warehouse?.filtered ?? 0;
  const whSpring = summary?.warehouse?.spring ?? 0;
  const whTotal = summary?.warehouse?.total ?? whFiltered + whSpring;

  const isWriteOff = dialog === 'WRITE_OFF_SELF' || dialog === 'WRITE_OFF_WAREHOUSE';
  const needsWorker = dialog === 'DISTRIBUTE';
  const isWarehouseSource = dialog === 'TAKE' || dialog === 'DISTRIBUTE' || dialog === 'WRITE_OFF_WAREHOUSE';
  // Which balance the action draws from. An inbound has none: it creates stock.
  const boundedSource: 'WAREHOUSE' | 'SELF' | null = isWarehouseSource
    ? 'WAREHOUSE'
    : dialog === 'RETURN' || dialog === 'WRITE_OFF_SELF'
      ? 'SELF'
      : null;

  const countNum = parseInt(count || '0', 10);
  const sourceQty =
    boundedSource === 'WAREHOUSE'
      ? waterType === 'SPRING'
        ? whSpring
        : whFiltered
      : waterType === 'SPRING'
        ? mySpring
        : myFiltered;
  const sourceLoaded = boundedSource === 'WAREHOUSE' ? summary !== null : data !== null;

  const validationError = (() => {
    if (!dialog) return null;
    if (countNum <= 0) return 'Say daxil edin.';
    if (needsWorker && !workerId) return 'İşçi seçin.';
    if (isWriteOff && note.trim().length < 3) return 'Səbəb yazın (ən azı 3 simvol).';
    // The server enforces this too, but catching it here avoids a pointless
    // round trip and tells the anbardar the number they actually have.
    if (boundedSource && sourceLoaded && countNum > sourceQty) {
      return `${boundedSource === 'WAREHOUSE' ? 'Anbarda' : 'Əlinizdə'} ${sourceQty} bidon var.`;
    }
    return null;
  })();

  const action = useSubmit(async () => {
    if (!dialog) throw new Error('Əməliyyat seçilməyib.');
    const payload = {
      waterType,
      bottleCount: countNum,
      note: note.trim() || undefined,
      idempotencyKey: `${dialog.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    };

    switch (dialog) {
      case 'IN':
        return (await inventoryApi.stockIn(payload)).data;
      case 'TAKE':
        return (await inventoryApi.takeFromWarehouse(payload)).data;
      case 'RETURN':
        return (await inventoryApi.returnStock(payload)).data;
      case 'DISTRIBUTE':
        return (
          await inventoryApi.distribute({
            ...payload,
            workerId: workerId as string,
            note: note.trim() || undefined,
          })
        ).data;
      case 'WRITE_OFF_SELF':
        return (
          await inventoryApi.writeOff({ ...payload, type: writeOffType, note: note.trim() })
        ).data;
      case 'WRITE_OFF_WAREHOUSE':
        return (
          await inventoryApi.warehouseWriteOff({ ...payload, type: writeOffType, note: note.trim() })
        ).data;
    }
  });

  const onSubmit = async () => {
    if (validationError) return;
    const entered = countNum;
    const result = await action.submit();
    if (!result) return;
    setSnack(`${entered} bidon: ${DIALOG_TITLE[dialog as ActionKind].toLowerCase()} yerinə yetirildi.`);
    close();
    void refreshAll();
  };

  const workerChoices = (summary?.workers ?? []).filter((w) => w.isActive || w.totalQty > 0);

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
        {canManage ? (
          <>
            <Text style={styles.groupTitle}>Anbar qalığı</Text>
            <View style={styles.row}>
              <StatCard label="Bulaq suyu" value={String(whSpring)} icon="🏔️" accent={colors.info} background={colors.infoBg} />
              <StatCard label="Filtr suyu" value={String(whFiltered)} icon="💧" accent={colors.success} background={colors.successBg} />
            </View>
            <StatCard label="Anbarda cəmi" value={String(whTotal)} icon="🏭" accent={colors.primaryDark} />
          </>
        ) : null}

        <Text style={styles.groupTitle}>Mənim balansım</Text>
        <View style={styles.row}>
          <StatCard label="Bulaq suyu" value={String(mySpring)} icon="🏔️" accent={colors.info} background={colors.infoBg} />
          <StatCard label="Filtr suyu" value={String(myFiltered)} icon="💧" accent={colors.success} background={colors.successBg} />
        </View>
        <StatCard label="Əlimdə cəmi" value={String(myTotal)} icon="📦" accent={colors.primary} />

        {canManage ? (
          <View style={styles.actions}>
            <Button mode="contained" icon="tray-arrow-down" onPress={() => open('IN')} style={styles.actionButton}>
              Anbara qəbul
            </Button>
            <Button mode="contained-tonal" icon="account-arrow-right" onPress={() => open('DISTRIBUTE')} style={styles.actionButton}>
              İşçiyə ver
            </Button>
            <Button mode="outlined" icon="tray-arrow-up" onPress={() => open('TAKE')} style={styles.actionButton}>
              Özümə götür
            </Button>
            <Button mode="outlined" icon="undo" onPress={() => open('RETURN')} style={styles.actionButton}>
              Anbara qaytar
            </Button>
            <Button mode="outlined" icon="alert-circle" onPress={() => open('WRITE_OFF_WAREHOUSE')} style={styles.actionButton}>
              Anbardan çıxar
            </Button>
            <Button mode="outlined" icon="close-circle" onPress={() => open('WRITE_OFF_SELF')} style={styles.actionButton}>
              Özümdə zədə / itki
            </Button>
          </View>
        ) : (
          <View style={styles.notice}>
            <Text style={styles.noticeText}>
              Siz adi işçisiniz. Bidonları sizə anbardar təhvil verir; bu ekranda yalnız öz
              balansınızı görürsünüz. Anbara və başqa işçinin balansına toxuna bilməzsiniz.
            </Text>
          </View>
        )}

        {canManage ? (
          <Text style={styles.hint}>
            Hər əməliyyatda su növü ayrıca seçilir. Bulaq və Filtr heç vaxt bir balansa
            toplanmır; hər hərəkət kim, nə vaxt və hansı balansdan yazılır.
          </Text>
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {canManage && summary && summary.workers.length > 0 ? (
          <SectionCard title="İşçilərin balansı" subtitle="Bulaq və Filtr ayrı-ayrı">
            {summary.workers.map((w) => (
              <View key={w.workerId} style={styles.workerRow}>
                <View style={styles.flex}>
                  <Text style={styles.workerName}>
                    {w.workerName}
                    {w.workerId === user?.id ? ' (siz)' : ''}
                  </Text>
                  <Text style={styles.workerMeta}>
                    {w.workerType === 'WAREHOUSE_KEEPER' ? 'Anbardar' : 'Adi işçi'}
                    {w.isActive ? '' : ' · deaktiv'}
                  </Text>
                </View>
                <View style={styles.qtyCol}>
                  <Text style={[styles.qty, w.springQty === 0 && styles.qtyZero]}>{w.springQty}</Text>
                  <Text style={styles.qtyLabel}>Bulaq</Text>
                </View>
                <View style={styles.qtyCol}>
                  <Text style={[styles.qty, w.filteredQty === 0 && styles.qtyZero]}>{w.filteredQty}</Text>
                  <Text style={styles.qtyLabel}>Filtr</Text>
                </View>
              </View>
            ))}
          </SectionCard>
        ) : null}

        <SectionCard title="Hərəkət tarixçəsi" subtitle="Son əməliyyatlar">
          {loading && !history ? (
            <ActivityIndicator />
          ) : !history || history.items.length === 0 ? (
            <EmptyState icon="📋" title="Əməliyyat yoxdur" message="Hələ heç bir bidon hərəkəti qeydə alınmayıb." />
          ) : (
            history.items.slice(0, 20).map((t) => (
              <View key={t.id} style={styles.txRow}>
                <View
                  style={[
                    styles.txBadge,
                    { backgroundColor: t.signedCount > 0 ? colors.successBg : colors.dangerBg },
                  ]}
                >
                  <Text style={[styles.txBadgeText, { color: t.signedCount > 0 ? colors.success : colors.danger }]}>
                    {t.signedCount > 0 ? '+' : ''}
                    {t.signedCount}
                  </Text>
                </View>
                <View style={styles.flex}>
                  <Text style={styles.txTitle}>
                    {t.waterType === 'SPRING' ? '🏔️ Bulaq' : '💧 Filtr'} · {INVENTORY_TYPE_LABEL[t.type] ?? t.type}
                  </Text>
                  <Text style={styles.txMeta}>
                    {formatDateTime(t.occurredAt)}
                    {t.workerName ? ` · ${t.workerName}` : ''}
                  </Text>
                  {t.note ? <Text style={styles.txNote}>{t.note}</Text> : null}
                </View>
              </View>
            ))
          )}
        </SectionCard>

        <KeyValueRow label="Son yenilənmə" value={formatDateTime(data?.updatedAt ?? null)} />
      </ScrollView>

      <Portal>
        <Dialog visible={dialog !== null} onDismiss={close}>
          <Dialog.Title>{dialog ? DIALOG_TITLE[dialog] : ''}</Dialog.Title>
          <Dialog.Content>
            <Text style={styles.dialogHint}>
              {dialog === 'DISTRIBUTE'
                ? 'Seçilən bidonlar anbardan çıxıb işçinin balansına yazılır.'
                : isWarehouseSource
                  ? `Anbarda: Bulaq ${whSpring}, Filtr ${whFiltered}.`
                  : `Əlinizdə: Bulaq ${mySpring}, Filtr ${myFiltered}.`}
            </Text>

            <SegmentedButtons
              value={waterType}
              onValueChange={(v) => setWaterType(v as WaterType)}
              buttons={[
                { value: 'FILTERED', label: '💧 Filtr' },
                { value: 'SPRING', label: '🏔️ Bulaq' },
              ]}
              style={styles.dialogInput}
            />

            {needsWorker ? (
              <View style={styles.chipWrap}>
                {workerChoices.length === 0 ? (
                  <Text style={styles.dialogHint}>Əvvəlcə işçi hesabı yaradılmalıdır.</Text>
                ) : (
                  workerChoices.map((w) => (
                    <Chip
                      key={w.workerId}
                      selected={workerId === w.workerId}
                      onPress={() => setWorkerId(w.workerId)}
                      style={styles.chip}
                    >
                      {w.workerName}
                    </Chip>
                  ))
                )}
              </View>
            ) : null}

            {isWriteOff ? (
              <SegmentedButtons
                value={writeOffType}
                onValueChange={(v) => setWriteOffType(v as WriteOffType)}
                buttons={[
                  { value: 'DAMAGE', label: 'Zədələnmiş' },
                  { value: 'LOSS', label: 'İtmiş' },
                ]}
                style={styles.dialogInput}
              />
            ) : null}

            <PaperInput
              label="Bidon sayı"
              value={count}
              onChangeText={(t) => setCount(t.replace(/[^\d]/g, ''))}
              mode="outlined"
              keyboardType="number-pad"
              error={Boolean(count) && Boolean(validationError)}
              style={styles.dialogInput}
            />

            <PaperInput
              label={isWriteOff ? 'Səbəb' : 'Qeyd (istəyə bağlı)'}
              value={note}
              onChangeText={setNote}
              mode="outlined"
              multiline={isWriteOff}
              style={styles.dialogInput}
            />

            {count && validationError ? <HelperText type="error">{validationError}</HelperText> : null}
            {action.error ? <HelperText type="error">{action.error}</HelperText> : null}
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={close}>Ləğv et</Button>
            <Button
              onPress={onSubmit}
              loading={action.submitting}
              disabled={action.submitting || validationError !== null}
            >
              {dialog === 'WRITE_OFF_SELF' || dialog === 'WRITE_OFF_WAREHOUSE' ? 'Qeydə al' : 'Təsdiq et'}
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
  groupTitle: { fontSize: 13, fontWeight: '700', color: colors.primaryDark, marginTop: spacing.sm, marginBottom: spacing.xs },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md, marginBottom: spacing.xs },
  actionButton: { flexGrow: 1, flexBasis: '45%' },
  hint: { fontSize: 11, color: colors.textMuted, marginBottom: spacing.md, lineHeight: 16 },
  notice: {
    backgroundColor: colors.infoBg,
    borderRadius: radius.sm,
    padding: spacing.md,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  noticeText: { fontSize: 12, color: colors.info, lineHeight: 18 },
  error: { color: colors.danger, fontSize: 12, marginBottom: spacing.sm },
  workerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.md,
  },
  workerName: { fontSize: 13, fontWeight: '600', color: colors.text },
  workerMeta: { fontSize: 11, color: colors.textMuted },
  qtyCol: { alignItems: 'center', minWidth: 44 },
  qty: { fontSize: 15, fontWeight: '700', color: colors.primaryDark },
  qtyZero: { color: colors.textMuted },
  qtyLabel: { fontSize: 9, color: colors.textMuted },
  txRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs },
  txBadge: { minWidth: 44, paddingVertical: 4, paddingHorizontal: 6, borderRadius: radius.sm, alignItems: 'center' },
  txBadgeText: { fontSize: 13, fontWeight: '700' },
  txTitle: { fontSize: 13, fontWeight: '600', color: colors.text },
  txMeta: { fontSize: 11, color: colors.textMuted },
  txNote: { fontSize: 11, color: colors.textMuted, fontStyle: 'italic' },
  dialogHint: { fontSize: 12, color: colors.textMuted, marginBottom: spacing.sm },
  dialogInput: { marginBottom: spacing.sm },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm },
  chip: { marginRight: 4, marginBottom: 4 },
});
