import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Card, Divider } from 'react-native-paper';
import { StatusChip } from './StatusChip';
import { formatDate, formatMoney } from '../utils/format';
import { colors, spacing, radius } from '../theme';
import type { Delivery } from '../types';

interface Props {
  delivery: Delivery;
  onPress?: () => void;
  showWorker?: boolean;
}

/** Compact, scannable delivery row (mobile replacement for a table row). */
export const DeliveryRow: React.FC<Props> = ({ delivery, onPress, showWorker = false }) => (
  <Pressable onPress={onPress} android_ripple={{ color: colors.surfaceVariant }}>
    <Card style={styles.card} mode="contained">
      <Card.Content style={styles.content}>
        <View style={styles.topRow}>
          <View style={styles.left}>
            <Text style={styles.customer} numberOfLines={1}>
              {delivery.customerName ?? 'Naməlum müştəri'}
            </Text>
            <Text style={styles.address} numberOfLines={1}>
              {delivery.address}
            </Text>
          </View>
          <StatusChip status={delivery.status} compact />
        </View>

        <View style={styles.metaRow}>
          <Text style={styles.meta}>
            {formatDate(delivery.deliveredAt)} · {delivery.bottleCount} bidon
          </Text>
          {showWorker && delivery.workerName ? (
            <Text style={styles.meta} numberOfLines={1}>
              · {delivery.workerName}
            </Text>
          ) : null}
        </View>

        <Divider style={styles.divider} />

        <View style={styles.amountRow}>
          <View>
            <Text style={styles.amountLabel}>Ümumi</Text>
            <Text style={styles.amount}>{formatMoney(delivery.totalAmount)}</Text>
          </View>
          <View style={styles.amountBlock}>
            <Text style={styles.amountLabel}>Ödənilən</Text>
            <Text style={[styles.amount, { color: colors.success }]}>{formatMoney(delivery.paidAmount)}</Text>
          </View>
          <View style={styles.amountBlock}>
            <Text style={styles.amountLabel}>Borc</Text>
            <Text
              style={[styles.amount, { color: delivery.debtAmount > 0 ? colors.danger : colors.textMuted }]}
            >
              {formatMoney(delivery.debtAmount)}
            </Text>
          </View>
        </View>
      </Card.Content>
    </Card>
  </Pressable>
);

const styles = StyleSheet.create({
  card: { borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.sm },
  content: { gap: spacing.xs, paddingVertical: spacing.md },
  topRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  left: { flex: 1, gap: 2 },
  customer: { fontSize: 15, fontWeight: '600', color: colors.text },
  address: { fontSize: 12, color: colors.textMuted },
  metaRow: { flexDirection: 'row', gap: 4 },
  meta: { fontSize: 11, color: colors.textMuted },
  divider: { marginVertical: spacing.xs },
  amountRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  amountBlock: { alignItems: 'flex-end' },
  amountLabel: { fontSize: 10, color: colors.textMuted },
  amount: { fontSize: 14, fontWeight: '700', color: colors.text },
});
