import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Button } from 'react-native-paper';
import { colors, spacing } from '../theme';

interface Props {
  icon?: string;
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
}

/** Explanatory placeholder so an empty list never looks like a broken screen. */
export const EmptyState: React.FC<Props> = ({ icon = '💧', title, message, actionLabel, onAction }) => (
  <View style={styles.container}>
    <Text style={styles.icon}>{icon}</Text>
    <Text style={styles.title}>{title}</Text>
    {message ? <Text style={styles.message}>{message}</Text> : null}
    {actionLabel && onAction ? (
      <Button mode="contained" onPress={onAction} style={styles.button}>
        {actionLabel}
      </Button>
    ) : null}
  </View>
);

const styles = StyleSheet.create({
  container: { alignItems: 'center', paddingVertical: spacing.xxl, paddingHorizontal: spacing.xl, gap: spacing.sm },
  icon: { fontSize: 40 },
  title: { fontSize: 15, fontWeight: '600', color: colors.text, textAlign: 'center' },
  message: { fontSize: 13, color: colors.textMuted, textAlign: 'center', lineHeight: 19 },
  button: { marginTop: spacing.sm },
});
