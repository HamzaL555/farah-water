import React, { useState, useCallback } from 'react';
import { View, ScrollView, StyleSheet, RefreshControl, Text } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';
import { Button, ActivityIndicator, SegmentedButtons, Divider, Searchbar } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatCard } from '../components/StatCard';
import { DeliveryRow } from '../components/DeliveryRow';
import { EmptyState } from '../components/EmptyState';
import { KeyValueRow } from '../components/KeyValueRow';
import { SectionCard } from '../components/SectionCard';
import { useAsync } from '../hooks/useAsync';
import { usersApi, deliveriesApi, paymentsApi, inventoryApi } from '../services/endpoints';
import { formatDate, formatMoney, INVENTORY_TYPE_LABEL } from '../utils/format';
import { colors, spacing, radius } from '../theme';
import type { AdminStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<AdminStackParamList, 'WorkerDetail'>;
type Nav = NativeStackNavigationProp<AdminStackParamList>;
type Mode = 'deliveries' | 'payments' | 'inventory';

/** Admin audit view for one worker: activity, money and stock. */
export const WorkerDetailScreen: React.FC<Props> = ({ route }) => {
  const navigation = useNavigation<Nav>();
  const { workerId } = route.params;
  const [mode, setMode] = useState<Mode>('deliveries');
  const [search, setSearch] = useState('');

  const { data: profile, loading, error, run } = useAsync(
    () => usersApi.detail(workerId).then((r) => r.data),
    [workerId],
  );

  const { data: deliveries, run: runDeliveries } = useAsync(
    () => deliveriesApi.list({ workerId, search: search || undefined, pageSize: 30 }).then((r) => r.data),
    [workerId, search],
  );

  const { data: payments, run: runPayments } = useAsync(
    () => paymentsApi.list({ workerId, pageSize: 30 }).then((r) => r.data),
    [workerId],
  );

  const { data: inventory, run: runInventory } = useAsync(
    () => inventoryApi.transactions({ workerId, pageSize: 30 }).then((r) => r.data),
    [workerId],
  );

  const refreshAll = useCallback(async () => {
    await Promise.all([run(), runDeliveries(), runPayments(), runInventory()]);
  }, [run, runDeliveries, runPayments, runInventory]);

  useFocusEffect(
    useCallback(() => {
      void refreshAll();
    }, [refreshAll]),
  );

  if (loading && !profile) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <ActivityIndicator size="large" />
        </View>
      </SafeAreaView>
    );
  }

  if (error || !profile) {
    return (
      <SafeAreaView style={styles.safe}>
        <EmptyState icon="⚠️" title="Yüklənmədi" message={error ?? 'Tapılmadı.'} actionLabel="Yenidən" onAction={() => void refreshAll()} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
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
        <SectionCard title={profile.fullName} subtitle={profile.username}>
          <KeyValueRow label="Telefon" value={profile.phone ?? '-'} />
          <KeyValueRow label="E-mail" value={profile.email ?? '-'} />
          <KeyValueRow label="Hesab statusu" value={profile.isActive ? 'Aktiv' : 'Deaktiv'} valueColor={profile.isActive ? colors.success : colors.danger} />
          <KeyValueRow label="Qeydiyyat tarixi" value={formatDate(profile.createdAt)} />
          <KeyValueRow label="Son giriş" value={formatDate(profile.lastLoginAt)} />
        </SectionCard>

        <View style={styles.row}>
          <StatCard label="Əlindəki bidon" value={String(profile.stockInHand)} icon="📦" accent={colors.info} background={colors.infoBg} />
          <StatCard
            label="Müştəri borcu"
            value={formatMoney(profile.outstandingDebt)}
            icon="⚠️"
            accent={profile.outstandingDebt > 0 ? colors.danger : colors.success}
            background={profile.outstandingDebt > 0 ? colors.dangerBg : colors.successBg}
          />
        </View>

        <View style={styles.row}>
          <StatCard label="Toplanan ödəniş" value={formatMoney(payments?.totalAmount ?? 0)} icon="💵" accent={colors.success} background={colors.successBg} />
          <StatCard label="Çatdırılma sayı" value={String(deliveries?.total ?? 0)} icon="🚚" accent={colors.primary} />
        </View>

        <SegmentedButtons
          value={mode}
          onValueChange={(v) => setMode(v as Mode)}
          buttons={[
            { value: 'deliveries', label: 'Çatdırılma' },
            { value: 'payments', label: 'Ödəniş' },
            { value: 'inventory', label: 'Anbar' },
          ]}
          style={styles.segmented}
        />

        {mode === 'deliveries' ? (
          <>
            <Searchbar placeholder="Müştəri və ya ünvan..." value={search} onChangeText={setSearch} style={styles.search} />
            {!deliveries || deliveries.items.length === 0 ? (
              <EmptyState icon="🚚" title="Çatdırılma yoxdur" />
            ) : (
              deliveries.items.map((d) => (
                <DeliveryRow
                  key={d.id}
                  delivery={d}
                  onPress={() => navigation.navigate('DeliveryDetail', { deliveryId: d.id })}
                />
              ))
            )}
          </>
        ) : mode === 'payments' ? (
          !payments || payments.items.length === 0 ? (
            <EmptyState icon="🧾" title="Ödəniş yoxdur" />
          ) : (
            payments.items.map((p) => (
              <View key={p.id} style={[styles.row2, p.voidedAt ? styles.voided : null]}>
                <View style={styles.flex}>
                  <Text style={styles.amount}>{formatMoney(p.amount)}</Text>
                  <Text style={styles.meta}>
                    {formatDate(p.paidAt)} · {p.customerName ?? '-'} · {p.recordedByName ?? '-'}
                  </Text>
                  {p.voidedAt ? <Text style={styles.voidText}>Geri qaytarıldı: {p.voidReason}</Text> : null}
                </View>
                <Button compact onPress={() => navigation.navigate('DeliveryDetail', { deliveryId: p.deliveryId })}>
                  Aç
                </Button>
              </View>
            ))
          )
        ) : !inventory || inventory.items.length === 0 ? (
          <EmptyState icon="📋" title="Anbar əməliyyatı yoxdur" />
        ) : (
          inventory.items.map((t) => (
            <View key={t.id} style={styles.row2}>
              <View
                style={[styles.badge, { backgroundColor: t.signedCount > 0 ? colors.successBg : colors.dangerBg }]}
              >
                <Text style={[styles.badgeText, { color: t.signedCount > 0 ? colors.success : colors.danger }]}>
                  {t.signedCount > 0 ? '+' : ''}
                  {t.signedCount}
                </Text>
              </View>
              <View style={styles.flex}>
                <Text style={styles.type}>{INVENTORY_TYPE_LABEL[t.type]}</Text>
                <Text style={styles.meta}>
                  {formatDate(t.occurredAt)}
                  {t.note ? ` · ${t.note}` : ''}
                </Text>
              </View>
            </View>
          ))
        )}

        <Divider style={styles.divider} />
        <Button mode="outlined" icon="pencil" onPress={() => navigation.navigate('WorkerForm', { workerId })}>
          Hesabı redaktə et
        </Button>
        <Text style={styles.footer}>Məlumatlar real PostgreSQL bazasından gəlir.</Text>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  center: { flex: 1, justifyContent: 'center' },
  scroll: { padding: spacing.md, paddingBottom: spacing.xxl },
  row: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  segmented: { marginVertical: spacing.md },
  search: { backgroundColor: colors.surface, marginBottom: spacing.sm },
  row2: {
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
  voided: { opacity: 0.6, borderStyle: 'dashed' },
  amount: { fontSize: 15, fontWeight: '700', color: colors.text },
  meta: { fontSize: 11, color: colors.textMuted },
  voidText: { fontSize: 11, color: colors.danger },
  badge: { minWidth: 44, paddingVertical: 4, paddingHorizontal: 6, borderRadius: radius.sm, alignItems: 'center' },
  badgeText: { fontSize: 13, fontWeight: '700' },
  type: { fontSize: 13, fontWeight: '600', color: colors.text },
  divider: { marginVertical: spacing.lg },
  footer: { textAlign: 'center', fontSize: 11, color: colors.textMuted, marginTop: spacing.md },
});
