import React, { useState, useCallback } from 'react';
import { View, StyleSheet, FlatList, RefreshControl, Text } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Searchbar, ActivityIndicator, Chip } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DeliveryRow } from '../components/DeliveryRow';
import { EmptyState } from '../components/EmptyState';
import { useAsync } from '../hooks/useAsync';
import { deliveriesApi } from '../services/endpoints';
import { colors, spacing, radius } from '../theme';
import type { Delivery, DeliveryStatus } from '../types';
import type { AdminStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<AdminStackParamList>;

const FILTERS: Array<{ value: DeliveryStatus | 'ALL'; label: string }> = [
  { value: 'ALL', label: 'Hamısı' },
  { value: 'UNPAID', label: 'Borc' },
  { value: 'PARTIAL', label: 'Qismən' },
  { value: 'PAID', label: 'Ödənilib' },
];

/** Worker history: their own deliveries with search and status filters. */
export const HistoryScreen: React.FC = () => {
  const navigation = useNavigation<Nav>();
  
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<DeliveryStatus | 'ALL'>('ALL');
  const [page, setPage] = useState(1);

  const { data, loading, error, run } = useAsync(
    () =>
      deliveriesApi
        .list({
          search: query || undefined,
          status: status === 'ALL' ? undefined : status,
          page,
          pageSize: 25,
        })
        .then((r) => r.data),
    [query, status, page],
  );

  useFocusEffect(
    useCallback(() => {
      void run(false);
    }, [run]),
  );

  const loadMore = () => {
    if (data?.hasMore && !loading) setPage((p) => p + 1);
  };

  const renderItem = ({ item }: { item: Delivery }) => (
    <DeliveryRow
      delivery={item}
      // Highlight the record that triggered this navigation.
      onPress={() => navigation.navigate('DeliveryDetail', { deliveryId: item.id })}
    />
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Searchbar
          placeholder="Müştəri, ünvan və ya telefon..."
          value={query}
          onChangeText={(t) => {
            setQuery(t);
            setPage(1);
          }}
          style={styles.search}
        />
        <View style={styles.filterRow}>
          {FILTERS.map((f) => (
            <Chip
              key={f.value}
              selected={status === f.value}
              onPress={() => {
                setStatus(f.value);
                setPage(1);
              }}
              style={styles.chip}
              compact
            >
              {f.label}
            </Chip>
          ))}
        </View>
        {data ? (
          <View style={styles.summaryBar}>
            <Text style={styles.summaryText}>
              {data.total} çatdırılma
            </Text>
            {status === 'ALL' && query === '' ? null : (
              <Text style={styles.summaryText}>səhifə {page}</Text>
            )}
          </View>
        ) : null}
      </View>

      {loading && !data ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" />
        </View>
      ) : error ? (
        <EmptyState icon="⚠️" title="Yüklənmədi" message={error} actionLabel="Yenidən" onAction={() => void run()} />
      ) : (
        <FlatList
          data={data?.items ?? []}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void run()} />}
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <EmptyState
              icon="📋"
              title="Çatdırılma tapılmadı"
              message={query || status !== 'ALL' ? 'Axtarış və ya filtr dəyişdirin.' : 'Hələ çatdırılma etməmisiniz.'}
            />
          }
        />
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  header: { padding: spacing.md, gap: spacing.sm },
  search: { backgroundColor: colors.surface },
  filterRow: { flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap' },
  chip: { marginBottom: 2 },
  summaryBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: colors.surfaceVariant,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
  },
  summaryText: { fontSize: 11, color: colors.textMuted, fontWeight: '500' },
  center: { flex: 1, justifyContent: 'center' },
  list: { paddingHorizontal: spacing.md, paddingBottom: spacing.xxl },
});
