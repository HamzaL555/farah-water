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
} from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatCard } from '../components/StatCard';
import { SectionCard } from '../components/SectionCard';
import { EmptyState } from '../components/EmptyState';
import { KeyValueRow } from '../components/KeyValueRow';
import { useAsync, useSubmit } from '../hooks/useAsync';
import { inventoryApi } from '../services/endpoints';
import { formatDateTime, INVENTORY_TYPE_LABEL } from '../utils/format';
import { colors, spacing, radius } from '../theme';

type WriteOffType = 'DAMAGE' | 'LOSS';

/**
 * Worker stock view.
 *
 * Shows the worker's own bottle count and lets them return unsold bottles or
 * write off damaged/lost ones. Warehouse operations are admin-only.
 */
export const BottlesScreen: React.FC = () => {
  const { data, loading, error, run } = useAsync(() => inventoryApi.myStock().then((r) => r.data), []);
  const { data: history, run: runHistory } = useAsync(
    () => inventoryApi.transactions({ pageSize: 30 }).then((r) => r.data),
    [],
  );

  const refreshAll = useCallback(async () => {
    await Promise.all([run(), runHistory()]);
  }, [run, runHistory]);

  useFocusEffect(
    useCallback(() => {
      void refreshAll();
    }, [refreshAll]),
  );

  const [stockInOpen, setStockInOpen] = useState(false);
  const [stockInCount, setStockInCount] = useState('');
  const [stockInNote, setStockInNote] = useState('');

  const [returnOpen, setReturnOpen] = useState(false);
  const [returnCount, setReturnCount] = useState('');
  const [returnNote, setReturnNote] = useState('');

  const [writeOffOpen, setWriteOffOpen] = useState(false);
  const [writeOffType, setWriteOffType] = useState<WriteOffType>('DAMAGE');
  const [writeOffCount, setWriteOffCount] = useState('');
  const [writeOffNote, setWriteOffNote] = useState('');

  const [snack, setSnack] = useState<string | null>(null);

  /**
   * Workers physically count what arrives, so they may post the inbound. The
   * server records who did it and the admin's warehouse view shows the same
   * figure, so both sides see one number.
   */
  const stockInAction = useSubmit(() =>
    inventoryApi
      .stockIn({
        bottleCount: parseInt(stockInCount || '0', 10),
        note: stockInNote.trim() || undefined,
        idempotencyKey: `in-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      })
      .then((r) => r.data),
  );

  const returnAction = useSubmit(() =>
    inventoryApi
      .returnStock({
        bottleCount: parseInt(returnCount || '0', 10),
        note: returnNote.trim() || undefined,
        idempotencyKey: `ret-${Date.now()}`,
      })
      .then((r) => r.data),
  );

  const writeOffAction = useSubmit(() =>
    inventoryApi
      .writeOff({
        type: writeOffType,
        bottleCount: parseInt(writeOffCount || '0', 10),
        note: writeOffNote.trim(),
        idempotencyKey: `wo-${Date.now()}`,
      })
      .then((r) => r.data),
  );

  const myQuantity = data?.quantity ?? 0;
  const returnCountNum = parseInt(returnCount || '0', 10);
  const writeOffCountNum = parseInt(writeOffCount || '0', 10);
  const stockInCountNum = parseInt(stockInCount || '0', 10);

  const stockInError = stockInCountNum <= 0 ? 'Say daxil edin.' : null;

  const returnError = returnCountNum <= 0 ? 'Say daxil edin.' : returnCountNum > myQuantity ? `Əlinizdə ${myQuantity} bidon var.` : null;
  const writeOffError =
    writeOffCountNum <= 0
      ? 'Say daxil edin.'
      : writeOffCountNum > myQuantity
        ? `Əlinizdə ${myQuantity} bidon var.`
        : !writeOffNote.trim()
          ? 'Səbəb yazın.'
          : null;

  const onStockIn = async () => {
    if (stockInError) return;
    const entered = stockInCountNum;
    const result = await stockInAction.submit();
    if (!result) return;
    setStockInOpen(false);
    setStockInCount('');
    setStockInNote('');
    setSnack(`${entered} bidon anbara qəbul edildi. Anbarda: ${result.newBalance} bidon.`);
    void refreshAll();
  };

  const onReturn = async () => {
    if (returnError) return;
    const returnedCount = returnCountNum;
    const result = await returnAction.submit();
    if (!result) return;
    setReturnOpen(false);
    setReturnCount('');
    setReturnNote('');
    setSnack(`${returnedCount} bidon anbara qaytarıldı. Əlinizdə: ${result.newBalance} bidon.`);
    void refreshAll();
  };

  const onWriteOff = async () => {
    if (writeOffError) return;
    const result = await writeOffAction.submit();
    if (!result) return;
    setWriteOffOpen(false);
    setWriteOffCount('');
    setWriteOffNote('');
    setSnack('Qeydə alındı.');
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
          <StatCard label="Əlimdəki bidonlar" value={String(myQuantity)} icon="📦" accent={colors.primary} />
          <StatCard label="Anbarda (ümumi)" value={String(history?.total ?? myQuantity)} icon="🏭" accent={colors.info} background={colors.infoBg} />
        </View>

        <View style={styles.actions}>
          <Button mode="contained" icon="tray-arrow-down" onPress={() => setStockInOpen(true)} style={styles.actionButton}>
            Anbara qəbul
          </Button>
          <Button mode="contained-tonal" icon="undo" onPress={() => setReturnOpen(true)} style={styles.actionButton}>
            Anbara qaytar
          </Button>
          <Button mode="outlined" icon="alert-circle" onPress={() => setWriteOffOpen(true)} style={styles.actionButton}>
            Zədələnmiş / itmiş
          </Button>
        </View>

        <Text style={styles.hint}>
          "Anbara qəbul" — yeni gələn bidonları yaz. Admin dərhal görür. "Anbara qaytar" isə öz əlinizdən artıq qalanı geri qaytarır.
        </Text>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <SectionCard title="İnventar tarixçəsi" subtitle="Son əməliyyatlar">
          {loading && !history ? (
            <ActivityIndicator />
          ) : !history || history.items.length === 0 ? (
            <EmptyState icon="📋" title="Əməliyyat yoxdur" message="Hələ heç bir anbar əməliyyatı qeydə alınmayıb." />
          ) : (
            history.items.slice(0, 15).map((t) => (
              <View key={t.id} style={styles.txRow}>
                <View
                  style={[
                    styles.txBadge,
                    { backgroundColor: t.signedCount > 0 ? colors.successBg : colors.dangerBg },
                  ]}
                >
                  <Text
                    style={[
                      styles.txBadgeText,
                      { color: t.signedCount > 0 ? colors.success : colors.danger },
                    ]}
                  >
                    {t.signedCount > 0 ? '+' : ''}
                    {t.signedCount}
                  </Text>
                </View>
                <View style={styles.flex}>
                  <Text style={styles.txType}>{INVENTORY_TYPE_LABEL[t.type]}</Text>
                  <Text style={styles.txMeta}>
                    {formatDateTime(t.occurredAt)}
                    {t.note ? ` · ${t.note}` : ''}
                  </Text>
                </View>
              </View>
            ))
          )}
        </SectionCard>

        <KeyValueRow label="Son yenilənmə" value={formatDateTime(data?.updatedAt ?? null)} />
      </ScrollView>

      {/* stock in dialog */}
      <Portal>
        <Dialog visible={stockInOpen} onDismiss={() => setStockInOpen(false)}>
          <Dialog.Title>Anbara qəbul</Dialog.Title>
          <Dialog.Content>
            <Text style={styles.dialogHint}>Yeni gələn bidonların sayını yazın. Admin bunu dərhal görəcək.</Text>
            <PaperInput
              label="Bidon sayı"
              value={stockInCount}
              onChangeText={(t) => setStockInCount(t.replace(/[^\d]/g, ''))}
              mode="outlined"
              keyboardType="number-pad"
              error={Boolean(stockInCount) && Boolean(stockInError)}
              style={styles.dialogInput}
            />
            {stockInCount && stockInError ? <HelperText type="error">{stockInError}</HelperText> : null}
            <PaperInput
              label="Qeyd (istəyə bağlı)"
              value={stockInNote}
              onChangeText={setStockInNote}
              mode="outlined"
              style={styles.dialogInput}
            />
            {stockInAction.error ? <HelperText type="error">{stockInAction.error}</HelperText> : null}
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setStockInOpen(false)}>Ləğv et</Button>
            <Button onPress={onStockIn} loading={stockInAction.submitting} disabled={stockInAction.submitting}>
              Qəbul et
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      {/* return stock dialog */}
      <Portal>
        <Dialog visible={returnOpen} onDismiss={() => setReturnOpen(false)}>
          <Dialog.Title>Anbara qaytar</Dialog.Title>
          <Dialog.Content>
            <Text style={styles.dialogHint}>Əlinizdə: {myQuantity} bidon</Text>
            <PaperInput
              label="Bidon sayı"
              value={returnCount}
              onChangeText={(t) => setReturnCount(t.replace(/[^\d]/g, ''))}
              mode="outlined"
              keyboardType="number-pad"
              error={Boolean(returnCount) && Boolean(returnError)}
              style={styles.dialogInput}
            />
            {returnCount && returnError ? <HelperText type="error">{returnError}</HelperText> : null}
            <PaperInput
              label="Qeyd (istəyə bağlı)"
              value={returnNote}
              onChangeText={setReturnNote}
              mode="outlined"
              style={styles.dialogInput}
            />
            {returnAction.error ? <HelperText type="error">{returnAction.error}</HelperText> : null}
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setReturnOpen(false)}>Ləğv et</Button>
            <Button onPress={onReturn} loading={returnAction.submitting}>
              Qaytar
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      {/* write-off dialog */}
      <Portal>
        <Dialog visible={writeOffOpen} onDismiss={() => setWriteOffOpen(false)}>
          <Dialog.Title>Zədələnmiş / itmiş</Dialog.Title>
          <Dialog.Content>
            <SegmentedButtons
              value={writeOffType}
              onValueChange={(v) => setWriteOffType(v as WriteOffType)}
              buttons={[
                { value: 'DAMAGE', label: 'Zədələnmiş' },
                { value: 'LOSS', label: 'İtmiş' },
              ]}
              style={styles.dialogInput}
            />
            <PaperInput
              label="Bidon sayı"
              value={writeOffCount}
              onChangeText={(t) => setWriteOffCount(t.replace(/[^\d]/g, ''))}
              mode="outlined"
              keyboardType="number-pad"
              style={styles.dialogInput}
            />
            <PaperInput
              label="Səbəb"
              value={writeOffNote}
              onChangeText={setWriteOffNote}
              mode="outlined"
              multiline
              style={styles.dialogInput}
            />
            {writeOffCount && writeOffError ? <HelperText type="error">{writeOffError}</HelperText> : null}
            {writeOffAction.error ? <HelperText type="error">{writeOffAction.error}</HelperText> : null}
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setWriteOffOpen(false)}>Ləğv et</Button>
            <Button onPress={onWriteOff} loading={writeOffAction.submitting}>
              Qeydə al
            </Button>
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
  flex: { flex: 1 },
  scroll: { padding: spacing.md, paddingBottom: spacing.xxl },
  row: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.xs },
  actionButton: { flexGrow: 1 },
  hint: { fontSize: 11, color: colors.textMuted, marginBottom: spacing.md, lineHeight: 16 },
  error: { color: colors.danger, fontSize: 12, marginBottom: spacing.sm },
  txRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs },
  txBadge: { minWidth: 44, paddingVertical: 4, paddingHorizontal: 6, borderRadius: radius.sm, alignItems: 'center' },
  txBadgeText: { fontSize: 13, fontWeight: '700' },
  txType: { fontSize: 13, fontWeight: '600', color: colors.text },
  txMeta: { fontSize: 11, color: colors.textMuted },
  dialogHint: { fontSize: 12, color: colors.textMuted, marginBottom: spacing.sm },
  dialogInput: { marginBottom: spacing.sm },
});
