import React, { useState, useCallback } from 'react';
import { View, ScrollView, StyleSheet, RefreshControl, Text } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Searchbar, ActivityIndicator, Chip, Dialog, Portal, Button } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { EmptyState } from '../components/EmptyState';
import { useAsync } from '../hooks/useAsync';
import { auditApi } from '../services/endpoints';
import { formatDateTime } from '../utils/format';
import { colors, spacing, radius } from '../theme';
import type { AuditLogEntry } from '../types';

/**
 * Audit journal: who changed what, when.
 *
 * Admin-only. Financial and administrative actions are recorded server-side on
 * every mutation, so this screen is the trail an admin uses to investigate a
 * mistake (e.g. "payment.voided" or "user.password_reset").
 */
export const AuditLogScreen: React.FC = () => {
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<AuditLogEntry | null>(null);

  const { data, loading, error, run } = useAsync(
    () => auditApi.logs({ action: action || undefined, page, pageSize: 40 }).then((r) => r.data),
    [action, page],
  );

  useFocusEffect(
    useCallback(() => {
      void run(false);
    }, [run]),
  );

  const actionLabel = (a: string): { label: string; color: string } => {
    if (a.includes('void')) return { label: 'Geri qaytarma', color: colors.warning };
    if (a.includes('deleted') || a.includes('cancel')) return { label: 'Ləğv/silinmə', color: colors.danger };
    if (a.includes('password')) return { label: 'Şifrə', color: colors.danger };
    if (a.includes('payment.created')) return { label: 'Ödəniş', color: colors.success };
    if (a.includes('delivery.created')) return { label: 'Çatdırılma', color: colors.primary };
    if (a.includes('inventory')) return { label: 'Anbar', color: colors.info };
    if (a.includes('user')) return { label: 'İstifadəçi', color: colors.primaryLight };
    return { label: a, color: colors.textMuted };
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Searchbar
          placeholder="Əməliyyat axtar (məs. payment)"
          value={action}
          onChangeText={(t) => {
            setAction(t);
            setPage(1);
          }}
          style={styles.search}
        />
        <View style={styles.chipRow}>
          {['', 'payment', 'delivery', 'inventory', 'user', 'debt'].map((a) => (
            <Chip key={a || 'all'} compact selected={action === a} onPress={() => setAction(a)} style={styles.chip}>
              {a || 'Hamısı'}
            </Chip>
          ))}
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void run()} />}
      >
        {loading && !data ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" />
          </View>
        ) : error ? (
          <EmptyState icon="⚠️" title="Yüklənmədi" message={error} actionLabel="Yenidən" onAction={() => void run()} />
        ) : !data || data.items.length === 0 ? (
          <EmptyState icon="🛡️" title="Qeyd tapılmadı" message="Bu filtrə uyğun əməliyyat yoxdur." />
        ) : (
          <>
            {data.items.map((log) => {
              const meta = actionLabel(log.action);
              return (
                <View key={log.id} style={styles.row}>
                  <View style={[styles.badge, { backgroundColor: `${meta.color}1A` }]}>
                    <Text style={[styles.badgeText, { color: meta.color }]} numberOfLines={1}>
                      {meta.label}
                    </Text>
                  </View>
                  <View style={styles.flex}>
                    <Text style={styles.actionText}>{log.action}</Text>
                    <Text style={styles.metaText}>
                      {log.actorName ?? 'Sistem'} · {formatDateTime(log.createdAt)}
                    </Text>
                    <Text style={styles.entityText}>
                      {log.entityType}
                      {log.entityId ? ` · ${log.entityId.slice(0, 8)}` : ''}
                    </Text>
                  </View>
                  <Button compact onPress={() => setDetail(log)}>
                    Detal
                  </Button>
                </View>
              );
            })}

            {data.hasMore ? (
              <Button mode="outlined" onPress={() => setPage((p) => p + 1)} loading={loading} style={styles.moreBtn}>
                Daha çox
              </Button>
            ) : null}
          </>
        )}
      </ScrollView>

      <Portal>
        <Dialog visible={Boolean(detail)} onDismiss={() => setDetail(null)}>
          <Dialog.Title>{detail?.action}</Dialog.Title>
          <Dialog.ScrollArea style={styles.scrollArea}>
            <ScrollView>
              <Text style={styles.detailMeta}>
                {detail?.actorName} ({detail?.actorRole}) · {formatDateTime(detail?.createdAt)}
              </Text>
              <Text style={styles.detailLabel}>Əvvəlki vəziyyət</Text>
              <Text style={styles.detailJson} selectable>
                {detail?.before ? JSON.stringify(detail.before, null, 2) : '-'}
              </Text>
              <Text style={styles.detailLabel}>Yeni vəziyyət</Text>
              <Text style={styles.detailJson} selectable>
                {detail?.after ? JSON.stringify(detail.after, null, 2) : '-'}
              </Text>
              {detail?.meta ? (
                <>
                  <Text style={styles.detailLabel}>Əlavə məlumat</Text>
                  <Text style={styles.detailJson} selectable>
                    {JSON.stringify(detail.meta, null, 2)}
                  </Text>
                </>
              ) : null}
            </ScrollView>
          </Dialog.ScrollArea>
          <Dialog.Actions>
            <Button onPress={() => setDetail(null)}>Bağla</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  center: { paddingVertical: spacing.xxl },
  header: { padding: spacing.md, gap: spacing.sm },
  search: { backgroundColor: colors.surface },
  chipRow: { flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap' },
  chip: { marginBottom: 2 },
  list: { paddingHorizontal: spacing.md, paddingBottom: spacing.xxl },
  row: {
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
  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.sm, maxWidth: 80 },
  badgeText: { fontSize: 10, fontWeight: '700' },
  actionText: { fontSize: 12, fontWeight: '600', color: colors.text },
  metaText: { fontSize: 11, color: colors.textMuted },
  entityText: { fontSize: 10, color: colors.primaryLight },
  moreBtn: { marginTop: spacing.md },
  scrollArea: { height: 320 },
  detailMeta: { fontSize: 12, color: colors.textMuted, marginBottom: spacing.md },
  detailLabel: { fontSize: 12, fontWeight: '700', color: colors.primaryDark, marginTop: spacing.md },
  detailJson: { fontFamily: 'monospace', fontSize: 10, color: colors.text, backgroundColor: colors.background, padding: spacing.sm, borderRadius: radius.sm },
});
