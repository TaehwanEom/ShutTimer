export const SETTINGS_KEY = {
  DISMISS_METHOD: 'shutimer_dismiss_method',
  VIBRATION_ENABLED: 'shutimer_vibration_enabled',
  DARK_MODE: 'shutimer_dark_mode',
} as const;

export type DismissMethod = 'tap' | 'shake' | 'camera';

export const DEFAULT_SETTINGS = {
  dismissMethod: 'camera' as DismissMethod,
  vibrationEnabled: true,
  darkMode: false,
};
