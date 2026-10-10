import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { STATUS_LABEL, STATUS_COLOR } from '../utils/format';
import type { DeliveryStatus } from '../types';
import { radius } from '../theme';

interface Props {
  status: DeliveryStatus;
  compact?: boolean;
}

/**
 * Distinct visual markers per payment status, as required by the design spec:
 * red = debt, amber = partial, green = paid, grey = cancelled.
 */
export const StatusChip: React.FC<Props> = ({ status, compact = false }) => {
  const color = STATUS_COLOR[status] ?? '#757575';
  return (
    <View
      style={[
        styles.chip,
        compact && styles.chipCompact,
        { backgroundColor: `${color}1A`, borderColor: `${color}55` },
      ]}
    >
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={[styles.label, { color }, compact && styles.labelCompact]} numberOfLines={1}>
        {STATUS_LABEL[status] ?? status}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  chipCompact: { paddingHorizontal: 8, paddingVertical: 3 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  label: { fontSize: 12, fontWeight: '600' },
  labelCompact: { fontSize: 11 },
});
