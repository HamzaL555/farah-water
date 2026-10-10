import { MD3LightTheme, type MD3Theme } from 'react-native-paper';

/**
 * Farah Su Şirkəti - blue/white water palette.
 * Chosen for legibility on cheap, low-contrast Android screens in daylight.
 */

export const colors = {
  primary: '#0B4F6C',
  primaryDark: '#063347',
  primaryLight: '#1E7BA3',
  secondary: '#03A9F4',
  accent: '#00BCD4',
  background: '#F4F8FB',
  surface: '#FFFFFF',
  surfaceVariant: '#E3F2FD',

  success: '#2E7D32',
  successBg: '#E8F5E9',
  warning: '#EF6C00',
  warningBg: '#FFF3E0',
  danger: '#C62828',
  dangerBg: '#FFEBEE',
  info: '#0277BD',
  infoBg: '#E1F5FE',

  text: '#12232E',
  textMuted: '#5A6B78',
  border: '#D6E2EA',
  disabled: '#B0BEC5',
  white: '#FFFFFF',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
} as const;

export const theme: MD3Theme = {
  ...MD3LightTheme,
  roundness: radius.md,
  colors: {
    ...MD3LightTheme.colors,
    primary: colors.primary,
    onPrimary: colors.white,
    primaryContainer: colors.surfaceVariant,
    onPrimaryContainer: colors.primaryDark,
    secondary: colors.secondary,
    onSecondary: colors.white,
    secondaryContainer: colors.infoBg,
    onSecondaryContainer: colors.primaryDark,
    background: colors.background,
    onBackground: colors.text,
    surface: colors.surface,
    onSurface: colors.text,
    surfaceVariant: colors.surfaceVariant,
    onSurfaceVariant: colors.textMuted,
    outline: colors.border,
    outlineVariant: colors.border,
    error: colors.danger,
    onError: colors.white,
    errorContainer: colors.dangerBg,
    onErrorContainer: colors.danger,
    elevation: {
      level0: 'transparent',
      level1: '#FFFFFF',
      level2: '#FBFDFF',
      level3: '#F5F9FC',
      level4: '#F2F7FB',
      level5: '#EFF5FA',
    },
  },
};

/** Colour pair for a payment status chip. */
export function statusColors(status: string): { bg: string; fg: string } {
  switch (status) {
    case 'PAID':
      return { bg: colors.successBg, fg: colors.success };
    case 'PARTIAL':
      return { bg: colors.warningBg, fg: colors.warning };
    case 'CANCELLED':
      return { bg: '#ECEFF1', fg: colors.textMuted };
    case 'UNPAID':
    default:
      return { bg: colors.dangerBg, fg: colors.danger };
  }
}
