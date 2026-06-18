export const SETTINGS_KEY = {
  DISMISS_METHOD: 'shutimer_dismiss_method',
  VIBRATION_ENABLED: 'shutimer_vibration_enabled',
  DARK_MODE: 'shutimer_dark_mode',
  ALARM_SOUND: 'shutimer_alarm_sound',
  PRIMARY_COLOR: 'shutimer_primary_color',
  DIAL_TYPE: 'shutimer_dial_type',
  ALARM_ENABLED: 'shutimer_alarm_enabled',
  MISSION_DURATION: 'shutimer_mission_duration',
  SELECTED_MISSIONS: 'shutimer_selected_missions',
  KEEP_SCREEN_ON: 'shutimer_keep_screen_on',
} as const;

export const MIN_SELECTED_MISSIONS = 1;

// v1.8 — 0 = 제한 없음 (= 무제한 미션 타이머).
export const MISSION_DURATION_OPTIONS = [10, 20, 30, 40, 50, 60, 0] as const;
export type MissionDuration = typeof MISSION_DURATION_OPTIONS[number];

export type DialType = 'classic' | 'digital';

export const COLOR_PRESETS = [
  { id: 'red', color: '#ff2424' },
  { id: 'orange', color: '#be3816' },
  { id: 'pink', color: '#c2185b' },
  { id: 'green', color: '#00796b' },
  { id: 'teal', color: '#00838f' },
  { id: 'purple', color: '#4a148c' },
  { id: 'lavender', color: '#9b8ec4' },
  { id: 'coral', color: '#e08888' },
  { id: 'mint', color: '#7bc4a8' },
] as const;

export type DismissMethod = 'tap' | 'shake' | 'camera' | 'math' | 'typing' | 'tapcharge' | 'random';

export const DEFAULT_SETTINGS = {
  dismissMethod: 'camera' as DismissMethod,
  alarmEnabled: true,
  vibrationEnabled: true,
  darkMode: false,
  missionDuration: 30 as MissionDuration,
  keepScreenOn: false,
};
