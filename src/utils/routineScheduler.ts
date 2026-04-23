// v1.6: 루틴 알림 스케줄러.
// (1) 시작 5분 전 푸시 알림 — iOS/Android CALENDAR trigger + repeats:true 로 요일별 1개씩만 예약.
//     OS가 자동으로 매주 반복 발화 → rolling 동기화 불필요, 64개 한계 완화.
// (2) 자동 진행 모드 백그라운드 체인 — 현재 미션 종료 시점 DATE trigger 1개만 예약.
//     발화 시 handler에서 다음 체인 등록 (연쇄 방식).

import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import i18n from '../i18n';
import {
  Routine,
  ROUTINE_PREALERT_MINUTES,
  SCHEDULED_ROUTINE_NOTIFS_KEY,
  IOS_NOTIFICATION_SAFE_CAP,
  loadRoutines,
  nextOccurrenceTime,
} from '../constants/routines';
import { SETTINGS_KEY } from '../constants/settings';

// Phase 2: 한계 초과 감지 시 RoutineListScreen 상단 배너 노출용 상태
export const ROUTINE_SCHEDULE_STATUS_KEY = 'shuttimer_routine_schedule_status';

export type ScheduleStatus = {
  overflow: boolean;
  skippedRoutineIds: string[];
  totalAttempted: number;
  totalScheduled: number;
  lastSyncedAt: number;
};

/**
 * 사용자 설정 기준 푸시 사운드 파일명 반환.
 * HomeScreen/RunningScreen 패턴과 일관성 유지.
 * alarmEnabled=false면 false 반환 (무음).
 */
async function resolveSound(): Promise<string | false> {
  try {
    const [soundId, enabledRaw] = await Promise.all([
      AsyncStorage.getItem(SETTINGS_KEY.ALARM_SOUND),
      AsyncStorage.getItem(SETTINGS_KEY.ALARM_ENABLED),
    ]);
    const enabled = enabledRaw !== 'false';
    if (!enabled) return false;
    const effective = soundId ?? 'alarm_01';
    return effective.startsWith('ringtone_')
      ? 'notification_ringtone.wav'
      : 'notification_alarm.wav';
  } catch {
    return 'notification_alarm.wav';
  }
}

type ScheduledRoutineRecord = {
  routineId: string;
  notifIds: string[];
  lastSyncedAt: number;
};

type RoutineNotifData = {
  type: 'routine_prealert' | 'routine_chain';
  routineId: string;
  /** 체인 알림 전용 — 다음 미션 index */
  nextStepIndex?: number;
  nextLoop?: number;
  scheduledFor?: number;
};

// ─── 스토리지 ─────────────────────────────────────────────────

async function loadNotifRecords(): Promise<ScheduledRoutineRecord[]> {
  try {
    const raw = await AsyncStorage.getItem(SCHEDULED_ROUTINE_NOTIFS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function saveNotifRecords(list: ScheduledRoutineRecord[]): Promise<void> {
  await AsyncStorage.setItem(SCHEDULED_ROUTINE_NOTIFS_KEY, JSON.stringify(list));
}

// ─── 시간 계산 헬퍼 ──────────────────────────────────────────

/**
 * "HH:MM" 형태 시작 시간에서 5분 전 시점 계산.
 * 자정을 넘어 전날로 넘어가는 경우 요일 오프셋 -1 반환.
 */
function computeAlertTime(time: string): { hour: number; minute: number; dayOffset: number } | null {
  const [hStr, mStr] = time.split(':');
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  if (isNaN(h) || isNaN(m)) return null;

  const startTotal = h * 60 + m;
  const alertTotal = startTotal - ROUTINE_PREALERT_MINUTES;

  if (alertTotal < 0) {
    const adjusted = alertTotal + 24 * 60;
    return { hour: Math.floor(adjusted / 60), minute: adjusted % 60, dayOffset: -1 };
  }
  return { hour: Math.floor(alertTotal / 60), minute: alertTotal % 60, dayOffset: 0 };
}

// ─── 시작 5분 전 예약 (CALENDAR + repeats) ───────────────────

/**
 * 특정 루틴의 시작 5분 전 알림을 WEEKLY trigger 로 요일별 1개씩 예약.
 * iOS/Android 모두 지원 (CALENDAR trigger는 Android 미지원 → WEEKLY 선택).
 * WEEKLY는 내부적으로 OS가 매주 자동 반복 발화.
 *
 * 기존 예약 전부 cancel → 요일별 재예약.
 *
 * @returns 예약된 알림 id 배열
 */
export async function scheduleRoutinePrealerts(routine: Routine): Promise<string[]> {
  // 예약 없는 수동 루틴 — 스킵
  if (!routine.schedule) return [];

  // 기존 예약 정리
  const records = await loadNotifRecords();
  const existing = records.find(r => r.routineId === routine.id);
  if (existing) {
    for (const id of existing.notifIds) {
      await Notifications.cancelScheduledNotificationAsync(id).catch(() => {});
    }
  }

  const alertTime = computeAlertTime(routine.schedule.time);
  if (!alertTime) return [];

  const { days } = routine.schedule;
  const effectiveDays = days.length === 0 ? [0, 1, 2, 3, 4, 5, 6] : days;
  const ids: string[] = [];
  const sound = await resolveSound();

  for (const day of effectiveDays) {
    // 자정 넘어 전날로 넘어간 경우 요일 오프셋 적용 (0-6)
    const alertDay = (day + alertTime.dayOffset + 7) % 7;
    // expo-notifications WEEKLY: weekday = 1(Sunday) ~ 7(Saturday)
    const weekday = alertDay + 1;

    try {
      const data: RoutineNotifData = {
        type: 'routine_prealert',
        routineId: routine.id,
      };
      const id = await Notifications.scheduleNotificationAsync({
        content: {
          title: routine.name,
          body: i18n.t('routine.prealertBody', { defaultValue: '곧 루틴이 시작됩니다' }),
          data: { ...data },
          sound,
          interruptionLevel: 'active',
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
          weekday,
          hour: alertTime.hour,
          minute: alertTime.minute,
        },
      });
      ids.push(id);
    } catch {
      // 예약 실패 무시 (64개 한계 등)
    }
  }

  const next = records.filter(r => r.routineId !== routine.id);
  next.push({ routineId: routine.id, notifIds: ids, lastSyncedAt: Date.now() });
  await saveNotifRecords(next);

  return ids;
}

/** 특정 루틴의 모든 예약 알림 취소 */
export async function cancelRoutinePrealerts(routineId: string): Promise<void> {
  const records = await loadNotifRecords();
  const target = records.find(r => r.routineId === routineId);
  if (target) {
    for (const id of target.notifIds) {
      await Notifications.cancelScheduledNotificationAsync(id).catch(() => {});
    }
  }
  const filtered = records.filter(r => r.routineId !== routineId);
  await saveNotifRecords(filtered);
}

/**
 * 앱 기동 시 호출. 전체 루틴 예약 재확인.
 * Phase 2: 다가오는 예약 시각 기준 정렬 — 가까운 루틴부터 예약.
 * 64개 상한 초과 시 건너뛴 루틴 id 를 ScheduleStatus 에 저장 → RoutineListScreen 배너 노출.
 */
export async function syncRollingSchedule(): Promise<void> {
  const routines = await loadRoutines();
  const scheduledRoutines = routines.filter(r => r.schedule);

  // 기존 전부 cancel (단순 + 정확)
  const records = await loadNotifRecords();
  for (const rec of records) {
    for (const id of rec.notifIds) {
      await Notifications.cancelScheduledNotificationAsync(id).catch(() => {});
    }
  }
  await saveNotifRecords([]);

  // Phase 2 A: 다가오는 예약 시각 기준 정렬
  const now = new Date();
  const sorted = scheduledRoutines
    .map(r => ({ r, nextAt: nextOccurrenceTime(r, now) }))
    .filter((x): x is { r: Routine; nextAt: number } => x.nextAt !== null)
    .sort((a, b) => a.nextAt - b.nextAt)
    .map(x => x.r);

  // 합계 상한 체크하며 재예약
  let totalScheduled = 0;
  const skipped: string[] = [];
  for (const r of sorted) {
    if (totalScheduled >= IOS_NOTIFICATION_SAFE_CAP) {
      skipped.push(r.id);
      continue;
    }
    const ids = await scheduleRoutinePrealerts(r);
    if (ids.length === 0 && r.schedule) {
      // schedule 있는데 예약 실패 — 권한 거부 등
      skipped.push(r.id);
    }
    totalScheduled += ids.length;
  }

  // Phase 2 B: 한계 초과 상태 저장 (RoutineListScreen 배너 노출용)
  const status: ScheduleStatus = {
    overflow: skipped.length > 0,
    skippedRoutineIds: skipped,
    totalAttempted: sorted.length,
    totalScheduled,
    lastSyncedAt: Date.now(),
  };
  await AsyncStorage.setItem(ROUTINE_SCHEDULE_STATUS_KEY, JSON.stringify(status));
}

/** RoutineListScreen 상단 배너 노출용 — 마지막 sync 상태 조회. */
export async function loadScheduleStatus(): Promise<ScheduleStatus | null> {
  try {
    const raw = await AsyncStorage.getItem(ROUTINE_SCHEDULE_STATUS_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ─── 백그라운드 체인 (자동 진행 모드 — 미션 종료 시점 DATE trigger) ─

/**
 * 자동 진행 모드에서 현재 미션 종료 시점에 발화할 알림 1개 예약.
 * 발화 시 App.tsx notification handler가 data.type === 'routine_chain'으로 분기.
 * 연쇄 방식: 이 알림 발화 시 다음 미션 알림을 다시 등록.
 */
export async function scheduleRoutineChain(
  routineId: string,
  nextLoop: number,
  nextStepIndex: number,
  fireAt: Date
): Promise<string | null> {
  if (fireAt.getTime() <= Date.now()) return null;
  try {
    const data: RoutineNotifData = {
      type: 'routine_chain',
      routineId,
      nextLoop,
      nextStepIndex,
      scheduledFor: fireAt.getTime(),
    };
    const sound = await resolveSound();
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: i18n.t('routine.chainTitle', { defaultValue: '다음 미션' }),
        body: i18n.t('routine.chainBody', { defaultValue: '다음 미션이 시작됩니다' }),
        data: { ...data },
        sound,
        interruptionLevel: 'active',
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: fireAt,
      },
    });
    return id;
  } catch {
    return null;
  }
}

/** 체인 알림 취소 (루틴 일시정지/종료 시) */
export async function cancelRoutineChain(notifId: string): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(notifId).catch(() => {});
}

// ─── F4: 확인 후 진행 모드 배경 알림 (미션 종료 시점 RoutineAlarm 유도) ─

/**
 * 확인 후 진행 모드에서 미션 종료 시점에 발화할 DATE trigger 알림 예약.
 * 앱이 배경/kill 상태여도 알림으로 사용자에게 미션 종료 알림.
 * 발화 시 data.type === 'routine_confirm_prompt' → App.tsx handler가 RoutineAlarm 이동.
 */
export async function scheduleRoutineConfirmPrompt(
  routineId: string,
  fireAt: Date
): Promise<string | null> {
  if (fireAt.getTime() <= Date.now()) return null;
  try {
    const data = {
      type: 'routine_confirm_prompt' as const,
      routineId,
      scheduledFor: fireAt.getTime(),
    };
    const sound = await resolveSound();
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: i18n.t('routine.confirmPromptTitle', { defaultValue: '미션 완료' }),
        body: i18n.t('routine.confirmPromptBody', { defaultValue: '다음 미션을 시작하려면 앱을 여세요' }),
        data: { ...data },
        sound,
        interruptionLevel: 'active',
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: fireAt,
      },
    });
    return id;
  } catch {
    return null;
  }
}

/** 확인 후 진행 프롬프트 알림 취소 (사용자 dismiss 시) */
export async function cancelRoutineConfirmPrompt(notifId: string): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(notifId).catch(() => {});
}
