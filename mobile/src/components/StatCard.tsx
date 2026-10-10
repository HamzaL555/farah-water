import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Card } from 'react-native-paper';
import { colors, spacing, radius } from '../theme';

interface Props {
  label: string;
  value: string;
  hint?: string;
  icon?: string;
  accent?: string;
  background?: string;
  onPress?: () => void;
  compact?: boolean;
}

/**
 * A single statistic tile. Deliberately text-first (no chart dependency) so it
 * renders fast and stays legible on small, low-DPI screens.
 */
export const StatCard: React.FC<Props> = ({
  label,
  value,
  hint,
  icon,
  accent = colors.primary,
  background = colors.surface,
  onPress,
  compact = false,
}) => {
  const content = (
    <Card style={[styles.card, { backgroundColor: background }]} mode="contained">
      <Card.Content style={compact ? styles.contentCompact : styles.content}>
        <View style={styles.header}>
          {icon ? <Text style={[styles.icon, { color: accent }]}>{icon}</Text> : null}
          <Text style={styles.label} numberOfLines={2}>
            {label}
          </Text>
        </View>
        <Text style={[styles.value, { color: accent }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
          {value}
        </Text>
        {hint ? (
          <Text style={styles.hint} numberOfLines={1}>
            {hint}
          </Text>
        ) : null}
      </Card.Content>
    </Card>
  );

  if (!onPress) return content;
  return (
    <Pressable onPress={onPress} style={styles.pressable} android_ripple={{ color: colors.surfaceVariant }}>
      {content}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  pressable: { flex: 1 },
  card: { flex: 1, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  content: { paddingVertical: spacing.md, paddingHorizontal: spacing.md, gap: spacing.xs },
  contentCompact: { paddingVertical: spacing.sm, paddingHorizontal: spacing.sm, gap: 2 },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  icon: { fontSize: 16 },
  label: { flex: 1, fontSize: 11, color: colors.textMuted, fontWeight: '500' },
  value: { fontSize: 20, fontWeight: '700', marginTop: spacing.xs },
  hint: { fontSize: 10, color: colors.textMuted },
});
