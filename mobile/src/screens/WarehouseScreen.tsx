import React, { useCallback } from 'react';
import { View, ScrollView, StyleSheet, RefreshControl, Text } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { ActivityIndicator } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatCard } from '../components/StatCard';
import { SectionCard } from '../components/SectionCard';
import { EmptyState } from '../components/EmptyState';
import { useAsync } from '../hooks/useAsync';
import { inventoryApi } from '../services/endpoints';
import { formatDateTime, INVENTORY_TYPE_LABEL } from '../utils/format';
import { colors, spacing, radius } from '../theme';

/**
 * Admin warehouse: a read-only view of what the workers actually did.
 *
 * Every figure here was written by a worker - the inbound count, what left the
 * warehouse, and who is holding stock now. The owner asked not to hand stock
 * out from this screen; the driver takes what they need. So there is no action
 * here to take, only numbers to check.
 */
export const WarehouseScreen: React.FC = () => {
  const { data: summary, loading, error, run: runSummary } = useAsync(
    () => inventoryApi.summary().then((r) => r.data),
    [],
  );
  const { data: history, run: runHistory } = useAsync(
    () => inventoryApi.transactions({ pageSize: 40 }).then((r) => r.data),
    [],
  );

  const refreshAll = useCallback(async () => {
    await Promise.all([runSummary(), runHistory()]);
  }, [runSummary, runHistory]);

  useFocusEffect(
    useCallback(() => {
      void refreshAll();
    }, [refreshAll]),
  );

  if (loading && !summary) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <ActivityIndicator size="large" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void refreshAll()} />}
      >
        <Text style={styles.title}>Anbar</Text>
        <Text style={styles.subtitle}>İşçilər qeyd edir, siz baxırsınız</Text>

        <View style={styles.row}>
          <StatCard label="Anbarda Bulaq" value={String(summary?.warehouse.spring ?? 0)} icon="🏔️" accent={colors.info} background={colors.infoBg} />
          <StatCard label="Anbarda Filtr" value={String(summary?.warehouse.filtered ?? 0)} icon="💧" accent={colors.success} background={colors.successBg} />
        </View>
        <View style={styles.row}>
          <StatCard label="Anbarda cəmi" value={String(summary?.warehouse.total ?? 0)} icon="🏭" accent={colors.primary} />
          <StatCard
            label="İşçilərdə"
            value={String(summary?.inWorkersHands ?? 0)}
            icon="👷"
            accent={colors.info}
            background={colors.infoBg}
          />
        </View>

        <View style={styles.row}>
          <StatCard
            label="Bu gün daxil"
            value={String(summary?.todayInbound ?? 0)}
            icon="📥"
            accent={colors.success}
            background={colors.successBg}
          />
          <StatCard
            label="Bu gün çıxış"
            value={String(summary?.todayOutbound ?? 0)}
            icon="📤"
            accent={colors.warning}
            background={colors.warningBg}
          />
        </View>

        <View style={styles.row}>
          <StatCard
            label="Zədələnmiş"
            value={String(summary?.damagedTotal ?? 0)}
            icon="🔨"
            accent={colors.danger}
            background={colors.dangerBg}
          />
          <StatCard label="İtmiş" value={String(summary?.lostTotal ?? 0)} icon="❓" accent={colors.textMuted} />
        </View>

        <StatCard
          label="Sistemdə cəmi bidon"
          value={String(summary?.totalSystemQuantity ?? 0)}
          icon="🧮"
          accent={colors.primaryDark}
        />

        <Text style={styles.hint}>
          Yeni gələn bidonları işçi öz telefonundan qeyd edir və anbardan özü götürür.
          {'\n'}Aşağıda kim nə qədər götürdü və indi nə qədər qalıb.
        </Text>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <SectionCard title="İşçilərin əlində" subtitle="Hər işçinin indi nə qədər bidonu var">
          {!summary || summary.workers.length === 0 ? (
            <EmptyState icon="👷" title="Məlumat yoxdur" message="Hələ heç bir işçi qeydə alınmayıb." />
          ) : (
            summary.workers.map((w) => (
              <View key={w.workerId} style={styles.workerRow}>
                <View style={styles.flex}>
                  <Text style={styles.workerName}>{w.workerName}</Text>
                  <Text style={styles.workerMeta}>
                    {w.workerType === 'WAREHOUSE_KEEPER' ? 'Anbardar' : 'Adi işçi'}
                    {w.isActive ? '' : ' · deaktiv'}
                  </Text>
                </View>
                <View style={styles.qtyCol}>
                  <Text style={[styles.qtyText, w.springQty === 0 && styles.qtyZero]}>{w.springQty}</Text>
                  <Text style={styles.qtyLabel}>Bulaq</Text>
                </View>
                <View style={styles.qtyCol}>
                  <Text style={[styles.qtyText, w.filteredQty === 0 && styles.qtyZero]}>{w.filteredQty}</Text>
                  <Text style={styles.qtyLabel}>Filtr</Text>
                </View>
              </View>
            ))
          )}
        </SectionCard>

        <SectionCard title="Kim nə qədər götürdü" subtitle="Son əməliyyatlar">
          {loading && !history ? (
            <ActivityIndicator />
          ) : !history || history.items.length === 0 ? (
            <EmptyState icon="📋" title="Əməliyyat yoxdur" message="Hələ heç bir bidon hərəkəti qeydə alınmayıb." />
          ) : (
            history.items.map((t) => (
              <View key={t.id} style={styles.txRow}>
                <View
                  style={[
                    styles.txBadge,
                    { backgroundColor: t.signedCount > 0 ? colors.successBg : colors.dangerBg },
                  ]}
                >
                  <Text
                    style={[
                      styles.txBadgeText,
                      { color: t.signedCount > 0 ? colors.success : colors.danger },
                    ]}
                  >
                    {t.signedCount > 0 ? '+' : ''}
                    {t.signedCount}
                  </Text>
                </View>
                <View style={styles.flex}>
                  <Text style={styles.txTitle}>{INVENTORY_TYPE_LABEL[t.type] ?? t.type}</Text>
                  <Text style={styles.txMeta}>
                    {formatDateTime(t.occurredAt)}
                    {t.workerName ? ' · ' + t.workerName : ''}
                    {t.createdByRole === 'WORKER' ? ' (işçi)' : ''}
                  </Text>
                  {t.note ? <Text style={styles.txNote}>{t.note}</Text> : null}
                </View>
              </View>
            ))
          )}
        </SectionCard>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1 },
  scroll: { padding: spacing.md, paddingBottom: spacing.xxl },
  title: { fontSize: 20, fontWeight: '700', color: colors.text },
  subtitle: { fontSize: 12, color: colors.textMuted, marginBottom: spacing.md },
  hint: { fontSize: 12, color: colors.textMuted, marginVertical: spacing.sm, fontStyle: 'italic' },
  row: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  error: { color: colors.danger, fontSize: 12, marginBottom: spacing.sm },
  workerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.sm,
  },
  workerName: { fontSize: 14, fontWeight: '600', color: colors.text },
  workerMeta: { fontSize: 11, color: colors.textMuted },
  qtyCol: { alignItems: 'center', minWidth: 48 },
  qtyText: { fontSize: 14, fontWeight: '700', color: colors.info },
  qtyZero: { color: colors.danger },
  qtyLabel: { fontSize: 9, color: colors.textMuted },
  txRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs },
  txBadge: { minWidth: 44, paddingVertical: 4, paddingHorizontal: 6, borderRadius: radius.sm, alignItems: 'center' },
  txBadgeText: { fontSize: 13, fontWeight: '700' },
  txTitle: { fontSize: 13, fontWeight: '600', color: colors.text },
  txMeta: { fontSize: 11, color: colors.textMuted },
  txNote: { fontSize: 11, color: colors.textMuted, fontStyle: 'italic' },
});
