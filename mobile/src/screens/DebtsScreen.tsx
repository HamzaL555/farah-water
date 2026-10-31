import React, { useState, useCallback } from 'react';
import { View, ScrollView, StyleSheet, RefreshControl, Text } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Searchbar, Button, ActivityIndicator, SegmentedButtons } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DeliveryRow } from '../components/DeliveryRow';
import { EmptyState } from '../components/EmptyState';
import { useAuth } from '../context/AuthContext';
import { useAsync } from '../hooks/useAsync';
import { debtsApi } from '../services/endpoints';
import { formatMoney } from '../utils/format';
import { colors, spacing, radius } from '../theme';
import type { WorkerStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<WorkerStackParamList>;
type Mode = 'deliveries' | 'customers';

/**
 * Debt ledger.
 *
 * The header total comes straight from the server's SUM(debtAmount); the list
 * below is a scrollable subset, so the two are never confused.
 */
export const DebtsScreen: React.FC<{ showWorkerFilter?: boolean }> = ({ showWorkerFilter = false }) => {
  const navigation = useNavigation<Nav>();
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<Mode>('deliveries');

  const { data, loading, error, run } = useAsync(
    () => debtsApi.list({ search: query || undefined, pageSize: 50 }).then((r) => r.data),
    [query],
  );

  const { data: summary } = useAsync(
    () => debtsApi.summary({ search: query || undefined }).then((r) => r.data),
    [query],
  );

  useFocusEffect(
    useCallback(() => {
      void run(false);
    }, [run]),
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void run()} />}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.totalBox}>
          <Text style={styles.totalLabel}>Ümumi qalıq borc</Text>
          <Text style={styles.totalValue}>{formatMoney(data?.totalDebt ?? 0)}</Text>
          <Text style={styles.totalMeta}>{data?.total ?? 0} çatdırılma · {summary?.length ?? 0} müştəri</Text>
        </View>

        <Searchbar
          placeholder="Müştəri, ünvan və ya işçi axtar..."
          value={query}
          onChangeText={setQuery}
          style={styles.search}
        />

        <SegmentedButtons
          value={mode}
          onValueChange={(v) => setMode(v as Mode)}
          buttons={[
            { value: 'deliveries', label: 'Çatdırılmalar' },
            { value: 'customers', label: 'Müştərilər' },
          ]}
          style={styles.segmented}
        />

        {loading && !data ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" />
          </View>
        ) : error ? (
          <EmptyState icon="⚠️" title="Yüklənmədi" message={error} actionLabel="Yenidən" onAction={() => void run()} />
        ) : mode === 'deliveries' ? (
          data && data.items.length === 0 ? (
            <EmptyState icon="🎉" title="Borc yoxdur" message="Bütün çatdırılmalar ödənilib." />
          ) : (
            data?.items.map((d) => (
              <DeliveryRow
                key={d.id}
                delivery={d}
                showWorker
                isAdmin={isAdmin}
                onPress={() => navigation.navigate('DeliveryDetail', { deliveryId: d.id })}
              />
            ))
          )
        ) : summary && summary.length === 0 ? (
          <EmptyState icon="🎉" title="Borclu müştəri yoxdur" message="Bütün müştərilərin borcları ödənilib." />
        ) : (
          summary?.map((row) => (
            <Button
              key={row.customerId}
              mode="text"
              style={styles.customerRow}
              contentStyle={styles.customerContent}
              onPress={() => navigation.navigate('CustomerDetail', { customerId: row.customerId })}
            >
              <View style={styles.customerInfo}>
                <Text style={styles.customerName} numberOfLines={1}>
                  {row.customerName}
                </Text>
                <Text style={styles.customerAddress} numberOfLines={1}>
                  {row.address ?? '-'}
                </Text>
                <Text style={styles.customerMeta}>
                  {row.deliveryCount} çatdırılma · ödənilən {formatMoney(row.paidAmount)}
                </Text>
              </View>
              <View style={styles.debtCol}>
                <Text style={styles.debtLabel}>Borc</Text>
                <Text style={styles.debtValue}>{formatMoney(row.debtAmount)}</Text>
              </View>
            </Button>
          ))
        )}
        {showWorkerFilter ? null : null}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: spacing.md, paddingBottom: spacing.xxl },
  center: { paddingVertical: spacing.xxl },
  totalBox: {
    backgroundColor: colors.dangerBg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: `${colors.danger}44`,
    padding: spacing.lg,
    marginBottom: spacing.md,
    alignItems: 'center',
  },
  totalLabel: { fontSize: 12, color: colors.textMuted },
  totalValue: { fontSize: 28, fontWeight: '800', color: colors.danger, marginVertical: spacing.xs },
  totalMeta: { fontSize: 11, color: colors.textMuted },
  search: { backgroundColor: colors.surface, marginBottom: spacing.sm },
  segmented: { marginBottom: spacing.md },
  customerRow: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.sm,
  },
  customerContent: { height: undefined, paddingVertical: spacing.md, flexDirection: 'row', alignItems: 'center' },
  customerInfo: { flex: 1, gap: 2 },
  customerName: { fontSize: 15, fontWeight: '600', color: colors.text },
  customerAddress: { fontSize: 12, color: colors.textMuted },
  customerMeta: { fontSize: 11, color: colors.textMuted },
  debtCol: { alignItems: 'flex-end', marginLeft: spacing.sm },
  debtLabel: { fontSize: 10, color: colors.textMuted },
  debtValue: { fontSize: 15, fontWeight: '700', color: colors.danger },
});
