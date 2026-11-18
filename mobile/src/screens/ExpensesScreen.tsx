import React, { useState, useCallback } from 'react';
import { View, ScrollView, StyleSheet, RefreshControl, Text } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  ActivityIndicator,
  Button,
  Chip,
  Dialog,
  FAB,
  HelperText,
  Portal,
  SegmentedButtons,
  Snackbar,
  Switch,
  TextInput as PaperInput,
} from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatCard } from '../components/StatCard';
import { SectionCard } from '../components/SectionCard';
import { EmptyState } from '../components/EmptyState';
import { useAsync, useSubmit } from '../hooks/useAsync';
import { dashboardApi, expensesApi } from '../services/endpoints';
import { formatDateTime, formatMoney, normalizeMoneyInput } from '../utils/format';
import { colors, spacing, radius } from '../theme';
import type { Expense, ExpenseCategory, WaterType } from '../types';

const CATEGORY_LABEL: Record<ExpenseCategory, string> = {
  FUEL: 'Yanacaq',
  SALARY: 'Əmək haqqı',
  MAINTENANCE: 'Təmir',
  RENT: 'İcarə',
  UTILITIES: 'Kommunal',
  SUPPLIES: 'Ləvazimat',
  TRANSPORT: 'Nəqliyyat',
  OTHER: 'Digər',
};

const CATEGORY_KEYS = Object.keys(CATEGORY_LABEL) as ExpenseCategory[];

/**
 * Company expenses.
 *
 * Admin-only, because an expense reduces profit. A wrong entry is voided, never
 * deleted: the row stays exactly as written, with the reason and the person who
 * voided it. Bulaq and Filtr are kept apart; an expense with no water type is
 * shared and only touches the overall profit.
 */
export const ExpensesScreen: React.FC = () => {
  const [waterFilter, setWaterFilter] = useState<WaterType | ''>('');
  const [includeVoided, setIncludeVoided] = useState(false);
  const [snack, setSnack] = useState<string | null>(null);

  const { data, loading, error, run } = useAsync(
    () =>
      expensesApi
        .list({ waterType: waterFilter || undefined, includeVoided, pageSize: 100 })
        .then((r) => r.data),
    [waterFilter, includeVoided],
  );

  // Totals come from the dashboard so the number on this screen is the same one
  // the profit figure is computed from.
  const { data: finance, run: runFinance } = useAsync(
    () => dashboardApi.admin({ preset: 'all' }).then((r) => r.data.finance),
    [],
  );

  const refreshAll = useCallback(async () => {
    await Promise.all([run(), runFinance()]);
  }, [run, runFinance]);

  useFocusEffect(
    useCallback(() => {
      void refreshAll();
    }, [refreshAll]),
  );

  const [formOpen, setFormOpen] = useState(false);
  const [category, setCategory] = useState<ExpenseCategory>('FUEL');
  const [waterType, setWaterType] = useState<WaterType | ''>('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [voidTarget, setVoidTarget] = useState<Expense | null>(null);
  const [voidReason, setVoidReason] = useState('');

  const amountError = (() => {
    if (amount.trim() === '') return 'Məbləğ yazın.';
    const n = Number(normalizeMoneyInput(amount));
    if (!Number.isFinite(n) || n <= 0) return 'Məbləğ sıfırdan böyük olmalıdır.';
    return null;
  })();

  const createAction = useSubmit(async () => {
    return expensesApi.create({
      idempotencyKey: `exp-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      category,
      waterType: waterType || undefined,
      amount: normalizeMoneyInput(amount),
      note: note.trim() || undefined,
    });
  });

  const voidAction = useSubmit(async () => {
    if (!voidTarget) throw new Error('Xərc seçilməyib.');
    return expensesApi.void(voidTarget.id, voidReason.trim());
  });

  const openForm = () => {
    setCategory('FUEL');
    setWaterType('');
    setAmount('');
    setNote('');
    setFormOpen(true);
  };

  const onCreate = async () => {
    if (amountError) return;
    const result = await createAction.submit();
    if (!result) return;
    setFormOpen(false);
    setSnack('Xərc qeydə alındı.');
    void refreshAll();
  };

  const onVoid = async () => {
    if (voidReason.trim().length < 3) return;
    const result = await voidAction.submit();
    if (!result) return;
    setVoidTarget(null);
    setVoidReason('');
    setSnack('Xərc ləğv edildi. Qeyd silinmədi.');
    void refreshAll();
  };

  const exp = finance?.expensesByWater ?? { filtered: 0, spring: 0, shared: 0, total: 0 };
  const items = data?.items ?? [];

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void refreshAll()} />}
      >
        <Text style={styles.intro}>
          Xərc mənfəətdən çıxılır. Su növü seçilməzsə xərc ümumi mənfəətdən çıxılır, ayrı-ayrı
          Filtr/Bulaq mənfəətindən deyil. Səhv qeyd silinmir — ləğv edilir.
        </Text>

        <View style={styles.row}>
          <StatCard label="Filtr xərci" value={formatMoney(exp.filtered)} icon="💧" accent={colors.success} background={colors.successBg} />
          <StatCard label="Bulaq xərci" value={formatMoney(exp.spring)} icon="🏔️" accent={colors.info} background={colors.infoBg} />
        </View>
        <View style={styles.row}>
          <StatCard label="Ümumi xərc" value={formatMoney(exp.total)} icon="🧾" accent={colors.danger} background={colors.dangerBg} />
          <StatCard label="Bölünməmiş" value={formatMoney(exp.shared)} icon="➗" accent={colors.warning} background={colors.warningBg} />
        </View>

        <View style={styles.filters}>
          <SegmentedButtons
            value={waterFilter}
            onValueChange={(v) => setWaterFilter(v as WaterType | '')}
            buttons={[
              { value: '', label: 'Hamısı' },
              { value: 'FILTERED', label: 'Filtr' },
              { value: 'SPRING', label: 'Bulaq' },
            ]}
            style={styles.segment}
          />
          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>Ləğv edilənlər də görünsün</Text>
            <Switch value={includeVoided} onValueChange={setIncludeVoided} />
          </View>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <SectionCard title={`Xərclər (${data?.total ?? 0})`} subtitle={`Siyahı cəmi: ${formatMoney(data?.totalAmount ?? 0)}`}>
          {loading && !data ? (
            <ActivityIndicator />
          ) : items.length === 0 ? (
            <EmptyState icon="🧾" title="Xərc yoxdur" message="Sağ altdakı düymə ilə ilk xərci əlavə edin." />
          ) : (
            items.map((e) => {
              const voided = Boolean(e.voidedAt);
              return (
                <View key={e.id} style={[styles.expenseRow, voided && styles.expenseVoided]}>
                  <View style={styles.flex}>
                    <Text style={styles.expenseTitle}>
                      {CATEGORY_LABEL[e.category] ?? e.category} · {formatMoney(e.amount)}
                    </Text>
                    <Text style={styles.expenseMeta}>
                      {formatDateTime(e.spentAt)}
                      {e.waterType ? ` · ${e.waterType === 'SPRING' ? '🏔️ Bulaq' : '💧 Filtr'}` : ' · ümumi'}
                      {e.createdByName ? ` · ${e.createdByName}` : ''}
                    </Text>
                    {e.note ? <Text style={styles.expenseNote}>{e.note}</Text> : null}
                    {voided ? (
                      <Text style={styles.voidText}>
                        Ləğv edilib{e.voidReason ? `: ${e.voidReason}` : ''}
                      </Text>
                    ) : null}
                  </View>
                  {!voided ? (
                    <Button
                      compact
                      textColor={colors.danger}
                      onPress={() => {
                        setVoidReason('');
                        setVoidTarget(e);
                      }}
                    >
                      Ləğv et
                    </Button>
                  ) : null}
                </View>
              );
            })
          )}
        </SectionCard>
      </ScrollView>

      <FAB icon="plus" label="Xərc" style={styles.fab} onPress={openForm} />

      <Portal>
        <Dialog visible={formOpen} onDismiss={() => setFormOpen(false)}>
          <Dialog.Title>Yeni xərc</Dialog.Title>
          <Dialog.Content>
            <Text style={styles.fieldLabel}>Kateqoriya</Text>
            <View style={styles.chipWrap}>
              {CATEGORY_KEYS.map((k) => (
                <Chip key={k} selected={category === k} onPress={() => setCategory(k)} style={styles.chip}>
                  {CATEGORY_LABEL[k]}
                </Chip>
              ))}
            </View>

            <Text style={styles.fieldLabel}>Su növü (istəyə bağlı)</Text>
            <SegmentedButtons
              value={waterType}
              onValueChange={(v) => setWaterType(v as WaterType | '')}
              buttons={[
                { value: '', label: 'Ümumi' },
                { value: 'FILTERED', label: '💧 Filtr' },
                { value: 'SPRING', label: '🏔️ Bulaq' },
              ]}
              style={styles.dialogInput}
            />

            <PaperInput
              label="Məbləğ (AZN)"
              value={amount}
              onChangeText={(t) => setAmount(normalizeMoneyInput(t))}
              mode="outlined"
              keyboardType="decimal-pad"
              error={Boolean(amount) && Boolean(amountError)}
              style={styles.dialogInput}
            />
            <PaperInput
              label="Qeyd"
              value={note}
              onChangeText={setNote}
              mode="outlined"
              multiline
              style={styles.dialogInput}
            />
            {amount && amountError ? <HelperText type="error">{amountError}</HelperText> : null}
            {createAction.error ? <HelperText type="error">{createAction.error}</HelperText> : null}
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setFormOpen(false)}>Ləğv et</Button>
            <Button onPress={onCreate} loading={createAction.submitting} disabled={createAction.submitting || amountError !== null}>
              Yadda saxla
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      <Portal>
        <Dialog visible={voidTarget !== null} onDismiss={() => setVoidTarget(null)}>
          <Dialog.Title>Xərci ləğv et</Dialog.Title>
          <Dialog.Content>
            <Text style={styles.dialogHint}>
              {voidTarget ? formatMoney(voidTarget.amount) : ''} məbləğində xərc ləğv ediləcək.
              Qeyd silinmir, tarixçədə “ləğv edilib” kimi qalır.
            </Text>
            <PaperInput
              label="Ləğv səbəbi"
              value={voidReason}
              onChangeText={setVoidReason}
              mode="outlined"
              multiline
              style={styles.dialogInput}
            />
            {voidReason.trim().length > 0 && voidReason.trim().length < 3 ? (
              <HelperText type="error">Səbəb ən azı 3 simvol olmalıdır.</HelperText>
            ) : null}
            {voidAction.error ? <HelperText type="error">{voidAction.error}</HelperText> : null}
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setVoidTarget(null)}>İmtina</Button>
            <Button
              textColor={colors.danger}
              onPress={onVoid}
              loading={voidAction.submitting}
              disabled={voidAction.submitting || voidReason.trim().length < 3}
            >
              Ləğv et
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
  scroll: { padding: spacing.md, paddingBottom: 110 },
  intro: { fontSize: 12, color: colors.textMuted, lineHeight: 18, marginBottom: spacing.md },
  row: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  filters: { marginTop: spacing.sm, marginBottom: spacing.sm, gap: spacing.sm },
  segment: { marginBottom: spacing.xs },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xs },
  switchLabel: { fontSize: 12, color: colors.textMuted },
  error: { color: colors.danger, fontSize: 12, marginBottom: spacing.sm },
  expenseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: spacing.sm,
  },
  expenseVoided: { opacity: 0.6 },
  expenseTitle: { fontSize: 14, fontWeight: '600', color: colors.text },
  expenseMeta: { fontSize: 11, color: colors.textMuted },
  expenseNote: { fontSize: 12, color: colors.text, marginTop: 2 },
  voidText: { fontSize: 11, color: colors.danger, marginTop: 2 },
  fieldLabel: { fontSize: 12, color: colors.textMuted, marginBottom: spacing.xs, marginTop: spacing.xs },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm },
  chip: { marginRight: 4, marginBottom: 4 },
  dialogInput: { marginBottom: spacing.sm },
  dialogHint: { fontSize: 12, color: colors.text, lineHeight: 18, marginBottom: spacing.sm },
  fab: { position: 'absolute', right: spacing.lg, bottom: spacing.lg, backgroundColor: colors.primary },
});
