import React, { useState, useCallback } from 'react';
import { View, ScrollView, StyleSheet, RefreshControl, Text, Pressable } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ActivityIndicator, Menu, Button, Chip, Searchbar } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatCard } from '../components/StatCard';
import { EmptyState } from '../components/EmptyState';
import { useAsync } from '../hooks/useAsync';
import { dashboardApi, paymentsApi, deliveriesApi } from '../services/endpoints';
import { formatDate, formatMoney, METHOD_LABEL } from '../utils/format';
import { colors, spacing, radius } from '../theme';
import type { DateRangePreset, PaymentMethod } from '../types';
import type { AdminStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<AdminStackParamList>;

const PRESETS: Array<{ value: DateRangePreset; label: string }> = [
  { value: 'today', label: 'Bu gün' },
  { value: 'yesterday', label: 'Dünən' },
  { value: 'last7days', label: 'Son 7 gün' },
  { value: 'thisMonth', label: 'Bu ay' },
  { value: 'lastMonth', label: 'Keçən ay' },
  { value: 'thisYear', label: 'Bu il' },
  { value: 'all', label: 'Hamısı' },
];

const METHODS: Array<{ value: PaymentMethod | 'ALL'; label: string }> = [
  { value: 'ALL', label: 'Hamısı' },
  { value: 'CASH', label: 'Nağd' },
  { value: 'CARD', label: 'Kart' },
  { value: 'TRANSFER', label: 'Köçürmə' },
];

/**
 * Revenue screen.
 *
 * Revenue = sum of non-voided payments only. The "billed" figure is shown
 * beside it so unpaid debt is never mistaken for income.
 */
export const RevenueScreen: React.FC = () => {
  const navigation = useNavigation<Nav>();
  const [preset, setPreset] = useState<DateRangePreset>('today');
  const [menuVisible, setMenuVisible] = useState(false);
  const [method, setMethod] = useState<PaymentMethod | 'ALL'>('ALL');
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<'methods' | 'workers' | 'history'>('methods');

  const { data, loading, error, run } = useAsync(
    () => dashboardApi.revenue({ preset }).then((r) => r.data),
    [preset],
  );

  const { data: history, run: runHistory } = useAsync(
    () =>
      paymentsApi
        .list({ preset, method: method === 'ALL' ? undefined : method, search: search || undefined, pageSize: 50 })
        .then((r) => r.data),
    [preset, method, search],
  );

  const { data: billed, run: runBilled } = useAsync(
    () => deliveriesApi.list({ preset, pageSize: 1 }).then((r) => r.data),
    [preset],
  );

  const refreshAll = useCallback(async () => {
    await Promise.all([run(), runHistory(), runBilled()]);
  }, [run, runHistory, runBilled]);

  useFocusEffect(
    useCallback(() => {
      void refreshAll();
    }, [refreshAll]),
  );

  const collected = history?.totalAmount ?? 0;

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
        <View style={styles.header}>
          <Text style={styles.title}>Gəlirlər</Text>
          <Menu
            visible={menuVisible}
            onDismiss={() => setMenuVisible(false)}
            anchor={
              <Button mode="outlined" compact icon="calendar" onPress={() => setMenuVisible(true)}>
                {PRESETS.find((p) => p.value === preset)?.label}
              </Button>
            }
          >
            {PRESETS.map((p) => (
              <Menu.Item
                key={p.value}
                title={p.label}
                onPress={() => {
                  setPreset(p.value);
                  setMenuVisible(false);
                }}
              />
            ))}
          </Menu>
        </View>

        <View style={styles.row}>
          <StatCard label="Faktiki daxil olan" value={formatMoney(collected)} icon="💰" accent={colors.success} background={colors.successBg} />
          <StatCard label="Çatdırılmış (faktura)" value={formatMoney(billed?.items[0]?.totalAmount ?? 0)} icon="📄" accent={colors.primary} />
        </View>

        <View style={styles.infoBox}>
          <Text style={styles.infoText}>
            Gəlir yalnız faktiki qeydə alınmış ödənişlərdən hesablanır. Borc ödənilməyibsə, həmin məbləğ gəlirə daxil
            edilmir.
          </Text>
        </View>

        <View style={styles.tabRow}>
          {(['methods', 'workers', 'history'] as const).map((t) => (
            <Chip key={t} selected={tab === t} onPress={() => setTab(t)} style={styles.chip}>
              {t === 'methods' ? 'Üsul' : t === 'workers' ? 'İşçi' : 'Tarixçə'}
            </Chip>
          ))}
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}
        {loading && !data ? <ActivityIndicator style={styles.spinner} /> : null}

        {tab === 'methods' ? (
          !data || data.byMethod.length === 0 ? (
            <EmptyState icon="💵" title="Ödəniş yoxdur" message="Seçilmiş dövrda ödəniş qeydə alınmayıb." />
          ) : (
            <>
              {data.byMethod.map((m) => {
                const pct = collected > 0 ? Math.round((m.amount / collected) * 100) : 0;
                return (
                  <View key={m.method} style={styles.barRow}>
                    <View style={styles.barHeader}>
                      <Text style={styles.barLabel}>{METHOD_LABEL[m.method] ?? m.method}</Text>
                      <Text style={styles.barValue}>{formatMoney(m.amount)} ({pct}%)</Text>
                    </View>
                    <View style={styles.barTrack}>
                      <View style={[styles.barFill, { width: `${pct}%` }]} />
                    </View>
                    <Text style={styles.barMeta}>{m.count} ödəniş</Text>
                  </View>
                );
              })}
            </>
          )
        ) : tab === 'workers' ? (
          !data || data.byWorker.length === 0 ? (
            <EmptyState icon="👷" title="Məlumat yoxdur" />
          ) : (
            data.byWorker.map((w) => {
              const pct = collected > 0 ? Math.round((w.amount / collected) * 100) : 0;
              return (
                <View key={w.workerId} style={styles.barRow}>
                  <View style={styles.barHeader}>
                    <Text style={styles.barLabel}>{w.workerName}</Text>
                    <Text style={styles.barValue}>{formatMoney(w.amount)} ({pct}%)</Text>
                  </View>
                  <View style={styles.barTrack}>
                    <View style={[styles.barFill, { width: `${pct}%` }]} />
                  </View>
                  <Text style={styles.barMeta}>{w.count} ödəniş</Text>
                </View>
              );
            })
          )
        ) : (
          <>
            <Searchbar
              placeholder="Müştəri, ünvan və ya qeyd..."
              value={search}
              onChangeText={setSearch}
              style={styles.search}
            />
            <View style={styles.filterRow}>
              {METHODS.map((m) => (
                <Chip key={m.value} compact selected={method === m.value} onPress={() => setMethod(m.value)}>
                  {m.label}
                </Chip>
              ))}
            </View>
            {!history || history.items.length === 0 ? (
              <EmptyState icon="🧾" title="Ödəniş tapılmadı" />
            ) : (
              history.items.map((p) => (
                <Pressable
                  key={p.id}
                  onPress={() => navigation.navigate('DeliveryDetail', { deliveryId: p.deliveryId })}
                  android_ripple={{ color: colors.surfaceVariant }}
                  style={[styles.historyRow, p.voidedAt ? styles.voided : null]}
                >
                  <View style={styles.flex}>
                    <Text style={[styles.historyAmount, p.voidedAt && styles.strike]}>
                      {formatMoney(p.amount)}
                    </Text>
                    <Text style={styles.historyMeta}>
                      {formatDate(p.paidAt)} · {p.customerName ?? '-'} · {METHOD_LABEL[p.method]}
                    </Text>
                    {p.voidedAt ? <Text style={styles.voidText}>Geri qaytarıldı</Text> : null}
                  </View>
                </Pressable>
              ))
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  scroll: { padding: spacing.md, paddingBottom: spacing.xxl },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  title: { fontSize: 20, fontWeight: '700', color: colors.text },
  row: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  infoBox: {
    backgroundColor: colors.infoBg,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: `${colors.info}44`,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  infoText: { fontSize: 11, color: colors.info, lineHeight: 16 },
  tabRow: { flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.md },
  chip: { flex: 1 },
  error: { color: colors.danger, fontSize: 12, marginBottom: spacing.sm },
  spinner: { marginVertical: spacing.lg },
  barRow: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  barHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.xs },
  barLabel: { fontSize: 13, fontWeight: '600', color: colors.text },
  barValue: { fontSize: 13, fontWeight: '700', color: colors.success },
  barTrack: { height: 8, backgroundColor: colors.border, borderRadius: 4, overflow: 'hidden' },
  barFill: { height: '100%', backgroundColor: colors.success, borderRadius: 4 },
  barMeta: { fontSize: 10, color: colors.textMuted, marginTop: spacing.xs },
  search: { backgroundColor: colors.surface, marginBottom: spacing.sm },
  filterRow: { flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.md, flexWrap: 'wrap' },
  historyRow: {
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.xs,
  },
  voided: { opacity: 0.6, borderStyle: 'dashed' },
  historyAmount: { fontSize: 15, fontWeight: '700', color: colors.success },
  strike: { textDecorationLine: 'line-through', color: colors.textMuted },
  historyMeta: { fontSize: 11, color: colors.textMuted },
  voidText: { fontSize: 11, color: colors.danger },
});
