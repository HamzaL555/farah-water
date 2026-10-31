import React, { useCallback } from 'react';
import { View, ScrollView, StyleSheet, RefreshControl, Text } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Button, ActivityIndicator, Divider } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatCard } from '../components/StatCard';
import { DeliveryRow } from '../components/DeliveryRow';
import { EmptyState } from '../components/EmptyState';
import { KeyValueRow } from '../components/KeyValueRow';
import { SectionCard } from '../components/SectionCard';
import { useAuth } from '../context/AuthContext';
import { useAsync } from '../hooks/useAsync';
import { customersApi } from '../services/endpoints';
import { formatDate, formatMoney } from '../utils/format';
import { colors, spacing } from '../theme';
import type { AdminStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<AdminStackParamList, 'CustomerDetail'>;

/** Customer profile: totals plus their delivery history. */
export const CustomerDetailScreen: React.FC<Props> = ({ route }) => {
  const { customerId } = route.params;
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';

  const { data, loading, error, run } = useAsync(
    () => customersApi.detail(customerId).then((r) => r.data),
    [customerId],
  );

  useFocusEffect(
    useCallback(() => {
      void run(false);
    }, [run]),
  );

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
        <EmptyState icon="⚠️" title="Yüklənmədi" message={error ?? 'Məlumat tapılmadı.'} actionLabel="Yenidən" onAction={() => void run()} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void run()} />}
      >
        <SectionCard title={data.name} subtitle={data.address}>
          <KeyValueRow label="Telefon" value={data.phone ?? '-'} />
          <KeyValueRow label="Qeyd" value={data.note ?? '-'} />
          <KeyValueRow label="Qeydiyyat tarixi" value={formatDate(data.createdAt)} />
        </SectionCard>

        <View style={styles.row}>
          <StatCard label="Ümumi çatdırılmış" value={formatMoney(data.totalDelivered)} icon="📄" accent={colors.primary} />
          <StatCard
            label="Ödənilən"
            value={formatMoney(data.totalPaid)}
            icon="✅"
            accent={colors.success}
            background={colors.successBg}
          />
        </View>

        <View style={styles.row}>
          <StatCard
            label="Qalan borc"
            value={formatMoney(data.totalDebt)}
            icon="⚠️"
            accent={data.totalDebt > 0 ? colors.danger : colors.success}
            background={data.totalDebt > 0 ? colors.dangerBg : colors.successBg}
          />
          <StatCard label="Ümumi bidon" value={String(data.totalBottles)} icon="🧴" accent={colors.info} background={colors.infoBg} />
        </View>

        <Divider style={styles.divider} />
        <Text style={styles.sectionTitle}>Çatdırılmalar ({data.deliveries.length})</Text>

        {data.deliveries.length === 0 ? (
          <EmptyState icon="🚚" title="Çatdırılma yoxdur" message="Bu müştəri üçün hələ çatdırılma qeydə alınmayıb." />
        ) : (
          data.deliveries.map((d) => <DeliveryRow key={d.id} delivery={d} showWorker isAdmin={isAdmin} />)
        )}

        <Button mode="outlined" onPress={() => void run()} style={styles.refresh}>
          Yenilə
        </Button>
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
  divider: { marginVertical: spacing.lg },
  sectionTitle: { fontSize: 15, fontWeight: '600', color: colors.text, marginBottom: spacing.sm },
  refresh: { marginTop: spacing.md },
});
