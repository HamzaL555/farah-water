import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, spacing } from '../theme';

interface Props {
  label: string;
  value: string;
  valueColor?: string;
  monospace?: boolean;
}

/** Label/value line used across detail screens. */
export const KeyValueRow: React.FC<Props> = ({ label, value, valueColor = colors.text, monospace = false }) => (
  <View style={styles.row}>
    <Text style={styles.label}>{label}</Text>
    <Text
      style={[styles.value, { color: valueColor }, monospace && styles.mono]}
      numberOfLines={2}
    >
      {value}
    </Text>
  </View>
);

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.md },
  label: { flex: 1, fontSize: 13, color: colors.textMuted },
  value: { flex: 1.4, fontSize: 13, fontWeight: '600', textAlign: 'right' },
  mono: { fontFamily: 'monospace', fontSize: 11 },
});
