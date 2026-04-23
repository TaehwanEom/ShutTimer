// v1.6: 루틴 알림 스케줄러.
// (1) 시작 5분 전 푸시 알림 — iOS/Android CALENDAR trigger + repeats:true 로 요일별 1개씩만 예약.
//     OS가 자동으로 매주 반복 발화 → rolling 동기화 불필요, 64개 한계 완화.
// (2) 자동 진행 모드 백그라운드 체인 — 현재 미션 종료 시점 DATE trigger 1개만 예약.
//     발화 시 handler에서 다음 체인 등록 (연쇄 방식).

import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  Routine,
  ROUTINE_PREALERT_MINUTES,
  SCHEDULED_ROUTINE_NOTIFS_KEY,
  IOS_NOTIFICATION_SAFE_CAP,
  loadRoutines,
} from '../constants/routines';
import { SETTINGS_KEY } from '../constants/settings';

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
          body: 'routine.prealertBody', // i18n 키 — 수신자에서 치환
          data: data as any,
          sound,
          interruptionLevel: 'active',
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
          weekday,
          hour: alertTime.hour,
          minute: alertTime.minute,
        } as any,
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
 * CALENDAR + repeats 방식이라 rolling 재동기화는 불필요하지만,
 * 루틴 추가/편집/삭제 누락 시나리오 대비 1회 재예약.
 * 64개 상한 초과 시 앞쪽 루틴 우선 예약 (Phase 2에서 우선순위 로직 강화).
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

  // 합계 상한 체크하며 재예약
  let totalScheduled = 0;
  for (const r of scheduledRoutines) {
    if (totalScheduled >= IOS_NOTIFICATION_SAFE_CAP) break;
    const ids = await scheduleRoutinePrealerts(r);
    totalScheduled += ids.length;
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
        title: 'routine.chainTitle',
        body: 'routine.chainBody',
        data: data as any,
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
