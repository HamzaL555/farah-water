import React, { useCallback } from 'react';
import { View, ScrollView, StyleSheet, RefreshControl, Text } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { Button, ActivityIndicator } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatCard } from '../components/StatCard';
import { DeliveryRow } from '../components/DeliveryRow';
import { EmptyState } from '../components/EmptyState';
import { OfflineBanner } from '../components/OfflineBanner';
import { useAsync } from '../hooks/useAsync';
import { useAuth } from '../context/AuthContext';
import { dashboardApi } from '../services/endpoints';
import { formatMoney } from '../utils/format';
import { colors, spacing } from '../theme';
import type { WorkerTabParamList } from '../navigation/types';

type Nav = BottomTabNavigationProp<WorkerTabParamList, 'Home'>;

/** Worker home: today's numbers, stock in hand, and recent deliveries. */
export const WorkerHomeScreen: React.FC = () => {
  const navigation = useNavigation<Nav>();
  const { user } = useAuth();
  const { data, loading, error, run } = useAsync(() => dashboardApi.worker().then((r) => r.data), []);

  // Refresh whenever the tab regains focus so a new admin-issued stock shows up.
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
          <Text style={styles.loadingText}>Yüklənir...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error && !data) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <EmptyState
            icon="⚠️"
            title="Məlumat yüklənmədi"
            message={error}
            actionLabel="Yenidən cəhd et"
            onAction={() => void run()}
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void run()} />}
      >
        <View style={styles.header}>
          <View style={styles.flex}>
            <Text style={styles.greeting}>Salam, {user?.fullName?.split(' ')[0] ?? 'işçi'}!</Text>
            <Text style={styles.date}>{new Date().toLocaleDateString('az-AZ')}</Text>
          </View>
        </View>

        <OfflineBanner />

        {data ? (
          <>
            <View style={styles.row}>
              <StatCard
                label="Bu gün çatdırılan bidon"
                value={String(data.todayBottles)}
                icon="🚚"
                accent={colors.primary}
              />
              <StatCard
                label="Əlimdəki bidon"
                value={String(data.stockInHand)}
                icon="📦"
                accent={colors.info}
                background={colors.infoBg}
                onPress={() => navigation.navigate('Bottles')}
              />
            </View>

            <View style={styles.row}>
              <StatCard
                label="Bu gün toplanan pul"
                value={formatMoney(data.todayCollected)}
                icon="💵"
                accent={colors.success}
                background={colors.successBg}
              />
              <StatCard
                label="Bu gün ödəniş sayı"
                value={String(data.todayPayments)}
                icon="🧾"
                accent={colors.primaryLight}
              />
            </View>

            <View style={styles.row}>
              <StatCard
                label="Borclu çatdırılma"
                value={String(data.outstandingDeliveryCount)}
                icon="⏳"
                accent={colors.warning}
                background={colors.warningBg}
                onPress={() => navigation.navigate('Debts')}
              />
              <StatCard
                label="Alınmalı borc"
                value={formatMoney(data.outstandingDebt)}
                icon="⚠️"
                accent={colors.danger}
                background={colors.dangerBg}
                onPress={() => navigation.navigate('Debts')}
              />
            </View>

            <View style={styles.summaryBar}>
              <View>
                <Text style={styles.summaryLabel}>Bu gün faktura</Text>
                <Text style={styles.summaryValue}>{formatMoney(data.todayBilledAmount)}</Text>
              </View>
              <View style={styles.summaryRight}>
                <Text style={styles.summaryLabel}>Çatdırılma sayı</Text>
                <Text style={styles.summaryValue}>{data.todayDeliveries}</Text>
              </View>
            </View>

            <Button
              mode="contained"
              icon="plus"
              onPress={() => navigation.navigate('NewDelivery')}
              style={styles.cta}
              contentStyle={styles.ctaContent}
            >
              Yeni çatdırılma
            </Button>

            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Son çatdırılmalar</Text>
              <Button compact onPress={() => navigation.navigate('History')}>
                Hamısı
              </Button>
            </View>

            {data.recentDeliveries.length === 0 ? (
              <EmptyState
                icon="🚚"
                title="Hələ çatdırılma yoxdur"
                message="İlk çatdırılmanı yaratmaq üçün yuxarıdakı düyməni basın."
                actionLabel="Yeni çatdırılma"
                onAction={() => navigation.navigate('NewDelivery')}
              />
            ) : (
              data.recentDeliveries.map((delivery) => (
                <DeliveryRow
                  key={delivery.id}
                  delivery={delivery}
                  onPress={() => navigation.navigate('History', { focusId: delivery.id })}
                />
              ))
            )}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  center: { flex: 1, justifyContent: 'center' },
  loadingText: { marginTop: spacing.md, color: colors.textMuted },
  scroll: { padding: spacing.md, paddingBottom: spacing.xxl },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md },
  greeting: { fontSize: 20, fontWeight: '700', color: colors.text },
  date: { fontSize: 12, color: colors.textMuted },
  row: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  summaryBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  summaryRight: { alignItems: 'flex-end' },
  summaryLabel: { fontSize: 11, color: colors.textMuted },
  summaryValue: { fontSize: 16, fontWeight: '700', color: colors.primaryDark },
  cta: { marginBottom: spacing.lg },
  ctaContent: { height: 50 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.xs },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: colors.text },
});
