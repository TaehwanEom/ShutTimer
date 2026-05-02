// v1.6 — feature flags. revert 가능 셋팅.

/**
 * 앱 active (foreground) 상태에서 AlarmKit alerting 측 시스템 banner 차단.
 * - true: alerting fire 시 즉시 AlarmkitBridge.cancelAlarm 호출 → banner ❌, in-app modal + expo-av 사운드만
 * - false: AlarmKit alerting 측 시스템 banner 표시 (default)
 */
export const SUPPRESS_ALARMKIT_BANNER_IN_FG = true;
