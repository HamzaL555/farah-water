import React, { useState, useCallback } from 'react';
import { View, StyleSheet, RefreshControl, FlatList, Text, Pressable } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Searchbar, ActivityIndicator, FAB, Chip } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { EmptyState } from '../components/EmptyState';
import { useAsync } from '../hooks/useAsync';
import { customersApi } from '../services/endpoints';
import { formatMoney } from '../utils/format';
import { colors, spacing, radius } from '../theme';
import type { Customer } from '../types';
import type { WorkerStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<WorkerStackParamList>;

/** Customer list with live debt totals and a search box. */
export const CustomersScreen: React.FC = () => {
  const navigation = useNavigation<Nav>();
  const [query, setQuery] = useState('');
  const [onlyDebtors, setOnlyDebtors] = useState(false);

  const { data, loading, error, run } = useAsync(
    () => customersApi.list({ search: query || undefined, onlyDebtors, pageSize: 50 }).then((r) => r.data),
    [query, onlyDebtors],
  );

  useFocusEffect(
    useCallback(() => {
      void run(false);
    }, [run]),
  );

  const renderCustomer = ({ item }: { item: Customer }) => (
    <Pressable
      onPress={() => navigation.navigate('CustomerDetail', { customerId: item.id })}
      android_ripple={{ color: colors.surfaceVariant }}
      style={styles.card}
    >
      <View style={styles.cardTop}>
        <View style={styles.flex}>
          <Text style={styles.name} numberOfLines={1}>
            {item.name}
          </Text>
          <Text style={styles.address} numberOfLines={1}>
            {item.address}
          </Text>
          {item.phone ? <Text style={styles.phone}>{item.phone}</Text> : null}
        </View>
        {item.totalDebt > 0 ? (
          <View style={styles.debtBadge}>
            <Text style={styles.debtText}>{formatMoney(item.totalDebt)}</Text>
          </View>
        ) : (
          <Chip compact style={styles.paidChip}>
            Borc yoxdur
          </Chip>
        )}
      </View>

      <View style={styles.cardBottom}>
        <Text style={styles.meta}>{item.deliveryCount} çatdırılma</Text>
        <Text style={styles.meta}>{item.totalBottles} bidon</Text>
        <Text style={styles.meta}>Cəmi: {formatMoney(item.totalDelivered)}</Text>
      </View>
    </Pressable>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Searchbar
          placeholder="Müştəri axtar..."
          value={query}
          onChangeText={setQuery}
          style={styles.search}
        />
        <Chip
          selected={onlyDebtors}
          onPress={() => setOnlyDebtors((v) => !v)}
          style={styles.filterChip}
        >
          Yalnız borclular
        </Chip>
      </View>

      {loading && !data ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" />
        </View>
      ) : error ? (
        <EmptyState
          icon="⚠️"
          title="Məlumat yüklənmədi"
          message={error}
          actionLabel="Yenidən cəhd et"
          onAction={() => void run()}
        />
      ) : (
        <FlatList
          data={data?.items ?? []}
          keyExtractor={(item) => item.id}
          renderItem={renderCustomer}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void run()} />}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <EmptyState
              icon="👥"
              title="Müştəri tapılmadı"
              message="Yeni çatdırılma yaradarkən müştərinin adı avtomatik əlavə olunur."
            />
          }
        />
      )}

      <FAB
        icon="plus"
        label="Yeni çatdırılma"
        style={styles.fab}
        onPress={() => navigation.navigate('WorkerTabs', { screen: 'NewDelivery' })}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  header: { padding: spacing.md, gap: spacing.sm },
  search: { backgroundColor: colors.surface },
  filterChip: { alignSelf: 'flex-start' },
  center: { flex: 1, justifyContent: 'center' },
  list: { paddingHorizontal: spacing.md, paddingBottom: 90 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.xs,
  },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  name: { fontSize: 15, fontWeight: '600', color: colors.text },
  address: { fontSize: 12, color: colors.textMuted },
  phone: { fontSize: 11, color: colors.primaryLight },
  debtBadge: { backgroundColor: colors.dangerBg, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
  debtText: { color: colors.danger, fontSize: 12, fontWeight: '700' },
  paidChip: { backgroundColor: colors.successBg },
  cardBottom: { flexDirection: 'row', gap: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.xs },
  meta: { fontSize: 11, color: colors.textMuted },
  fab: { position: 'absolute', right: spacing.lg, bottom: spacing.lg, backgroundColor: colors.primary },
});
