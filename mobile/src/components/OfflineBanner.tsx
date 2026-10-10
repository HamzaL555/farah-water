import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { colors, spacing, radius } from '../theme';
import { subscribe, getQueueSnapshot, flush, type QueuedOperation } from '../services/offlineQueue';

/**
 * Persistent connectivity + offline-queue indicator.
 *
 * Shows three distinct states:
 *  - offline            -> "Bağlantı yoxdur, əməliyyatlar növbəyə göndərilir"
 *  - online with backlog -> "N gözləyən əməliyyat göndərilir..."
 *  - online, clear       -> hidden
 */
export const OfflineBanner: React.FC = () => {
  const [isConnected, setIsConnected] = useState<boolean | null>(null);
  const [queue, setQueue] = useState<QueuedOperation[]>(getQueueSnapshot());

  useEffect(() => {
    const unsubscribeNet = NetInfo.addEventListener((state) => setIsConnected(state.isConnected === true));
    const unsubscribeQueue = subscribe((items) => {
      setQueue(items);
      const hasPending = items.some((i) => !i.permanentlyFailed);
      if (hasPending && isConnected) void flush();
    });
    return () => {
      unsubscribeNet();
      unsubscribeQueue();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pending = queue.filter((i) => !i.permanentlyFailed).length;
  const failed = queue.filter((i) => i.permanentlyFailed).length;

  if (isConnected !== false && pending === 0 && failed === 0) return null;

  const offline = isConnected === false;
  const bg = failed > 0 ? colors.dangerBg : offline ? colors.warningBg : colors.infoBg;
  const fg = failed > 0 ? colors.danger : offline ? colors.warning : colors.info;

  const message = failed > 0
    ? `${failed} əməliyyat təsdiqlənmədi. Profil → Gözləyən əməliyyatlar bölməsinə baxın.`
    : offline
      ? `Bağlantı yoxdur. ${pending} əməliyyat növbəyə göndəriləcək.`
      : `${pending} əməliyyat göndərilir...`;

  return (
    <View style={[styles.banner, { backgroundColor: bg, borderColor: `${fg}55` }]}>
      <Text style={[styles.icon, { color: fg }]}>{failed > 0 ? '⚠️' : offline ? '📴' : '🔄'}</Text>
      <Text style={[styles.text, { color: fg }]} numberOfLines={2}>
        {message}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    borderWidth: 1,
    marginHorizontal: spacing.md,
    marginVertical: spacing.xs,
  },
  icon: { fontSize: 14 },
  text: { flex: 1, fontSize: 12, fontWeight: '500', lineHeight: 17 },
});
