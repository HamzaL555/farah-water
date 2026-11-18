import React, { useState, useCallback } from 'react';
import { View, ScrollView, StyleSheet, RefreshControl, Text, Pressable } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  ActivityIndicator,
  Button,
  Chip,
  Dialog,
  FAB,
  HelperText,
  Portal,
  Searchbar,
  SegmentedButtons,
  Snackbar,
  TextInput as PaperInput,
} from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatCard } from '../components/StatCard';
import { SectionCard } from '../components/SectionCard';
import { EmptyState } from '../components/EmptyState';
import { useAsync, useSubmit } from '../hooks/useAsync';
import { customersApi, depositsApi } from '../services/endpoints';
import { formatDateTime, formatMoney, normalizeMoneyInput } from '../utils/format';
import { colors, spacing, radius } from '../theme';
import type { Customer, CustomerDeposit, DepositTxType } from '../types';
import type { AdminStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<AdminStackParamList, 'Deposits'>;

const TYPE_LABEL: Record<DepositTxType, string> = {
  DEPOSIT_IN: 'Depozit qəbul edildi',
  DEPOSIT_OUT: 'Depozit qaytarıldı',
  ADJUSTMENT: 'Düzəliş',
};

const TYPE_COLOR: Record<DepositTxType, string> = {
  DEPOSIT_IN: colors.success,
  DEPOSIT_OUT: colors.danger,
  ADJUSTMENT: colors.warning,
};

/**
 * Customer deposit ledger.
 *
 * A deposit is money the company holds for a customer's bottles - it is not
 * revenue and never appears in the sales figures. Every row is append-only and
 * carries the balance it produced, so the history can always be replayed.
 */
export const DepositsScreen: React.FC<Props> = ({ navigation }) => {
  const [typeFilter, setTypeFilter] = useState<DepositTxType | ''>('');
  const [snack, setSnack] = useState<string | null>(null);

  const { data, loading, error, run } = useAsync(
    () => depositsApi.list({ type: typeFilter || undefined, pageSize: 100 }).then((r) => r.data),
    [typeFilter],
  );

  useFocusEffect(
    useCallback(() => {
      void run(false);
    }, [run]),
  );

  // ------------------------------- new deposit -----------------------------
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [formCustomer, setFormCustomer] = useState<Customer | null>(null);
  const [type, setType] = useState<DepositTxType>('DEPOSIT_IN');
  const [amount, setAmount] = useState('');
  const [bottles, setBottles] = useState('');
  const [note, setNote] = useState('');

  const { data: customerPage, loading: customersLoading } = useAsync(
    () =>
      pickerOpen
        ? customersApi.list({ search: search.trim() || undefined, pageSize: 30 }).then((r) => r.data)
        : Promise.resolve(null),
    [pickerOpen, search],
  );

  const isAdjustment = type === 'ADJUSTMENT';
  const amountNumber = Number(normalizeMoneyInput(amount));
  const bottleNumber = parseInt(bottles || '0', 10);

  const formError = (() => {
    if (amount.trim() === '') return 'Məbləğ yazın.';
    if (!Number.isFinite(amountNumber) || amountNumber === 0) return 'Məbləğ sıfır ola bilməz.';
    if (!isAdjustment && amountNumber <= 0) return 'Məbləğ sıfırdan böyük olmalıdır.';
    if (!Number.isFinite(bottleNumber)) return 'Bidon sayı düzgün deyil.';
    if (!isAdjustment && bottleNumber < 0) return 'Bidon sayı mənfi ola bilməz.';
    return null;
  })();

  const createAction = useSubmit(async () => {
    if (!formCustomer) throw new Error('Müştəri seçilməyib.');
    return depositsApi.create({
      idempotencyKey: `dep-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      customerId: formCustomer.id,
      type,
      amount: normalizeMoneyInput(amount),
      bottleCount: bottleNumber,
      note: note.trim() || undefined,
    });
  });

  const openForm = (customer: Customer) => {
    setFormCustomer(customer);
    setType('DEPOSIT_IN');
    setAmount('');
    setBottles('');
    setNote('');
    setPickerOpen(false);
    setSearch('');
  };

  const onCreate = async () => {
    if (formError) return;
    const result = await createAction.submit();
    if (!result) return;
    setFormCustomer(null);
    setSnack('Depozit əməliyyatı yazıldı.');
    void run(false);
  };

  const items = data?.items ?? [];
  const totals = data?.totals ?? { amount: 0, bottleCount: 0 };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void run()} />}
      >
        <Text style={styles.intro}>
          Depozit pulu şirkətin saxladığı, hələ qazanmadığı məbləğdir — gəlirə düşmür. Hər hərəkət
          yalnız əlavə olunur, silinmir; düzəliş ayrıca sətir kimi yazılır.
        </Text>

        <View style={styles.row}>
          <StatCard label="Depozitdə saxlanan" value={formatMoney(totals.amount)} icon="💧" accent={colors.primary} />
          <StatCard label="Depozit bidonları" value={String(totals.bottleCount)} icon="🧴" accent={colors.info} background={colors.infoBg} />
        </View>

        <SegmentedButtons
          value={typeFilter}
          onValueChange={(v) => setTypeFilter(v as DepositTxType | '')}
          buttons={[
            { value: '', label: 'Hamısı' },
            { value: 'DEPOSIT_IN', label: 'Qəbul' },
            { value: 'DEPOSIT_OUT', label: 'Qaytarma' },
            { value: 'ADJUSTMENT', label: 'Düzəliş' },
          ]}
          style={styles.segment}
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <SectionCard title={`Depozit tarixçəsi (${data?.total ?? 0})`} subtitle="Ən yenilər əvvəldə">
          {loading && !data ? (
            <ActivityIndicator />
          ) : items.length === 0 ? (
            <EmptyState icon="💧" title="Hərəkət yoxdur" message="Sağ altdakı düymə ilə depozit qəbul edin." />
          ) : (
            items.map((d) => <DepositRow key={d.id} deposit={d} onOpenCustomer={(id) => navigation.navigate('CustomerDetail', { customerId: id })} />)
          )}
        </SectionCard>
      </ScrollView>

      <FAB icon="plus" label="Depozit" style={styles.fab} onPress={() => setPickerOpen(true)} />

      {/* Step 1: choose the customer. */}
      <Portal>
        <Dialog visible={pickerOpen} onDismiss={() => setPickerOpen(false)}>
          <Dialog.Title>Müştəri seç</Dialog.Title>
          <Dialog.Content>
            <Searchbar
              placeholder="Ad və ya telefon"
              value={search}
              onChangeText={setSearch}
              style={styles.searchbar}
            />
            <ScrollView style={styles.customerList}>
              {customersLoading && !customerPage ? (
                <ActivityIndicator />
              ) : (customerPage?.items ?? []).length === 0 ? (
                <Text style={styles.dialogHint}>Müştəri tapılmadı.</Text>
              ) : (
                (customerPage?.items ?? []).map((c) => (
                  <Pressable
                    key={c.id}
                    onPress={() => openForm(c)}
                    android_ripple={{ color: colors.surfaceVariant }}
                    style={styles.customerRow}
                  >
                    <Text style={styles.customerName}>{c.name}</Text>
                    <Text style={styles.customerMeta}>
                      {c.address}
                      {c.phone ? ` · ${c.phone}` : ''}
                    </Text>
                  </Pressable>
                ))
              )}
            </ScrollView>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setPickerOpen(false)}>Bağla</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      {/* Step 2: the movement itself. */}
      <Portal>
        <Dialog visible={formCustomer !== null} onDismiss={() => setFormCustomer(null)}>
          <Dialog.Title>{TYPE_LABEL[type]}</Dialog.Title>
          <Dialog.Content>
            {formCustomer ? (
              <Text style={styles.dialogHint}>
                Müştəri: <Text style={styles.bold}>{formCustomer.name}</Text>
              </Text>
            ) : null}

            <SegmentedButtons
              value={type}
              onValueChange={(v) => setType(v as DepositTxType)}
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

            {amount ? <HelperText type={formError ? 'error' : 'info'}>{formError ?? ' '}</HelperText> : null}
            {createAction.error ? <HelperText type="error">{createAction.error}</HelperText> : null}
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setFormCustomer(null)}>Ləğv et</Button>
            <Button onPress={onCreate} loading={createAction.submitting} disabled={createAction.submitting || formError !== null}>
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

const DepositRow: React.FC<{ deposit: CustomerDeposit; onOpenCustomer: (id: string) => void }> = ({ deposit, onOpenCustomer }) => {
  const sign = deposit.amount > 0 ? '+' : deposit.amount < 0 ? '−' : '';
  return (
    <View style={styles.depositRow}>
      <View style={styles.flex}>
        <Pressable onPress={() => onOpenCustomer(deposit.customerId)} hitSlop={6}>
          <Text style={styles.customerLink}>{deposit.customerName ?? 'Müştəri'}</Text>
        </Pressable>
        <Text style={[styles.typeText, { color: TYPE_COLOR[deposit.type] ?? colors.text }]}>
          {TYPE_LABEL[deposit.type] ?? deposit.type}
        </Text>
        <Text style={styles.meta}>
          {formatDateTime(deposit.occurredAt)}
          {deposit.createdByName ? ` · ${deposit.createdByName}` : ''}
        </Text>
        {deposit.note ? <Text style={styles.note}>{deposit.note}</Text> : null}
      </View>
      <View style={styles.amountCol}>
        <Text style={[styles.amount, { color: TYPE_COLOR[deposit.type] ?? colors.text }]}>
          {sign}
          {formatMoney(Math.abs(deposit.amount))}
        </Text>
        <Text style={styles.amountSub}>
          {deposit.bottleCount > 0 ? '+' : ''}
          {deposit.bottleCount} bidon
        </Text>
        <Text style={styles.balance}>
          {formatMoney(deposit.balanceAfter)} · {deposit.bottleBalanceAfter} bidon
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  scroll: { padding: spacing.md, paddingBottom: 110 },
  intro: { fontSize: 12, color: colors.textMuted, lineHeight: 18, marginBottom: spacing.md },
  row: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  segment: { marginBottom: spacing.sm },
  error: { color: colors.danger, fontSize: 12, marginBottom: spacing.sm },
  depositRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: spacing.sm,
  },
  customerLink: { fontSize: 14, fontWeight: '700', color: colors.primary, textDecorationLine: 'underline' },
  typeText: { fontSize: 12, fontWeight: '600' },
  meta: { fontSize: 11, color: colors.textMuted },
  note: { fontSize: 12, color: colors.text, fontStyle: 'italic' },
  amountCol: { alignItems: 'flex-end', minWidth: 110 },
  amount: { fontSize: 14, fontWeight: '700' },
  amountSub: { fontSize: 11, color: colors.textMuted },
  balance: { fontSize: 10, color: colors.textMuted },
  searchbar: { backgroundColor: colors.surface, marginBottom: spacing.sm },
  customerList: { maxHeight: 320 },
  customerRow: {
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  customerName: { fontSize: 14, fontWeight: '600', color: colors.text },
  customerMeta: { fontSize: 11, color: colors.textMuted },
  dialogHint: { fontSize: 12, color: colors.text, lineHeight: 18, marginBottom: spacing.sm },
  bold: { fontWeight: '700' },
  dialogInput: { marginBottom: spacing.sm },
  fab: { position: 'absolute', right: spacing.lg, bottom: spacing.lg, backgroundColor: colors.primary },
});
