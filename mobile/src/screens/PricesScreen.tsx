import React, { useCallback, useState } from 'react';
import { View, ScrollView, StyleSheet, RefreshControl, Text } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  ActivityIndicator,
  Button,
  Dialog,
  HelperText,
  Portal,
  SegmentedButtons,
  Snackbar,
  TextInput as PaperInput,
} from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SectionCard } from '../components/SectionCard';
import { EmptyState } from '../components/EmptyState';
import { KeyValueRow } from '../components/KeyValueRow';
import { useAsync, useSubmit } from '../hooks/useAsync';
import { useAuth } from '../context/AuthContext';
import { pricesApi } from '../services/endpoints';
import { formatDateTime, formatMoney } from '../utils/format';
import { colors, spacing, radius } from '../theme';
import type { PriceChangeRequest, WaterType } from '../types';

const WATER_LABEL: Record<WaterType, string> = { FILTERED: '💧 Filtr suyu', SPRING: '🏔️ Bulaq suyu' };
const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Gözləyir',
  APPROVED: 'Təsdiqləndi',
  REJECTED: 'Rədd edildi',
};
const STATUS_COLOR: Record<string, string> = {
  PENDING: colors.warning,
  APPROVED: colors.success,
  REJECTED: colors.danger,
};

/**
 * Sale prices, one per water type.
 *
 * The admin edits a price directly. A worker can only *ask*: the request is
 * stored, the admin approves or rejects it, and the price does not move until
 * that approval is claimed exactly once.
 */
export const PricesScreen: React.FC = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';

  const { data: prices, loading, error, run: runPrices } = useAsync(
    () => pricesApi.list().then((r) => r.data),
    [],
  );
  const { data: requests, run: runRequests } = useAsync(
    () => pricesApi.requests({ pageSize: 50 }).then((r) => r.data),
    [],
  );
  const { data: history, run: runHistory } = useAsync(
    () => (isAdmin ? pricesApi.history({ pageSize: 30 }).then((r) => r.data) : Promise.resolve(null)),
    [isAdmin],
  );

  const refreshAll = useCallback(async () => {
    await Promise.all([runPrices(), runRequests(), isAdmin ? runHistory() : Promise.resolve()]);
  }, [runPrices, runRequests, runHistory, isAdmin]);

  useFocusEffect(
    useCallback(() => {
      void refreshAll();
    }, [refreshAll]),
  );

  const [formOpen, setFormOpen] = useState(false);
  const [waterType, setWaterType] = useState<WaterType>('FILTERED');
  const [price, setPrice] = useState('');
  const [reason, setReason] = useState('');
  const [snack, setSnack] = useState<string | null>(null);
  const [reviewTarget, setReviewTarget] = useState<{ request: PriceChangeRequest; action: 'APPROVE' | 'REJECT' } | null>(null);
  const [reviewNote, setReviewNote] = useState('');

  const openForm = (type: WaterType) => {
    const current = prices?.find((p) => p.waterType === type);
    setWaterType(type);
    setPrice(String(current?.price ?? 0));
    setReason('');
    setFormOpen(true);
  };

  const priceError = (() => {
    if (price.trim() === '') return 'Qiymət yazın.';
    const n = Number(price);
    if (!Number.isFinite(n) || n < 0) return 'Qiymət mənfi ola bilməz.';
    if (!isAdmin && reason.trim().length < 3) return 'Səbəb yazın (ən azı 3 simvol).';
    return null;
  })();

  const submitAction = useSubmit(async () => {
    if (isAdmin) {
      return pricesApi.set(waterType, price.trim(), reason.trim() || undefined);
    }
    return pricesApi.request(waterType, price.trim(), reason.trim());
  });

  const reviewAction = useSubmit(async () => {
    if (!reviewTarget) throw new Error('Sorğu seçilməyib.');
    return pricesApi.review(reviewTarget.request.id, reviewTarget.action, reviewNote.trim() || undefined);
  });

  const onSubmit = async () => {
    if (priceError) return;
    const result = await submitAction.submit();
    if (!result) return;
    setFormOpen(false);
    setSnack(isAdmin ? 'Qiymət yeniləndi.' : 'Sorğu göndərildi.');
    void refreshAll();
  };

  const onReview = async () => {
    const result = await reviewAction.submit();
    if (!result) return;
    setReviewTarget(null);
    setReviewNote('');
    setSnack(reviewTarget?.action === 'APPROVE' ? 'Qiymət təsdiqləndi.' : 'Sorğu rədd edildi.');
    void refreshAll();
  };

  const requests_ = requests?.items ?? [];
  const pending = requests_.filter((r) => r.status === 'PENDING');

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void refreshAll()} />}
      >
        <Text style={styles.intro}>
          Bulaq və Filtr qiymətləri ayrı saxlanılır. {isAdmin
            ? 'Qiyməti birbaşa dəyişə bilərsiniz; hər dəyişiklik tarixçəyə yazılır.'
            : 'Qiyməti dəyişmək üçün sorğu göndərin; administrator təsdiqləyənə qədər köhnə qiymət qüvvədə qalır.'}
        </Text>

        {prices?.map((p) => (
          <SectionCard key={p.waterType} title={WATER_LABEL[p.waterType]} subtitle="Bir bidonun satış qiyməti">
            <Text style={styles.price}>{formatMoney(p.price)} AZN</Text>
            <KeyValueRow label="Son dəyişiklik" value={formatDateTime(p.updatedAt)} />
            <KeyValueRow label="Kim dəyişdi" value={p.updatedByName ?? '-'} />
            <Button mode="contained-tonal" icon={isAdmin ? 'pencil' : 'send'} onPress={() => openForm(p.waterType)} style={styles.priceButton}>
              {isAdmin ? 'Qiyməti dəyiş' : 'Sorğu göndər'}
            </Button>
          </SectionCard>
        ))}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {isAdmin ? (
          <SectionCard title="Gözləyən sorğular" subtitle={`${pending.length} sorğu`}>
            {pending.length === 0 ? (
              <EmptyState icon="✅" title="Gözləyən sorğu yoxdur" message="İşçilər qiymət dəyişikliyi təklif etdikdə burada görünəcək." />
            ) : (
              pending.map((r) => (
                <View key={r.id} style={styles.requestRow}>
                  <Text style={styles.requestTitle}>
                    {WATER_LABEL[r.waterType]}: {formatMoney(r.oldPrice)} → {formatMoney(r.newPrice)} AZN
                  </Text>
                  <Text style={styles.requestMeta}>
                    {r.requestedByName ?? '-'} · {formatDateTime(r.requestedAt)}
                  </Text>
                  <Text style={styles.requestReason}>{r.reason}</Text>
                  <View style={styles.requestActions}>
                    <Button
                      mode="contained"
                      compact
                      onPress={() => {
                        setReviewNote('');
                        setReviewTarget({ request: r, action: 'APPROVE' });
                      }}
                    >
                      Təsdiq et
                    </Button>
                    <Button
                      mode="outlined"
                      compact
                      textColor={colors.danger}
                      onPress={() => {
                        setReviewNote('');
                        setReviewTarget({ request: r, action: 'REJECT' });
                      }}
                    >
                      Rədd et
                    </Button>
                  </View>
                </View>
              ))
            )}
          </SectionCard>
        ) : null}

        <SectionCard title={isAdmin ? 'Bütün sorğular' : 'Mənim sorğularım'} subtitle="Qərar verilmiş sorğular dəyişdirilmir">
          {requests_.length === 0 ? (
            <EmptyState icon="📋" title="Sorğu yoxdur" message="Hələ heç bir qiymət sorğusu göndərilməyib." />
          ) : (
            requests_.slice(0, 15).map((r) => (
              <View key={r.id} style={styles.historyRow}>
                <View style={styles.flex}>
                  <Text style={styles.requestTitle}>
                    {WATER_LABEL[r.waterType]}: {formatMoney(r.oldPrice)} → {formatMoney(r.newPrice)}
                  </Text>
                  <Text style={styles.requestMeta}>
                    {r.requestedByName ?? '-'} · {formatDateTime(r.requestedAt)}
                  </Text>
                </View>
                <Text style={[styles.status, { color: STATUS_COLOR[r.status] ?? colors.textMuted }]}>
                  {STATUS_LABEL[r.status] ?? r.status}
                </Text>
              </View>
            ))
          )}
        </SectionCard>

        {isAdmin ? (
          <SectionCard title="Qiymət tarixçəsi" subtitle="Heç bir qeyd silinmir">
            {!history || history.items.length === 0 ? (
              <EmptyState icon="🕓" title="Tarixçə boşdur" message="Qiymət dəyişikliyi baş verdikdə burada görünəcək." />
            ) : (
              history.items.slice(0, 20).map((h) => (
                <View key={h.id} style={styles.historyRow}>
                  <View style={styles.flex}>
                    <Text style={styles.requestTitle}>
                      {WATER_LABEL[h.waterType]}: {formatMoney(h.oldPrice)} → {formatMoney(h.newPrice)}
                    </Text>
                    <Text style={styles.requestMeta}>
                      {formatDateTime(h.occurredAt)} · {h.changedByName ?? '-'}
                      {h.source === 'PRICE_REQUEST' ? ' · işçi sorğusu' : ' · admin'}
                    </Text>
                  </View>
                </View>
              ))
            )}
          </SectionCard>
        ) : null}

        {loading && !prices ? <ActivityIndicator style={styles.loader} /> : null}
      </ScrollView>

      <Portal>
        <Dialog visible={formOpen} onDismiss={() => setFormOpen(false)}>
          <Dialog.Title>{isAdmin ? 'Qiyməti dəyiş' : 'Qiymət sorğusu'}</Dialog.Title>
          <Dialog.Content>
            <SegmentedButtons
              value={waterType}
              onValueChange={(v) => setWaterType(v as WaterType)}
              buttons={[
                { value: 'FILTERED', label: '💧 Filtr' },
                { value: 'SPRING', label: '🏔️ Bulaq' },
              ]}
              style={styles.dialogInput}
            />
            <PaperInput
              label="Yeni qiymət (AZN / bidon)"
              value={price}
              onChangeText={setPrice}
              mode="outlined"
              keyboardType="decimal-pad"
              style={styles.dialogInput}
            />
            <PaperInput
              label={isAdmin ? 'Qeyd (istəyə bağlı)' : 'Səbəb'}
              value={reason}
              onChangeText={setReason}
              mode="outlined"
              multiline
              style={styles.dialogInput}
            />
            {priceError ? <HelperText type="error">{priceError}</HelperText> : null}
            {submitAction.error ? <HelperText type="error">{submitAction.error}</HelperText> : null}
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setFormOpen(false)}>Ləğv et</Button>
            <Button onPress={onSubmit} loading={submitAction.submitting} disabled={submitAction.submitting || priceError !== null}>
              {isAdmin ? 'Yadda saxla' : 'Göndər'}
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      <Portal>
        <Dialog visible={reviewTarget !== null} onDismiss={() => setReviewTarget(null)}>
          <Dialog.Title>{reviewTarget?.action === 'APPROVE' ? 'Qiyməti təsdiqlə' : 'Sorğunu rədd et'}</Dialog.Title>
          <Dialog.Content>
            {reviewTarget ? (
              <Text style={styles.dialogHint}>
                {WATER_LABEL[reviewTarget.request.waterType]}: {formatMoney(reviewTarget.request.oldPrice)} →{' '}
                {formatMoney(reviewTarget.request.newPrice)} AZN
                {'\n'}
                {reviewTarget.request.reason}
              </Text>
            ) : null}
            <PaperInput
              label="Qeyd (istəyə bağlı)"
              value={reviewNote}
              onChangeText={setReviewNote}
              mode="outlined"
              style={styles.dialogInput}
            />
            {reviewAction.error ? <HelperText type="error">{reviewAction.error}</HelperText> : null}
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setReviewTarget(null)}>Ləğv et</Button>
            <Button onPress={onReview} loading={reviewAction.submitting}>
              {reviewTarget?.action === 'APPROVE' ? 'Təsdiq et' : 'Rədd et'}
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
  intro: { fontSize: 12, color: colors.textMuted, lineHeight: 18, marginBottom: spacing.md },
  price: { fontSize: 30, fontWeight: '700', color: colors.primaryDark, marginBottom: spacing.xs },
  priceButton: { marginTop: spacing.sm },
  error: { color: colors.danger, fontSize: 12, marginBottom: spacing.sm },
  requestRow: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: spacing.sm,
    gap: 2,
  },
  requestTitle: { fontSize: 13, fontWeight: '600', color: colors.text },
  requestMeta: { fontSize: 11, color: colors.textMuted },
  requestReason: { fontSize: 12, color: colors.text, marginTop: 2 },
  requestActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: spacing.sm,
  },
  status: { fontSize: 11, fontWeight: '700' },
  dialogHint: { fontSize: 12, color: colors.text, lineHeight: 18, marginBottom: spacing.sm },
  dialogInput: { marginBottom: spacing.sm },
  loader: { marginTop: spacing.md },
});
