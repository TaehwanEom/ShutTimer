export type ThemeColors = {
  primary: string;
  background: string;
  surfaceContainerLow: string;
  surfaceContainerLowest: string;
  secondary: string;
  onPrimary: string;
  onBackground: string;
  onSurface: string;
  outline: string;
  outlineVariant: string;
  error: string;
};

export const lightColors: ThemeColors = {
  primary: '#bc000a',
  background: '#f9f9fe',
  surfaceContainerLow: '#f3f3f8',
  surfaceContainerLowest: '#ffffff',
  secondary: '#5d5e63',
  onPrimary: '#ffffff',
  onBackground: '#1a1c1f',
  onSurface: '#1a1c1f',
  outline: '#926f6a',
  outlineVariant: '#e7bdb7',
  error: '#ba1a1a',
};

export const darkColors: ThemeColors = {
  primary: '#bc000a',
  background: '#111318',
  surfaceContainerLow: '#1d2024',
  surfaceContainerLowest: '#282c31',
  secondary: '#8e9099',
  onPrimary: '#ffffff',
  onBackground: '#e2e2e9',
  onSurface: '#e2e2e9',
  outline: '#b07f7a',
  outlineVariant: '#5e3b37',
  error: '#ba1a1a',
};

// 기존 import 호환용
export const colors = lightColors;
