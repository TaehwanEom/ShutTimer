// v1.6 리팩토링: 루틴 상태 전환 단일 진입점.
// 모든 상태 변경은 이 파일 export 함수를 통해서만 발생.
// Phase 1+2: steps 기반 데이터 모델로 타입 보정. 로직 유지. loopCount/missions 제거.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { DeviceEventEmitter } from 'react-native';
import {
  Routine,
  ActiveRoutine,
  ROUTINE_DEADLINE_MS,
  loadRoutines,
  loadActiveRoutine,
  PENDING_DISABLED_ALARMS_KEY,
} from '../constants/routines';
import { loadAlarms, upsertAlarm } from '../constants/alarms';
import { syncAllAlarms } from './alarmScheduler';
import { clearPreloadedSound } from './alarmSoundPreload';
import { requestAlarmKitAuthorizationIfNeeded } from './routineScheduler';
import { Logger } from './logger';
import {
  writeRoutineSnapshot,
  readRoutineSnapshot,
  type RoutineSnapshot,
} from './appGroupSync';
// v2.0 C.4 — Session dispatch 부수 호출용. routineController → SessionController 단방향.
import { dispatch as sessionDispatch, getCurrentSession } from '../state/SessionController';
// v2.0 C.D — startRoutine wrapper 측 Session → ActiveRoutine 변환 (옛 createFreshAr 등가).
import { sessionToActiveRoutine, SESSION_EVENT_NAVIGATE } from '../state/effectRunner';
import { Step as SessionStep } from '../types/session';
// v2.0 C.D 우선순위 3 — ad_hoc kind 분기 (sessionId prefix 측 판단)
import { isAdhocAlarmRoutine } from './alarmRoutineLink';

const IS_ROUTINE_ACTIVE_KEY = 'isRoutineActive';
const ACTIVE_TIMER_KEY = 'activeTimer';
const IS_TIMER_ACTIVE_KEY = 'isTimerActive';

// v2.0 C — 옛 모듈 변수 (currentConfirmPromptId / lastScheduleKey / lastScheduleAt) 폐기.
//   effectRunner.ts 측 currentRunningAlarmId / lastScheduleKey / lastScheduleAt 으로 통합 (옛 DupSched 가드 등가).

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

// v2.0 C — createFreshAr / scheduleBackgroundNotif / mirrorRoutineSnapshot / cancelBackgroundNotif 폐기.
//   효과 = effectRunner.ts 측 effect 처리로 통합.
//     createFreshAr            → transition Start (새 session 생성)
//     scheduleBackgroundNotif  → ScheduleConfirmPrompt effect + WriteRoutineSnapshot effect + DupSched 가드
//     mirrorRoutineSnapshot    → WriteRoutineSnapshot effect (sound 매핑 + i18n + autoCountdownSec 포함)
//     cancelBackgroundNotif    → ClearActiveRoutine effect (chain/confirm_prompt cancel + snapshot 정리)

/**
 * v1.6 hotfix — autoCountdownSec 0~60 clamp. default 5.
 * routine.autoCountdownSec 미지정 시 default. 범위 외 시 clamp.
 */
export function clampCountdown(sec: number | undefined): number {
  const v = typeof sec === 'number' ? sec : 5;
  return Math.max(0, Math.min(60, Math.floor(v)));
}

async function findRoutine(routineId: string): Promise<Routine | null> {
  const list = await loadRoutines();
  return list.find(r => r.id === routineId) ?? null;
}

// v1.7 hotfix #LAUnify Phase 10-G1 — startOrUpdateLiveActivity / setLiveActivityStage / endLiveActivity 함수 폐기.
// AlarmKit framework가 .timer/.alarm factory 호출 시 자동으로 LA Activity를 시작/갱신/종료한다.
// 옛 LiveActivityBridge 모듈은 별도 ActivityKit Activity를 manual 관리하던 영역으로 두 LA 시스템이 충돌
// → areActivitiesEnabled=false 강제 땜빵 + 검정 바 root cause. 본 G1에서 모듈 통째 폐기.

// v2.0 P2-3 — markAwaitingConfirm 본체 폐기 (dual SoT 해소).
//   기능 등가 = transition OnAlarmFire(confirm_prompt) 측 effect:
//     - SaveActiveRoutine effect → 옛 ar mirror 측 awaitingConfirm=true 갱신
//     - EmitEvent('routineAwaitingConfirmExternally') → ActiveRoutineSection subAwaitingConfirm listener 호환
//   caller (App.tsx line 405, 497) 측 dispatch onAlarmFire(confirm_prompt) 호출로 통합.

// v1.6 Phase 12 — reinstallChainsIfAuto 함수 제거 (auto 모드 영구 미사용).

// v1.8 #AlarmTimerConflict — 단일 타이머 종료 시점에서도 호출 가능한 공용 복원 함수.
// AlarmScreen goHome 측 측 단일 타이머 dismiss 시 직접 호출.
export async function restorePendingDisabledAlarms(): Promise<void> {
  try {
    const pendingRaw = await AsyncStorage.getItem(PENDING_DISABLED_ALARMS_KEY);
    if (!pendingRaw) return;
    const pendingIds: string[] = JSON.parse(pendingRaw);
    if (pendingIds.length > 0) {
      const alarms = await loadAlarms();
      for (const id of pendingIds) {
        const target = alarms.find(a => a.id === id);
        if (target && !target.enabled) {
          await upsertAlarm({ ...target, enabled: true });
        }
      }
      await syncAllAlarms();
    }
    await AsyncStorage.removeItem(PENDING_DISABLED_ALARMS_KEY);
  } catch (e) {
    Logger.warn('routine', `pendingDisabledAlarms restore fail err=${String(e)}`);
  }
}

// v2.0 C — fullCleanup 폐기.
//   효과 = transition Stop 측 effects (ClearActiveRoutine + SetIsRoutineActive(false) + RestorePendingDisabled +
//   CancelAlarmChain + EmitEvent) 일괄. ClearActiveRoutine effect 강화 (chain/confirm_prompt cancel + snapshot 정리).

// ─── 공개 API ───────────────────────────────────────────────

/**
 * 루틴 시작 (또는 같은 루틴 복원).
 * 다른 루틴 진행 중이면 needs_override. 단일 타이머 진행 중이면 needs_timer_override.
 */
/**
 * v2.0 C.D — startRoutine 본체 폐기. dispatch(Start) 단독 + dispatch(Resync) 단독으로 통합.
 *   옛 본체 (createFreshAr / saveActiveRoutine / IS_ROUTINE_ACTIVE_KEY / scheduleBackgroundNotif) 직접 호출 0.
 *   가드 (findRoutine / activeTimer / existing) + return kind 매핑은 wrapper 측 유지 — caller 영향 X.
 */
export async function startRoutine(
  routineId: string,
  options: { overrideActive?: boolean; overrideTimer?: boolean } = {}
): Promise<StartRoutineResult> {
  const target = await findRoutine(routineId);
  if (!target) return { kind: 'not_found' };

  // v1.7 hotfix Phase 13 G4-D-1 — AlarmKit 측 권한 자동 검증.
  try {
    await requestAlarmKitAuthorizationIfNeeded();
  } catch {}

  // 단일 timer 충돌 가드 (옛 ACTIVE_TIMER_KEY 측 — timer kind 통합 전 잔존)
  const activeTimerRaw = await AsyncStorage.getItem(ACTIVE_TIMER_KEY);
  if (activeTimerRaw && !options.overrideTimer) {
    return { kind: 'needs_timer_override' };
  }
  if (activeTimerRaw && options.overrideTimer) {
    await AsyncStorage.removeItem(ACTIVE_TIMER_KEY).catch(() => {});
    await AsyncStorage.removeItem(IS_TIMER_ACTIVE_KEY).catch(() => {});
    await clearPreloadedSound().catch(() => {});
    DeviceEventEmitter.emit('timerCancelledExternally');
  }

  // Fix B (2026-05-26) — stale non-routine session (= timer / simple_alarm) 측 = 잔존 시 강제 Stop.
  //   원인: timer / simple_alarm 측 Dismiss → CONFIRMING 전이만. Advance/Stop 미dispatch 시 session 영구 잔존.
  //   증상: 사용자 측 timer 발화 → 미션 풀고 dismiss → 루틴 ▶ → dispatch(Start) currentState=CONFIRMING → "Start rejected — existing session" → 화면 변화 0 = 먹통.
  //   정정: routine ▶ 진입 시 = 잔존 timer/simple_alarm session 측 = 명시 Stop dispatch (= ActiveRoutine 비관여 영역).
  //   Fix A (AlarmScreen goHome) 측 = root cause 정리. 본 안전망 = AlarmScreen 미경유 path (= 외부 stop / 강종 등) 측 보강.
  {
    const preSession = await getCurrentSession();
    if (preSession && (preSession.kind === 'timer' || preSession.kind === 'simple_alarm')) {
      Logger.warn(
        'routine',
        `startRoutine stale non-routine session detected kind=${preSession.kind} state=${preSession.state} → dispatch Stop`
      );
      await sessionDispatch({ type: 'Stop', reason: 'override' }).catch(() => {});
    }
  }

  const existing = await loadActiveRoutine();

  if (existing && existing.routineId === routineId) {
    if (Date.now() > existing.deadlineAt) {
      // deadline 만료 → 새 session (replaceExisting=true → transition 측 CancelAlarmChain + 새 session 생성)
      const ar = await dispatchStartRoutine(target, true);
      return { kind: 'started', ar, routine: target };
    }
    // v2.0 P2-5 fallback — session=null + 옛 ar 잔존 case 안전망.
    //   invariant 깨짐 case (SaveActiveRoutine effect 실패 / 마이그레이션 결손) 측 Resync 무력 회피.
    //   session=null 시 dispatch Start (replaceExisting=true) → 새 session 생성.
    const session = await getCurrentSession();
    if (!session) {
      Logger.warn(
        'routine',
        `startRoutine 'resumed' 분기 session=null fallback → dispatch Start replaceExisting=true routineId=${routineId}`
      );
      const ar = await dispatchStartRoutine(target, true);
      return { kind: 'started', ar, routine: target };
    }
    // 진행 중 routine 재호출 → Resync (옛 'resumed' 분기 등가)
    await sessionDispatch({ type: 'Resync' }).catch(() => {});
    return { kind: 'resumed', ar: existing, routine: target };
  }

  if (existing && existing.routineId !== routineId && !options.overrideActive) {
    return { kind: 'needs_override', existingRoutineId: existing.routineId, newRoutineId: routineId };
  }

  // existing X 또는 existing && override → 새 session 생성
  const ar = await dispatchStartRoutine(target, existing != null);
  return { kind: 'started', ar, routine: target };
}

/**
 * v2.0 C.D — Routine → SessionAction(Start) 변환 + dispatch + ar 재구성.
 *   본 helper 가 routine kind session 진입 단일 경로.
 *   transition Start 측 effect (CancelAlarmChain / ScheduleConfirmPrompt / WriteRoutineSnapshot /
 *   SetIsRoutineActive / SaveActiveRoutine / CancelRoutinePrealerts) 가 옛 startRoutine 본체 부수 동작 일괄 흡수.
 */
async function dispatchStartRoutine(r: Routine, replaceExisting: boolean): Promise<ActiveRoutine> {
  const steps: SessionStep[] = r.steps.map((s, idx) => ({
    index: idx,
    name: s.name,
    durationSeconds: s.durationSeconds,
    endMethod: r.endMethod,
    soundName: '',
  }));
  // v2.0 우선순위 3 — ad_hoc routine (sessionId prefix `aa_a_`) 분기. SessionKind 의미 정합.
  const sessionKind = isAdhocAlarmRoutine(r.id) ? 'ad_hoc_routine' : 'routine';
  await sessionDispatch({
    type: 'Start',
    kind: sessionKind,
    sessionId: r.id,
    steps,
    replaceExisting,
    deadlineAt: Date.now() + ROUTINE_DEADLINE_MS,
    routineName: r.name ?? r.category,
    autoCountdownSec: r.autoCountdownSec,
    laMeta: {
      routineName: r.name ?? r.category,
      stepName: r.steps[0]?.name ?? '',
      stepIndex: 0,
      totalSteps: r.steps.length,
    },
  });
  const session = await getCurrentSession();
  if (!session) {
    // dispatch 거부 — fallback (이론상 도달 X. existing 매핑 어긋난 경우)
    Logger.warn('routine', `dispatchStartRoutine session null fallback routineId=${r.id}`);
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
  return sessionToActiveRoutine(session);
}

/**
 * v2.0 C.G — completeCurrentMission 본체 폐기. dispatch(OnEndAtReached) 단독.
 *   transition OnEndAtReached (routine/ad_hoc_routine kind) 측 effect (RecordStepSession + SaveActiveRoutine) 가
 *   옛 본체 부수 동작 일괄 흡수. awaitingConfirm=true + state=CONFIRMING 전이.
 */
export async function completeCurrentMission(): Promise<MissionEndResult | null> {
  const ar = await loadActiveRoutine();
  if (!ar) return null;
  const routine = await findRoutine(ar.routineId);
  if (!routine) {
    await sessionDispatch({ type: 'Stop', reason: 'override' }).catch(() => {});
    return null;
  }
  await sessionDispatch({ type: 'OnEndAtReached' }).catch(() => {});
  const session = await getCurrentSession();
  const finalAr = session ? sessionToActiveRoutine(session) : { ...ar, awaitingConfirm: true };
  return { kind: 'advance_confirm', ar: finalAr, routine };
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
 * v2.0 C.H — syncRoutineFromSnapshot 본체 폐기. dispatch(OnSnapshotChange, snapshot 정보) 단독.
 *   transition OnSnapshotChange 측 effect (RecordStepSession 다발 + SaveActiveRoutine + SetCurrentRunningAlarmId + EmitEvent) 가 옛 본체 부수 동작 일괄 흡수.
 *   wrapper 측 책무 = snapshot read + routineEnded 분기 + caller 반환 MissionEndResult 매핑.
 */
export async function syncRoutineFromSnapshot(routineId: string): Promise<MissionEndResult | null> {
  const snapshot = readRoutineSnapshot();
  const ar = await loadActiveRoutine();
  if (!ar || ar.routineId !== routineId) return null;
  const routine = await findRoutine(ar.routineId);
  if (!routine) {
    await sessionDispatch({ type: 'Stop', reason: 'override' }).catch(() => {});
    return null;
  }
  // snapshot 부재 or routineEnded → 종료
  if (!snapshot || snapshot.routineId !== routineId || snapshot.routineEnded === true) {
    Logger.warn(
      'routine-DBG',
      `syncRoutineFromSnapshot-stop 진입 reason=${!snapshot ? 'no-snapshot' : snapshot.routineId !== routineId ? `routineId-mismatch(snap=${snapshot.routineId}, req=${routineId})` : 'routineEnded=true'} snapshot=${JSON.stringify(snapshot)}`
    );
    // 2번 fix (2026-05-25, 사용자 요구) — 위젯 "다음 진행" 누른 후 마지막 step 처리 = 잠금 해제 path 와 동일하게 종료방식 화면 진입.
    //   AdvanceNextStepIntent perform (native) → snapshot.routineEnded=true → 본 분기 진입.
    //   옛 동작: dispatch Stop 만 호출 → routine cleanup 완료. 종료방식 화면 진입 X = §3-B 7번 위반.
    //   정정: routineEnded=true 시 SESSION_EVENT_NAVIGATE Alarm + fromRoutine='last_step' emit → 옵션 A-2 (open_app_dismiss lastStep 분기) 와 동일 흐름.
    //   사용자가 잠금 풀고 들어오면 미션 화면 표시 (= 옵션 A 흐름과 결과 동일).
    if (snapshot?.routineEnded === true) {
      Logger.warn(
        'routine-DBG',
        `lastStep navigate emit routineId=${routineId} endMethod=${routine.endMethod ?? 'tap'}`
      );
      DeviceEventEmitter.emit(SESSION_EVENT_NAVIGATE, {
        target: 'Alarm',
        fromRoutine: 'last_step',
        routineId,
        endMethod: routine.endMethod ?? 'tap',
      });
    }
    await sessionDispatch({ type: 'Stop', reason: 'override' }).catch(() => {});
    return { kind: 'end', routine };
  }
  const completed = snapshot.completedStepIndices ?? [];
  await sessionDispatch({
    type: 'OnSnapshotChange',
    routineId,
    nextStepIndex: snapshot.currentStepIndex,
    stepEndAt: snapshot.stepEndAt,
    currentAlarmId: snapshot.currentAlarmId,
    completedStepIndices: completed,
  }).catch(() => {});
  // snapshot completedStepIndices clear (옛 동작 정합 — 다음 record 누락 회피)
  if (completed.length > 0) {
    const cleared: RoutineSnapshot = { ...snapshot, completedStepIndices: [] };
    writeRoutineSnapshot(cleared);
  }
  const session = await getCurrentSession();
  const finalAr = session
    ? sessionToActiveRoutine(session)
    : {
        ...ar,
        currentStepIndex: snapshot.currentStepIndex,
        stepEndAt: snapshot.stepEndAt,
        pausedAt: null,
        awaitingConfirm: false,
      };
  return { kind: 'advance_auto', ar: finalAr, routine };
}

/**
 * v2.0 C.G — confirmAndAdvance 본체 폐기. dispatch(Advance) 단독.
 *   transition Advance 측 effect (CleanupAlertingAlarms + RecordStepSession + ScheduleConfirmPrompt +
 *   WriteRoutineSnapshot + SaveActiveRoutine + EmitEvent — 마지막 step 시 ClearActiveRoutine + CancelAlarmChain) 가
 *   옛 본체 부수 동작 일괄 흡수.
 */
export async function confirmAndAdvance(): Promise<MissionEndResult | null> {
  const ar = await loadActiveRoutine();
  if (!ar) return null;
  const routine = await findRoutine(ar.routineId);
  if (!routine) {
    await sessionDispatch({ type: 'Stop', reason: 'override' }).catch(() => {});
    return null;
  }
  const nextIdx = ar.currentStepIndex + 1;
  await sessionDispatch({ type: 'Advance' }).catch(() => {});
  if (nextIdx >= routine.steps.length) {
    return { kind: 'end', routine };
  }
  const session = await getCurrentSession();
  if (session) {
    return { kind: 'advance_auto', ar: sessionToActiveRoutine(session), routine };
  }
  // fallback (session null 도달 X. 안전망)
  const nextStep = routine.steps[nextIdx];
  const durationMs = Math.max(0, nextStep.durationSeconds) * 1000;
  const now = Date.now();
  return {
    kind: 'advance_auto',
    ar: {
      ...ar,
      currentStepIndex: nextIdx,
      stepEndAt: now + durationMs,
      pausedAt: null,
      awaitingConfirm: false,
    },
    routine,
  };
}

/** 일시정지. */
/**
 * v2.0 C.E — pauseRoutine 본체 폐기. dispatch(Pause, source:'ui') 단독.
 *   transition Pause 측 effect (PauseAlarmNative + SaveActiveRoutine + EmitEvent) 가 옛 본체 부수 동작 일괄 흡수.
 *   caller 시그니처 보존 — ActiveRoutine | null 반환.
 */
export async function pauseRoutine(): Promise<ActiveRoutine | null> {
  const ar = await loadActiveRoutine();
  if (!ar || ar.pausedAt !== null) return ar;
  const now = Date.now();
  await sessionDispatch({ type: 'Pause', timestamp: now, source: 'ui' }).catch(() => {});
  const session = await getCurrentSession();
  return session ? sessionToActiveRoutine(session) : { ...ar, pausedAt: now };
}

/**
 * v2.0 C.E — resumeRoutine 본체 폐기. dispatch(Resume, source:'ui') 단독.
 *   transition Resume 측 effect (ResumeAlarmNative + SaveActiveRoutine + EmitEvent) 가 옛 본체 부수 동작 일괄 흡수.
 *   stepEndAt shift 는 transition 측 pauseDuration 계산 동등.
 */
export async function resumeRoutine(): Promise<ActiveRoutine | null> {
  const ar = await loadActiveRoutine();
  if (!ar || ar.pausedAt === null) return ar;
  const now = Date.now();
  await sessionDispatch({ type: 'Resume', timestamp: now, source: 'ui' }).catch(() => {});
  const session = await getCurrentSession();
  if (session) return sessionToActiveRoutine(session);
  // fallback (session null 도달 X. 옛 동작 등가 안전망)
  const pauseDuration = now - ar.pausedAt;
  return { ...ar, stepEndAt: ar.stepEndAt + pauseDuration, pausedAt: null };
}

/**
 * v2.0 C.F — stopRoutine 본체 폐기. dispatch(Stop) 단독.
 *   transition Stop 측 effect (RecordStepSession + CancelAlarmChain + ClearActiveRoutine +
 *   SetIsRoutineActive(false) + RestorePendingDisabled + EmitEvent) 가 옛 본체 부수 동작 일괄 흡수.
 *   ClearActiveRoutine effect 강화로 옛 fullCleanup 등가 (chain/confirm_prompt cancel + snapshot 정리).
 */
export async function stopRoutine(): Promise<void> {
  await sessionDispatch({ type: 'Stop', reason: 'user_button' }).catch(() => {});
}

// v2.0 C.E — pauseRoutineFromLA / resumeRoutineFromLA 폐기.
//   LA Intent 측 pause/resume 처리는 dispatch(Pause/Resume, source:'la') 단독으로 통합.
//   transition 측 source='la' 시 PauseAlarmNative/ResumeAlarmNative effect 미생성 (LA 이중 호출 방지).
//   ActionDispatcher.onLAControlSignal 측 호출 변경됨.

/**
 * v2.0 C.H — restoreRoutineState 본체 폐기. dispatch 단독 변환.
 *   - deadline 만료 → dispatch(Stop, 'override') → 'expired'
 *   - routine 부재 → dispatch(Stop, 'override') → 'none'
 *   - awaitingConfirm → 'alarm' (dispatch X — session 그대로 유지)
 *   - paused → 'run' (dispatch X)
 *   - stepEndAt 만료 → dispatch(OnEndAtReached) → CONFIRMING → 'alarm'
 *   - 진행 중 → dispatch(Resync) → IS_ROUTINE_ACTIVE_KEY/LA/snapshot 재동기 → 'run'
 *   옛 catch-up loop (completeCurrentMission 반복) = confirm 모드 1 step만 처리 → 단일 OnEndAtReached 호출 등가.
 */
export async function restoreRoutineState(): Promise<RestoreResult> {
  await sessionDispatch({ type: 'OnAppActive' }).catch(() => {});
  const ar = await loadActiveRoutine();
  if (!ar) return { kind: 'none' };

  // v2.0 P0-B R-5 fix — session ↔ ar 매칭 검증.
  //   R-4 fix 후에도 invariant 깨짐 case 안전망. session.sessionId !== ar.routineId 시 mismatch.
  //   불일치 시 dispatch Stop (override) → session + ar 측 정리 → cold-start 측 의도 X confirm_prompt 회피.
  const session = await getCurrentSession();
  if (session && session.sessionId !== ar.routineId) {
    Logger.warn(
      'routine',
      `restoreRoutineState — session ↔ ar mismatch sessionId=${session.sessionId} ar.routineId=${ar.routineId} → Stop`
    );
    await sessionDispatch({ type: 'Stop', reason: 'override' }).catch(() => {});
    return { kind: 'none' };
  }

  const routine = await findRoutine(ar.routineId);
  if (!routine) {
    await sessionDispatch({ type: 'Stop', reason: 'override' }).catch(() => {});
    return { kind: 'none' };
  }

  if (Date.now() > ar.deadlineAt) {
    Logger.warn('routine-DBG', `restoreRoutineState-stop deadline-expired ar.deadlineAt=${ar.deadlineAt} now=${Date.now()} routineId=${ar.routineId}`);
    await sessionDispatch({ type: 'Stop', reason: 'override' }).catch(() => {});
    return { kind: 'expired' };
  }

  if (ar.awaitingConfirm) {
    return { kind: 'alarm', routineId: routine.id };
  }

  if (ar.pausedAt !== null) {
    return { kind: 'run', routineId: routine.id };
  }

  if (Date.now() >= ar.stepEndAt) {
    // 시간 만료 — confirm 모드 catch-up 1회 (transition OnEndAtReached 측 CONFIRMING 전이)
    await sessionDispatch({ type: 'OnEndAtReached' }).catch(() => {});
    return { kind: 'alarm', routineId: routine.id };
  }

  // 진행 중 — Resync 로 IS_ROUTINE_ACTIVE_KEY + scheduleConfirmPrompt + snapshot 재동기
  await sessionDispatch({ type: 'Resync' }).catch(() => {});
  return { kind: 'run', routineId: routine.id };
}
