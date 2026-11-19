import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, KeyboardAvoidingView, Platform, Pressable } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  Button,
  TextInput as PaperInput,
  HelperText,
  Snackbar,
  Chip,
  Divider,
  Menu,
  SegmentedButtons,
} from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { companiesApi, customersApi, deliveriesApi } from '../services/endpoints';
import { enqueue } from '../services/offlineQueue';
import { useAuth } from '../context/AuthContext';
import { useAsync, useSubmit } from '../hooks/useAsync';
import { formatDate, dayRelativeName, recentDeliveryDates, todayInputValue } from '../utils/format';
import { colors, spacing, radius } from '../theme';
import { ApiError } from '../services/types';
import type { DestinationType, WaterType } from '../types';
import type { WorkerStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<WorkerStackParamList>;

/**
 * New delivery form.
 *
 * The worker records three things: which water, where it went, and how many
 * bottles. Nothing about money. The price is the company's or the admin's to
 * set and the cash collected is the admin's to declare, so the amount on the
 * delivery is decided by the owner rather than by whoever was carrying it.
 *
 * The destination picker cascades. "Şirkət" reveals a company and then an
 * office; "Ev" reveals a free-text address. Exactly one of the two is ever on
 * screen, so a company delivery cannot end up with a typed address that
 * contradicts its office.
 */
export const NewDeliveryScreen: React.FC = () => {
  const navigation = useNavigation<Nav>();
  const { user, isConnected } = useAuth();

  const [waterType, setWaterType] = useState<WaterType>('FILTERED');
  const [destinationType, setDestinationType] = useState<DestinationType>('HOME');
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [officeId, setOfficeId] = useState<string | null>(null);

  const [customerQuery, setCustomerQuery] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [address, setAddress] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [bottleCount, setBottleCount] = useState('');
  const [deliveredAt, setDeliveredAt] = useState(todayInputValue());
  const [dateMenuOpen, setDateMenuOpen] = useState(false);
  const [note, setNote] = useState('');
  const [touched, setTouched] = useState(false);
  const [snack, setSnack] = useState<string | null>(null);
  const [queuedOffline, setQueuedOffline] = useState(false);

  const { data: companies } = useAsync(() => companiesApi.list().then((r) => r.data), []);
  const { data: customers } = useAsync(
    () => customersApi.list({ search: customerQuery, pageSize: 8 }).then((r) => r.data.items),
    [customerQuery],
  );

  // The office list depends on the company, so it is derived rather than stored
  // - two sources of truth for "which office" would drift.
  const company = useMemo(
    () => (companies ?? []).find((c) => c.id === companyId) ?? null,
    [companies, companyId],
  );
  const offices = company?.offices ?? [];
  // A company delivery names a company and an office, not a person, so there is
  // no customer to pick and none is required. The server attaches the company.
  const isCompany = destinationType === 'COMPANY';

  const count = parseInt(bottleCount || '0', 10);

  const countError = touched && (!Number.isInteger(count) || count <= 0) ? 'Bidon sayı ən azı 1 olmalıdır.' : null;
  const nameError =
    touched && !isCompany && !selectedCustomerId && customerName.trim().length < 2
      ? 'Müştərinin adını yazın.'
      : null;
  const addressError =
    touched && destinationType === 'HOME' && address.trim().length < 3 ? 'Evə çatdırılmada ünvan yazılmalıdır.' : null;
  const companyError = touched && destinationType === 'COMPANY' && !company ? 'Şirkət seçilməlidir.' : null;
  const officeError = touched && destinationType === 'COMPANY' && !officeId ? 'Ofis seçilməlidir.' : null;

  const payload = () => ({
    // One UUID per submission attempt: makes replay after reconnect safe.
    idempotencyKey: `d-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    customerId: isCompany ? undefined : (selectedCustomerId ?? undefined),
    customerName: isCompany ? undefined : selectedCustomerId ? undefined : customerName.trim(),
    customerPhone: isCompany ? undefined : customerPhone.trim() || undefined,
    waterType,
    destinationType,
    companyId: destinationType === 'COMPANY' ? companyId ?? undefined : undefined,
    officeId: destinationType === 'COMPANY' ? officeId ?? undefined : undefined,
    address: destinationType === 'HOME' ? address.trim() : undefined,
    contactPhone: contactPhone.trim() || undefined,
    bottleCount: count,
    // A delivery saved for today happened now, so it carries the exact second;
    // the backend would otherwise read a bare date as the start of the day.
    // Backdated deliveries keep their date-only value because no clock time
    // was ever known for them.
    deliveredAt: deliveredAt === todayInputValue() ? new Date().toISOString() : deliveredAt,
    note: note.trim() || undefined,
  });

  const { submit, submitting, error } = useSubmit(async () => {
    const body = payload();

    if (!isConnected) {
      await enqueue('delivery', '/deliveries', body as unknown as Record<string, unknown>, body.idempotencyKey, `Çatdırılma · ${body.customerName ?? customerName} · ${count} bidon`);
      return { queued: true as const, id: null as string | null };
    }

    try {
      const created = await deliveriesApi.create(body);
      return { queued: false as const, id: created.data.id };
    } catch (err) {
      // Only network-ish failures are worth queueing; a validation error must
      // reach the worker immediately so they can correct the form.
      if (err instanceof ApiError && err.isRetryable) {
        await enqueue('delivery', '/deliveries', body as unknown as Record<string, unknown>, body.idempotencyKey, `Çatdırılma · ${body.customerName ?? customerName} · ${count} bidon`);
        return { queued: true as const, id: null as string | null };
      }
      throw err;
    }
  });

  const onSave = async () => {
    setTouched(true);
    if (!Number.isInteger(count) || count <= 0) return;
    if (!isCompany && !selectedCustomerId && customerName.trim().length < 2) return;
    if (destinationType === 'HOME' && address.trim().length < 3) return;
    if (isCompany && (!company || !officeId)) return;

    const result = await submit();
    if (!result) return;

    if (result.queued) {
      setQueuedOffline(true);
      setSnack('Bağlantı yoxdur. Çatdırılma növbəyə göndəriləcək.');
      setTimeout(() => navigation.goBack(), 700);
      return;
    }

    // Land on the row itself: recording is only half the flow, and the
    // separate "Təsdiqlə" action must be one tap away.
    setSnack('Çatdırılma qeydə alındı. Bidonlar hələ stokdan çıxmayıb.');
    const id = result.id;
    setTimeout(() => {
      if (id) navigation.navigate('DeliveryDetail', { deliveryId: id });
      else navigation.goBack();
    }, 700);
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

          <Text style={styles.sectionTitle}>Su</Text>
          <SegmentedButtons
            value={waterType}
            onValueChange={(v) => setWaterType(v as WaterType)}
            buttons={[
              { value: 'FILTERED', label: 'Filtr suyu' },
              { value: 'SPRING', label: 'Bulaq suyu' },
            ]}
            style={styles.input}
          />

          <Text style={[styles.sectionTitle, styles.spaced]}>Hara</Text>
          <SegmentedButtons
            value={destinationType}
            onValueChange={(v) => {
              const next = v as DestinationType;
              setDestinationType(next);
              // Clear the other branch's selection: leaving a stale office id
              // behind would attach this delivery to an office the driver no
              // longer picked.
              if (next === 'COMPANY') {
                setAddress('');
              } else {
                setOfficeId(null);
                setCompanyId(null);
              }
            }}
            buttons={[
              { value: 'HOME', label: 'Ev' },
              { value: 'COMPANY', label: 'Şirkət' },
            ]}
            style={styles.input}
          />

          {destinationType === 'COMPANY' ? (
            <>
              <Text style={[styles.sectionTitle, styles.spaced]}>Şirkət</Text>
              {companies && companies.length > 0 ? (
                <View style={styles.chipRow}>
                  {companies.map((c) => (
                    <Chip
                      key={c.id}
                      selected={companyId === c.id}
                      onPress={() => {
                        setCompanyId(c.id);
                        setOfficeId(null);
                      }}
                      style={styles.chip}
                    >
                      {c.name}
                    </Chip>
                  ))}
                </View>
              ) : (
                <Text style={styles.hint}>Şirkət yüklənir…</Text>
              )}
              {companyError ? <HelperText type="error">{companyError}</HelperText> : null}

              {company ? (
                <>
                  <Text style={[styles.sectionTitle, styles.spaced]}>Ofis</Text>
                  <View style={styles.chipRow}>
                    {offices.map((o) => (
                      <Chip
                        key={o.id}
                        selected={officeId === o.id}
                        onPress={() => setOfficeId(o.id)}
                        style={styles.chip}
                      >
                        {o.name}
                      </Chip>
                    ))}
                  </View>
                  {officeError ? <HelperText type="error">{officeError}</HelperText> : null}
                </>
              ) : null}
            </>
          ) : (
            <>
              <Text style={[styles.sectionTitle, styles.spaced]}>Ünvan</Text>
              <PaperInput
                label="Ev ünvanı"
                value={address}
                onChangeText={setAddress}
                mode="outlined"
                multiline
                error={Boolean(addressError)}
                style={styles.input}
              />
              {addressError ? <HelperText type="error">{addressError}</HelperText> : null}
              <View style={styles.priceNote}>
                <Text style={styles.priceNoteText}>
                  Qiymət cari qiymət siyahısından götürülür. Alınan pulu admin sonra daxil edir.
                </Text>
              </View>
            </>
          )}

          {/* A company drop is addressed by the office, so a customer field here would
              only invite a name that contradicts it. */}
          {!isCompany ? (
            <>
              <Divider style={styles.divider} />
              <Text style={styles.sectionTitle}>Müştəri</Text>
              <PaperInput
                label="Müştəri axtar"
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
                        // A stored address only pre-fills the field when this is
                        // a home drop; for a company the office is the address.
                        if (destinationType === 'HOME') setAddress(c.address);
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
                    label="Müştərinin telefonu"
                    value={customerPhone}
                    onChangeText={setCustomerPhone}
                    mode="outlined"
                    keyboardType="phone-pad"
                    style={styles.input}
                  />
                </>
              )}
            </>
          ) : null}

          <Divider style={styles.divider} />
          <Text style={styles.sectionTitle}>Çatdırılma</Text>

          <PaperInput
            label="Bidon sayı"
            value={bottleCount}
            onChangeText={(t) => setBottleCount(t.replace(/[^\d]/g, ''))}
            mode="outlined"
            keyboardType="number-pad"
            error={Boolean(countError)}
            style={styles.input}
          />
          {countError ? <HelperText type="error">{countError}</HelperText> : null}

          {/* Paper's Menu measures the box that holds the anchor node, so the
            input has to sit inside it. The Pressable wraps it because a
            read-only TextInput is not guaranteed to report touches on every
            Android version, and a picker that silently does nothing on an old
            phone is worse than no picker at all. */}
          <Menu
            visible={dateMenuOpen}
            onDismiss={() => setDateMenuOpen(false)}
            anchor={
              <Pressable
                onPress={() => setDateMenuOpen(true)}
                accessibilityRole="button"
                accessibilityLabel={`Çatdırılma tarixi: ${dayRelativeName(deliveredAt)}`}
              >
                <PaperInput
                  label="Çatdırılma tarixi"
                  value={dayRelativeName(deliveredAt)}
                  mode="outlined"
                  editable={false}
                  pointerEvents="none"
                  right={<PaperInput.Icon icon="calendar-month" />}
                  style={styles.input}
                />
              </Pressable>
            }
          >
            {recentDeliveryDates().map((d) => (
              <Menu.Item
                key={d}
                title={`${dayRelativeName(d)} · ${formatDate(d)}`}
                onPress={() => {
                  setDeliveredAt(d);
                  setDateMenuOpen(false);
                }}
                leadingIcon={d === deliveredAt ? 'check' : undefined}
              />
            ))}
          </Menu>
          <Text style={styles.hint}>Seçilən tarix: {formatDate(deliveredAt)}</Text>

          <PaperInput
            label="Qeyd (istəyə bağlı)"
            value={note}
            onChangeText={setNote}
            mode="outlined"
            multiline
            numberOfLines={2}
            style={styles.input}
          />

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
  spaced: { marginTop: spacing.lg },
  hint: { fontSize: 12, color: colors.textMuted },
  input: { backgroundColor: colors.surface },
  half: { flex: 1, backgroundColor: colors.surface },
  row: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs },
  chip: { marginBottom: 2 },
  priceNote: {
    backgroundColor: colors.infoBg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: `${colors.info}44`,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  priceNoteText: { fontSize: 12, color: colors.textMuted, lineHeight: 17 },
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
  save: { marginTop: spacing.lg },
  saveContent: { height: 52 },
  footer: { textAlign: 'center', fontSize: 11, color: colors.textMuted, marginTop: spacing.sm },
});
