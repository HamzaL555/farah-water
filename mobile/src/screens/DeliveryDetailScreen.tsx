import React, { useState, useCallback } from 'react';
import { View, ScrollView, StyleSheet, RefreshControl, Text } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  Button,
  ActivityIndicator,
  Dialog,
  Portal,
  TextInput as PaperInput,
  HelperText,
  SegmentedButtons,
  Divider,
  Snackbar,
} from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusChip } from '../components/StatusChip';
import { StatCard } from '../components/StatCard';
import { KeyValueRow } from '../components/KeyValueRow';
import { SectionCard } from '../components/SectionCard';
import { EmptyState } from '../components/EmptyState';
import { useAsync, useSubmit } from '../hooks/useAsync';
import { deliveriesApi, paymentsApi, debtsApi } from '../services/endpoints';
import { enqueue } from '../services/offlineQueue';
import { useAuth } from '../context/AuthContext';
import {
  formatDate,
  formatDateTime,
  formatMoney,
  normalizeMoneyInput,
  parseMoneyInput,
  todayInputValue,
  METHOD_LABEL,
  ADJUSTMENT_LABEL,
} from '../utils/format';
import { colors, spacing, radius } from '../theme';
import type { AdminStackParamList } from '../navigation/types';
import type { PaymentMethod, DebtAdjustmentType } from '../types';

type Props = NativeStackScreenProps<AdminStackParamList, 'DeliveryDetail'>;

/**
 * Delivery detail: money summary, append-only payment history, and the actions
 * permitted for the current role.
 *
 * A worker's permitted action is "add payment" only. Everything that could
 * rewrite history (void, waive debt, cancel) is admin-gated here AND on the
 * server, which is the authority.
 */
export const DeliveryDetailScreen: React.FC<Props> = ({ route }) => {
  
  const { user, isConnected } = useAuth();
  const isAdmin = user?.role === 'ADMIN';

  const { data, loading, error, run } = useAsync(
    () => deliveriesApi.detail(route.params.deliveryId).then((r) => r.data),
    [route.params.deliveryId],
  );

  useFocusEffect(
    useCallback(() => {
      void run(false);
    }, [run]),
  );

  // ---------------------------- payment dialog -----------------------------
  const [payOpen, setPayOpen] = useState(false);
  const [payAmount, setPayAmount] = useState('');
  const [payDate, setPayDate] = useState(todayInputValue());
  const [payMethod, setPayMethod] = useState<PaymentMethod>('CASH');
  const [payNote, setPayNote] = useState('');
  const [payTouched, setPayTouched] = useState(false);

  // ----------------------------- void dialog -------------------------------
  const [voidTarget, setVoidTarget] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState('');

  // ---------------------------- adjust dialog -------------------------------
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustType, setAdjustType] = useState<DebtAdjustmentType>('FORGIVE');
  const [adjustAmount, setAdjustAmount] = useState('');
  const [adjustReason, setAdjustReason] = useState('');

  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [snack, setSnack] = useState<string | null>(null);

  // --------------------------- price dialog ---------------------------------
  // Admin-only. The worker set neither the price nor the cash collected, so
  // both arrive as 0 until the owner fills them in here.
  const [priceOpen, setPriceOpen] = useState(false);
  const [unitPrice, setUnitPrice] = useState('');
  const [paidAmount, setPaidAmount] = useState('');
  const [priceReason, setPriceReason] = useState('');
  const [priceTouched, setPriceTouched] = useState(false);

  const outstanding = data?.debtAmount ?? 0;
  const payAmountNum = parseMoneyInput(payAmount);
  const payError =
    payTouched && payAmountNum <= 0
      ? 'Məbləğ sıfırdan böyük olmalıdır.'
      : payTouched && payAmountNum > outstanding
        ? `Qalan borc ${outstanding.toFixed(2)} AZN-dir.`
        : null;

  const payAction = useSubmit(async () => {
    const body = {
      idempotencyKey: `p-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      deliveryId: route.params.deliveryId,
      amount: normalizeMoneyInput(payAmount),
      method: payMethod,
      paidAt: payDate,
      note: payNote.trim() || undefined,
    };

    if (!isConnected) {
      await enqueue('payment', '/payments', body as unknown as Record<string, unknown>, body.idempotencyKey, `Ödəniş · ${formatMoney(payAmountNum)}`);
      return { queued: true };
    }

    try {
      await paymentsApi.create(body);
      return { queued: false };
    } catch (err) {
      // Re-queue only when the request could not reach the server at all.
      if (err instanceof Error && err.name === 'ApiError' && (err as { isRetryable?: boolean }).isRetryable) {
        await enqueue('payment', '/payments', body as unknown as Record<string, unknown>, body.idempotencyKey, `Ödəniş · ${formatMoney(payAmountNum)}`);
        return { queued: true };
      }
      throw err;
    }
  });

  const voidAction = useSubmit(async (paymentId: string) => paymentsApi.void(paymentId, voidReason.trim()).then((r) => r.data));
  const adjustAction = useSubmit(async () =>
    debtsApi
      .createAdjustment({
        deliveryId: route.params.deliveryId,
        type: adjustType,
        amount: normalizeMoneyInput(adjustAmount),
        reason: adjustReason.trim(),
      })
      .then((r) => r.data),
  );
  const cancelAction = useSubmit(async () => deliveriesApi.cancel(route.params.deliveryId, cancelReason.trim()).then((r) => r.data));
  const priceAction = useSubmit(async () =>
    deliveriesApi
      .update(route.params.deliveryId, {
        unitPrice: normalizeMoneyInput(unitPrice),
        paidAmount: normalizeMoneyInput(paidAmount || '0'),
        reason: priceReason.trim(),
      })
      .then((r) => r.data),
  );

  const priceNum = parseMoneyInput(unitPrice);
  const paidNum = parseMoneyInput(paidAmount || '0');
  const newTotal = Math.round(priceNum * (data?.bottleCount ?? 0) * 100) / 100;
  const priceError =
    priceTouched && priceNum < 0
      ? 'Qiymət negatif ola bilməz.'
      : priceTouched && paidNum < 0
        ? 'Ödənilən məbləğ negatif ola bilməz.'
        : priceTouched && paidNum > newTotal
          ? `Ödənilən məbləğ ümumi məbləğdən (${newTotal.toFixed(2)}) çox ola bilməz.`
          : priceTouched && priceReason.trim().length < 3
            ? 'Düzəliş səbəbi yazılmalıdır.'
            : null;

  const onSavePrice = async () => {
    setPriceTouched(true);
    if (priceNum < 0 || paidNum < 0 || paidNum > newTotal || priceReason.trim().length < 3) return;
    const result = await priceAction.submit();
    if (!result) return;
    setPriceOpen(false);
    setPriceReason('');
    setPriceTouched(false);
    setSnack('Qiymət və ödəniş yazıldı. Borc avtomatik hesablandı.');
    void run(false);
  };

  const onAddPayment = async () => {
    setPayTouched(true);
    if (payAmountNum <= 0 || payAmountNum > outstanding) return;
    const result = await payAction.submit();
    if (!result) return;
    setPayOpen(false);
    setPayAmount('');
    setPayNote('');
    setPayTouched(false);
    setSnack(result.queued ? 'Bağlantı yoxdur — ödəniş növbəyə göndəriləcək.' : 'Ödəniş qeydə alındı.');
    void run(false);
  };

  const onVoid = async () => {
    if (!voidTarget || !voidReason.trim()) return;
    const result = await voidAction.submit(voidTarget);
    if (!result) return;
    setVoidTarget(null);
    setVoidReason('');
    setSnack('Ödəniş geri qaytarıldı. Borc yenidən hesablandı.');
    void run(false);
  };

  const onAdjust = async () => {
    if (!adjustReason.trim() || parseMoneyInput(adjustAmount) <= 0) return;
    const result = await adjustAction.submit();
    if (!result) return;
    setAdjustOpen(false);
    setAdjustAmount('');
    setAdjustReason('');
    setSnack('Borc düzəlişi qeydə alındı. Gəlirə təsir etmir.');
    void run(false);
  };

  const onCancel = async () => {
    if (!cancelReason.trim()) return;
    const result = await cancelAction.submit();
    if (!result) return;
    setCancelOpen(false);
    setCancelReason('');
    setSnack('Çatdırılma ləğv edildi.');
    void run(false);
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
        <EmptyState
          icon="⚠️"
          title="Yüklənmədi"
          message={error ?? 'Çatdırılma tapılmadı.'}
          actionLabel="Yenidən"
          onAction={() => void run()}
        />
      </SafeAreaView>
    );
  }

  const isCancelled = data.status === 'CANCELLED';
  const priceMissing = Number(data.unitPrice) === 0;

  const openPriceDialog = () => {
    setUnitPrice(String(data.unitPrice ?? '0'));
    setPaidAmount(String(data.paidAmount ?? '0'));
    setPriceReason('');
    setPriceTouched(false);
    setPriceOpen(true);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void run()} />}
      >
        <SectionCard title={data.customerName ?? 'Müştəri'} subtitle={data.address}>
          <View style={styles.chipRow}>
            <StatusChip status={data.status} />
            <Text style={styles.date}>{formatDate(data.deliveredAt)}</Text>
          </View>
          <KeyValueRow label="İşçi" value={data.workerName ?? '-'} />
          <KeyValueRow label="Su" value={data.waterType === 'SPRING' ? 'Bulaq suyu' : 'Filtr suyu'} />
          <KeyValueRow
            label="Hara"
            value={
              data.destinationType === 'COMPANY'
                ? [data.companyName, data.officeName].filter(Boolean).join(' — ') || 'Şirkət'
                : 'Ev'
            }
          />
          <KeyValueRow label="Əlaqə nömrəsi" value={data.contactPhone ?? data.customerPhone ?? '-'} />
          <KeyValueRow label="Bidon sayı" value={String(data.bottleCount)} />
          <KeyValueRow
            label="Bir bidonun qiyməti"
            value={priceMissing ? 'qiymət yazılmayıb' : formatMoney(data.unitPrice)}
          />
          <KeyValueRow label="Qeyd" value={data.note ?? '-'} />
        </SectionCard>

        <View style={styles.row}>
          <StatCard label="Ümumi məbləğ" value={formatMoney(data.totalAmount)} icon="📄" accent={colors.primary} />
          <StatCard
            label="Qalan borc"
            value={formatMoney(data.debtAmount)}
            icon="⚠️"
            accent={data.debtAmount > 0 ? colors.danger : colors.success}
            background={data.debtAmount > 0 ? colors.dangerBg : colors.successBg}
          />
        </View>

        {isCancelled ? (
          <View style={styles.cancelledBox}>
            <Text style={styles.cancelledText}>
              Bu çatdırılma ləğv edilib ({formatDate(data.cancelledAt)}). Səbəb: {data.cancelReason}
            </Text>
          </View>
        ) : null}

        {/* Actions permitted for this role. */}
        {!isCancelled ? (
          <View style={styles.actions}>
            {isAdmin ? (
              <>
                {data.debtAmount > 0 || priceMissing ? (
                  <Button mode="contained" icon="tag-plus" onPress={openPriceDialog} style={styles.actionButton}>
                    Qiymət / ödəniş
                  </Button>
                ) : (
                  <Button mode="contained" icon="cash-plus" onPress={() => setPayOpen(true)} style={styles.actionButton}>
                    Ödəniş əlavə et
                  </Button>
                )}
                {priceMissing ? null : data.debtAmount > 0 ? (
                  <Button mode="outlined" icon="cash-plus" onPress={() => setPayOpen(true)} style={styles.actionButton}>
                    Ödəniş əlavə et
                  </Button>
                ) : null}
                <Button mode="outlined" icon="percent" onPress={() => setAdjustOpen(true)} style={styles.actionButton}>
                  Borc düzəlişi
                </Button>
                <Button mode="outlined" icon="close-circle" onPress={() => setCancelOpen(true)} style={styles.actionButton}>
                  Ləğv et
                </Button>
              </>
            ) : (
              <Text style={styles.dialogHint}>
                Qiyməti və ödənilən pulu administrator yazır.
              </Text>
            )}
          </View>
        ) : null}

        <Divider style={styles.divider} />
        <Text style={styles.sectionTitle}>Ödəniş tarixçəsi ({data.payments.length})</Text>

        {data.payments.length === 0 ? (
          <EmptyState icon="🧾" title="Ödəniş yoxdur" message="Hələ ödəniş qeydə alınmayıb." />
        ) : (
          data.payments.map((p) => (
            <View key={p.id} style={[styles.paymentRow, p.voidedAt ? styles.paymentVoided : null]}>
              <View style={styles.flex}>
                <Text style={[styles.paymentAmount, p.voidedAt ? styles.strike : null]}>
                  {formatMoney(p.amount)}
                </Text>
                <Text style={styles.paymentMeta}>
                  {formatDate(p.paidAt)} · {METHOD_LABEL[p.method]} · {p.recordedByName ?? '-'}
                </Text>
                {p.note ? <Text style={styles.paymentNote}>{p.note}</Text> : null}
                {p.voidedAt ? (
                  <Text style={styles.voidText}>
                    Geri qaytarıldı {formatDate(p.voidedAt)}: {p.voidReason}
                  </Text>
                ) : null}
              </View>
              {isAdmin && !p.voidedAt ? (
                <Button compact onPress={() => setVoidTarget(p.id)}>
                  Geri qaytar
                </Button>
              ) : null}
            </View>
          ))
        )}

        {data.debtAdjustments.length > 0 ? (
          <>
            <Text style={styles.sectionTitle}>Borc düzəlişləri</Text>
            {data.debtAdjustments.map((a) => (
              <View key={a.id} style={styles.adjustRow}>
                <Text style={styles.adjustLabel}>{ADJUSTMENT_LABEL[a.type]}</Text>
                <Text style={styles.adjustAmount}>{formatMoney(a.amount)}</Text>
                <Text style={styles.adjustMeta}>
                  {formatDate(a.createdAt)} · {a.createdByName ?? '-'} · {a.reason}
                </Text>
              </View>
            ))}
            <Text style={styles.adjustNote}>
              Düzəliş ödəniş deyil: gəlir hesabatına daxil edilmir.
            </Text>
          </>
        ) : null}

        {data.inventoryTransactions.length > 0 ? (
          <>
            <Text style={styles.sectionTitle}>Anbar əməliyyatları</Text>
            {data.inventoryTransactions.map((t) => (
              <View key={t.id} style={styles.adjustRow}>
                <Text style={styles.adjustLabel}>
                  {t.signedCount > 0 ? '+' : ''}
                  {t.signedCount} bidon
                </Text>
                <Text style={styles.adjustMeta}>{formatDateTime(t.occurredAt)} · {t.note ?? '-'}</Text>
              </View>
            ))}
          </>
        ) : null}
      </ScrollView>

      {/* --------------------------- price dialog ------------------------------- */}
      <Portal>
        <Dialog visible={priceOpen} onDismiss={() => setPriceOpen(false)}>
          <Dialog.Title>Qiymət və ödəniş</Dialog.Title>
          <Dialog.Content>
            <Text style={styles.dialogHint}>
              İşçi qiymət yazmır. Siz yazırsınız — borc avtomatik hesablanır.
            </Text>
            <PaperInput
              label="Bir bidonun qiyməti"
              value={unitPrice}
              onChangeText={(t) => setUnitPrice(normalizeMoneyInput(t))}
              mode="outlined"
              keyboardType="decimal-pad"
              style={styles.dialogInput}
            />
            <PaperInput
              label="Ödənilən məbləğ"
              value={paidAmount}
              onChangeText={(t) => setPaidAmount(normalizeMoneyInput(t))}
              mode="outlined"
              keyboardType="decimal-pad"
              style={styles.dialogInput}
            />
            <Text style={styles.dialogHint}>
              {`${data.bottleCount} bidon × ${priceNum.toFixed(2)} = `}
              <Text style={{ fontWeight: '700' }}>{formatMoney(newTotal)}</Text>
            </Text>
            <PaperInput
              label="Səbəb"
              value={priceReason}
              onChangeText={setPriceReason}
              mode="outlined"
              multiline
              style={styles.dialogInput}
            />
            {priceError ? <HelperText type="error">{priceError}</HelperText> : null}
            {priceAction.error ? <HelperText type="error">{priceAction.error}</HelperText> : null}
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setPriceOpen(false)}>Ləğv et</Button>
            <Button onPress={onSavePrice} loading={priceAction.submitting}>
              Yadda saxla
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      {/* --------------------------- add payment dialog ------------------------ */}
      <Portal>
        <Dialog visible={payOpen} onDismiss={() => setPayOpen(false)}>
          <Dialog.Title>Ödəniş əlavə et</Dialog.Title>
          <Dialog.Content>
            <Text style={styles.dialogHint}>
              Qalan borc: <Text style={{ fontWeight: '700' }}>{formatMoney(outstanding)}</Text>
            </Text>
            <PaperInput
              label="Məbləğ"
              value={payAmount}
              onChangeText={(t) => setPayAmount(normalizeMoneyInput(t))}
              mode="outlined"
              keyboardType="decimal-pad"
              error={Boolean(payError)}
              style={styles.dialogInput}
            />
            {payError ? <HelperText type="error">{payError}</HelperText> : null}
            <PaperInput
              label="Tarix (YYYY-AA-GG)"
              value={payDate}
              onChangeText={setPayDate}
              mode="outlined"
              style={styles.dialogInput}
            />
            <Text style={styles.dialogLabel}>Üsul</Text>
            <SegmentedButtons
              value={payMethod}
              onValueChange={(v) => setPayMethod(v as PaymentMethod)}
              buttons={(['CASH', 'CARD', 'TRANSFER'] as PaymentMethod[]).map((m) => ({ value: m, label: METHOD_LABEL[m] }))}
              style={styles.dialogInput}
            />
            <PaperInput
              label="Qeyd (istəyə bağlı)"
              value={payNote}
              onChangeText={setPayNote}
              mode="outlined"
              style={styles.dialogInput}
            />
            {payAction.error ? <HelperText type="error">{payAction.error}</HelperText> : null}
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setPayOpen(false)}>Ləğv et</Button>
            <Button onPress={onAddPayment} loading={payAction.submitting}>
              Təsdiqlə
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      {/* ---------------------------- void dialog ----------------------------- */}
      <Portal>
        <Dialog visible={Boolean(voidTarget)} onDismiss={() => setVoidTarget(null)}>
          <Dialog.Title>Ödənişi geri qaytar</Dialog.Title>
          <Dialog.Content>
            <Text style={styles.dialogHint}>
              Ödəniş silinmir — tarixçədə "geri qaytarıldı" kimi qeyd olunur və borc yenidən hesablanır.
            </Text>
            <PaperInput
              label="Səbəb"
              value={voidReason}
              onChangeText={setVoidReason}
              mode="outlined"
              style={styles.dialogInput}
            />
            {voidAction.error ? <HelperText type="error">{voidAction.error}</HelperText> : null}
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setVoidTarget(null)}>Ləğv et</Button>
            <Button onPress={onVoid} loading={voidAction.submitting} textColor={colors.danger}>
              Geri qaytar
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      {/* --------------------------- adjust dialog ---------------------------- */}
      <Portal>
        <Dialog visible={adjustOpen} onDismiss={() => setAdjustOpen(false)}>
          <Dialog.Title>Borc düzəlişi</Dialog.Title>
          <Dialog.Content>
            <Text style={styles.dialogHint}>
              Güzəşti və düzəliş ödəniş sayılmaz — gəlirə təsir etmir.
            </Text>
            <SegmentedButtons
              value={adjustType}
              onValueChange={(v) => setAdjustType(v as DebtAdjustmentType)}
              buttons={[
                { value: 'FORGIVE', label: 'Güzəşti' },
                { value: 'DECREASE', label: 'Azalt' },
                { value: 'INCREASE', label: 'Artır' },
              ]}
              style={styles.dialogInput}
            />
            <PaperInput
              label="Məbləğ"
              value={adjustAmount}
              onChangeText={(t) => setAdjustAmount(normalizeMoneyInput(t))}
              mode="outlined"
              keyboardType="decimal-pad"
              style={styles.dialogInput}
            />
            <PaperInput
              label="Səbəb"
              value={adjustReason}
              onChangeText={setAdjustReason}
              mode="outlined"
              multiline
              style={styles.dialogInput}
            />
            {adjustAction.error ? <HelperText type="error">{adjustAction.error}</HelperText> : null}
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setAdjustOpen(false)}>Bağla</Button>
            <Button onPress={onAdjust} loading={adjustAction.submitting}>
              Yadda saxla
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      {/* --------------------------- cancel dialog ---------------------------- */}
      <Portal>
        <Dialog visible={cancelOpen} onDismiss={() => setCancelOpen(false)}>
          <Dialog.Title>Çatdırılmanı ləğv et</Dialog.Title>
          <Dialog.Content>
            <Text style={styles.dialogHint}>
              Ləğv edilmə mümkündürsə, bidonlar işçinin hesabına geri qaytarılır. Ödəniş alınmışsa əvvəlcə ödənişi geri qaytarın.
            </Text>
            <PaperInput
              label="Səbəb"
              value={cancelReason}
              onChangeText={setCancelReason}
              mode="outlined"
              multiline
              style={styles.dialogInput}
            />
            {cancelAction.error ? <HelperText type="error">{cancelAction.error}</HelperText> : null}
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setCancelOpen(false)}>Bağla</Button>
            <Button onPress={onCancel} loading={cancelAction.submitting} textColor={colors.danger}>
              Ləğv et
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      <Snackbar visible={Boolean(snack)} onDismiss={() => setSnack(null)} duration={4000}>
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
  chipRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  date: { fontSize: 12, color: colors.textMuted },
  row: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  actionButton: { flexGrow: 1 },
  cancelledBox: {
    backgroundColor: '#ECEFF1',
    borderRadius: radius.sm,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  cancelledText: { fontSize: 12, color: colors.textMuted },
  divider: { marginVertical: spacing.md },
  sectionTitle: { fontSize: 15, fontWeight: '600', color: colors.text, marginBottom: spacing.sm },
  paymentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.xs,
    gap: spacing.sm,
  },
  paymentVoided: { backgroundColor: colors.background, borderStyle: 'dashed' },
  paymentAmount: { fontSize: 16, fontWeight: '700', color: colors.success },
  strike: { textDecorationLine: 'line-through', color: colors.textMuted },
  paymentMeta: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  paymentNote: { fontSize: 11, color: colors.primaryLight, marginTop: 2 },
  voidText: { fontSize: 11, color: colors.danger, marginTop: 2 },
  adjustRow: {
    backgroundColor: colors.warningBg,
    borderRadius: radius.sm,
    padding: spacing.md,
    marginBottom: spacing.xs,
    gap: 2,
  },
  adjustLabel: { fontSize: 13, fontWeight: '600', color: colors.warning },
  adjustAmount: { fontSize: 14, fontWeight: '700', color: colors.warning },
  adjustMeta: { fontSize: 11, color: colors.textMuted },
  adjustNote: { fontSize: 10, color: colors.textMuted, fontStyle: 'italic', marginTop: spacing.xs },
  dialogHint: { fontSize: 12, color: colors.textMuted, marginBottom: spacing.sm },
  dialogLabel: { fontSize: 12, color: colors.textMuted, marginBottom: spacing.xs, marginTop: spacing.xs },
  dialogInput: { marginBottom: spacing.sm },
});
