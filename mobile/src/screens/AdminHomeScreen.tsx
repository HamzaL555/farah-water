import React, { useState, useCallback } from 'react';
import { View, ScrollView, StyleSheet, RefreshControl, Text } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { ActivityIndicator, Chip, Menu, Button } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatCard } from '../components/StatCard';
import { OfflineBanner } from '../components/OfflineBanner';
import { EmptyState } from '../components/EmptyState';
import { useAsync } from '../hooks/useAsync';
import { useAutoRefresh } from '../hooks/useAutoRefresh';
import { dashboardApi } from '../services/endpoints';
import { formatMoney } from '../utils/format';
import { colors, spacing, radius } from '../theme';
import type { DateRangePreset } from '../types';
import type { AdminTabParamList } from '../navigation/types';

type Nav = BottomTabNavigationProp<AdminTabParamList, 'AdminHome'>;

const PRESETS: Array<{ value: DateRangePreset; label: string }> = [
  { value: 'today', label: 'Bu gün' },
  { value: 'yesterday', label: 'Dünən' },
  { value: 'last7days', label: 'Son 7 gün' },
  { value: 'thisMonth', label: 'Bu ay' },
  { value: 'lastMonth', label: 'Keçən ay' },
  { value: 'all', label: 'Hamısı' },
];

/**
 * Admin dashboard.
 *
 * "Faktiki alınan pul" (collected) and "Çatdırılmış məbləğ" (billed) are shown
 * as separate cards on purpose: unpaid debt is never presented as revenue.
 */
export const AdminHomeScreen: React.FC = () => {
  const navigation = useNavigation<Nav>();
  const [preset, setPreset] = useState<DateRangePreset>('today');
  const [menuVisible, setMenuVisible] = useState(false);

  const { data, loading, error, run } = useAsync(
    () => dashboardApi.admin({ preset }).then((r) => r.data),
    [preset],
  );

  useFocusEffect(
    useCallback(() => {
      void run(false);
    }, [run]),
  );

  // Keep the dashboard live while it is open: a delivery recorded by a worker
  // should appear here without the admin touching anything.
  useAutoRefresh(
    useCallback(() => run(false), [run]),
    30_000,
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

  if (error && !data) {
    return (
      <SafeAreaView style={styles.safe}>
        <EmptyState
          icon="⚠️"
          title="Məlumat yüklənmədi"
          message={error}
          actionLabel="Yenidən cəhd et"
          onAction={() => void run()}
        />
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
          <Text style={styles.title}>Admin Panel</Text>
          <Menu
            visible={menuVisible}
            onDismiss={() => setMenuVisible(false)}
            anchor={
              <Button
                mode="outlined"
                compact
                icon="calendar"
                onPress={() => setMenuVisible(true)}
                style={styles.periodButton}
              >
                {PRESETS.find((p) => p.value === preset)?.label ?? 'Bu gün'}
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

        <OfflineBanner />

        {/* --- Finance: collected vs billed, never conflated ---------------- */}
        <Text style={styles.groupTitle}>Maliyyə</Text>
        <View style={styles.row}>
          <StatCard
            label="Faktiki alınan pul (seçilmiş dövr)"
            value={formatMoney(data?.finance.collectedInRange ?? 0)}
            icon="💰"
            accent={colors.success}
            background={colors.successBg}
            onPress={() => navigation.navigate('Revenue')}
          />
          <StatCard
            label="Çatdırılmış məbləğ (faktura)"
            value={formatMoney(data?.finance.billedInRange ?? 0)}
            icon="📄"
            accent={colors.primary}
            onPress={() => navigation.navigate('Deliveries')}
          />
        </View>

        <View style={styles.row}>
          <StatCard label="Bu gün alınan pul" value={formatMoney(data?.finance.todayCollected ?? 0)} icon="🗓️" accent={colors.primary} />
          <StatCard label="Bu ay alınan pul" value={formatMoney(data?.finance.monthCollected ?? 0)} icon="📅" accent={colors.info} background={colors.infoBg} />
        </View>

        <View style={styles.row}>
          <StatCard
            label="Ümumi qalıq borc"
            value={formatMoney(data?.finance.totalOutstandingDebt ?? 0)}
            icon="⚠️"
            accent={colors.danger}
            background={colors.dangerBg}
            onPress={() => navigation.navigate('Debts')}
          />
          <StatCard
            label="Borclu müştəri"
            value={String(data?.finance.debtorCustomers ?? 0)}
            icon="👥"
            accent={colors.warning}
            background={colors.warningBg}
            onPress={() => navigation.navigate('Debts')}
          />
        </View>

        {/* --- Inventory ----------------------------------------------------- */}
        <Text style={styles.groupTitle}>Anbar</Text>
        <View style={styles.row}>
          <StatCard
            label="Anbarda qalan bidon"
            value={String(data?.inventory.warehouseQuantity ?? 0)}
            icon="🏭"
            accent={colors.primary}
            onPress={() => navigation.navigate('Warehouse')}
          />
          <StatCard
            label="İşçilərin əlində"
            value={String(data?.inventory.inWorkersHands ?? 0)}
            icon="🧑‍🏭"
            accent={colors.info}
            background={colors.infoBg}
            onPress={() => navigation.navigate('Warehouse')}
          />
        </View>

        <View style={styles.row}>
          <StatCard label="Bu gün daxil olan" value={String(data?.inventory.todayInbound ?? 0)} icon="📥" accent={colors.success} background={colors.successBg} />
          <StatCard label="Bu gün işçiyə verilən" value={String(data?.inventory.todayIssuedToWorkers ?? 0)} icon="📤" accent={colors.warning} background={colors.warningBg} />
        </View>

        {/* --- Deliveries ---------------------------------------------------- */}
        <Text style={styles.groupTitle}>Çatdırılmalar</Text>
        <View style={styles.row}>
          <StatCard label="Bu gün çatdırılan" value={String(data?.deliveries.todayCount ?? 0)} icon="🚚" accent={colors.primary} />
          <StatCard label="Bu gün bidon" value={String(data?.deliveries.todayBottles ?? 0)} icon="🧴" accent={colors.info} background={colors.infoBg} />
        </View>
        <View style={styles.row}>
          <StatCard
            label="Seçilmiş dövrda çatdırılma"
            value={String(data?.deliveries.inRangeCount ?? 0)}
            icon="📋"
            accent={colors.primary}
            onPress={() => navigation.navigate('Deliveries')}
          />
          <StatCard label="Ümumi çatdırılan bidon" value={String(data?.deliveries.allTimeBottles ?? 0)} icon="🏆" accent={colors.success} background={colors.successBg} />
        </View>

        <View style={styles.quickActions}>
          <Chip icon="account-group" onPress={() => navigation.navigate('Workers')}>
            İşçilər
          </Chip>
          <Chip icon="cash" onPress={() => navigation.navigate('Revenue')}>
            Gəlirlər
          </Chip>
          <Chip icon="file-chart" onPress={() => navigation.navigate('Reports')}>
            Hesabatlar
          </Chip>
          <Chip icon="shield-check" onPress={() => navigation.navigate('AuditLog')}>
            Audit jurnalı
          </Chip>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, justifyContent: 'center' },
  scroll: { padding: spacing.md, paddingBottom: spacing.xxl },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  title: { fontSize: 20, fontWeight: '700', color: colors.text },
  periodButton: { borderRadius: radius.pill },
  groupTitle: { fontSize: 13, fontWeight: '700', color: colors.primaryDark, marginTop: spacing.sm, marginBottom: spacing.xs },
  row: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  quickActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.lg },
});
