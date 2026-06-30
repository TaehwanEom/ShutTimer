// v1.6: 루틴 알림 스케줄러.
// (1) 다단계 prealert (T2) — 시작 30분 전 + 5분 전 2회. iOS 26+ AlarmKit only (= G4-E 측 expo-notifications 폐기).
// (2) F4 confirm_prompt — 미션 종료 시점 DATE trigger 1개. AlarmKit only.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform, AppState, PermissionsAndroid } from 'react-native';
import i18n from '../i18n';
import AlarmkitBridge from '../../modules/alarmkit-bridge';
import {
  Routine,
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

// v1.7 hotfix #G7 Phase 2-B — main app target 26.0 강제 정합 → iOS 측 = AlarmKit 항상 사용 가능.
// Phase 3-0b (2026-05-26): Android 도 알람 엔진 활성화 (= 루틴 prealert + confirm_prompt path 측 활성).
//   Phase 3-3 (2026-05-26): secondaryLabel ("다음 진행") 측 native FSI notification 측 secondary action button 측 정합.
//     AlarmActionReceiver 측 broadcast → JS App.tsx 측 'secondary_action' listener → dispatch Advance.
function isAlarmKitAvailableSync(): boolean {
  if (_alarmKitAvailable !== null) return _alarmKitAvailable;
  _alarmKitAvailable = Platform.OS === 'ios' || Platform.OS === 'android';
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
    if (state === 'denied') {
      _alarmKitAuthorized = false;
      return false;
    }
    return false;
  } catch {
    return false;
  }
}

/** 사용자 액션 (첫 루틴 저장 / 첫 타이머 / 온보딩) 시점에 명시적으로 권한 요청.
 *  iOS = AlarmKit framework 권한 (= AlarmManager.shared.requestAuthorization).
 *  Android = POST_NOTIFICATIONS 런타임 권한 (Android 13+ — 거부 시 FSI 알람 미표시).
 *    USE_EXACT_ALARM / USE_FULL_SCREEN_INTENT 측 = manifest 자동 부여 (사용자 prompt X).
 */
export async function requestAlarmKitAuthorizationIfNeeded(): Promise<'authorized' | 'denied' | 'unavailable'> {
  if (Platform.OS === 'android') {
    return requestAndroidNotificationPermission();
  }
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

// Android POST_NOTIFICATIONS 런타임 요청. Android 12 이하 = 자동 허용 → 'authorized'.
async function requestAndroidNotificationPermission(): Promise<'authorized' | 'denied' | 'unavailable'> {
  try {
    const perm = (PermissionsAndroid.PERMISSIONS as any).POST_NOTIFICATIONS;
    // Android 12 이하 (API < 33) — 본 키 미정의 → 권한 자동 부여 상태로 처리.
    if (!perm) {
      _alarmKitAuthorized = true;
      return 'authorized';
    }
    const already = await PermissionsAndroid.check(perm);
    if (already) {
      _alarmKitAuthorized = true;
      return 'authorized';
    }
    const result = await PermissionsAndroid.request(perm);
    const granted = result === PermissionsAndroid.RESULTS.GRANTED;
    _alarmKitAuthorized = granted;
    return granted ? 'authorized' : 'denied';
  } catch (e) {
    Logger.warn('routineScheduler', `requestAndroidNotificationPermission error=${String(e)}`);
    return 'unavailable';
  }
}

// AppState 'active' 사이클당 Alert 1회 노출 허용. 시스템 설정 복귀 후 권한 캐시 invalidate.
let _alertShownThisCycle = false;

// iOS = AlarmKit, Android = POST_NOTIFICATIONS. 둘 다 시스템 설정 복귀 시 권한 캐시 invalidate 필요.
if (Platform.OS === 'ios' || Platform.OS === 'android') {
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

type ScheduledRoutineRecord = {
  routineId: string;
  /** AlarmKit 경로 alarm UUID */
  alarmKitIds?: string[];
  lastSyncedAt: number;
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

  // v1.7 hotfix Phase 13 G4-E — AlarmKit 측만 사용 (= expo-notifications WEEKLY 경로 폐기).
  const useAlarmKit = await shouldUseAlarmKit();
  if (!useAlarmKit) return [];
  return scheduleViaAlarmKit(routine);
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

  // v1.8 #SoundRenameMigration — prealert 사운드 누락 정정.
  //   직전: prealert scheduleAlarm 호출에 soundName 미전달 → AlarmKit 이 .default(아이폰 기본음) 발화.
  //   정정: 사용자 설정 사운드 전달 (confirm_prompt / alarm_main 과 동일 정책).
  const soundId = (await AsyncStorage.getItem(SETTINGS_KEY.ALARM_SOUND)) ?? DEFAULT_SOUND_ID;
  const soundItem = ALARM_SOUNDS.find(s => s.id === soundId) ?? ALARM_SOUNDS[0];

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
          entityId: routine.id,
          title,
          fireAt: fireDate.getTime(),
          stopLabel,
          type: 'prealert',
          soundName: soundItem.pushSound,
        });
        alarmIds.push(id);
        // v1.7 hotfix #3 — prealert metadata 저장. 직전: 저장 안 해서
        // App.tsx onAlarmStateChange listener 가 fire 시 meta 못 찾음 → silent return →
        // 첫 step confirm_prompt 와 동시 alerting 시 "다음 진행" 눌러도 prealert 잔존 ring.
        if (id) {
          await saveAlarmMetadata({
            alarmId: id,
            type: 'prealert',
            entityId: routine.id,
          });
        }
      } catch {
        // 등록 실패 무시
      }
    }
  }

  const records = await loadNotifRecords();
  const next = records.filter(r => r.routineId !== routine.id);
  next.push({
    routineId: routine.id,
    alarmKitIds: alarmIds,
    lastSyncedAt: Date.now(),
  });
  await saveNotifRecords(next);
  return alarmIds;
}

// v1.7 hotfix Phase 13 G4-E — scheduleViaExpoNotifications 함수 통째 폐기 (= AlarmKit only).

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

/** 특정 루틴의 모든 예약 알림 취소 (= AlarmKit 측만 = G4-E 정합). */
export async function cancelRoutinePrealerts(routineId: string): Promise<void> {
  const records = await loadNotifRecords();
  const target = records.find(r => r.routineId === routineId);
  if (target?.alarmKitIds) {
    for (const id of target.alarmKitIds) {
      await AlarmkitBridge.cancelAlarm(id).catch(() => {});
      await deleteAlarmMetadata(id).catch(() => {});
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

  // v1.7 hotfix Phase 13 G4-E — AlarmKit 측만 cancel (= expo-notifications cancel 폐기).
  const records = await loadNotifRecords();
  for (const rec of records) {
    if (rec.alarmKitIds) {
      for (const id of rec.alarmKitIds) {
        await AlarmkitBridge.cancelAlarm(id).catch(() => {});
        await deleteAlarmMetadata(id).catch(() => {});
      }
    }
  }
  await saveNotifRecords([]);

  // v1.6 후속 hotfix — mapping table 측 stale 영역 cleanup (= 이전 빌드 측 예약 영역 = records 측 ❌ 영역).
  // type 'prealert' / 'chain' 영역 cancel (= 'confirm_prompt' = 활성 영역 보호).
  // v1.7 hotfix #SyncRollingTimerMainCancel — 'timer_main' 영역 폐기.
  //   직전 = 'timer_main' 측 = 모두 cancel → 시나리오 2 측 = 강종 후 LA 누름 + 앱 진입 시점 측 = 잔존 5분 타이머 측 cancel
  //   → LA 측 OS 측 dismiss → 앱 진입 후 LA 사라짐 root cause (= 사용자분 사인 정합).
  //   본 정정 = 'timer_main' 측 cancel 폐기 (= 잔존 타이머 측 보존 강제). AlarmScreen dismiss 측 = stopAudioAndVibration 측 = timer_main cancel 잔존 ✅.
  const allMeta = await listAllAlarmMetadata();
  for (const meta of allMeta) {
    if (meta.type === 'prealert' || meta.type === 'chain') {
      await AlarmkitBridge.cancelAlarm(meta.alarmId).catch(() => {});
      await deleteAlarmMetadata(meta.alarmId).catch(() => {});
    }
  }

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

// v1.7 hotfix Phase 13 G4-E — 옛 routine_chain 함수 4개 통째 폐기 (= caller 0건 = dead 확정).
//   scheduleRoutineChain / scheduleChainViaAlarmKit / scheduleChainViaExpoNotifications / cancelRoutineChain.
//   v1.6 옵션 A 측 폐기 영역 (= scheduleAllRoutineChains 측 사용 명시). 본 cycle 측 통째 정리.

// ─── F4: 확인 후 진행 모드 배경 알림 (미션 종료 시점 RoutineAlarm 유도) ─

/**
 * 확인 후 진행 모드에서 미션 종료 시점에 발화할 DATE trigger 알림 예약.
 * 앱이 배경/kill 상태여도 알림으로 사용자에게 미션 종료 알림.
 * 발화 시 data.type === 'routine_confirm_prompt' → App.tsx handler가 RoutineAlarm 이동.
 */
export async function scheduleRoutineConfirmPrompt(
  routineId: string,
  fireAt: Date,
  // v1.6 hotfix B1 — alerting UI title 에 다음 step name 포함 ("다음 루틴 조깅" 형식).
  // 마지막 step 종료 시점 = nextStepName undefined → 기본 "다음 루틴" 만 표시.
  nextStepName?: string,
  // v1.8 #WatchLARoutine — 워치 Smart Stack LA 표시용 메타데이터.
  laRoutineName?: string,
  laStepName?: string,
  laStepIndex?: number,
  laTotalSteps?: number,
  // 2026-05-31 — Android 미션 알람 잠금 해제 강제 (iOS 정합).
  endMethod?: string,
): Promise<string | null> {
  // v1.7 hotfix #12 — fireAt 측 과거 시 = 1초 future 강제 (= scheduleBackgroundNotif id=null 회귀 차단).
  // 직전: fireAt < now 시 null 반환 → confirm_prompt alarm 등록 ❌ → 다음 step alarm fire ❌ → routine 진행 정지.
  // 가능 원인: step duration 측 짧음 / confirmAndAdvance 측 race / syncRoutineFromSnapshot 측 지연.
  if (fireAt.getTime() <= Date.now()) {
    fireAt = new Date(Date.now() + 1000);
  }
  // v1.7 hotfix Phase 13 G4-E — AlarmKit 측만 사용 (= expo-notifications 폴백 폐기).
  const useAlarmKit = await shouldUseAlarmKit();
  if (!useAlarmKit) return null;
  return scheduleConfirmPromptViaAlarmKit(routineId, fireAt, nextStepName, laRoutineName, laStepName, laStepIndex, laTotalSteps, endMethod);
}

// #ConfirmPromptRealert (2026-06-22) — 단계 전환 알림 재알림 체인 상수.
//   confirm_prompt는 .timer(postAlert nil)라 발화 후 OS가 즉시 제거 → 한 번 울리고 끝 → 잠든 사용자가 놓치면
//   루틴이 다음 단계로 못 넘어가고 조용히 멈춤(2026-06-22 Log_0622 실측: 단계종료 1회 알림 후 3.5h 정지).
//   본체 알람 안전체인(.alarm(.fixed) 2분 간격 eager)과 동일 방식으로, 단계 종료 후 재알림을 미리 깔아 끌 때까지 깨운다.
//   개수 15회 × 2분 = 30분(기상 깨움 충분 + AlarmKit 동시 한계 여유). 필요 시 조정 가능한 단일 지점.
const CONFIRM_PROMPT_REALERT_COUNT = 15;
const CONFIRM_PROMPT_REALERT_INTERVAL_MS = 120000; // 2분 (본체 ALARM_CHAIN_INTERVAL_MS 동일)

/**
 * 단계 종료 시각(baseFireAtMs) 기준 2분 간격 confirm_prompt 재알림 체인 예약.
 * primary(.timer 카운트다운)는 별도. 재알림은 recurrence{mode:'never'}=네이티브 .alarm(.fixed) 지속 알림.
 * RN Advance 경로(scheduleConfirmPromptViaAlarmKit)와 네이티브 advance 경로(effectRunner.SyncNativeAdvanceRealerts) 공용.
 */
export async function scheduleConfirmPromptRealertChain(
  routineId: string,
  baseFireAtMs: number,
  nextStepName?: string,
  endMethod?: string,
): Promise<number> {
  // 2026-06-24 #LastStepNoRealert — 마지막 단계(nextStepName 없음 = "루틴 완료" 프롬프트)는 재알림 미예약.
  //   완료 프롬프트는 다음 단계가 없어 2분 간격 30분 재알림의 가치가 낮고(미확인 방치 시 "루틴 완료"만 30분 발화),
  //   primary는 1회 발화하므로 사용자는 깨어날 때 확인 가능. 진행 필요한 중간 단계만 재알림 유지.
  if (!nextStepName) {
    Logger.warn('routine', `confirm_prompt realert skip — 마지막 단계(루틴 완료) routineId=${routineId}`);
    return 0;
  }
  const soundId = await AsyncStorage.getItem(SETTINGS_KEY.ALARM_SOUND) ?? DEFAULT_SOUND_ID;
  const soundItem = ALARM_SOUNDS.find(s => s.id === soundId) ?? ALARM_SOUNDS[0];
  const baseTitle = i18n.t('routine.confirmPromptTitle', { defaultValue: '다음 루틴' });
  // nextStepName 없으면 위에서 early-return → 여기선 항상 존재.
  const title = `${baseTitle} ${nextStepName}`;
  let realertOk = 0;
  for (let i = 1; i <= CONFIRM_PROMPT_REALERT_COUNT; i++) {
    const realertAt = baseFireAtMs + i * CONFIRM_PROMPT_REALERT_INTERVAL_MS;
    try {
      const realertId = await AlarmkitBridge.scheduleAlarm({
        entityId: routineId,
        title,
        fireAt: realertAt,
        stopLabel: i18n.t('routine.confirmPromptStop', { defaultValue: '확인' }),
        type: 'confirm_prompt',
        // recurrence{mode:'never'} → 네이티브 .alarm(.fixed) 강제(지속 알림). secondaryLabel 미전달(=깨진 버튼 방지).
        recurrence: { mode: 'never' },
        soundName: soundItem.pushSound,
        endMethod: endMethod as any,
        // 2026-06-25 — 재알림도 alert 상태 → 위젯 안내 문구 동일 전달.
        laAlertMessage: i18n.t('routine.laAlertMessage', { defaultValue: '다음 루틴을 진행' }),
      });
      if (realertId) {
        realertOk++;
        // 2026-06-24 #RealertMetaCleanup — realert 마커로 primary와 구분 → listener가 발화 후 정식 삭제.
        await saveAlarmMetadata({ alarmId: realertId, type: 'confirm_prompt', entityId: routineId, realert: true });
      }
    } catch (e) {
      Logger.warn('routine', `confirm_prompt realert[${i}] schedule error=${String(e)}`);
    }
  }
  return realertOk;
}

/**
 * routineId의 잔존 confirm_prompt(primary + 재알림) 일괄 cancel — keepAlarmId 하나만 보존.
 * 네이티브 advance_done 경로는 ScheduleConfirmPrompt의 #ConfirmPromptDedup을 안 거쳐 이전 step 재알림이
 * 살아남아 다음 step 중 발화 → 사용자가 끄면 루틴 조기 종료(2026-06-24 Log_0624 실측 회귀). 그 누락을 메움.
 * keepAlarmId = 네이티브가 방금 만든 새 step primary(취소하면 다음 step 깨짐).
 */
export async function cancelStaleConfirmPrompts(routineId: string, keepAlarmId?: string): Promise<number> {
  // 2026-06-24 검수 반영 — keepAlarmId 미전달 시 routineId의 모든 confirm_prompt(=활성 primary 포함)를
  //   무차별 삭제하는 사고를 방지. 보존 대상이 없으면 호출 의도가 모호하므로 no-op.
  if (!keepAlarmId) {
    Logger.warn('routine', `cancelStaleConfirmPrompts skip — keepAlarmId 없음 routineId=${routineId}`);
    return 0;
  }
  let canceled = 0;
  try {
    const allMeta = await listAllAlarmMetadata();
    const stale = allMeta.filter(m =>
      m.type === 'confirm_prompt' &&
      m.entityId === routineId &&
      m.deleted !== true &&
      m.alarmId !== keepAlarmId
    );
    for (const meta of stale) {
      await AlarmkitBridge.cancelAlarm(meta.alarmId).catch(() => {});
      await deleteAlarmMetadata(meta.alarmId).catch(() => {});
      canceled++;
    }
  } catch (e) {
    Logger.warn('routine', `cancelStaleConfirmPrompts error=${String(e)}`);
  }
  return canceled;
}

/** AlarmKit 경로 — iOS 26+. */
async function scheduleConfirmPromptViaAlarmKit(
  routineId: string,
  fireAt: Date,
  nextStepName?: string,
  laRoutineName?: string,
  laStepName?: string,
  laStepIndex?: number,
  laTotalSteps?: number,
  endMethod?: string,
): Promise<string | null> {
  try {
    // v1.6 hotfix — confirm_prompt 사운드 통일. 사용자 설정 사운드 (단일 timer 와 동일 정책).
    const soundId = await AsyncStorage.getItem(SETTINGS_KEY.ALARM_SOUND) ?? DEFAULT_SOUND_ID;
    const soundItem = ALARM_SOUNDS.find(s => s.id === soundId) ?? ALARM_SOUNDS[0];
    // v1.7 hotfix #DBG-Sound (C1) — confirm_prompt 측 사운드 매핑 출력 (= soundId → soundItem.id → pushSound).
    // soundId 영역 측 = AsyncStorage. soundItem.id 영역 측 = ALARM_SOUNDS 측 매칭 결과 (= mismatch 시 fallback to ALARM_SOUNDS[0]).
    Logger.warn('routine-DBG', `confirm_prompt sound storedId=${soundId} → matchedId=${soundItem.id} pushSound=${soundItem.pushSound} routineId=${routineId}`);

    // v1.6 hotfix B1 — title 동적 생성 ("다음 루틴 {nextStepName}" / 마지막 step (1-step routine) 시 "루틴 완료")
    const baseTitle = i18n.t('routine.confirmPromptTitle', { defaultValue: '다음 루틴' });
    const completeTitle = i18n.t('routine.routineCompleteTitle', { defaultValue: '루틴 완료' });
    const title = nextStepName ? `${baseTitle} ${nextStepName}` : completeTitle;

    // v1.6 #13 — 마지막 step (nextStepName 미전달 = 1-step routine) 의 alerting UI = "밀어서 중단" 만 (secondary 제거).
    const isLastStep = !nextStepName;
    const id = await AlarmkitBridge.scheduleAlarm({
      entityId: routineId,
      title,
      fireAt: fireAt.getTime(),
      stopLabel: i18n.t('routine.confirmPromptStop', { defaultValue: '확인' }),
      type: 'confirm_prompt',
      // 마지막 step 일 때 secondaryLabel 미전달 → AlarmkitBridgeModule 측 hasSecondary=false 분기로 진입 → "다음 진행" 버튼 미노출.
      secondaryLabel: isLastStep ? undefined : i18n.t('routine.alarmAdvance', { defaultValue: '다음 진행' }),
      soundName: soundItem.pushSound,
      // 2026-05-31 — Android 미션 알람 잠금 해제 강제 (iOS 정합). 'tap' / undefined = 일반 알람.
      endMethod: endMethod as any,
      // v1.8 #WatchLARoutine — 워치 Smart Stack LA 표시용 메타데이터.
      laRoutineName,
      laStepName,
      laStepIndex,
      laTotalSteps,
      laRoutineId: routineId,
      // 2026-06-25 — 위젯 LA(.alert) 큰 글씨 안내 문구(루틴 단계). 현지화 전달.
      laAlertMessage: i18n.t('routine.laAlertMessage', { defaultValue: '다음 루틴을 진행' }),
    });
    Logger.warn('routine', `confirm_prompt akId=${id}`);
    if (!id) return null;
    await saveAlarmMetadata({
      alarmId: id,
      type: 'confirm_prompt',
      entityId: routineId,
    });

    // #ConfirmPromptRealert (2026-06-22) — 단계 종료 + 2분 간격 재알림 체인을 eager 예약 (본체 안전체인 미러링).
    //   primary(위) = .timer 카운트다운(LA·일시정지 유지). 재알림 = recurrence{mode:'never'} → 네이티브 .alarm(.fixed)
    //   분기(alert-only, LA 생성 ❌, stopIntent=OpenAppDismissIntent → 탭 시 앱 진입). .alarm 분기는 secondaryIntent를
    //   못 달므로 재알림은 "확인"(앱 진입)만 = 본체 알람과 동일 UX. Stop 전용이라 중복 advance 위험 없음(앱 진입 후 진행).
    //   취소: 다음 step ScheduleConfirmPrompt의 #ConfirmPromptDedup(type=confirm_prompt+entityId 전체) + ClearActiveRoutine가
    //   모든 멤버 일괄 제거. (재알림 fire는 auto-advance 아님 → 취소 전 spurious 발화돼도 추가 배너뿐, 다음 dedup이 자가치유.)
    //   eager 필수: lazy(발화 시 다음 1개 등록)는 잠금 suspend 시 깨짐(project_alarm_chain_must_be_eager).
    const realertOk = await scheduleConfirmPromptRealertChain(routineId, fireAt.getTime(), nextStepName, endMethod);
    // 검증용 — 재알림 몇 개 깔렸는지(2분 간격). baseFireAt = 단계 종료 시각.
    Logger.warn('routine', `confirm_prompt realert scheduled ${realertOk}/${CONFIRM_PROMPT_REALERT_COUNT} routineId=${routineId} baseFireAt=${fireAt.getTime()}`);

    return id;
  } catch (e) {
    Logger.warn('routine', `scheduleConfirmPromptViaAlarmKit error=${String(e)}`);
    return null;
  }
}

// v1.7 hotfix Phase 13 G4-E — scheduleConfirmPromptViaExpoNotifications 통째 폐기 (= AlarmKit only).

/** 확인 후 진행 프롬프트 알림 취소 (사용자 dismiss 시). */
export async function cancelRoutineConfirmPrompt(notifId: string): Promise<void> {
  const meta = await loadAlarmMetadata(notifId);
  if (meta) {
    await AlarmkitBridge.cancelAlarm(notifId).catch(() => {});
    await deleteAlarmMetadata(notifId);
  }
}

// v1.6 Phase 12 — 옵션 A (chain 일괄 등록) 영구 폐기.
// scheduleAllRoutineChains / scheduleAllViaAlarmKit / scheduleAllViaExpoNotifications / cancelAllRoutineChains / ScheduleAllChainsResult 모두 제거.
// 자동 모드 영구 미사용 → 모든 routine 이 confirm_prompt 단발 등록만 사용 (scheduleRoutineConfirmPrompt).
