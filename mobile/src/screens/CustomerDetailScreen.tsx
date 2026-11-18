import React, { useCallback, useState } from 'react';
import { View, ScrollView, StyleSheet, RefreshControl, Text, Linking, Pressable } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  Button,
  ActivityIndicator,
  Dialog,
  Divider,
  HelperText,
  Portal,
  SegmentedButtons,
  Snackbar,
  TextInput as PaperInput,
} from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatCard } from '../components/StatCard';
import { DeliveryRow } from '../components/DeliveryRow';
import { EmptyState } from '../components/EmptyState';
import { KeyValueRow } from '../components/KeyValueRow';
import { SectionCard } from '../components/SectionCard';
import { useAuth } from '../context/AuthContext';
import { useAsync, useSubmit } from '../hooks/useAsync';
import { customersApi, depositsApi } from '../services/endpoints';
import { formatDate, formatDateTime, formatMoney, normalizeMoneyInput } from '../utils/format';
import { colors, spacing } from '../theme';
import type { AdminStackParamList } from '../navigation/types';
import type { CustomerDeposit, DepositTxType } from '../types';

type Props = NativeStackScreenProps<AdminStackParamList, 'CustomerDetail'>;

const DEPOSIT_LABEL: Record<DepositTxType, string> = {
  DEPOSIT_IN: 'Depozit qəbul edildi',
  DEPOSIT_OUT: 'Depozit qaytarıldı',
  ADJUSTMENT: 'Düzəliş',
};

const DEPOSIT_COLOR: Record<DepositTxType, string> = {
  DEPOSIT_IN: colors.success,
  DEPOSIT_OUT: colors.danger,
  ADJUSTMENT: colors.warning,
};

/**
 * Customer profile: totals, deliveries, and - for an admin - the deposit ledger.
 *
 * The deposit balance is never stored on the customer: it is the sum of an
 * append-only ledger, so every lari and bottle can be traced to the movement
 * that produced it. Tapping the address opens it in Google Maps.
 */
export const CustomerDetailScreen: React.FC<Props> = ({ route }) => {
  const { customerId } = route.params;
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';

  const { data, loading, error, run } = useAsync(
    () => customersApi.detail(customerId).then((r) => r.data),
    [customerId],
  );

  useFocusEffect(
    useCallback(() => {
      void run(false);
    }, [run]),
  );

  const [depositType, setDepositType] = useState<DepositTxType | null>(null);
  const [amount, setAmount] = useState('');
  const [bottles, setBottles] = useState('');
  const [note, setNote] = useState('');
  const [snack, setSnack] = useState<string | null>(null);

  const isAdjustment = depositType === 'ADJUSTMENT';
  const amountNumber = Number(normalizeMoneyInput(amount));
  const bottleNumber = parseInt(bottles || '0', 10);

  const depositError = (() => {
    if (!depositType) return null;
    if (amount.trim() === '') return 'Məbləğ yazın.';
    if (!Number.isFinite(amountNumber) || amountNumber === 0) return 'Məbləğ sıfır ola bilməz.';
    if (!isAdjustment && amountNumber <= 0) return 'Məbləğ sıfırdan böyük olmalıdır.';
    if (!Number.isFinite(bottleNumber)) return 'Bidon sayı düzgün deyil.';
    if (depositType === 'DEPOSIT_OUT' && amountNumber > (data?.depositBalance ?? 0)) {
      return `Mövcud depozit ${formatMoney(data?.depositBalance ?? 0)}. Ondan çox qaytarmaq olmaz.`;
    }
    return null;
  })();

  const depositAction = useSubmit(async () => {
    if (!depositType) throw new Error('Əməliyyat seçilməyib.');
    return depositsApi.create({
      idempotencyKey: `dep-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      customerId,
      type: depositType,
      amount: normalizeMoneyInput(amount),
      bottleCount: bottleNumber,
      note: note.trim() || undefined,
    });
  });

  const openDeposit = (type: DepositTxType) => {
    setDepositType(type);
    setAmount('');
    setBottles('');
    setNote('');
  };

  const onDepositSave = async () => {
    if (depositError) return;
    const result = await depositAction.submit();
    if (!result) return;
    setDepositType(null);
    setSnack('Depozit əməliyyatı yazıldı.');
    void run(false);
  };

  const openMaps = () => {
    if (!data?.address) return;
    void Linking.openURL(
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(data.address)}`,
    );
  };

  if (loading && !data) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <ActivityIndicator size="large" />
        </View>
      </SafeAreaView>
    );
  }

  if (error || !data) {
    return (
      <SafeAreaView style={styles.safe}>
        <EmptyState icon="⚠️" title="Yüklənmədi" message={error ?? 'Məlumat tapılmadı.'} actionLabel="Yenidən" onAction={() => void run()} />
      </SafeAreaView>
    );
  }

  const deposits: CustomerDeposit[] = data.deposits ?? [];

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void run()} />}
      >
        <SectionCard title={data.name} subtitle={data.address}>
          <KeyValueRow label="Telefon" value={data.phone ?? '-'} />
          <Pressable onPress={openMaps} android_ripple={{ color: colors.surfaceVariant }}>
            <KeyValueRow label="Ünvan (xəritədə aç)" value={data.address} valueColor={colors.primary} />
          </Pressable>
          <KeyValueRow label="Qeyd" value={data.note ?? '-'} />
          <KeyValueRow label="Qeydiyyat tarixi" value={formatDate(data.createdAt)} />
        </SectionCard>

        <View style={styles.row}>
          <StatCard label="Ümumi çatdırılmış" value={formatMoney(data.totalDelivered)} icon="📄" accent={colors.primary} />
          <StatCard
            label="Ödənilən"
            value={formatMoney(data.totalPaid)}
            icon="✅"
            accent={colors.success}
            background={colors.successBg}
          />
        </View>

        <View style={styles.row}>
          <StatCard
            label="Qalan borc"
            value={formatMoney(data.totalDebt)}
            icon="⚠️"
            accent={data.totalDebt > 0 ? colors.danger : colors.success}
            background={data.totalDebt > 0 ? colors.dangerBg : colors.successBg}
          />
          <StatCard label="Ümumi bidon" value={String(data.totalBottles)} icon="🧴" accent={colors.info} background={colors.infoBg} />
        </View>

        {isAdmin ? (
          <SectionCard
            title="Depozit"
            subtitle="Şirkətin saxladığı pul — gəlir deyil"
            right={
              <View style={styles.depositTotals}>
                <Text style={styles.depositMoney}>{formatMoney(data.depositBalance ?? 0)}</Text>
                <Text style={styles.depositBottles}>{data.depositBottleBalance ?? 0} bidon</Text>
              </View>
            }
          >
            <View style={styles.depositActions}>
              <Button compact mode="contained" icon="plus" onPress={() => openDeposit('DEPOSIT_IN')}>
                Qəbul et
              </Button>
              <Button compact mode="outlined" icon="minus" onPress={() => openDeposit('DEPOSIT_OUT')}>
                Qaytar
              </Button>
              <Button compact mode="text" onPress={() => openDeposit('ADJUSTMENT')}>
                Düzəliş
              </Button>
            </View>

            {deposits.length === 0 ? (
              <Text style={styles.emptyDeposit}>Depozit hərəkəti yoxdur.</Text>
            ) : (
              deposits.map((d) => {
                const sign = d.amount > 0 ? '+' : d.amount < 0 ? '−' : '';
                return (
                  <View key={d.id} style={styles.depositRow}>
                    <View style={styles.flex}>
                      <Text style={[styles.depositType, { color: DEPOSIT_COLOR[d.type] ?? colors.text }]}>
                        {DEPOSIT_LABEL[d.type] ?? d.type}
                      </Text>
                      <Text style={styles.depositMeta}>
                        {formatDateTime(d.occurredAt)}
                        {d.createdByName ? ` · ${d.createdByName}` : ''}
                      </Text>
                      {d.note ? <Text style={styles.depositNote}>{d.note}</Text> : null}
                    </View>
                    <View style={styles.depositAmountCol}>
                      <Text style={[styles.depositAmount, { color: DEPOSIT_COLOR[d.type] ?? colors.text }]}>
                        {sign}
                        {formatMoney(Math.abs(d.amount))}
                      </Text>
                      <Text style={styles.depositMeta}>
                        {d.bottleCount > 0 ? '+' : ''}
                        {d.bottleCount} bidon
                      </Text>
                      <Text style={styles.depositBalanceAfter}>
                        {formatMoney(d.balanceAfter)} · {d.bottleBalanceAfter} bidon
                      </Text>
                    </View>
                  </View>
                );
              })
            )}
          </SectionCard>
        ) : null}

        <Divider style={styles.divider} />
        <Text style={styles.sectionTitle}>Çatdırılmalar ({data.deliveries.length})</Text>

        {data.deliveries.length === 0 ? (
          <EmptyState icon="🚚" title="Çatdırılma yoxdur" message="Bu müştəri üçün hələ çatdırılma qeydə alınmayıb." />
        ) : (
          data.deliveries.map((d) => <DeliveryRow key={d.id} delivery={d} showWorker isAdmin={isAdmin} />)
        )}

        <Button mode="outlined" onPress={() => void run()} style={styles.refresh}>
          Yenilə
        </Button>
      </ScrollView>

      <Portal>
        <Dialog visible={depositType !== null} onDismiss={() => setDepositType(null)}>
          <Dialog.Title>{depositType ? DEPOSIT_LABEL[depositType] : ''}</Dialog.Title>
          <Dialog.Content>
            <Text style={styles.dialogHint}>
              Mövcud depozit: {formatMoney(data.depositBalance ?? 0)} · {data.depositBottleBalance ?? 0} bidon
            </Text>

            <SegmentedButtons
              value={depositType ?? 'DEPOSIT_IN'}
              onValueChange={(v) => setDepositType(v as DepositTxType)}
              buttons={[
                { value: 'DEPOSIT_IN', label: 'Qəbul' },
                { value: 'DEPOSIT_OUT', label: 'Qaytar' },
                { value: 'ADJUSTMENT', label: 'Düzəliş' },
              ]}
              style={styles.dialogInput}
            />

            <PaperInput
              label={isAdjustment ? 'Məbləğ (mənfi də ola bilər)' : 'Məbləğ (AZN)'}
              value={amount}
              onChangeText={(t) => setAmount(normalizeMoneyInput(t))}
              mode="outlined"
              keyboardType="decimal-pad"
              style={styles.dialogInput}
            />
            <PaperInput
              label={isAdjustment ? 'Bidon sayı (mənfi də ola bilər)' : 'Bidon sayı'}
              value={bottles}
              onChangeText={(t) => setBottles(t.replace(/[^\d-]/g, ''))}
              mode="outlined"
              keyboardType="number-pad"
              style={styles.dialogInput}
            />
            <PaperInput
              label="Qeyd / səbəb"
              value={note}
              onChangeText={setNote}
              mode="outlined"
              multiline
              style={styles.dialogInput}
            />

            {amount && depositError ? <HelperText type="error">{depositError}</HelperText> : null}
            {depositAction.error ? <HelperText type="error">{depositAction.error}</HelperText> : null}
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setDepositType(null)}>Ləğv et</Button>
            <Button onPress={onDepositSave} loading={depositAction.submitting} disabled={depositAction.submitting || depositError !== null}>
              Yadda saxla
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
  center: { flex: 1, justifyContent: 'center' },
  scroll: { padding: spacing.md, paddingBottom: spacing.xxl },
  row: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  divider: { marginVertical: spacing.lg },
  sectionTitle: { fontSize: 15, fontWeight: '600', color: colors.text, marginBottom: spacing.sm },
  refresh: { marginTop: spacing.md },
  depositTotals: { alignItems: 'flex-end' },
  depositMoney: { fontSize: 16, fontWeight: '700', color: colors.primaryDark },
  depositBottles: { fontSize: 11, color: colors.textMuted },
  depositActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm },
  emptyDeposit: { fontSize: 12, color: colors.textMuted },
  depositRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
  },
  depositType: { fontSize: 12, fontWeight: '700' },
  depositMeta: { fontSize: 11, color: colors.textMuted },
  depositNote: { fontSize: 12, color: colors.text, fontStyle: 'italic' },
  depositAmountCol: { alignItems: 'flex-end', minWidth: 100 },
  depositAmount: { fontSize: 13, fontWeight: '700' },
  depositBalanceAfter: { fontSize: 10, color: colors.textMuted },
  dialogHint: { fontSize: 12, color: colors.text, marginBottom: spacing.sm },
  dialogInput: { marginBottom: spacing.sm },
});
