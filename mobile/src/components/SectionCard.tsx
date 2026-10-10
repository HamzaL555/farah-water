import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Card } from 'react-native-paper';
import { colors, spacing, radius } from '../theme';

interface Props {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  children?: React.ReactNode;
  onPress?: () => void;
}

/** Titled container used to group settings and detail sections. */
export const SectionCard: React.FC<Props> = ({ title, subtitle, right, children, onPress }) => {
  const body = (
    <Card style={styles.card} mode="contained">
      <Card.Content style={styles.content}>
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={styles.title}>{title}</Text>
            {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
          </View>
          {right}
        </View>
        {children}
      </Card.Content>
    </Card>
  );

  if (!onPress) return body;
  return (
    <Pressable onPress={onPress} android_ripple={{ color: colors.surfaceVariant }}>
      {body}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  card: { borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md },
  content: { gap: spacing.md, paddingVertical: spacing.md },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  headerText: { flex: 1 },
  title: { fontSize: 15, fontWeight: '600', color: colors.text },
  subtitle: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
});
