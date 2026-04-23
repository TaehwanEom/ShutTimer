// v1.6 리팩토링: 루틴 상태 전환 단일 진입점.
// 모든 상태 변경은 이 파일 export 함수를 통해서만 발생.
// 목적: ActiveRoutine + isRoutineActive flag + 알림 id + 세션 기록이
//       여러 UI 경로(포그라운드 tick / 배경 알림 / 사용자 수동 dismiss / 콜드 스타트)에서
//       일관되게 처리되도록.

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  Routine,
  ActiveRoutine,
  ROUTINE_DEADLINE_MS,
  loadRoutines,
  loadActiveRoutine,
  saveActiveRoutine,
  clearActiveRoutine,
  recordMissionSession,
} from '../constants/routines';
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
  | { kind: 'needs_timer_override' }  // 단일 타이머 진행 중
  | { kind: 'not_found' };

export type MissionEndResult =
  | { kind: 'advance_auto'; ar: ActiveRoutine; routine: Routine }    // 자동 진행 — 다음 미션 시작됨
  | { kind: 'advance_confirm'; ar: ActiveRoutine; routine: Routine } // 확인 후 진행 — RoutineAlarm 필요
  | { kind: 'end'; routine: Routine };                               // 전체 루틴 종료

export type RestoreResult =
  | { kind: 'none' }
  | { kind: 'expired' }                                              // 24시간 초과
  | { kind: 'run'; routineId: string }                               // RoutineRun 복원
  | { kind: 'alarm'; routineId: string };                            // 미션 종료 지났음 + 확인 후 진행 → RoutineAlarm

// ─── 내부 헬퍼 ───────────────────────────────────────────────

function createFreshAr(r: Routine): ActiveRoutine {
  const now = Date.now();
  const firstStep = r.missions[0];
  return {
    routineId: r.id,
    currentLoop: 1,
    currentStepIndex: 0,
    stepEndAt: now + (firstStep?.durationMinutes ?? 1) * 60 * 1000,
    pausedAt: null,
    startedAt: now,
    deadlineAt: now + ROUTINE_DEADLINE_MS,
    awaitingConfirm: false,
  };
}

/** 현재 미션 종료 시점에 발화할 배경 알림 예약. autoAdvance 따라 chain/confirmPrompt 분기. */
async function scheduleBackgroundNotif(r: Routine, ar: ActiveRoutine): Promise<void> {
  await cancelBackgroundNotif();
  if (ar.pausedAt !== null) return; // pause 중엔 예약 안 함
  const fireAt = new Date(ar.stepEndAt);

  if (r.autoAdvance) {
    let nextIdx = ar.currentStepIndex + 1;
    let nextLoop = ar.currentLoop;
    if (nextIdx >= r.missions.length) { nextLoop += 1; nextIdx = 0; }
    // 마지막 미션이면 체인 알림 없음 (어차피 advanceToNext 호출 안 됨)
    if (nextLoop <= r.loopCount) {
      const id = await scheduleRoutineChain(r.id, nextLoop, nextIdx, fireAt);
      currentChainNotifId = id;
    }
  } else {
    // 확인 후 진행 — 마지막 미션이라도 미션 종료 알림 필요 (RoutineAlarm 유도)
    const id = await scheduleRoutineConfirmPrompt(r.id, fireAt);
    currentConfirmPromptId = id;
  }
}

/** 배경 알림 전부 취소. */
async function cancelBackgroundNotif(): Promise<void> {
  if (currentChainNotifId) {
    await cancelRoutineChain(currentChainNotifId);
    currentChainNotifId = null;
  }
  if (currentConfirmPromptId) {
    await cancelRoutineConfirmPrompt(currentConfirmPromptId);
    currentConfirmPromptId = null;
  }
}

/** 루틴 찾기 헬퍼. */
async function findRoutine(routineId: string): Promise<Routine | null> {
  const list = await loadRoutines();
  return list.find(r => r.id === routineId) ?? null;
}

/** 루틴 전체 정리 — ActiveRoutine + flag + 배경 알림. */
async function fullCleanup(): Promise<void> {
  await cancelBackgroundNotif();
  await clearActiveRoutine();
  await AsyncStorage.removeItem(IS_ROUTINE_ACTIVE_KEY).catch(() => {});
}

// ─── 공개 API ───────────────────────────────────────────────

/**
 * 루틴 시작 (또는 같은 루틴 복원).
 * 다른 루틴 진행 중이면 needs_override 반환. 호출자가 사용자 확인 후 overrideActive=true로 재호출.
 * 단일 타이머 진행 중이면 needs_timer_override 반환. 호출자가 사용자 확인 후 overrideTimer=true로 재호출.
 */
export async function startRoutine(
  routineId: string,
  options: { overrideActive?: boolean; overrideTimer?: boolean } = {}
): Promise<StartRoutineResult> {
  const target = await findRoutine(routineId);
  if (!target) return { kind: 'not_found' };

  // 단일 타이머 상호 배타
  const activeTimerRaw = await AsyncStorage.getItem(ACTIVE_TIMER_KEY);
  if (activeTimerRaw && !options.overrideTimer) {
    return { kind: 'needs_timer_override' };
  }
  if (activeTimerRaw && options.overrideTimer) {
    await AsyncStorage.removeItem(ACTIVE_TIMER_KEY).catch(() => {});
    await AsyncStorage.removeItem(IS_TIMER_ACTIVE_KEY).catch(() => {});
  }

  const existing = await loadActiveRoutine();

  // 같은 루틴 복원
  if (existing && existing.routineId === routineId) {
    // 24시간 데드라인 체크
    if (Date.now() > existing.deadlineAt) {
      await fullCleanup();
      const fresh = createFreshAr(target);
      await saveActiveRoutine(fresh);
      await AsyncStorage.setItem(IS_ROUTINE_ACTIVE_KEY, 'true').catch(() => {});
      await scheduleBackgroundNotif(target, fresh);
      return { kind: 'started', ar: fresh, routine: target };
    }
    await AsyncStorage.setItem(IS_ROUTINE_ACTIVE_KEY, 'true').catch(() => {});
    // pause 상태 아니면 배경 알림 재예약 (stepEndAt 기준)
    if (existing.pausedAt === null && !existing.awaitingConfirm) {
      await scheduleBackgroundNotif(target, existing);
    }
    return { kind: 'resumed', ar: existing, routine: target };
  }

  // 다른 루틴 진행 중 — override 확인 필요
  if (existing && existing.routineId !== routineId && !options.overrideActive) {
    return { kind: 'needs_override', existingRoutineId: existing.routineId, newRoutineId: routineId };
  }

  // override 확정 또는 existing 없음 — 기존 정리 후 신규
  if (existing) await fullCleanup();
  const fresh = createFreshAr(target);
  await saveActiveRoutine(fresh);
  await AsyncStorage.setItem(IS_ROUTINE_ACTIVE_KEY, 'true').catch(() => {});
  await scheduleBackgroundNotif(target, fresh);
  return { kind: 'started', ar: fresh, routine: target };
}

/**
 * 현재 미션 종료 처리.
 * - 세션 기록 (중복 방지: awaitingConfirm 플래그)
 * - 배경 알림 정리
 * - 다음 미션 계산 후 ActiveRoutine 갱신
 *
 * 호출 경로:
 *  (a) RoutineRun tick → 포그라운드 미션 종료
 *  (b) RoutineRun AppState 'active' 복귀 → stepEndAt 이미 지남
 *  (c) RoutineAlarm 배경 알림으로 마운트 → 이미 종료됐어야 할 상태 복구
 *  (d) restoreRoutineState → 콜드 스타트에서 stepEndAt 지났음 감지
 */
export async function completeCurrentMission(): Promise<MissionEndResult | null> {
  const ar = await loadActiveRoutine();
  if (!ar) return null;
  const routine = await findRoutine(ar.routineId);
  if (!routine) {
    await fullCleanup();
    return null;
  }

  // 중복 방지: awaitingConfirm이 이미 true면 세션 기록 skip
  if (!ar.awaitingConfirm) {
    await recordMissionSession(routine, ar.currentStepIndex);
  }

  await cancelBackgroundNotif();

  const nextIdx = ar.currentStepIndex + 1;
  const hasNextInLoop = nextIdx < routine.missions.length;
  const hasNextLoop = ar.currentLoop < routine.loopCount;
  const isEnding = !hasNextInLoop && !hasNextLoop;

  // F3: 마지막 미션이라도 autoAdvance=false면 RoutineAlarm 경유 (dismiss 유도)
  if (isEnding && routine.autoAdvance) {
    await fullCleanup();
    return { kind: 'end', routine };
  }

  if (routine.autoAdvance) {
    // 자동 진행 — 다음 미션 즉시 시작
    let ni = ar.currentStepIndex + 1;
    let nl = ar.currentLoop;
    if (ni >= routine.missions.length) { nl += 1; ni = 0; }
    const step = routine.missions[ni];
    const now = Date.now();
    const nextAr: ActiveRoutine = {
      ...ar,
      currentStepIndex: ni,
      currentLoop: nl,
      stepEndAt: now + step.durationMinutes * 60 * 1000,
      pausedAt: null,
      awaitingConfirm: false,
    };
    await saveActiveRoutine(nextAr);
    await scheduleBackgroundNotif(routine, nextAr);
    return { kind: 'advance_auto', ar: nextAr, routine };
  } else {
    // 확인 후 진행 — awaitingConfirm=true 저장. UI가 RoutineAlarm 이동
    if (!ar.awaitingConfirm) {
      const pending: ActiveRoutine = { ...ar, awaitingConfirm: true };
      await saveActiveRoutine(pending);
      return { kind: 'advance_confirm', ar: pending, routine };
    }
    return { kind: 'advance_confirm', ar, routine };
  }
}

/**
 * 확인 후 진행 모드: 사용자 dismiss → "다음 미션 시작" 탭.
 * 다음 미션을 준비하거나 루틴 종료.
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
  const hasNextInLoop = nextIdx < routine.missions.length;
  const hasNextLoop = ar.currentLoop < routine.loopCount;

  if (!hasNextInLoop && !hasNextLoop) {
    await fullCleanup();
    return { kind: 'end', routine };
  }

  let ni = ar.currentStepIndex + 1;
  let nl = ar.currentLoop;
  if (ni >= routine.missions.length) { nl += 1; ni = 0; }
  const step = routine.missions[ni];
  const now = Date.now();
  const nextAr: ActiveRoutine = {
    ...ar,
    currentStepIndex: ni,
    currentLoop: nl,
    stepEndAt: now + step.durationMinutes * 60 * 1000,
    pausedAt: null,
    awaitingConfirm: false,
  };
  await saveActiveRoutine(nextAr);
  await scheduleBackgroundNotif(routine, nextAr);
  return { kind: 'advance_auto', ar: nextAr, routine };
}

/** 일시정지. 배경 알림 취소 + pausedAt 기록. */
export async function pauseRoutine(): Promise<ActiveRoutine | null> {
  const ar = await loadActiveRoutine();
  if (!ar || ar.pausedAt !== null) return ar;
  const paused: ActiveRoutine = { ...ar, pausedAt: Date.now() };
  await saveActiveRoutine(paused);
  await cancelBackgroundNotif();
  return paused;
}

/** 재개. pause 동안 흐른 시간만큼 stepEndAt 연장 + 배경 알림 재예약. */
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

/** 전체 중단. 완전 정리. */
export async function stopRoutine(): Promise<void> {
  await fullCleanup();
}

/**
 * 앱 기동 또는 포그라운드 복귀 시 호출.
 * ActiveRoutine 상태 검사하여 UI가 어디로 이동해야 할지 결정.
 */
export async function restoreRoutineState(): Promise<RestoreResult> {
  const ar = await loadActiveRoutine();
  if (!ar) return { kind: 'none' };

  const routine = await findRoutine(ar.routineId);
  if (!routine) {
    await fullCleanup();
    return { kind: 'none' };
  }

  // 24시간 데드라인
  if (Date.now() > ar.deadlineAt) {
    await fullCleanup();
    return { kind: 'expired' };
  }

  await AsyncStorage.setItem(IS_ROUTINE_ACTIVE_KEY, 'true').catch(() => {});

  // awaitingConfirm 중이면 RoutineAlarm
  if (ar.awaitingConfirm) {
    return { kind: 'alarm', routineId: routine.id };
  }

  // pause 중이면 RoutineRun (일반 복원)
  if (ar.pausedAt !== null) {
    return { kind: 'run', routineId: routine.id };
  }

  // 미션 종료 지났는데 완료 처리 안 된 상태
  if (Date.now() >= ar.stepEndAt) {
    const result = await completeCurrentMission();
    if (!result) return { kind: 'none' };
    if (result.kind === 'end') return { kind: 'none' };
    if (result.kind === 'advance_confirm') return { kind: 'alarm', routineId: routine.id };
    if (result.kind === 'advance_auto') return { kind: 'run', routineId: routine.id };
  }

  // 일반 복원 — 배경 알림 재예약 (안전장치)
  await scheduleBackgroundNotif(routine, ar);
  return { kind: 'run', routineId: routine.id };
}
