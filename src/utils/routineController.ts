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
  scheduleRoutineChain,
  cancelRoutineChain,
  scheduleRoutineConfirmPrompt,
  cancelRoutineConfirmPrompt,
} from './routineScheduler';

const IS_ROUTINE_ACTIVE_KEY = 'isRoutineActive';
const ACTIVE_TIMER_KEY = 'activeTimer';
const IS_TIMER_ACTIVE_KEY = 'isTimerActive';

// 현재 예약된 배경 알림 id — 모듈 레벨에서 보관 (UI 마운트/언마운트와 독립)
let currentChainNotifId: string | null = null;
let currentConfirmPromptId: string | null = null;

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

/** 현재 step 종료 시점에 발화할 배경 알림 예약. endMethod === 'auto' 면 chain, 그 외엔 confirmPrompt 분기. */
async function scheduleBackgroundNotif(r: Routine, ar: ActiveRoutine): Promise<void> {
  await cancelBackgroundNotif();
  if (ar.pausedAt !== null) return;
  const fireAt = new Date(ar.stepEndAt);

  if (r.endMethod === 'auto') {
    const nextIdx = ar.currentStepIndex + 1;
    // 마지막 step이면 체인 알림 없음 (advanceToNext 호출 안 됨)
    if (nextIdx < r.steps.length) {
      const id = await scheduleRoutineChain(r.id, nextIdx, fireAt);
      currentChainNotifId = id;
    }
  } else {
    // 확인 후 진행 — 마지막 step이라도 종료 알림 필요 (RoutineAlarm 유도)
    const id = await scheduleRoutineConfirmPrompt(r.id, fireAt);
    currentConfirmPromptId = id;
  }
}

async function cancelBackgroundNotif(): Promise<void> {
  if (currentChainNotifId) {
    await cancelRoutineChain(currentChainNotifId);
    currentChainNotifId = null;
  }
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
}

async function findRoutine(routineId: string): Promise<Routine | null> {
  const list = await loadRoutines();
  return list.find(r => r.id === routineId) ?? null;
}

async function fullCleanup(): Promise<void> {
  await cancelBackgroundNotif();
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
      return { kind: 'started', ar: fresh, routine: target };
    }
    await AsyncStorage.setItem(IS_ROUTINE_ACTIVE_KEY, 'true').catch(() => {});
    if (existing.pausedAt === null && !existing.awaitingConfirm) {
      await scheduleBackgroundNotif(target, existing);
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

  await cancelBackgroundNotif();

  const nextIdx = ar.currentStepIndex + 1;
  const isEnding = nextIdx >= routine.steps.length;

  if (isEnding && routine.endMethod === 'auto') {
    await fullCleanup();
    return { kind: 'end', routine };
  }

  if (routine.endMethod === 'auto') {
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
    return { kind: 'advance_auto', ar: nextAr, routine };
  } else {
    if (!ar.awaitingConfirm) {
      const pending: ActiveRoutine = { ...ar, awaitingConfirm: true };
      await saveActiveRoutine(pending);
      return { kind: 'advance_confirm', ar: pending, routine };
    }
    return { kind: 'advance_confirm', ar, routine };
  }
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
  return { kind: 'advance_auto', ar: nextAr, routine };
}

/** 일시정지. */
export async function pauseRoutine(): Promise<ActiveRoutine | null> {
  const ar = await loadActiveRoutine();
  if (!ar || ar.pausedAt !== null) return ar;
  const paused: ActiveRoutine = { ...ar, pausedAt: Date.now() };
  await saveActiveRoutine(paused);
  await cancelBackgroundNotif();
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
  return resumed;
}

/** 전체 중단. */
export async function stopRoutine(): Promise<void> {
  await fullCleanup();
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

  await AsyncStorage.setItem(IS_ROUTINE_ACTIVE_KEY, 'true').catch(() => {});

  if (ar.awaitingConfirm) {
    return { kind: 'alarm', routineId: routine.id };
  }

  if (ar.pausedAt !== null) {
    return { kind: 'run', routineId: routine.id };
  }

  if (Date.now() >= ar.stepEndAt) {
    const result = await completeCurrentMission();
    if (!result) return { kind: 'none' };
    if (result.kind === 'end') return { kind: 'none' };
    if (result.kind === 'advance_confirm') return { kind: 'alarm', routineId: routine.id };
    if (result.kind === 'advance_auto') return { kind: 'run', routineId: routine.id };
  }

  await scheduleBackgroundNotif(routine, ar);
  return { kind: 'run', routineId: routine.id };
}
