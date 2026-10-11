import React, { useState, useCallback, useMemo } from 'react';
import { View, ScrollView, StyleSheet, RefreshControl, Text, Share, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Button, ActivityIndicator, Chip, Snackbar } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { EmptyState } from '../components/EmptyState';
import { SectionCard } from '../components/SectionCard';
import { useAsync, useSubmit } from '../hooks/useAsync';
import { reportsApi } from '../services/endpoints';
import { formatDate } from '../utils/format';
import { colors, spacing, radius } from '../theme';
import type { DateRangePreset } from '../types';

type ReportType = 'daily' | 'period' | 'worker' | 'customer' | 'inventory' | 'payments' | 'deliveries';

const TYPES: Array<{ value: ReportType; label: string }> = [
  { value: 'daily', label: 'Günlük' },
  { value: 'period', label: 'Dövri' },
  { value: 'worker', label: 'İşçi' },
  { value: 'customer', label: 'Müştəri borcu' },
  { value: 'payments', label: 'Ödəniş' },
  { value: 'deliveries', label: 'Çatdırılma' },
  { value: 'inventory', label: 'Anbar' },
];

const PRESETS: Array<{ value: DateRangePreset; label: string }> = [
  { value: 'today', label: 'Bu gün' },
  { value: 'yesterday', label: 'Dünən' },
  { value: 'last7days', label: 'Son 7 gün' },
  { value: 'thisMonth', label: 'Bu ay' },
  { value: 'lastMonth', label: 'Keçən ay' },
  { value: 'thisYear', label: 'Bu il' },
  { value: 'all', label: 'Hamısı' },
];

type ExportFormat = 'csv' | 'pdf' | 'xlsx' | 'xls';

/** Months offered by the monthly report picker, most recent first. */
const monthOptions = (count: number): Array<{ value: string; label: string }> => {
  const names = [
    'Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'İyun',
    'İyul', 'Avqust', 'Sentyabr', 'Oktyabr', 'Noyabr', 'Dekabr',
  ];
  const now = new Date();
  const out = [{ value: '', label: 'Bu ay' }, { value: 'last', label: 'Keçən ay' }];
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    out.push({ value, label: `${names[d.getMonth()]} ${d.getFullYear()}` });
  }
  return out;
};

/**
 * Report viewer with CSV / Excel / PDF export.
 *
 * Files are produced by the backend (so they always match the database) and
 * then shared from the device through the native share sheet.
 */
export const ReportsScreen: React.FC = () => {
  const [type, setType] = useState<ReportType>('daily');
  const [preset, setPreset] = useState<DateRangePreset>('today');
  const [month, setMonth] = useState('');
  const [snack, setSnack] = useState<string | null>(null);

  const MONTHS = useMemo(() => monthOptions(18), []);

  const { data, loading, error, run } = useAsync(
    () => reportsApi.json({ type, preset }).then((r) => r.data),
    [type, preset],
  );

  const { data: monthly, loading: monthlyLoading, run: runMonthly } = useAsync(
    () => reportsApi.monthly({ month: month || undefined }).then((r) => r.data),
    [month],
  );

  useFocusEffect(
    useCallback(() => {
      void run(false);
    }, [run]),
  );

  const exportAction = useSubmit(
    async (args: { format: ExportFormat; monthly?: boolean; month?: string }) => {
      const result = await reportsApi.raw({
        ...(args.monthly
          ? { monthly: true, month: args.month, type, preset }
          : { type, preset }),
        format: args.format,
      });
      // Sharing the text/base64 payload lets the user send the export to another
      // app (mail, cloud, chat) without the app needing filesystem permissions.
      await Share.share({
        title: result.filename,
        message: result.base64 ? result.body : result.body,
      });
      return result.filename;
    },
  );

  const onExport = async (args: { format: ExportFormat; monthly?: boolean; month?: string }) => {
    try {
      const result = await exportAction.submit(args);
      if (result) setSnack(`${result} yaradıldı və paylaşma pəncərəsi açıldı.`);
      else Alert.alert('Paylaşma mümkün olmadı', 'Hesabat yaradıldı, lakin paylaşma pəncərəsi açılmadı.');
    } catch (err) {
      Alert.alert('Hesabat yaradıla bilmədi', err instanceof Error ? err.message : 'Bilinməyən xəta.');
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void run()} />}
      >
        <Text style={styles.title}>Hesabatlar</Text>

        <Text style={styles.label}>Hesabat növü</Text>
        <View style={styles.chipRow}>
          {TYPES.map((t) => (
            <Chip
              key={t.value}
              selected={type === t.value}
              onPress={() => setType(t.value)}
              style={styles.chip}
            >
              {t.label}
            </Chip>
          ))}
        </View>

        <Text style={styles.label}>Dövr</Text>
        <View style={styles.chipRow}>
          {PRESETS.map((p) => (
            <Chip key={p.value} compact selected={preset === p.value} onPress={() => setPreset(p.value)} style={styles.chip}>
              {p.label}
            </Chip>
          ))}
        </View>

        {/* .xls first: it is the format older Excel installs open natively. */}
        <View style={styles.exportRow}>
          <Button
            mode="contained"
            icon="file-excel"
            loading={exportAction.submitting}
            onPress={() => void onExport({ format: 'xls' })}
            style={styles.exportBtn}
          >
            .xls
          </Button>
          <Button
            mode="contained"
            icon="file-delimited"
            loading={exportAction.submitting}
            onPress={() => void onExport({ format: 'xlsx' })}
            style={styles.exportBtn}
          >
            .xlsx
          </Button>
          <Button
            mode="contained-tonal"
            icon="file-delimited-outline"
            loading={exportAction.submitting}
            onPress={() => void onExport({ format: 'csv' })}
            style={styles.exportBtn}
          >
            CSV
          </Button>
          <Button
            mode="contained-tonal"
            icon="file-pdf-box"
            loading={exportAction.submitting}
            onPress={() => void onExport({ format: 'pdf' })}
            style={styles.exportBtn}
          >
            PDF
          </Button>
        </View>

        {/* Monthly report, kept separate so it is one tap instead of a date range. */}
        <SectionCard title="Aylıq hesabat" subtitle="Seçilmiş ayın tam hesabatı">
          <View style={styles.chipRow}>
            {MONTHS.slice(0, 12).map((m) => (
              <Chip
                key={m.value}
                compact
                selected={month === m.value}
                onPress={() => {
                  setMonth(m.value);
                  setTimeout(() => void runMonthly(false), 50);
                }}
                style={styles.chip}
              >
                {m.label}
              </Chip>
            ))}
          </View>

          <View style={styles.monthActions}>
            <Button
              mode="contained"
              icon="file-excel"
              loading={exportAction.submitting}
              onPress={() => void onExport({ format: 'xls', monthly: true, month })}
              style={styles.exportBtn}
            >
              .xls
            </Button>
            <Button
              mode="contained"
              icon="file-delimited"
              loading={exportAction.submitting}
              onPress={() => void onExport({ format: 'xlsx', monthly: true, month })}
              style={styles.exportBtn}
            >
              .xlsx
            </Button>
            <Button
              mode="contained-tonal"
              icon="file-delimited-outline"
              loading={exportAction.submitting}
              onPress={() => void onExport({ format: 'csv', monthly: true, month })}
              style={styles.exportBtn}
            >
              CSV
            </Button>
            <Button
              mode="contained-tonal"
              icon="file-pdf-box"
              loading={exportAction.submitting}
              onPress={() => void onExport({ format: 'pdf', monthly: true, month })}
              style={styles.exportBtn}
            >
              PDF
            </Button>
          </View>

          {monthlyLoading ? <ActivityIndicator style={styles.spinner} /> : null}

          {monthly && !monthlyLoading ? (
            <>
              <Text style={styles.meta}>
                {monthly.title} · {monthly.subtitle} · {monthly.sections.length} bölmə
              </Text>
              {monthly.sections.map((section) => (
                <View key={section.heading} style={styles.monthSection}>
                  <Text style={styles.monthHeading}>{section.heading}</Text>
                  <Text style={styles.meta}>{section.rows.length} sətir</Text>
                </View>
              ))}
            </>
          ) : null}
        </SectionCard>

        {error ? <Text style={styles.error}>{error}</Text> : null}
        {loading && !data ? <ActivityIndicator style={styles.spinner} /> : null}

        {data ? (
          <>
            <SectionCard title={data.title} subtitle={data.subtitle}>
              <Text style={styles.meta}>Hazırlanma: {formatDate(data.generatedAt)}</Text>
            </SectionCard>

            {data.sections.map((section) => (
              <SectionCard key={section.heading} title={section.heading} subtitle={`${section.rows.length} sətir`}>
                <ScrollView horizontal showsHorizontalScrollIndicator style={styles.tableScroll}>
                  <View>
                    <View style={[styles.tableRow, styles.tableHeader]}>
                      {section.columns.map((c, i) => (
                        <Text key={`${c}-${i}`} style={[styles.tableCell, styles.tableHeaderText, { width: cellWidth(section.columns.length) }]} numberOfLines={1}>
                          {c}
                        </Text>
                      ))}
                    </View>
                    {section.rows.slice(0, 100).map((row, ri) => (
                      <View key={ri} style={[styles.tableRow, ri % 2 === 1 && styles.tableAlt]}>
                        {row.map((cell, ci) => (
                          <Text key={ci} style={styles.tableCell} numberOfLines={1}>
                            {typeof cell === 'number' ? cell.toLocaleString('az-AZ') : cell}
                          </Text>
                        ))}
                      </View>
                    ))}
                    {section.totals ? (
                      <View style={[styles.tableRow, styles.tableTotal]}>
                        {section.totals.map((cell, ci) => (
                          <Text key={ci} style={[styles.tableCell, styles.tableTotalText]} numberOfLines={1}>
                            {typeof cell === 'number' ? cell.toLocaleString('az-AZ') : cell}
                          </Text>
                        ))}
                      </View>
                    ) : null}
                    {section.rows.length > 100 ? (
                      <Text style={styles.moreText}>
                        ... və s. (ilk 100 sətir göstərilir). Tam hesabat üçün CSV/PDF ixrac edin.
                      </Text>
                    ) : null}
                  </View>
                </ScrollView>
              </SectionCard>
            ))}
          </>
        ) : !loading && !error ? (
          <EmptyState icon="📄" title="Hesabat yoxdur" />
        ) : null}
      </ScrollView>

      <Snackbar visible={Boolean(snack)} onDismiss={() => setSnack(null)} duration={3500}>
        {snack ?? ''}
      </Snackbar>
    </SafeAreaView>
  );
};

const cellWidth = (columns: number) => Math.max(80, Math.min(190, 640 / columns));

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: spacing.md, paddingBottom: spacing.xxl },
  title: { fontSize: 20, fontWeight: '700', color: colors.text, marginBottom: spacing.md },
  label: { fontSize: 12, fontWeight: '600', color: colors.textMuted, marginBottom: spacing.xs, marginTop: spacing.sm },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: { marginBottom: 2 },
  exportRow: { flexDirection: 'row', gap: spacing.sm, marginVertical: spacing.lg },
  exportBtn: { flex: 1 },
  monthActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  monthSection: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.xs,
    marginTop: spacing.xs,
  },
  monthHeading: { fontSize: 12, fontWeight: '600', color: colors.primaryDark },
  error: { color: colors.danger, fontSize: 12, marginBottom: spacing.sm },
  spinner: { marginVertical: spacing.xl },
  meta: { fontSize: 11, color: colors.textMuted },
  tableScroll: { borderRadius: radius.sm },
  tableRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.border },
  tableAlt: { backgroundColor: colors.background },
  tableHeader: { backgroundColor: colors.primary },
  tableHeaderText: { color: colors.white, fontWeight: '700' },
  tableTotal: { backgroundColor: colors.surfaceVariant },
  tableTotalText: { fontWeight: '700', color: colors.primaryDark },
  tableCell: { width: 110, padding: 6, fontSize: 10, color: colors.text },
  moreText: { fontSize: 10, color: colors.textMuted, padding: spacing.xs, fontStyle: 'italic' },
});
