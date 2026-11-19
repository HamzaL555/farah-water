import React, { useState, useCallback } from 'react';
import { View, StyleSheet, FlatList, RefreshControl, Text } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Searchbar, ActivityIndicator, Chip, Button, Menu } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DeliveryRow } from '../components/DeliveryRow';
import { EmptyState } from '../components/EmptyState';
import { useAsync } from '../hooks/useAsync';
import { deliveriesApi, usersApi } from '../services/endpoints';
import { colors, spacing } from '../theme';
import type { DateRangePreset, Delivery, DeliveryStatus } from '../types';
import type { AdminStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<AdminStackParamList>;

const STATUS_FILTERS: Array<{ value: DeliveryStatus | 'ALL'; label: string }> = [
  { value: 'ALL', label: 'Hamısı' },
  { value: 'UNPAID', label: 'Borc' },
  { value: 'PARTIAL', label: 'Qismən' },
  { value: 'PAID', label: 'Ödənilib' },
];

const CONFIRM_FILTERS: Array<{ value: 'ALL' | 'PENDING' | 'CONFIRMED'; label: string }> = [
  { value: 'ALL', label: 'Bütün təsdiqlər' },
  { value: 'PENDING', label: 'Təsdiq gözləyən' },
  { value: 'CONFIRMED', label: 'Təsdiqlənmiş' },
];

const PRESETS: Array<{ value: DateRangePreset; label: string }> = [  { value: 'today', label: 'Bu gün' },
  { value: 'yesterday', label: 'Dünən' },
  { value: 'last7days', label: 'Son 7 gün' },
  { value: 'thisMonth', label: 'Bu ay' },
  { value: 'lastMonth', label: 'Keçən ay' },
  { value: 'all', label: 'Hamısı' },
];

/** Admin deliveries list: every worker's deliveries with filters. */
export const AdminDeliveriesScreen: React.FC = () => {
  const navigation = useNavigation<Nav>();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<DeliveryStatus | 'ALL'>('ALL');
  const [confirmation, setConfirmation] = useState<'ALL' | 'PENDING' | 'CONFIRMED'>('ALL');
  const [preset, setPreset] = useState<DateRangePreset>('today');
  const [workerId, setWorkerId] = useState<string | undefined>();
  const [menuVisible, setMenuVisible] = useState(false);
  const [page, setPage] = useState(1);

  const { data: workers } = useAsync(() => usersApi.stats().then((r) => r.data), []);

  const { data, loading, error, run } = useAsync(
    () =>
      deliveriesApi
        .list({
          search: query || undefined,
          status: status === 'ALL' ? undefined : status,
          confirmation: confirmation === 'ALL' ? undefined : confirmation,
          preset,
          workerId,
          page,
          pageSize: 25,
          sortBy: 'deliveredAt',
          sortDir: 'desc',
        })
        .then((r) => r.data),
    [query, status, confirmation, preset, workerId, page],
  );

  useFocusEffect(
    useCallback(() => {
      void run(false);
    }, [run]),
  );

  const selectedWorker = workers?.find((w) => w.id === workerId);

  const renderItem = ({ item }: { item: Delivery }) => (
    <DeliveryRow
      delivery={item}
      showWorker
      isAdmin
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
          <Menu
            visible={menuVisible}
            onDismiss={() => setMenuVisible(false)}
            anchor={
              <Button mode="outlined" compact icon="calendar" onPress={() => setMenuVisible(true)} style={styles.filterBtn}>
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
                  setPage(1);
                  setMenuVisible(false);
                }}
              />
            ))}
          </Menu>

          <Menu
            visible={false}
            anchor={
              <Button
                mode={workerId ? 'contained' : 'outlined'}
                compact
                icon="account"
                onPress={() => setWorkerId(undefined)}
                style={styles.filterBtn}
              >
                {selectedWorker?.fullName ?? 'Bütün işçilər'}
              </Button>
            }
          >
            {workers?.map((w) => (
              <Menu.Item
                key={w.id}
                title={w.fullName}
                onPress={() => {
                  setWorkerId(w.id);
                  setPage(1);
                }}
              />
            ))}
          </Menu>
        </View>

        <ScrollableChips
          items={STATUS_FILTERS}
          selected={status}
          onSelect={(v) => {
            setStatus(v);
            setPage(1);
          }}
        />

        <View style={styles.chipRow}>
          {CONFIRM_FILTERS.map((item) => (
            <Chip
              key={item.value}
              compact
              selected={confirmation === item.value}
              onPress={() => {
                setConfirmation(item.value);
                setPage(1);
              }}
              style={styles.chip}
            >
              {item.label}
            </Chip>
          ))}
        </View>

        {workerId ? (
          <View style={styles.activeFilterRow}>
            <Chip
              selected
              onClose={() => {
                setWorkerId(undefined);
                setPage(1);
              }}
            >
              {selectedWorker?.fullName}
            </Chip>
          </View>
        ) : null}

        {data ? <Text style={styles.count}>{data.total} çatdırılma tapıldı</Text> : null}
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
          onEndReached={() => {
            if (data?.hasMore && !loading) setPage((p) => p + 1);
          }}
          onEndReachedThreshold={0.4}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <EmptyState
              icon="🚚"
              title="Çatdırılma tapılmadı"
              message="Filtrləri dəyişdirin və ya daha geniş tarix aralığı seçin."
            />
          }
        />
      )}
    </SafeAreaView>
  );
};

const ScrollableChips: React.FC<{
  items: Array<{ value: DeliveryStatus | 'ALL'; label: string }>;
  selected: DeliveryStatus | 'ALL';
  onSelect: (v: DeliveryStatus | 'ALL') => void;
}> = ({ items, selected, onSelect }) => (
  <View style={styles.chipRow}>
    {items.map((item) => (
      <Chip
        key={item.value}
        compact
        selected={selected === item.value}
        onPress={() => onSelect(item.value)}
        style={styles.chip}
      >
        {item.label}
      </Chip>
    ))}
  </View>
);

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, justifyContent: 'center' },
  header: { padding: spacing.md, gap: spacing.sm },
  search: { backgroundColor: colors.surface },
  filterRow: { flexDirection: 'row', gap: spacing.sm },
  filterBtn: { flex: 1 },
  chipRow: { flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap' },
  chip: { marginBottom: 2 },
  activeFilterRow: { flexDirection: 'row' },
  count: { fontSize: 11, color: colors.textMuted },
  list: { paddingHorizontal: spacing.md, paddingBottom: spacing.xxl },
});
