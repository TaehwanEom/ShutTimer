// v1.6 리팩토링: 루틴 상태 전환 단일 진입점.
// 모든 상태 변경은 이 파일 export 함수를 통해서만 발생.
// Phase 1+2: steps 기반 데이터 모델로 타입 보정. 로직 유지. loopCount/missions 제거.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { DeviceEventEmitter } from 'react-native';
import * as Notifications from 'expo-notifications';
import {
  Routine,
  ActiveRoutine,
  ROUTINE_DEADLINE_MS,
  loadRoutines,
  loadActiveRoutine,
  saveActiveRoutine,
  clearActiveRoutine,
  recordStepSession,
} from '../constants/routines';
import { clearPreloadedSound } from './alarmSoundPreload';
import {
  scheduleRoutineConfirmPrompt,
  cancelRoutineConfirmPrompt,
  requestAlarmKitAuthorizationIfNeeded,
} from './routineScheduler';
import AlarmkitBridge from '../../modules/alarmkit-bridge';
import LiveActivityBridge from '../../modules/live-activity-bridge';
import { listAllAlarmMetadata, deleteAlarmMetadata } from './alarmkitMappingTable';
import { Logger } from './logger';

const IS_ROUTINE_ACTIVE_KEY = 'isRoutineActive';
const ACTIVE_TIMER_KEY = 'activeTimer';
const IS_TIMER_ACTIVE_KEY = 'isTimerActive';

// 현재 예약된 배경 알림 id — 모듈 레벨에서 보관 (UI 마운트/언마운트와 독립)
// v1.6 Phase 12 — 옵션 A (chain 일괄 등록) 폐기. confirm_prompt 단발만 유지.
let currentConfirmPromptId: string | null = null;
// v1.6 T3 Phase 4: 활성 LiveActivity id — 잠금화면/다이내믹 아일랜드 표시용.
let currentLiveActivityId: string | null = null;

// ─── 결과 타입 ───────────────────────────────────────────────

export type StartRoutineResult =
  | { kind: 'started'; ar: ActiveRoutine; routine: Routine }
  | { kind: 'resumed'; ar: ActiveRoutine; routine: Routine }
  | { kind: 'needs_override'; existingRoutineId: string; newRoutineId: string }
  | { kind: 'needs_timer_override' }
  | { kind: 'not_found' };

export type MissionEndResult =
  | { kind: 'advance_auto'; ar: ActiveRoutine; routine: Routine }
  | { kind: 'advance_confirm'; ar: ActiveRoutine; routine: Routine }
  | { kind: 'end'; routine: Routine };

export type RestoreResult =
  | { kind: 'none' }
  | { kind: 'expired' }
  | { kind: 'run'; routineId: string }
  | { kind: 'alarm'; routineId: string };

// ─── 내부 헬퍼 ───────────────────────────────────────────────

function createFreshAr(r: Routine): ActiveRoutine {
  const now = Date.now();
  const firstStep = r.steps[0];
  const durationMs = firstStep ? Math.max(0, firstStep.durationSeconds) * 1000 : 60 * 1000;
  return {
    routineId: r.id,
    currentStepIndex: 0,
    stepEndAt: now + durationMs,
    pausedAt: null,
    startedAt: now,
    deadlineAt: now + ROUTINE_DEADLINE_MS,
    awaitingConfirm: false,
  };
}

/**
 * v1.6 Phase 12 — 현재 step 종료 시점에 발화할 confirm_prompt 알림 예약 (수동 모드).
 * 'auto' endMethod 영구 제거 — 모든 routine = confirm_prompt.
 */
async function scheduleBackgroundNotif(r: Routine, ar: ActiveRoutine): Promise<void> {
  if (currentConfirmPromptId) {
    await cancelRoutineConfirmPrompt(currentConfirmPromptId);
    currentConfirmPromptId = null;
  }
  if (ar.pausedAt !== null) return;

  // 마지막 step 이라도 종료 알림 필요 (RoutineAlarm / 위젯 manual_prompt 유도)
  const fireAt = new Date(ar.stepEndAt);
  Logger.warn('routine', `schedBgNotif fireAt=${fireAt.toISOString()} stepIdx=${ar.currentStepIndex}`);
  const id = await scheduleRoutineConfirmPrompt(r.id, fireAt);
  Logger.warn('routine', `schedBgNotif id=${id}`);
  currentConfirmPromptId = id;
}

async function cancelBackgroundNotif(): Promise<void> {
  // v1.6 Phase 12 — chain alarm 일괄 cancel + clearChainAlarms 제거 (옵션 A 폐기).
  if (currentConfirmPromptId) {
    await cancelRoutineConfirmPrompt(currentConfirmPromptId);
    currentConfirmPromptId = null;
  }
  // ★ 강제 종료 등으로 모듈 ref 가 사라진 경우 대비 — iOS 시스템 큐에 잔존하는 routine_chain /
  //   routine_confirm_prompt 알림 모두 조회 + cancel. routine_prealert 는 rolling schedule 이므로 제외.
  try {
    const all = await Notifications.getAllScheduledNotificationsAsync();
    for (const n of all) {
      const t = (n.content?.data as any)?.type;
      if (t === 'routine_chain' || t === 'routine_confirm_prompt') {
        await Notifications.cancelScheduledNotificationAsync(n.identifier).catch(() => {});
      }
    }
  } catch {}
  // v1.6 T1 — AlarmKit 잔존 알람 cleanup (chain / confirm_prompt 만. prealert 는 rolling schedule)
  try {
    const metas = await listAllAlarmMetadata();
    for (const meta of metas) {
      if (meta.type === 'chain' || meta.type === 'confirm_prompt') {
        await AlarmkitBridge.cancelAlarm(meta.alarmId).catch(() => {});
        await deleteAlarmMetadata(meta.alarmId);
      }
    }
  } catch {}
}

async function findRoutine(routineId: string): Promise<Routine | null> {
  const list = await loadRoutines();
  return list.find(r => r.id === routineId) ?? null;
}

/**
 * v1.6 Phase 12 — routine 시작 시점 권한 자동 검증 + 미결정 시 요청.
 * RoutineEdit / Onboarding 경로 외 (직접 RoutineList 에서 시작) 시 권한 미결정 보강.
 * - expo-notifications 권한 (confirm_prompt 폴백 fire 보장)
 * - AlarmKit 권한 (iOS 26+ 풀스크린 알람 fire 보장)
 */
async function ensureNotificationPermissions(): Promise<void> {
  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') {
      await Notifications.requestPermissionsAsync();
    }
  } catch {}
  try {
    await requestAlarmKitAuthorizationIfNeeded();
  } catch {}
}

/**
 * v1.6 T3 Phase 4 — LiveActivity 시작 또는 갱신.
 * iOS 16.2+ + 사용자 권한 활성 시에만 실제 표시. 그 외엔 silent skip.
 */
async function startOrUpdateLiveActivity(routine: Routine, ar: ActiveRoutine): Promise<void> {
  try {
    if (!LiveActivityBridge.areActivitiesEnabled()) return;
  } catch {
    return;
  }
  const step = routine.steps[ar.currentStepIndex];
  if (!step) return;

  const stepDurationMs = Math.max(0, step.durationSeconds) * 1000;
  const remaining = Math.max(0, ar.stepEndAt - Date.now());
  const elapsed = Math.max(0, stepDurationMs - remaining);
  const progress = stepDurationMs > 0 ? Math.min(1, elapsed / stepDurationMs) : 0;
  const routineName = routine.name ?? routine.category;

  if (currentLiveActivityId) {
    try {
      await LiveActivityBridge.update({
        activityId: currentLiveActivityId,
        stepName: step.name,
        stepEndAt: ar.stepEndAt,
        progress,
      });
      return;
    } catch {
      // update 실패 — start 로 재시도
      currentLiveActivityId = null;
    }
  }

  try {
    const id = await LiveActivityBridge.start({
      routineId: routine.id,
      routineName,
      stepName: step.name,
      stepEndAt: ar.stepEndAt,
      progress,
    });
    currentLiveActivityId = id || null;
  } catch {
    // 권한 거부 / 시스템 한도 등 — silent skip
  }
}

/**
 * v1.6 Phase 12 — LA stage 갱신 (alerting 시 'manual_prompt' / 다음 step 시작 시 'step').
 * 위젯 자동 stage 전환 — App.tsx onAlarmStateChange listener 가 confirm_prompt alerting 시 호출.
 */
export async function setLiveActivityStage(stage: 'step' | 'manual_prompt'): Promise<void> {
  Logger.warn('routine', `setStage stage=${stage} laId=${currentLiveActivityId}`);
  try {
    if (!LiveActivityBridge.areActivitiesEnabled()) return;
  } catch {
    return;
  }
  const ar = await loadActiveRoutine();
  if (!ar) return;
  const routine = await findRoutine(ar.routineId);
  if (!routine) return;
  const step = routine.steps[ar.currentStepIndex];
  if (!step) return;
  const stepDurationMs = Math.max(0, step.durationSeconds) * 1000;
  const remaining = Math.max(0, ar.stepEndAt - Date.now());
  const elapsed = Math.max(0, stepDurationMs - remaining);
  const progress = stepDurationMs > 0 ? Math.min(1, elapsed / stepDurationMs) : 0;

  // v1.6 hotfix — currentLiveActivityId stale 시 endAll → start 재생성 (가설 C 직접 fix).
  // 잠금 진입 / cold-start 등으로 module-level ref 가 사라진 경우에도 LA stage 전환 보장.
  if (!currentLiveActivityId) {
    try {
      await LiveActivityBridge.endAll().catch(() => {});
      const id = await LiveActivityBridge.start({
        routineId: ar.routineId,
        routineName: routine.name ?? routine.category,
        stepName: step.name,
        stepEndAt: ar.stepEndAt,
        progress,
        stage,
      });
      currentLiveActivityId = id || null;
      Logger.warn('routine', `LA recreate stage=${stage} id=${currentLiveActivityId}`);
    } catch (e) {
      Logger.warn('routine', `LA recreate throw=${String(e)}`);
    }
    return;
  }

  try {
    await LiveActivityBridge.update({
      activityId: currentLiveActivityId,
      stepName: step.name,
      stepEndAt: ar.stepEndAt,
      progress,
      stage,
    });
    Logger.warn('routine', 'LA update OK');
  } catch (e) {
    Logger.warn('routine', `LA update throw=${String(e)}`);
  }
}

/**
 * v1.6 T3 Phase 4 — 활성 LiveActivity 종료. fullCleanup 시점에 호출.
 */
async function endLiveActivity(): Promise<void> {
  if (!currentLiveActivityId) {
    // 모듈 변수 stale 방지 — 시스템에 잔존 가능성 있을 때 endAll
    try {
      if (LiveActivityBridge.areActivitiesEnabled()) {
        await LiveActivityBridge.endAll();
      }
    } catch {}
    return;
  }
  try {
    await LiveActivityBridge.end({
      activityId: currentLiveActivityId,
      dismissalPolicy: 'immediate',
    });
  } catch {}
  currentLiveActivityId = null;
}

// v1.6 Phase 12 — reinstallChainsIfAuto 함수 제거 (auto 모드 영구 미사용).

async function fullCleanup(): Promise<void> {
  await cancelBackgroundNotif();
  await endLiveActivity();
  await clearActiveRoutine();
  await AsyncStorage.removeItem(IS_ROUTINE_ACTIVE_KEY).catch(() => {});
}

// ─── 공개 API ───────────────────────────────────────────────

/**
 * 루틴 시작 (또는 같은 루틴 복원).
 * 다른 루틴 진행 중이면 needs_override. 단일 타이머 진행 중이면 needs_timer_override.
 */
export async function startRoutine(
  routineId: string,
  options: { overrideActive?: boolean; overrideTimer?: boolean } = {}
): Promise<StartRoutineResult> {
  const target = await findRoutine(routineId);
  if (!target) return { kind: 'not_found' };

  // v1.6 Phase 12 — 권한 자동 검증 + 미결정 시 요청 (RoutineEdit / Onboarding 외 경로 보강)
  await ensureNotificationPermissions();

  const activeTimerRaw = await AsyncStorage.getItem(ACTIVE_TIMER_KEY);
  if (activeTimerRaw && !options.overrideTimer) {
    return { kind: 'needs_timer_override' };
  }
  if (activeTimerRaw && options.overrideTimer) {
    await AsyncStorage.removeItem(ACTIVE_TIMER_KEY).catch(() => {});
    await AsyncStorage.removeItem(IS_TIMER_ACTIVE_KEY).catch(() => {});
    // 단일 timer 의 시스템 예약 알림 cancel — routine_* 외 모든 알림 (단일 timer 알림은 type 없음).
    try {
      const all = await Notifications.getAllScheduledNotificationsAsync();
      for (const n of all) {
        const t = (n.content?.data as any)?.type;
        if (t !== 'routine_prealert' && t !== 'routine_chain' && t !== 'routine_confirm_prompt') {
          await Notifications.cancelScheduledNotificationAsync(n.identifier).catch(() => {});
        }
      }
    } catch {}
    // preload 된 알람 사운드 정리 (HomeScreen 이 scheduleAlarm 시 createAsync 한 핸들 누수 방지)
    await clearPreloadedSound().catch(() => {});
    // HomeScreen 의 React state / setInterval 리셋 신호 — 루틴이 단일 타이머를 override 했음을 알림
    DeviceEventEmitter.emit('timerCancelledExternally');
  }

  const existing = await loadActiveRoutine();

  if (existing && existing.routineId === routineId) {
    if (Date.now() > existing.deadlineAt) {
      await fullCleanup();
      const fresh = createFreshAr(target);
      await saveActiveRoutine(fresh);
      await AsyncStorage.setItem(IS_ROUTINE_ACTIVE_KEY, 'true').catch(() => {});
      await scheduleBackgroundNotif(target, fresh);
      await startOrUpdateLiveActivity(target, fresh);
      return { kind: 'started', ar: fresh, routine: target };
    }
    await AsyncStorage.setItem(IS_ROUTINE_ACTIVE_KEY, 'true').catch(() => {});
    if (existing.pausedAt === null && !existing.awaitingConfirm) {
      await scheduleBackgroundNotif(target, existing);
      await startOrUpdateLiveActivity(target, existing);
    }
    return { kind: 'resumed', ar: existing, routine: target };
  }

  if (existing && existing.routineId !== routineId && !options.overrideActive) {
    return { kind: 'needs_override', existingRoutineId: existing.routineId, newRoutineId: routineId };
  }

  if (existing) await fullCleanup();
  const fresh = createFreshAr(target);
  await saveActiveRoutine(fresh);
  await AsyncStorage.setItem(IS_ROUTINE_ACTIVE_KEY, 'true').catch(() => {});
  await scheduleBackgroundNotif(target, fresh);
  await startOrUpdateLiveActivity(target, fresh);
  return { kind: 'started', ar: fresh, routine: target };
}

/**
 * 현재 step 종료 처리.
 * - 세션 기록 (중복 방지: awaitingConfirm 플래그)
 * - 배경 알림 정리
 * - 다음 step 계산 후 ActiveRoutine 갱신
 */
export async function completeCurrentMission(): Promise<MissionEndResult | null> {
  const ar = await loadActiveRoutine();
  if (!ar) return null;
  const routine = await findRoutine(ar.routineId);
  if (!routine) {
    await fullCleanup();
    return null;
  }

  if (!ar.awaitingConfirm) {
    await recordStepSession(routine, ar.currentStepIndex);
  }

  // v1.6 hotfix — 단일 timer #2 와 동일 안티 패턴 제거. cancelBackgroundNotif 호출 시
  // AlarmKit alerting UI 즉시 dismiss 됨 (preempt cancel). 사용자 stop / 다음 진행 누름까지 alerting 지속이 정공.
  // 다음 step 등록 시 scheduleBackgroundNotif 가 currentConfirmPromptId 자동 cancel + 재등록 → 중복 ❌.
  // stop 시 fullCleanup 가 cancel.
  // await cancelBackgroundNotif();  // ← 제거

  // v1.6 Phase 12 — auto 분기 제거. 모든 endMethod 가 confirm 처리 (사용자 stop/dismiss/위젯 advance 후 진행).
  if (!ar.awaitingConfirm) {
    const pending: ActiveRoutine = { ...ar, awaitingConfirm: true };
    await saveActiveRoutine(pending);
    return { kind: 'advance_confirm', ar: pending, routine };
  }
  return { kind: 'advance_confirm', ar, routine };
}

/**
 * v1.6 Phase 12 — 위젯 "다음 진행" Button (AdvanceNextStepIntent) perform 후 호출.
 * confirmAndAdvance 와 동일 흐름 + routineId 검증.
 */
export async function advanceRoutineFromLA(routineId: string): Promise<MissionEndResult | null> {
  const ar = await loadActiveRoutine();
  if (!ar || ar.routineId !== routineId) return null;
  return await confirmAndAdvance();
}

/**
 * 확인 후 진행 모드: 사용자 dismiss → "다음 step 시작" 탭.
 */
export async function confirmAndAdvance(): Promise<MissionEndResult | null> {
  const ar = await loadActiveRoutine();
  if (!ar) return null;
  const routine = await findRoutine(ar.routineId);
  if (!routine) {
    await fullCleanup();
    return null;
  }

  const nextIdx = ar.currentStepIndex + 1;
  if (nextIdx >= routine.steps.length) {
    await fullCleanup();
    return { kind: 'end', routine };
  }

  const nextStep = routine.steps[nextIdx];
  const durationMs = Math.max(0, nextStep.durationSeconds) * 1000;
  const now = Date.now();
  const nextAr: ActiveRoutine = {
    ...ar,
    currentStepIndex: nextIdx,
    stepEndAt: now + durationMs,
    pausedAt: null,
    awaitingConfirm: false,
  };
  await saveActiveRoutine(nextAr);
  await scheduleBackgroundNotif(routine, nextAr);
  await startOrUpdateLiveActivity(routine, nextAr);
  return { kind: 'advance_auto', ar: nextAr, routine };
}

/** 일시정지. */
export async function pauseRoutine(): Promise<ActiveRoutine | null> {
  const ar = await loadActiveRoutine();
  if (!ar || ar.pausedAt !== null) return ar;
  const paused: ActiveRoutine = { ...ar, pausedAt: Date.now() };
  await saveActiveRoutine(paused);
  await cancelBackgroundNotif();
  // v1.6 발견 #D — pause 시 LA 종료 (잠금화면 카운트다운 진행 표시 ↔ 실제 알람 X 혼란 차단).
  // resume 시 reinstallChainsIfAuto + startOrUpdateLiveActivity 가 자동 재시작.
  await endLiveActivity();
  return paused;
}

/** 재개. */
export async function resumeRoutine(): Promise<ActiveRoutine | null> {
  const ar = await loadActiveRoutine();
  if (!ar || ar.pausedAt === null) return ar;
  const routine = await findRoutine(ar.routineId);
  if (!routine) return null;
  const now = Date.now();
  const pauseDuration = now - ar.pausedAt;
  const resumed: ActiveRoutine = {
    ...ar,
    stepEndAt: ar.stepEndAt + pauseDuration,
    pausedAt: null,
  };
  await saveActiveRoutine(resumed);
  await scheduleBackgroundNotif(routine, resumed);
  await startOrUpdateLiveActivity(routine, resumed);
  return resumed;
}

/** 전체 중단. */
export async function stopRoutine(): Promise<void> {
  await fullCleanup();
}

/**
 * v1.6 Phase 10-D — LA Intent (PauseRoutineIntent) 처리 후 RN 측 ar 동기화 만.
 * LA Intent 가 이미 AlarmKit pause(id:) 직접 호출 + Activity update paused:true 처리.
 * → RN 은 ar.pausedAt 만 갱신. chain alarm 재조작 X / endLiveActivity X.
 *
 * @param pauseTimestamp  signal.timestamp = LA Intent perform 시점.
 *                        RN polling 시점이 아닌 실제 사용자 LA 누름 시점 사용 (위험 #X 정정).
 */
export async function pauseRoutineFromLA(pauseTimestamp: number): Promise<ActiveRoutine | null> {
  const ar = await loadActiveRoutine();
  if (!ar || ar.pausedAt !== null) return ar;
  const paused: ActiveRoutine = { ...ar, pausedAt: pauseTimestamp };
  await saveActiveRoutine(paused);
  return paused;
}

/**
 * v1.6 Phase 10-D — LA Intent (ResumeRoutineIntent) 처리 후 RN 측 ar 동기화 만.
 * LA Intent 가 이미 AlarmKit resume(id:) 호출 + Activity update paused:false.
 * → RN 은 ar.stepEndAt shift + pausedAt=null 만. chain alarm 재예약 X.
 *
 * @param resumeTimestamp  signal.timestamp = LA Intent perform 시점.
 *                         pauseDuration = resumeTimestamp - ar.pausedAt 정확 계산 (위험 #X 정정).
 */
export async function resumeRoutineFromLA(resumeTimestamp: number): Promise<ActiveRoutine | null> {
  const ar = await loadActiveRoutine();
  if (!ar || ar.pausedAt === null) return ar;
  const pauseDuration = Math.max(0, resumeTimestamp - ar.pausedAt);
  const resumed: ActiveRoutine = {
    ...ar,
    stepEndAt: ar.stepEndAt + pauseDuration,
    pausedAt: null,
  };
  await saveActiveRoutine(resumed);
  return resumed;
}

/**
 * 앱 기동 또는 포그라운드 복귀 시 호출.
 */
export async function restoreRoutineState(): Promise<RestoreResult> {
  const ar = await loadActiveRoutine();
  if (!ar) return { kind: 'none' };

  const routine = await findRoutine(ar.routineId);
  if (!routine) {
    await fullCleanup();
    return { kind: 'none' };
  }

  if (Date.now() > ar.deadlineAt) {
    await fullCleanup();
    return { kind: 'expired' };
  }

  // v1.6 위험 #C — cold-start 시 stale LA cleanup. currentLiveActivityId = null + 시스템 측 살아 있을 때
  // startOrUpdateLiveActivity 의 start 호출이 새 LA 추가 → 두 LA 동시 위험. endAll 로 멱등성 보장.
  // routine + timer 동시 active 차단됨 (overrideTimer/timerBlocked) → endAll 안전.
  try {
    if (LiveActivityBridge.areActivitiesEnabled()) {
      await LiveActivityBridge.endAll().catch(() => {});
    }
  } catch {}

  await AsyncStorage.setItem(IS_ROUTINE_ACTIVE_KEY, 'true').catch(() => {});

  if (ar.awaitingConfirm) {
    return { kind: 'alarm', routineId: routine.id };
  }

  if (ar.pausedAt !== null) {
    return { kind: 'run', routineId: routine.id };
  }

  // v1.6 옵션 A: BG/KILL 자동 진행 후 사용자 복귀 — 시간 차이만큼 다회 진행 처리.
  // 시스템 측 chain 알람은 시간이 되면 자동 fire 됐을 것. ar.currentStepIndex 만 갱신 안 된 상태.
  let cur: ActiveRoutine = ar;
  while (Date.now() >= cur.stepEndAt) {
    const result = await completeCurrentMission();
    if (!result) return { kind: 'none' };
    if (result.kind === 'end') return { kind: 'none' };
    if (result.kind === 'advance_confirm') return { kind: 'alarm', routineId: routine.id };
    cur = result.ar;
  }

  await scheduleBackgroundNotif(routine, cur);
  await startOrUpdateLiveActivity(routine, cur);
  return { kind: 'run', routineId: routine.id };
}
