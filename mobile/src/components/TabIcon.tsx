import React from 'react';
import { Icon } from 'react-native-paper';
import { colors } from '../theme';

/**
 * Top-navigation icon.
 *
 * Renders through Paper's Icon so it uses the bundled icon font. Every name
 * below was verified against the installed glyph map.
 *
 * `color` comes from React Navigation (active/inactive tint); the fallback
 * keeps the component usable outside a navigator.
 */
export const TabIcon: React.FC<{ name: string; focused: boolean; color?: string }> = ({
  name,
  focused,
  color,
}) => (
  <Icon source={name} size={22} color={color ?? (focused ? colors.primary : colors.textMuted)} />
);
