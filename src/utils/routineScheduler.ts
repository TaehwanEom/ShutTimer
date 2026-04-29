// v1.6: 루틴 알림 스케줄러.
// (1) 다단계 prealert (T2) — 시작 30분 전 + 5분 전 2회. iOS 26+ AlarmKit (한도 해방) / 그 외 expo-notifications WEEKLY (64 한계).
// (2) 자동 진행 모드 백그라운드 체인 — DATE trigger 1개. AlarmKit/expo-notifications 모두 임시 1슬롯.

import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform, AppState } from 'react-native';
import i18n from '../i18n';
import AlarmkitBridge from '../../modules/alarmkit-bridge';
import {
  Routine,
  RoutineStep,
  ROUTINE_PREALERT_MINUTES_LIST,
  SCHEDULED_ROUTINE_NOTIFS_KEY,
  IOS_NOTIFICATION_SAFE_CAP,
  loadRoutines,
  nextOccurrenceTime,
} from '../constants/routines';
import { SETTINGS_KEY } from '../constants/settings';
import {
  saveAlarmMetadata,
  loadAlarmMetadata,
  deleteAlarmMetadata,
  listAllAlarmMetadata,
} from './alarmkitMappingTable';
import { ALARM_SOUNDS, DEFAULT_SOUND_ID } from '../constants/sounds';
import { Logger } from './logger';

// ─── AlarmKit 가용성 ──────────────────────────────────────

let _alarmKitAvailable: boolean | null = null;
let _alarmKitAuthorized: boolean | null = null;

function isAlarmKitAvailableSync(): boolean {
  if (_alarmKitAvailable !== null) return _alarmKitAvailable;
  if (Platform.OS !== 'ios') {
    _alarmKitAvailable = false;
    return false;
  }
  const ver = parseInt(String(Platform.Version), 10);
  if (isNaN(ver) || ver < 26) {
    _alarmKitAvailable = false;
    return false;
  }
  try {
    _alarmKitAvailable = AlarmkitBridge.isAvailable();
  } catch {
    _alarmKitAvailable = false;
  }
  return _alarmKitAvailable;
}

/** AlarmKit 사용 가능 + 권한 받음 → true. notDetermined 면 false (UI에서 명시 요청). */
async function shouldUseAlarmKit(): Promise<boolean> {
  if (!isAlarmKitAvailableSync()) return false;
  if (_alarmKitAuthorized === true) return true;
  if (_alarmKitAuthorized === false) return false;
  try {
    const state = await AlarmkitBridge.getAuthorizationState();
    if (state === 'authorized') {
      _alarmKitAuthorized = true;
      return true;
    }
    if (state === 'denied' || state === 'unsupported') {
      _alarmKitAuthorized = false;
      return false;
    }
    return false;
  } catch {
    return false;
  }
}

/** 사용자 액션 (첫 루틴 저장) 시점에 명시적으로 권한 요청. */
export async function requestAlarmKitAuthorizationIfNeeded(): Promise<'authorized' | 'denied' | 'unavailable'> {
  if (!isAlarmKitAvailableSync()) return 'unavailable';
  try {
    const current = await AlarmkitBridge.getAuthorizationState();
    if (current === 'authorized') {
      _alarmKitAuthorized = true;
      return 'authorized';
    }
    if (current === 'denied') {
      _alarmKitAuthorized = false;
      return 'denied';
    }
    const state = await AlarmkitBridge.requestAuthorization();
    _alarmKitAuthorized = state === 'authorized';
    return state === 'authorized' ? 'authorized' : 'denied';
  } catch {
    return 'unavailable';
  }
}

// AppState 'active' 사이클당 Alert 1회 노출 허용. 시스템 설정 복귀 후 권한 캐시 invalidate.
let _alertShownThisCycle = false;

if (Platform.OS === 'ios') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      _alarmKitAuthorized = null;
      _alertShownThisCycle = false;
    }
  });
}

export function isAlertShownThisCycle(): boolean {
  return _alertShownThisCycle;
}

export function markAlertShown(): void {
  _alertShownThisCycle = true;
}

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
  /** expo-notifications 폴백 경로 알림 id */
  notifIds: string[];
  /** AlarmKit 경로 alarm UUID */
  alarmKitIds?: string[];
  lastSyncedAt: number;
};

type RoutineNotifData = {
  type: 'routine_prealert' | 'routine_chain';
  routineId: string;
  /** 체인 알림 전용 — 다음 step index */
  nextStepIndex?: number;
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
 * "HH:MM" 형태 시작 시간에서 prealertMinutes 분 전 시점 계산.
 * 자정을 넘어 전날로 넘어가는 경우 요일 오프셋 -1 반환.
 */
function computeAlertTime(time: string, prealertMinutes: number): { hour: number; minute: number; dayOffset: number } | null {
  const [hStr, mStr] = time.split(':');
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  if (isNaN(h) || isNaN(m)) return null;

  const startTotal = h * 60 + m;
  const alertTotal = startTotal - prealertMinutes;

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
  if (!routine.schedule || !routine.active) return [];
  await cancelRoutinePrealerts(routine.id);

  const useAlarmKit = await shouldUseAlarmKit();
  if (useAlarmKit) {
    return scheduleViaAlarmKit(routine);
  }
  return scheduleViaExpoNotifications(routine);
}

/** AlarmKit 경로 — iOS 26+. 64 한도 없음. fixed-date 1회성이라 (요일 × prealert 단계) 만큼 등록. */
async function scheduleViaAlarmKit(routine: Routine): Promise<string[]> {
  if (!routine.schedule) return [];

  const effectiveDays = routine.schedule.days.length === 0
    ? [0, 1, 2, 3, 4, 5, 6]
    : routine.schedule.days;

  const alarmIds: string[] = [];
  const now = new Date();
  const stopLabel = i18n.t('routine.prealertStop', { defaultValue: '확인' });

  for (const prealertMin of ROUTINE_PREALERT_MINUTES_LIST) {
    const alertTime = computeAlertTime(routine.schedule.startTime, prealertMin);
    if (!alertTime) continue;
    const titleKey = `routine.prealertTitle${prealertMin}m`;
    const title = i18n.t(titleKey, { defaultValue: `${prealertMin}분 후 루틴 시작` });

    for (const day of effectiveDays) {
      const fireDate = computeNextOccurrence(day, alertTime, now);
      if (!fireDate) continue;
      try {
        const id = await AlarmkitBridge.scheduleAlarm({
          routineId: routine.id,
          title,
          fireAt: fireDate.getTime(),
          stopLabel,
        });
        alarmIds.push(id);
      } catch {
        // 등록 실패 무시
      }
    }
  }

  const records = await loadNotifRecords();
  const next = records.filter(r => r.routineId !== routine.id);
  next.push({
    routineId: routine.id,
    notifIds: [],
    alarmKitIds: alarmIds,
    lastSyncedAt: Date.now(),
  });
  await saveNotifRecords(next);
  return alarmIds;
}

/** expo-notifications WEEKLY 경로 — iOS 25 이하 / Android. 64 한도 적용 (routine 수 × prealert 단계). */
async function scheduleViaExpoNotifications(routine: Routine): Promise<string[]> {
  if (!routine.schedule) return [];

  const { days } = routine.schedule;
  const effectiveDays = days.length === 0 ? [0, 1, 2, 3, 4, 5, 6] : days;
  const ids: string[] = [];
  const sound = await resolveSound();

  for (const prealertMin of ROUTINE_PREALERT_MINUTES_LIST) {
    const alertTime = computeAlertTime(routine.schedule.startTime, prealertMin);
    if (!alertTime) continue;
    const titleKey = `routine.prealertTitle${prealertMin}m`;
    const bodyKey = `routine.prealertBody${prealertMin}m`;
    const title = i18n.t(titleKey, { defaultValue: `${prealertMin}분 후 루틴 시작` });
    const body = i18n.t(bodyKey, { defaultValue: `${prealertMin}분 후 루틴이 시작됩니다` });

    for (const day of effectiveDays) {
      const alertDay = (day + alertTime.dayOffset + 7) % 7;
      const weekday = alertDay + 1;

      try {
        const data: RoutineNotifData = {
          type: 'routine_prealert',
          routineId: routine.id,
        };
        const id = await Notifications.scheduleNotificationAsync({
          content: {
            title,
            body,
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
  }

  const records = await loadNotifRecords();
  const next = records.filter(r => r.routineId !== routine.id);
  next.push({ routineId: routine.id, notifIds: ids, lastSyncedAt: Date.now() });
  await saveNotifRecords(next);
  return ids;
}

/** 특정 요일 + alertTime 기준 다음 발화 Date (now 기준 향후). 못 찾으면 null. */
function computeNextOccurrence(
  targetWeekday: number,
  alertTime: { hour: number; minute: number; dayOffset: number },
  now: Date
): Date | null {
  const adjustedWeekday = (targetWeekday + alertTime.dayOffset + 7) % 7;
  for (let offset = 0; offset < 8; offset++) {
    const d = new Date(now);
    d.setDate(d.getDate() + offset);
    d.setHours(alertTime.hour, alertTime.minute, 0, 0);
    if (d.getDay() !== adjustedWeekday) continue;
    if (d.getTime() <= now.getTime()) continue;
    return d;
  }
  return null;
}

/** 특정 루틴의 모든 예약 알림 취소 (legacy + alarmkit 양쪽). */
export async function cancelRoutinePrealerts(routineId: string): Promise<void> {
  const records = await loadNotifRecords();
  const target = records.find(r => r.routineId === routineId);
  if (target) {
    for (const id of target.notifIds) {
      await Notifications.cancelScheduledNotificationAsync(id).catch(() => {});
    }
    if (target.alarmKitIds) {
      for (const id of target.alarmKitIds) {
        await AlarmkitBridge.cancelAlarm(id).catch(() => {});
      }
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
  const scheduledRoutines = routines.filter(r => r.schedule && r.active);

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
 * @deprecated v1.6 옵션 A — `scheduleAllRoutineChains` 사용 (BG/KILL 자동 진행 보장).
 * 본 함수는 호환성 보존만. 신규 호출 금지.
 *
 * 자동 진행 모드에서 현재 미션 종료 시점에 발화할 알림 1개 예약.
 * 발화 시 App.tsx notification handler가 data.type === 'routine_chain'으로 분기.
 * 연쇄 방식: 이 알림 발화 시 다음 미션 알림을 다시 등록.
 */
export async function scheduleRoutineChain(
  routineId: string,
  nextStepIndex: number,
  fireAt: Date
): Promise<string | null> {
  if (fireAt.getTime() <= Date.now()) return null;
  const useAlarmKit = await shouldUseAlarmKit();
  if (useAlarmKit) {
    return scheduleChainViaAlarmKit(routineId, nextStepIndex, fireAt);
  }
  return scheduleChainViaExpoNotifications(routineId, nextStepIndex, fireAt);
}

/** AlarmKit 경로 — iOS 26+. 64 한도 + 30초 사운드 한도 해방. */
async function scheduleChainViaAlarmKit(
  routineId: string,
  nextStepIndex: number,
  fireAt: Date
): Promise<string | null> {
  try {
    const id = await AlarmkitBridge.scheduleAlarm({
      routineId,
      title: i18n.t('routine.chainTitle', { defaultValue: '다음 루틴' }),
      fireAt: fireAt.getTime(),
      stopLabel: i18n.t('routine.chainStop', { defaultValue: '확인' }),
      type: 'chain',
      nextStepIndex,
    });
    if (!id) return null;
    await saveAlarmMetadata({
      alarmId: id,
      type: 'chain',
      routineId,
      nextStepIndex,
    });
    return id;
  } catch {
    return null;
  }
}

/** expo-notifications 경로 — iOS 25 이하 / Android. */
async function scheduleChainViaExpoNotifications(
  routineId: string,
  nextStepIndex: number,
  fireAt: Date
): Promise<string | null> {
  try {
    const data: RoutineNotifData = {
      type: 'routine_chain',
      routineId,
      nextStepIndex,
      scheduledFor: fireAt.getTime(),
    };
    const sound = await resolveSound();
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: i18n.t('routine.chainTitle', { defaultValue: '다음 루틴' }),
        body: i18n.t('routine.chainBody', { defaultValue: '다음 루틴이 시작됩니다' }),
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

/**
 * @deprecated v1.6 옵션 A — `cancelAllRoutineChains` 사용.
 * 체인 알림 취소 (루틴 일시정지/종료 시). AlarmKit / expo-notifications 자동 분기.
 */
export async function cancelRoutineChain(notifId: string): Promise<void> {
  const meta = await loadAlarmMetadata(notifId);
  if (meta) {
    await AlarmkitBridge.cancelAlarm(notifId).catch(() => {});
    await deleteAlarmMetadata(notifId);
    return;
  }
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
  const useAlarmKit = await shouldUseAlarmKit();
  if (useAlarmKit) {
    // v1.6 Phase 12 — AlarmKit 등록 실패 시 expo-notifications 폴백 (silent fail 방지).
    const akId = await scheduleConfirmPromptViaAlarmKit(routineId, fireAt);
    if (akId) return akId;
    Logger.warn('routine', 'AlarmKit confirm_prompt 등록 실패 → expo-notifications 폴백');
    return scheduleConfirmPromptViaExpoNotifications(routineId, fireAt);
  }
  return scheduleConfirmPromptViaExpoNotifications(routineId, fireAt);
}

/** AlarmKit 경로 — iOS 26+. */
async function scheduleConfirmPromptViaAlarmKit(
  routineId: string,
  fireAt: Date
): Promise<string | null> {
  try {
    // v1.6 hotfix — confirm_prompt 사운드 통일. 사용자 설정 사운드 (단일 timer 와 동일 정책).
    const soundId = await AsyncStorage.getItem(SETTINGS_KEY.ALARM_SOUND) ?? DEFAULT_SOUND_ID;
    const soundItem = ALARM_SOUNDS.find(s => s.id === soundId) ?? ALARM_SOUNDS[0];

    const id = await AlarmkitBridge.scheduleAlarm({
      routineId,
      title: i18n.t('routine.confirmPromptTitle', { defaultValue: '다음 루틴' }),
      fireAt: fireAt.getTime(),
      stopLabel: i18n.t('routine.confirmPromptStop', { defaultValue: '확인' }),
      type: 'confirm_prompt',
      // v1.6 hotfix — 잠금 alerting UI 에 "다음 진행" 버튼 노출 (AdvanceNextStepIntent 결합)
      secondaryLabel: i18n.t('routine.alarmAdvance', { defaultValue: '다음 진행' }),
      soundName: soundItem.pushSound,
    });
    Logger.warn('routine', `confirm_prompt akId=${id}`);
    if (!id) return null;
    await saveAlarmMetadata({
      alarmId: id,
      type: 'confirm_prompt',
      routineId,
    });
    return id;
  } catch (e) {
    Logger.warn('routine', `scheduleConfirmPromptViaAlarmKit error=${String(e)}`);
    return null;
  }
}

/** expo-notifications 경로 — iOS 25 이하 / Android. */
async function scheduleConfirmPromptViaExpoNotifications(
  routineId: string,
  fireAt: Date
): Promise<string | null> {
  try {
    const data = {
      type: 'routine_confirm_prompt' as const,
      routineId,
      scheduledFor: fireAt.getTime(),
    };
    const sound = await resolveSound();
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: i18n.t('routine.confirmPromptTitle', { defaultValue: '다음 루틴' }),
        body: i18n.t('routine.confirmPromptBody', { defaultValue: '다음 루틴을 시작하려면 앱을 여세요' }),
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

/** 확인 후 진행 프롬프트 알림 취소 (사용자 dismiss 시). AlarmKit / expo-notifications 자동 분기. */
export async function cancelRoutineConfirmPrompt(notifId: string): Promise<void> {
  const meta = await loadAlarmMetadata(notifId);
  if (meta) {
    await AlarmkitBridge.cancelAlarm(notifId).catch(() => {});
    await deleteAlarmMetadata(notifId);
    return;
  }
  await Notifications.cancelScheduledNotificationAsync(notifId).catch(() => {});
}

// v1.6 Phase 12 — 옵션 A (chain 일괄 등록) 영구 폐기.
// scheduleAllRoutineChains / scheduleAllViaAlarmKit / scheduleAllViaExpoNotifications / cancelAllRoutineChains / ScheduleAllChainsResult 모두 제거.
// 자동 모드 영구 미사용 → 모든 routine 이 confirm_prompt 단발 등록만 사용 (scheduleRoutineConfirmPrompt).
