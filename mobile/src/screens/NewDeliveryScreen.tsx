import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  Button,
  TextInput as PaperInput,
  HelperText,
  Snackbar,
  Chip,
  Divider,
  SegmentedButtons,
} from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { customersApi, deliveriesApi } from '../services/endpoints';
import { enqueue } from '../services/offlineQueue';
import { useAuth } from '../context/AuthContext';
import { useAsync, useSubmit } from '../hooks/useAsync';
import {
  formatMoney,
  normalizeMoneyInput,
  parseMoneyInput,
  todayInputValue,
  METHOD_LABEL,
} from '../utils/format';
import { colors, spacing, radius } from '../theme';
import { ApiError } from '../services/types';
import type { PaymentMethod } from '../types';
import type { WorkerStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<WorkerStackParamList>;

/**
 * New delivery form.
 *
 * Money fields pre-compute for the worker's convenience, but the displayed
 * totals are labelled as a preview: the server recomputes everything and its
 * answer is what gets stored.
 */
export const NewDeliveryScreen: React.FC = () => {
  const navigation = useNavigation<Nav>();
  const { user, isConnected } = useAuth();

  const [customerQuery, setCustomerQuery] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [address, setAddress] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [bottleCount, setBottleCount] = useState('');
  const [unitPrice, setUnitPrice] = useState('2.00');
  const [paidAmount, setPaidAmount] = useState('0');
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [deliveredAt, setDeliveredAt] = useState(todayInputValue());
  const [note, setNote] = useState('');
  const [touched, setTouched] = useState(false);
  const [snack, setSnack] = useState<string | null>(null);
  const [queuedOffline, setQueuedOffline] = useState(false);

  const { data: customers } = useAsync(
    () => customersApi.list({ search: customerQuery, pageSize: 8 }).then((r) => r.data.items),
    [customerQuery],
  );

  // ---- local preview only; the server is authoritative --------------------
  const count = parseInt(bottleCount || '0', 10);
  const price = parseMoneyInput(unitPrice);
  const total = Math.round(count * price * 100) / 100;
  const paid = parseMoneyInput(paidAmount);
  const debt = Math.round((total - paid) * 100) / 100;

  const previewStatus = useMemo(() => {
    if (paid <= 0) return 'UNPAID';
    if (paid >= total) return 'PAID';
    return 'PARTIAL';
  }, [paid, total]);

  const countError = touched && (!Number.isInteger(count) || count <= 0) ? 'Bidon sayı ən azı 1 olmalıdır.' : null;
  const priceError = touched && price <= 0 ? 'Qiymət sıfırdan böyük olmalıdır.' : null;
  const paidError = touched && (paid < 0 || paid > total) ? `0 - ${total.toFixed(2)} arasında olmalıdır.` : null;
  const nameError = touched && !selectedCustomerId && customerName.trim().length < 2 ? 'Müştərinin adını yazın.' : null;
  const addressError = touched && address.trim().length < 3 ? 'Çatdırılma ünvanı tələb olunur.' : null;

  const payload = () => ({
    // One UUID per submission attempt: makes replay after reconnect safe.
    idempotencyKey: `d-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    customerId: selectedCustomerId ?? undefined,
    customerName: selectedCustomerId ? undefined : customerName.trim(),
    customerPhone: customerPhone.trim() || undefined,
    address: address.trim(),
    contactPhone: contactPhone.trim() || undefined,
    bottleCount: count,
    unitPrice: normalizeMoneyInput(unitPrice),
    paidAmount: normalizeMoneyInput(paidAmount || '0'),
    paymentMethod: method,
    deliveredAt,
    note: note.trim() || undefined,
  });

  const { submit, submitting, error } = useSubmit(async () => {
    const body = payload();

    if (!isConnected) {
      await enqueue('delivery', '/deliveries', body as unknown as Record<string, unknown>, body.idempotencyKey, `Çatdırılma · ${body.customerName ?? customerName} · ${count} bidon`);
      return { queued: true as const };
    }

    try {
      await deliveriesApi.create(body);
      return { queued: false as const };
    } catch (err) {
      // Only network-ish failures are worth queueing; a validation error must
      // reach the worker immediately so they can correct the form.
      if (err instanceof ApiError && err.isRetryable) {
        await enqueue('delivery', '/deliveries', body as unknown as Record<string, unknown>, body.idempotencyKey, `Çatdırılma · ${body.customerName ?? customerName} · ${count} bidon`);
        return { queued: true as const };
      }
      throw err;
    }
  });

  const onSave = async () => {
    setTouched(true);
    if (!Number.isInteger(count) || count <= 0 || price <= 0 || address.trim().length < 3) return;
    if (!selectedCustomerId && customerName.trim().length < 2) return;
    if (paid < 0 || paid > total) return;

    const result = await submit();
    if (!result) return;

    if (result.queued) {
      setQueuedOffline(true);
      setSnack('Bağlantı yoxdur. Çatdırılma növbəyə göndəriləcək.');
    } else {
      setSnack('Çatdırılma uğurla qeydə alındı.');
    }
    setTimeout(() => navigation.goBack(), 700);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {!isConnected ? (
            <View style={styles.offlineNote}>
              <Text style={styles.offlineText}>
                📴 Bağlantı yoxdur. Çatdırılma yadda saxlanılacaq və bağlantı qaytarılanda avtomatik göndəriləcək.
              </Text>
            </View>
          ) : null}

          <Text style={styles.sectionTitle}>Müştəri</Text>
          <PaperInput
            label="Müştəri axtar (ad və ya telefon)"
            value={customerQuery}
            onChangeText={(text) => {
              setCustomerQuery(text);
              setSelectedCustomerId(null);
            }}
            mode="outlined"
            style={styles.input}
          />

          {customers && customers.length > 0 && !selectedCustomerId ? (
            <View style={styles.chipRow}>
              {customers.map((c) => (
                <Chip
                  key={c.id}
                  onPress={() => {
                    setSelectedCustomerId(c.id);
                    setCustomerName(c.name);
                    setAddress(c.address);
                    if (c.phone) setContactPhone(c.phone);
                  }}
                  style={styles.chip}
                >
                  {c.name}
                </Chip>
              ))}
            </View>
          ) : null}

          {selectedCustomerId ? (
            <View style={styles.selectedBox}>
              <Text style={styles.selectedText}>Seçilib: {customerName}</Text>
              <Button
                compact
                onPress={() => {
                  setSelectedCustomerId(null);
                  setCustomerQuery('');
                }}
              >
                Dəyiş
              </Button>
            </View>
          ) : (
            <>
              <PaperInput
                label="Müştərinin adı"
                value={customerName}
                onChangeText={setCustomerName}
                mode="outlined"
                error={Boolean(nameError)}
                style={styles.input}
              />
              {nameError ? <HelperText type="error">{nameError}</HelperText> : null}
              <PaperInput
                label="Müştərinin telefonu (istəyə bağlı)"
                value={customerPhone}
                onChangeText={setCustomerPhone}
                mode="outlined"
                keyboardType="phone-pad"
                style={styles.input}
              />
            </>
          )}

          <Divider style={styles.divider} />
          <Text style={styles.sectionTitle}>Çatdırılma</Text>

          <PaperInput
            label="Çatdırılma ünvanı"
            value={address}
            onChangeText={setAddress}
            mode="outlined"
            multiline
            error={Boolean(addressError)}
            style={styles.input}
          />
          {addressError ? <HelperText type="error">{addressError}</HelperText> : null}

          <PaperInput
            label="Əlaqə nömrəsi (istəyə bağlı)"
            value={contactPhone}
            onChangeText={setContactPhone}
            mode="outlined"
            keyboardType="phone-pad"
            style={styles.input}
          />

          <View style={styles.row}>
            <PaperInput
              label="Bidon sayı"
              value={bottleCount}
              onChangeText={(t) => setBottleCount(t.replace(/[^\d]/g, ''))}
              mode="outlined"
              keyboardType="number-pad"
              error={Boolean(countError)}
              style={styles.half}
            />
            <PaperInput
              label="Bir bidonun qiyməti"
              value={unitPrice}
              onChangeText={(t) => setUnitPrice(normalizeMoneyInput(t))}
              mode="outlined"
              keyboardType="decimal-pad"
              error={Boolean(priceError)}
              style={styles.half}
            />
          </View>
          {countError ? <HelperText type="error">{countError}</HelperText> : null}
          {priceError ? <HelperText type="error">{priceError}</HelperText> : null}

          <PaperInput
            label="Çatdırılma tarixi (YYYY-AA-GG)"
            value={deliveredAt}
            onChangeText={setDeliveredAt}
            mode="outlined"
            style={styles.input}
          />

          <PaperInput
            label="Qeyd (istəyə bağlı)"
            value={note}
            onChangeText={setNote}
            mode="outlined"
            multiline
            numberOfLines={2}
            style={styles.input}
          />

          <Divider style={styles.divider} />
          <Text style={styles.sectionTitle}>Ödəniş</Text>

          <PaperInput
            label="Ödənilən məbləğ"
            value={paidAmount}
            onChangeText={(t) => setPaidAmount(normalizeMoneyInput(t))}
            mode="outlined"
            keyboardType="decimal-pad"
            error={Boolean(paidError)}
            style={styles.input}
          />
          {paidError ? <HelperText type="error">{paidError}</HelperText> : null}

          <Text style={styles.fieldLabel}>Ödəniş üsulu</Text>
          <SegmentedButtons
            value={method}
            onValueChange={(v) => setMethod(v as PaymentMethod)}
            buttons={(['CASH', 'CARD', 'TRANSFER', 'OTHER'] as PaymentMethod[]).map((m) => ({
              value: m,
              label: METHOD_LABEL[m],
            }))}
            style={styles.input}
          />

          {/* Preview block. The server recalculates and its result is stored. */}
          <View style={[styles.preview, paidError && styles.previewError]}>
            <View style={styles.previewRow}>
              <Text style={styles.previewLabel}>Ümumi məbləğ</Text>
              <Text style={styles.previewValue}>{formatMoney(total)}</Text>
            </View>
            <View style={styles.previewRow}>
              <Text style={styles.previewLabel}>Qalıq borc</Text>
              <Text style={[styles.previewValue, { color: debt > 0 ? colors.danger : colors.success }]}>
                {formatMoney(debt)}
              </Text>
            </View>
            <View style={styles.previewRow}>
              <Text style={styles.previewLabel}>Status</Text>
              <Text style={styles.previewValue}>
                {previewStatus === 'PAID' ? 'Ödənilib' : previewStatus === 'PARTIAL' ? 'Qismən ödənilib' : 'Borc'}
              </Text>
            </View>
            <Text style={styles.previewNote}>
              Bu hesablamalar yalnız önizlədir. Yekun məbləğ serverdə hesablanılır.
            </Text>
          </View>

          <Button
            mode="contained"
            onPress={onSave}
            loading={submitting}
            disabled={submitting}
            contentStyle={styles.saveContent}
            style={styles.save}
            testID="save-delivery"
          >
            Çatdırılmanı yadda saxla
          </Button>
          <Text style={styles.footer}>
            {user?.fullName} · {queuedOffline ? 'Növbəyə göndəriləcək' : 'Serverə göndərilir'}
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>

      <Snackbar visible={Boolean(snack || error)} onDismiss={() => setSnack(null)} duration={4000}>
        {snack ?? error ?? ''}
      </Snackbar>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  scroll: { padding: spacing.md, paddingBottom: spacing.xxl },
  offlineNote: {
    backgroundColor: colors.warningBg,
    borderColor: colors.warning,
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  offlineText: { color: colors.warning, fontSize: 12 },
  sectionTitle: { fontSize: 15, fontWeight: '600', color: colors.primaryDark, marginBottom: spacing.sm },
  input: { backgroundColor: colors.surface },
  half: { flex: 1, backgroundColor: colors.surface },
  row: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs },
  chip: { marginBottom: 2 },
  selectedBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.successBg,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    marginTop: spacing.xs,
  },
  selectedText: { color: colors.success, fontSize: 13, fontWeight: '500' },
  divider: { marginVertical: spacing.lg },
  fieldLabel: { fontSize: 12, color: colors.textMuted, marginBottom: spacing.xs },
  preview: {
    backgroundColor: colors.infoBg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: `${colors.info}44`,
    padding: spacing.md,
    gap: spacing.xs,
    marginTop: spacing.md,
  },
  previewError: { borderColor: colors.danger, backgroundColor: colors.dangerBg },
  previewRow: { flexDirection: 'row', justifyContent: 'space-between' },
  previewLabel: { fontSize: 13, color: colors.textMuted },
  previewValue: { fontSize: 14, fontWeight: '700', color: colors.text },
  previewNote: { fontSize: 10, color: colors.textMuted, marginTop: spacing.xs, fontStyle: 'italic' },
  save: { marginTop: spacing.lg },
  saveContent: { height: 52 },
  footer: { textAlign: 'center', fontSize: 11, color: colors.textMuted, marginTop: spacing.sm },
});
