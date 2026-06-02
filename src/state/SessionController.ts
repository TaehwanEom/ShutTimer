// v2.0 P2.3 — Session state machine + dispatcher.
//
// 단독 ownership: 모든 state 변경은 dispatch(action) 단일 경로만.
// 결정 테이블 (P1.4) 을 transition() 함수로 구현. (state × action) → (next state, side effects).
// 본 파일은 신규. 기존 코드 수정 0. P3 단계에서 기존 함수가 dispatch 호출로 변환됨.
//
// Side effect 는 transition() 결과로 반환되어 dispatch 가 순차 실행.
//   - alarm schedule/cancel (alarmScheduler 호출)
//   - confirm_prompt schedule (routineScheduler 호출)
//   - DeviceEventEmitter emit (UI 갱신)
//   - PENDING_DISABLED_ALARMS 처리
// Side effect 함수 자체는 P3 단계에서 alarmScheduler/routineScheduler 와 결합.
//   본 P2 단계에선 SideEffect type 정의 + transition() 의사구현 (alarm bridge 호출 placeholder).

import { Logger } from '../utils/logger';
import {
  Session,
  SessionAction,
  SessionListener,
  SessionState,
  AlarmBinding,
} from '../types/session';
import {
  createSessionId,
  loadSession,
  saveSession,
  clearSession,
} from './SessionStore';

// ───────────────────────────────────────────────────────────
// SideEffect — transition() 이 dispatch 에 반환하는 부수 작업
// ───────────────────────────────────────────────────────────

export type SideEffect =
  | { kind: 'ScheduleAlarmChain'; binding: AlarmBinding }
  /**
   * Sub A-2 fix (2026-05-25, Timer 통합) — 단발성 알람 schedule (= chain X).
   *   Timer 전용. AlarmkitBridge.scheduleAlarm({type: 'timer_main'}) 1회 호출 + saveAlarmMetadata.
   *   simple_alarm chain 30개 (ScheduleAlarmChain) 와 분리. 정식 사이클 §0 Timer 별도 도구 정합.
   */
  | {
      kind: 'ScheduleAlarmOnce';
      entityId: string;
      fireAt: number;
      title: string;
      stopLabel?: string;
      soundName?: string;
      laStepName?: string;
      laRoutineName?: string;
    }
  | { kind: 'CancelAlarmChain'; alarmEntityId: string }
  // v2.2 #DailyDismissPreserve (2026-05-28) — Dismiss / Advance lastStep 측 = daily/weekly 알람 측 chain[0] 보존 + chain[1..29] 만 cancel.
  //   once 알람 / lookup 실패 / Android = cancelAlarmsForEntity 위임 (= 회귀 0).
  //   호출 위치: Dismiss + Advance lastStep. Stop / Start override / DisableAlarm = 기존 CancelAlarmChain (= 전체 cancel) 유지.
  | { kind: 'CancelSafetyChainOnly'; alarmEntityId: string }
  | {
      kind: 'ScheduleConfirmPrompt';
      routineId: string;
      fireAt: number;
      /** alerting UI title 측 = 다음 step name ("다음 루틴 X"). 마지막 step 시 undefined. */
      nextStepName?: string;
      /** LA metadata — 워치 Smart Stack 표시용 */
      routineName?: string;
      currentStepName?: string;
      stepIndex?: number;
      totalSteps?: number;
      /** 2026-05-31 — Android 미션 알람 잠금 해제 강제 (iOS 정합).
       *    'tap' / undefined = 일반 알람 = 잠금 위 표시.
       *    'shake' | 'camera' | 'math' | 'typing' | 'random' = 미션 알람 = KeyguardManager 호출.
       */
      endMethod?: string;
    }
  | { kind: 'CancelConfirmPrompt'; alarmId: string }
  | { kind: 'StopAlarmNative'; alarmId: string }
  | { kind: 'EmitEvent'; event: string; payload?: Record<string, unknown> }
  | { kind: 'RestorePendingDisabled' }
  | { kind: 'RecordStepSession'; routineId: string; stepIndex: number; executionId: string }
  | { kind: 'ShowInterstitialAd' } // 광고 → handleAfterAd 측 정합
  | { kind: 'NavigateAlarmScreen'; alarmEntityId: string }
  | { kind: 'NavigateHome' }
  // v2.0 영역 D.2 — routineController 본체 부수 동작 흡수용 4종 신설
  | { kind: 'SetIsRoutineActive'; active: boolean }   // IS_ROUTINE_ACTIVE_KEY 저장/삭제
  | { kind: 'PauseAlarmNative' }      // AlarmkitBridge.pauseAlarm (LA paused state) — effectRunner 측 추적 alarmId 사용
  | { kind: 'ResumeAlarmNative' }     // AlarmkitBridge.resumeAlarm (LA countdown 복귀) — effectRunner 측 추적 alarmId 사용
  | { kind: 'CleanupAlertingAlarms' }                  // confirmAndAdvance 측 alerting alarm 일괄 stop loop
  // v2.0 영역 C (D 본격 통합) — routineController wrapper 변환용 4종 신설
  | { kind: 'SaveActiveRoutine'; session: Session }    // 옛 ar 호환 mirror (UI useSession 도입 전 임시)
  | { kind: 'ClearActiveRoutine' }                      // 옛 ACTIVE_ROUTINE_KEY 제거
  | {
      kind: 'WriteRoutineSnapshot';
      session: Session;
      routineName?: string;
      routineCompleteTitle?: string;
      /** v2.0 C.C — routine.autoCountdownSec (없으면 effectRunner 측 clampCountdown(undefined)=5) */
      autoCountdownSec?: number;
    } // App Group routine_snapshot mirror
  | { kind: 'CancelRoutinePrealerts'; routineId: string } // 잔존 prealert 일괄 cancel
  // v2.0 C.H — OnSnapshotChange transition 측 effectRunner 모듈 변수 갱신
  | { kind: 'SetCurrentRunningAlarmId'; alarmId: string };

export type TransitionResult = {
  next: Session | null;
  effects: SideEffect[];
};

// ───────────────────────────────────────────────────────────
// Listeners (subscribe pattern — UI 갱신용)
// ───────────────────────────────────────────────────────────

const listeners: Set<SessionListener> = new Set();

export function subscribe(listener: SessionListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notifyListeners(session: Session | null): void {
  listeners.forEach((l) => {
    try {
      l(session);
    } catch (e) {
      Logger.warn('SessionController', `listener error=${String(e)}`);
    }
  });
}

// ───────────────────────────────────────────────────────────
// Dispatch lock — write serialization
// ───────────────────────────────────────────────────────────

let dispatchLock: Promise<unknown> = Promise.resolve();

function runDispatchExclusive<T>(fn: () => Promise<T>): Promise<T> {
  const result = dispatchLock.then(fn, fn);
  dispatchLock = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

// ───────────────────────────────────────────────────────────
// SideEffect 실행 backend (P3 단계에서 alarmScheduler/routineScheduler 결합)
//
// 본 P2 단계: placeholder + Logger 로만 출력 → 결정 테이블 검증.
// P3 단계: 각 effect 가 실제 alarm bridge 호출하도록 채움.
// ───────────────────────────────────────────────────────────

let effectRunner: (effect: SideEffect) => Promise<void> = async (effect) => {
  Logger.info('SessionController', `[P2 stub] effect=${effect.kind} payload=${JSON.stringify(effect)}`);
};

/**
 * P3 단계 진입 시 alarmScheduler/routineScheduler/DeviceEventEmitter 호출 runner 등록.
 * P2 단계엔 placeholder.
 */
export function registerEffectRunner(runner: (effect: SideEffect) => Promise<void>): void {
  effectRunner = runner;
}

// ───────────────────────────────────────────────────────────
// dispatch(action) — 유일한 state 변경 진입점
// ───────────────────────────────────────────────────────────

export async function dispatch(action: SessionAction): Promise<Session | null> {
  return runDispatchExclusive(async () => {
    const current = await loadSession();
    Logger.info(
      'SessionController',
      `dispatch action=${action.type} currentState=${current?.state ?? 'IDLE'}`
    );

    let result: TransitionResult;
    try {
      result = transition(current, action);
    } catch (e) {
      Logger.warn('SessionController', `transition error action=${action.type} err=${String(e)}`);
      return current;
    }

    // 1. state 저장 (변경 있을 때만)
    if (result.next !== current) {
      await saveSession(result.next);
    }

    // 2. side effects 순차 실행 (각 실패는 catch — 다른 effect 차단 안 함)
    for (const effect of result.effects) {
      try {
        await effectRunner(effect);
      } catch (e) {
        Logger.warn('SessionController', `effect error kind=${effect.kind} err=${String(e)}`);
      }
    }

    // 3. listeners 알림
    notifyListeners(result.next);

    return result.next;
  });
}

export async function getCurrentSession(): Promise<Session | null> {
  return loadSession();
}

export async function getCurrentState(): Promise<SessionState> {
  const s = await loadSession();
  return s?.state ?? 'IDLE';
}

// ───────────────────────────────────────────────────────────
// transition() — pure 함수. (current, action) → (next, effects)
//
// 결정 테이블 (P1.4) 그대로 구현. 새 분기 추가 금지.
// 새 사례 등장 시 → action 추가 → 본 함수에 case 추가.
// ───────────────────────────────────────────────────────────

const SESSION_DEADLINE_MS = 24 * 60 * 60 * 1000;

function transition(current: Session | null, action: SessionAction): TransitionResult {
  const now = Date.now();

  // ─── Stop ────────────────────────────────────────────────
  if (action.type === 'Stop') {
    if (!current) return { next: null, effects: [] };
    const effects: SideEffect[] = [];
    // 옛 stopRoutine: awaitingConfirm=true 시 마지막 step record (calendar 정합)
    if (current.awaitingConfirm && current.kind !== 'timer' && current.kind !== 'simple_alarm') {
      effects.push({
        kind: 'RecordStepSession',
        routineId: current.sessionId,
        stepIndex: current.currentStepIndex,
        executionId: `${current.sessionId}_${current.startedAt}`,
      });
    }
    if (current.alarmBinding) {
      // 2026-06-02 fix #DailyAlarmRoutineRevive (2차) — Stop 시에도 데일리 chain[0] 보존.
      //   log02(1.8.6 디버그)에서 확인: Dismiss override가 chain[0]을 보존해도, 직후 startRoutine이
      //     "stale simple_alarm 세션(CONFIRMING) 감지 → dispatch Stop"을 날리고, 이 Stop의 CancelAlarmChain(전체취소)이
      //     chain[0](.relative daily)을 다시 제거함. (rebalance가 재생성해 살아남긴 했으나 취소→재생성 불안정.)
      //   정정: Stop도 CancelSafetyChainOnly → cancelSafetyChainPreservingDaily.
      //     - daily/weekly: chain[0] 보존(취소 자체가 안 일어남) → rebalance churn 없음.
      //     - once / 알람 아닌 entity: 함수 내부 전체취소 폴백(회귀 0).
      //     - 알람 비활성/삭제는 DisableAlarm 전환(별도, 전체취소 유지)이 담당하므로 Stop 보존이 의도와 맞음.
      effects.push({
        kind: 'CancelSafetyChainOnly',
        alarmEntityId: current.alarmBinding.alarmEntityId,
      });
    }
    // 옛 fullCleanup: clearActiveRoutine + clearRoutineSnapshot + IS_ROUTINE_ACTIVE_KEY 제거
    effects.push({ kind: 'ClearActiveRoutine' });
    effects.push({ kind: 'SetIsRoutineActive', active: false });
    effects.push({ kind: 'RestorePendingDisabled' });
    effects.push({
      kind: 'EmitEvent',
      event: 'routineClearedExternally',
      payload: { routineId: current.sessionId },
    });
    return { next: null, effects };
  }

  // ─── Start ───────────────────────────────────────────────
  if (action.type === 'Start') {
    // 방향 B fix (2026-05-25, log02 버그 — race condition) + 1번 A fix (같은 시각 알람 2개 동시 발화 처리, 사용자 요구).
    //   STEP_ALERTING 상태에서 새 alarm fire trigger Start = 거부 (entity 같든 다르든).
    //   - 같은 entityId: cold start race (AlarmKit listener 두 번 emit) → 중복 처리 차단.
    //   - 다른 entityId: 같은 시각에 알람 2개 동시 fire → 첫 알람 chain 보존 (= 첫 알람 우선 + 둘째 알람 무시).
    //   가드: current.state === 'STEP_ALERTING' + simple_alarm kind fire 시 next:current effects:[] 반환.
    //   정상 흐름 (이전 알람 처리 완료 후 다음 알람 fire) = current.state !== 'STEP_ALERTING' (= IDLE/CONFIRMING) → 본 가드 통과 → 기존 override 분기 정상 처리.
    //   ad_hoc_routine kind Start (= routine 시작) 는 본 가드 우회 (= 사용자 명시 입력 trigger).
    if (
      current &&
      current.state === 'STEP_ALERTING' &&
      action.kind === 'simple_alarm' &&
      current.alarmBinding?.alarmEntityId
    ) {
      const sameEntity = action.alarmBinding?.alarmEntityId === current.alarmBinding.alarmEntityId;
      Logger.warn(
        'SessionController',
        `Start rejected — ${sameEntity ? 'duplicate alarm fire' : 'concurrent alarm fire'} (current=${current.alarmBinding.alarmEntityId}, incoming=${action.alarmBinding?.alarmEntityId ?? 'unknown'}) state=STEP_ALERTING`
      );
      return { next: current, effects: [] };
    }

    const effects: SideEffect[] = [];
    // 기존 session 있으면 override (replaceExisting 또는 ad_hoc 무조건)
    if (current && (action.replaceExisting || action.kind === 'ad_hoc_routine')) {
      if (current.alarmBinding) {
        // 2026-06-02 fix #DailyAlarmRoutineRevive — Start override(루틴 시작/replaceExisting) 시 전체취소 금지.
        //   버그: 데일리 알람+루틴에서 루틴 시작 → 직전 simple_alarm 세션(binding = 원본 데일리 alarm.id)에
        //     CancelAlarmChain(전체취소) → chain[0](.relative daily OS 반복)까지 삭제 → 다음날부터 미발화.
        //     복구(syncAllAlarms)는 cold start 한정이라, 앱을 며칠 안 켜면 토글 ON인데 영영 안 울림(= 사용자 확인:
        //     OFF→ON 재예약 시 부활). 원인 = 전체취소가 데일리 반복 심장(chain[0])을 같이 죽임.
        //   정정: CancelSafetyChainOnly → cancelSafetyChainPreservingDaily.
        //     - daily/weekly: chain[0] 보존 + 안전체인(1+)만 취소 → 데일리 반복 유지.
        //     - once / 알람 아닌 entity: 함수 내부에서 전체취소로 자동 폴백 → 기존 동작 동일(회귀 0).
        effects.push({
          kind: 'CancelSafetyChainOnly',
          alarmEntityId: current.alarmBinding.alarmEntityId,
        });
      }
      // v2.0 P2-6 — 명시 안전 가드. 옛 session 측 chain/confirm_prompt 잔존 정리 + currentRunningAlarmId reset.
      //   새 SaveActiveRoutine effect 측 ar 덮어쓰기와 별도로, effectRunner 측 모듈 상태 reset 안전망.
      effects.push({ kind: 'ClearActiveRoutine' });
    }
    if (current && !action.replaceExisting && action.kind !== 'ad_hoc_routine') {
      // 기존 session 있고 override 아님 → 새 Start 거부. 기존 유지.
      Logger.warn(
        'SessionController',
        `Start rejected — existing session ${current.sessionId} (${current.state})`
      );
      return { next: current, effects: [] };
    }

    const firstStep = action.steps[0];
    const duration = (firstStep?.durationSeconds ?? 0) * 1000;
    const newSession: Session = {
      sessionId: action.sessionId ?? createSessionId(),
      kind: action.kind,
      steps: action.steps,
      currentStepIndex: 0,
      startedAt: now,
      stepEndAt: now + duration,
      deadlineAt: action.deadlineAt ?? now + SESSION_DEADLINE_MS,
      pausedAt: null,
      state: 'SCHEDULED',
      awaitingConfirm: false,
      alarmBinding: action.alarmBinding ?? null,
      pendingResult: null,
      laMeta: action.laMeta,
      createdAt: now,
      updatedAt: now,
      schemaVersion: 1,
    };

    // v2.0 R-8 fix — simple_alarm 측 dispatch Start = alarm fire 시점 측 호출 (C-1 통합).
    //   alarm 측 이미 schedule 측 (사용자 enable 시점). fire 측 또 schedule = native 측 중복 + 무한 루프 회귀.
    //   ScheduleAlarmChain effect = enable / re-enable path 측만. simple_alarm fire path 측 push X.
    // 3번 fix (2026-05-25, 타입 강제) — routine/ad_hoc_routine/timer = alarmBinding undefined 강제 → 본 분기 dead code 화 → 제거.
    // 위반-10 fix (정식 사이클 정합) — simple_alarm 측 ScheduleConfirmPrompt + WriteRoutineSnapshot push X.
    //   simple_alarm = 잠금화면 1번만 출력 (= chain alarm 만으로 무한 울림). confirm_prompt = routine step 진행 전용.
    //   옛 코드 = simple_alarm 도 routine처럼 confirm_prompt 자동 schedule → 잠금화면 2차 출력 ("깜박임") 회귀.
    //   routine / ad_hoc_routine 측은 confirm_prompt 정상 (= step 사이 전환에 필요).
    // Sub A-1 fix (2026-05-25) — kind='timer' 도 simple_alarm처럼 confirm_prompt 미사용 (= Timer 1회 알람만).
    if ((action.kind === 'routine' || action.kind === 'ad_hoc_routine') && action.steps.length > 0) {
      const nextStep = action.steps[1];
      effects.push({
        kind: 'ScheduleConfirmPrompt',
        routineId: newSession.sessionId,
        fireAt: newSession.stepEndAt,
        nextStepName: nextStep?.name,
        routineName: action.routineName ?? action.laMeta?.routineName,
        currentStepName: firstStep?.name,
        stepIndex: 0,
        totalSteps: action.steps.length,
        endMethod: firstStep?.endMethod,  // 2026-05-31 — Android 미션 알람 잠금 해제 강제
      });
      effects.push({
        kind: 'WriteRoutineSnapshot',
        session: newSession,
        routineName: action.routineName ?? action.laMeta?.routineName,
        autoCountdownSec: action.autoCountdownSec,
      });
    }
    // 옛 startRoutine: IS_ROUTINE_ACTIVE_KEY='true' 저장 (routine/ad_hoc_routine kind 만)
    if (action.kind === 'routine' || action.kind === 'ad_hoc_routine') {
      effects.push({ kind: 'SetIsRoutineActive', active: true });
      effects.push({ kind: 'SaveActiveRoutine', session: newSession });
      // 옛 startRoutine: cancelRoutinePrealerts (잔존 prealert 정리)
      // 3번 fix (2026-05-25) — ad_hoc kind alarmBinding 타입 강제로 차단됨. sessionId 직접 사용 (= ad_hoc sessionId = ADHOC_PREFIX + alarm.id = entityId 등가).
      effects.push({ kind: 'CancelRoutinePrealerts', routineId: newSession.sessionId });
    }
    // Sub A-2 fix (2026-05-25, Timer 통합) — kind='timer' 측 단발성 알람 schedule.
    //   alarmBinding 필수 (Sub A-1 타입 강제). entityId = 'main_timer_xxx'. fireAt = newSession.stepEndAt (= now + duration).
    //   title / laRoutineName = action.routineName 또는 action.laMeta 측 사용. 사운드 = effectRunner 측 settings cache read.
    if (action.kind === 'timer') {
      effects.push({
        kind: 'ScheduleAlarmOnce',
        entityId: action.alarmBinding.alarmEntityId,
        fireAt: newSession.stepEndAt,
        title: action.routineName ?? action.laMeta?.routineName ?? '타이머',
        laStepName: action.laMeta?.stepName,
        laRoutineName: action.laMeta?.routineName ?? action.routineName,
      });
    }
    return { next: newSession, effects };
  }

  // ─── EnableAlarm / DisableAlarm — session 외 동작 (current null 허용) ─
  //   critical: 이 두 action 은 가드 위에 위치해야 함.
  //   AlarmListScreen/AlarmEditScreen 측 토글/저장/삭제는 보통 session 없는 상태에서 호출됨.
  //   가드 아래로 두면 session null 시 effect 생성 X → chain cancel/schedule 안 됨 → ⑨ 회귀 + 알람 등록 무력화.

  if (action.type === 'EnableAlarm') {
    // session 무관: alarm entity 의 chain 등록.
    // v2.0 P2-4 — chainCount 측 의미 X (effectRunner ScheduleAlarmChain effect 측 scheduleAlarmMain(target) 호출 — binding.chainCount 미사용).
    //   실제 chain 분배 = alarmScheduler 측 50/activeAlarmCount 자체 계산.
    //   binding 측 dummy 값 (alarmRepeat='once', alarmType='main', chainCount=0). entityId만 의미.
    return {
      next: current,
      effects: [
        {
          kind: 'ScheduleAlarmChain',
          binding: {
            alarmEntityId: action.alarmEntityId,
            alarmRepeat: 'once',
            alarmType: 'main',
            currentAlarmId: null,
            chainAlarmIds: [],
            chainCount: 0, // effectRunner 측 무시 — 의미 X
          },
        },
      ],
    };
  }

  if (action.type === 'DisableAlarm') {
    const effects: SideEffect[] = [];
    effects.push({ kind: 'CancelAlarmChain', alarmEntityId: action.alarmEntityId });
    // 현 session 의 alarm 이 disable 대상이면 session 도 stop.
    if (current && current.alarmBinding?.alarmEntityId === action.alarmEntityId) {
      effects.push({ kind: 'RestorePendingDisabled' });
      return { next: null, effects };
    }
    return { next: current, effects };
  }

  // ─── OnAlarmFire — session null 허용 (가드 위 위치) ────
  //   영역 B 핵심: alarm_main fire → NavigateAlarmScreen effect (session 없어도).
  //   prealert / confirm_prompt 는 옛 listener 분기 유지 — 영역 D 흡수 시 마무리.
  if (action.type === 'OnAlarmFire') {
    // prealert silent ignore (옛 listener 도 silent skip)
    if (action.alarmType === 'prealert') {
      return { next: current, effects: [] };
    }
    // confirm_prompt 측 — v2.0 P2-3 markAwaitingConfirm 통합.
    //   옛 App.tsx 측 markAwaitingConfirm 호출 폐기 (dual SoT 해소).
    //   transition 측 effect = SaveActiveRoutine (옛 ar mirror) + EmitEvent (routineAwaitingConfirmExternally — listener 호환).
    // v2.0 우선순위 13 — 이미 CONFIRMING + awaitingConfirm=true 시 next === current 명시 (idempotent skip).
    if (action.alarmType === 'confirm_prompt') {
      if (!current) return { next: null, effects: [] };
      if (current.state === 'CONFIRMING' && current.awaitingConfirm) {
        return { next: current, effects: [] };
      }
      const confirming: Session = { ...current, awaitingConfirm: true, state: 'CONFIRMING' };
      return {
        next: confirming,
        effects: [
          // 옛 ar mirror 갱신 — ActiveRoutineSection 측 loadActiveRoutine + setAr 호환
          { kind: 'SaveActiveRoutine', session: confirming },
          // ActiveRoutineSection / RoutineList 측 subAwaitingConfirm listener 호환 — 옛 emit 채널
          {
            kind: 'EmitEvent',
            event: 'routineAwaitingConfirmExternally',
            payload: { routineId: current.sessionId },
          },
        ],
      };
    }
    // 위반-11 fix (정식 사이클 정합) — alarm_main fire 시 NavigateAlarmScreen effect 제거.
    //   정식 사이클: alarm fire = 잠금화면 표시만. AlarmScreen mount = 사용자 포그라운드 진입 (OpenAppDismissIntent perform) 시점에만.
    //   옛 코드 = alarm_main fire 직후 NavigateAlarmScreen → AlarmScreen background mount → 사용자가 앱 열기 전 미션 진행 회귀.
    //   AlarmScreen mount 경로 = ActionDispatcher open_app_dismiss (3) alarm_main 매칭 → SESSION_EVENT_NAVIGATE Alarm (= 사용자 입력 trigger).
    if (current && current.alarmBinding?.alarmEntityId === action.entityId) {
      const alerting: Session = {
        ...current,
        state: 'STEP_ALERTING',
        alarmBinding: current.alarmBinding
          ? { ...current.alarmBinding, currentAlarmId: action.alarmId }
          : null,
      };
      return {
        next: alerting,
        effects: [],
      };
    }
    // session null 또는 다른 entity → state 변경 X (= 옛 navigate-only 흐름 제거)
    return {
      next: current,
      effects: [],
    };
  }

  // ─── 이하 action 들은 current 가 있어야 함 ──────────────
  if (!current) return { next: null, effects: [] };

  // ─── Pause ───────────────────────────────────────────────
  if (action.type === 'Pause') {
    if (current.state === 'IDLE' || current.state === 'COMPLETED' || current.state === 'PAUSED') {
      return { next: current, effects: [] };
    }
    const paused: Session = { ...current, state: 'PAUSED', pausedAt: action.timestamp };
    const effects: SideEffect[] = [];
    // 옛 pauseRoutine: AlarmkitBridge.pauseAlarm(currentRunningAlarmId) → LA paused state.
    // v2.0 C.B — alarmId 인자 제거. effectRunner 측 currentRunningAlarmId 모듈 변수 사용.
    // v2.0 C.E — source='la' 시 LA Intent 측 native pause 이미 완료 → PauseAlarmNative effect 생략 (이중 호출 방지).
    if (action.source !== 'la') {
      effects.push({ kind: 'PauseAlarmNative' });
    }
    effects.push({ kind: 'SaveActiveRoutine', session: paused });
    effects.push({
      kind: 'EmitEvent',
      event: 'routinePausedExternally',
      payload: { routineId: current.sessionId, timestamp: action.timestamp },
    });
    return { next: paused, effects };
  }

  // ─── Resume ──────────────────────────────────────────────
  if (action.type === 'Resume') {
    if (current.state !== 'PAUSED' || current.pausedAt === null) {
      return { next: current, effects: [] };
    }
    const pauseDuration = Math.max(0, action.timestamp - current.pausedAt);
    const resumed: Session = {
      ...current,
      state: 'SCHEDULED', // 이전 상태로 (현 simplification — P3 에서 prior state 추적 강화 가능)
      pausedAt: null,
      stepEndAt: current.stepEndAt + pauseDuration,
    };
    const effects: SideEffect[] = [];
    // 옛 resumeRoutine: AlarmkitBridge.resumeAlarm(currentRunningAlarmId) → LA countdown 복귀.
    // v2.0 C.B — alarmId 인자 제거. effectRunner 측 currentRunningAlarmId 사용.
    // v2.0 C.E — source='la' 시 LA Intent 측 native resume 이미 완료 → ResumeAlarmNative effect 생략.
    if (action.source !== 'la') {
      effects.push({ kind: 'ResumeAlarmNative' });
    }
    effects.push({ kind: 'SaveActiveRoutine', session: resumed });
    effects.push({
      kind: 'EmitEvent',
      event: 'routineResumedExternally',
      payload: { routineId: current.sessionId, timestamp: action.timestamp },
    });
    return { next: resumed, effects };
  }

  // ─── Dismiss ─────────────────────────────────────────────
  // STEP_ALERTING 안에서만 의미 있음. 광고 → Advance (의도 = 광고 노출)
  if (action.type === 'Dismiss') {
    if (current.state !== 'STEP_ALERTING') {
      return { next: current, effects: [] };
    }
    const pendingResult = action.missionResult;
    const dismissed: Session = { ...current, pendingResult, awaitingConfirm: true };
    // chain cancel — 미션 완료 시 같은 entity chain 정리
    // v2.2 #DailyDismissPreserve (2026-05-28) — Dismiss = "오늘 미션 완료" 의미. daily/weekly 알람 측 = 다음날 다시 fire 의도.
    //   → CancelSafetyChainOnly 측 = chain[0] 보존 + chain[1..29] 만 cancel.
    //   once 알람 / Android Platform = effectRunner 측 cancelSafetyChainPreservingDaily 측 = cancelAlarmsForEntity 위임 (= 기존 동작 보존).
    const effects: SideEffect[] = [];
    if (current.alarmBinding) {
      effects.push({
        kind: 'CancelSafetyChainOnly',
        alarmEntityId: current.alarmBinding.alarmEntityId,
      });
    }
    // 광고 → handleAfterAd 후 Advance dispatch
    effects.push({ kind: 'ShowInterstitialAd' });
    return { next: { ...dismissed, state: 'CONFIRMING' }, effects };
  }

  // ─── Advance ─────────────────────────────────────────────
  // STEP_ALERTING / CONFIRMING / ADVANCING 측에서 다음 step 진행. lastStep 이면 COMPLETED.
  if (action.type === 'Advance') {
    if (
      current.state !== 'STEP_ALERTING' &&
      current.state !== 'CONFIRMING' &&
      current.state !== 'ADVANCING'
    ) {
      return { next: current, effects: [] };
    }
    const nextIdx = current.currentStepIndex + 1;
    const effects: SideEffect[] = [];
    // 옛 confirmAndAdvance: alerting alarm 명시 stop loop (line 481-500) — confirm_prompt + prealert + metadata 없는 alerting 정리
    effects.push({ kind: 'CleanupAlertingAlarms' });
    effects.push({
      kind: 'RecordStepSession',
      routineId: current.sessionId,
      stepIndex: current.currentStepIndex,
      executionId: `${current.sessionId}_${current.startedAt}`,
    });

    if (nextIdx >= current.steps.length) {
      // 마지막 step → COMPLETED → IDLE (cleanup)
      // v2.2 #DailyDismissPreserve (2026-05-28) — 루틴 마지막 step 완료 = "오늘 루틴 완료" 의미. daily/weekly 알람 측 = 다음날 다시 fire 의도.
      //   → CancelSafetyChainOnly 측 = chain[0] 보존 + chain[1..29] 만 cancel.
      if (current.alarmBinding) {
        effects.push({
          kind: 'CancelSafetyChainOnly',
          alarmEntityId: current.alarmBinding.alarmEntityId,
        });
      }
      // 옛 fullCleanup: ClearActiveRoutine + IS_ROUTINE_ACTIVE_KEY 제거
      effects.push({ kind: 'ClearActiveRoutine' });
      effects.push({ kind: 'SetIsRoutineActive', active: false });
      effects.push({ kind: 'RestorePendingDisabled' });
      effects.push({
        kind: 'EmitEvent',
        event: 'routineAdvancedExternally',
        payload: { routineId: current.sessionId },
      });
      return { next: null, effects };
    }

    const nextStep = current.steps[nextIdx];
    const duration = (nextStep?.durationSeconds ?? 0) * 1000;
    const advanced: Session = {
      ...current,
      currentStepIndex: nextIdx,
      stepEndAt: now + duration,
      pausedAt: null,
      awaitingConfirm: false,
      pendingResult: null,
      state: 'SCHEDULED',
    };
    const stepAfterNext = current.steps[nextIdx + 1];
    effects.push({
      kind: 'ScheduleConfirmPrompt',
      routineId: current.sessionId,
      fireAt: advanced.stepEndAt,
      nextStepName: stepAfterNext?.name,
      routineName: current.laMeta?.routineName,
      currentStepName: nextStep?.name,
      stepIndex: nextIdx,
      totalSteps: current.steps.length,
      endMethod: nextStep?.endMethod,  // 2026-05-31 — Android 미션 알람 잠금 해제 강제
    });
    effects.push({
      kind: 'WriteRoutineSnapshot',
      session: advanced,
      routineName: current.laMeta?.routineName,
    });
    effects.push({ kind: 'SaveActiveRoutine', session: advanced });
    effects.push({
      kind: 'EmitEvent',
      event: 'routineAdvancedExternally',
      payload: { routineId: current.sessionId },
    });
    return { next: advanced, effects };
  }

  // EnableAlarm / DisableAlarm / OnAlarmFire 는 가드 위로 이동됨 (session null 허용 필수).

  // ─── Resync ──────────────────────────────────────────────
  // 진행 중 session 측 native+LA+storage 재동기. 옛 startRoutine 측 'resumed' 분기 등가.
  if (action.type === 'Resync') {
    if (current.pausedAt !== null || current.awaitingConfirm) {
      return { next: current, effects: [] };
    }
    const curStep = current.steps[current.currentStepIndex];
    const nxtStep = current.steps[current.currentStepIndex + 1];
    return {
      next: current,
      effects: [
        { kind: 'SetIsRoutineActive', active: true },
        {
          kind: 'ScheduleConfirmPrompt',
          routineId: current.sessionId,
          fireAt: current.stepEndAt,
          nextStepName: nxtStep?.name,
          routineName: current.laMeta?.routineName,
          currentStepName: curStep?.name,
          stepIndex: current.currentStepIndex,
          totalSteps: current.steps.length,
          endMethod: curStep?.endMethod,  // 2026-05-31 — Android 미션 알람 잠금 해제 강제
        },
        {
          kind: 'WriteRoutineSnapshot',
          session: current,
          routineName: current.laMeta?.routineName,
        },
        { kind: 'SaveActiveRoutine', session: current },
      ],
    };
  }

  // ─── OnSnapshotChange ────────────────────────────────────
  // native AdvanceNextStepIntent 측 advance_done 신호. caller (syncRoutineFromSnapshot) 가 snapshot 정보 payload 로 전달.
  // v2.0 C.H — 강화. completedStepIndices flush + nextStepIndex/stepEndAt 동기 + currentRunningAlarmId 갱신.
  if (action.type === 'OnSnapshotChange') {
    if (current.sessionId !== action.routineId) {
      Logger.warn(
        'SessionController',
        `OnSnapshotChange routineId mismatch session=${current.sessionId} req=${action.routineId} — skip`
      );
      return { next: current, effects: [] };
    }
    const effects: SideEffect[] = action.completedStepIndices.map((idx) => ({
      kind: 'RecordStepSession',
      routineId: current.sessionId,
      stepIndex: idx,
      executionId: `${current.sessionId}_${current.startedAt}`,
    }));
    const next: Session = {
      ...current,
      currentStepIndex: action.nextStepIndex,
      stepEndAt: action.stepEndAt,
      pausedAt: null,
      awaitingConfirm: false,
      state: 'SCHEDULED',
    };
    effects.push({ kind: 'SetCurrentRunningAlarmId', alarmId: action.currentAlarmId });
    effects.push({ kind: 'SaveActiveRoutine', session: next });
    effects.push({
      kind: 'EmitEvent',
      event: 'routineAdvancedExternally',
      payload: { routineId: current.sessionId },
    });
    return { next, effects };
  }

  // ─── OnAppActive ─────────────────────────────────────────
  // cold-start 또는 background→active 진입.
  // v2.0 P2-9 주석 명시 — effect 측 통합 불요 결정.
  //   cold-start 1회 cleanup (syncAllAlarms + cleanupGhostAlarms + cleanupDisabledEntityChains) =
  //   App.tsx 측 별도 호출 유지 (매 active 진입 시 호출 시 비용 큼 → 1회 의도).
  //   본 transition 측 OnAppActive = state machine 측 marker.
  //
  // 옵션 2 fix (2026-05-25 사용자 요구) — 자발 앱 진입 시 종료방식 화면 자동 mount.
  //   사용자 의도: "음향버튼/밀어서종료 후 앱 진입 → chain 회수 + 미션 화면 진입".
  //   버그 (log01): 음향버튼 silent dismiss → 1분 뒤 자발 앱 진입 → suppressFlag 가드로 alerting alarm cancel → AlarmScreen mount path 없음 → 미션 화면 X.
  //   정정: Session.state === 'STEP_ALERTING' + alarmBinding 있으면 → NavigateAlarmScreen effect.
  //     → AlarmScreen mount → stopAudioAndVibration → cancelAlarmsForEntity → chain 30개 회수.
  //   중복 mount 차단: App.tsx SESSION_EVENT_NAVIGATE listener 측 currentRoute === 'Alarm' 가드.
  //   정상 흐름 무영향: STEP_ALERTING 아닌 상태 (IDLE/CONFIRMING) = effects [].
  if (action.type === 'OnAppActive') {
    if (current?.state === 'STEP_ALERTING' && current.alarmBinding?.alarmEntityId) {
      return {
        next: current,
        effects: [
          { kind: 'NavigateAlarmScreen', alarmEntityId: current.alarmBinding.alarmEntityId },
        ],
      };
    }
    return {
      next: current,
      effects: [],
    };
  }

  // ─── OnAutoTimeout ───────────────────────────────────────
  // 위반-5 fix (정식 사이클 §4 정합) — STEP_ALERTING 측 mission_3min 자동 fail 제거.
  //   정식 사이클 §4 "자동 fail 금지" + §1 "일어날 때까지 안 꺼지는 알람".
  //   옛 코드: 3분 만료 시 CONFIRMING (pendingResult='fail') + ShowInterstitialAd → 자동 종료 사이클.
  //   정정: mission_3min = 무동작 (next:current effects:[]). 사용자 입력 trigger만 사이클 진행.
  //   result_30s 분기는 옛 동작 유지 (= 결과 화면 30초 후 home 복귀. 사용자 미션 success 결과 표시 후 timeout).
  if (action.type === 'OnAutoTimeout') {
    if (current.state !== 'STEP_ALERTING') {
      return { next: current, effects: [] };
    }
    if (action.reason === 'mission_3min') {
      return { next: current, effects: [] };
    }
    // result_30s → goHome
    return {
      next: { ...current, state: 'COMPLETED' },
      effects: [{ kind: 'NavigateHome' }],
    };
  }

  // ─── OnEndAtReached ──────────────────────────────────────
  // T8 (ActiveRoutineSection endAt) 측 catch-up. kind 별 분기:
  //   - timer / simple_alarm: STEP_ALERTING (= 알람 발화 = 미션 화면 진입)
  //   - routine / ad_hoc_routine: CONFIRMING (= 옛 completeCurrentMission 의미. awaitingConfirm=true)
  if (action.type === 'OnEndAtReached') {
    if (current.state !== 'SCHEDULED') {
      return { next: current, effects: [] };
    }
    const isAlarmKind = current.kind === 'timer' || current.kind === 'simple_alarm';
    if (isAlarmKind) {
      return {
        next: { ...current, state: 'STEP_ALERTING' },
        effects: [],
      };
    }
    // routine / ad_hoc_routine: 옛 completeCurrentMission 정합 (awaitingConfirm=true → CONFIRMING).
    // v2.0 C.G — recordStepSession effect 추가 (옛 completeCurrentMission line 419 정합. dedupe key 사용 → 중복 호출 안전).
    const confirming: Session = { ...current, state: 'CONFIRMING', awaitingConfirm: true };
    return {
      next: confirming,
      effects: [
        {
          kind: 'RecordStepSession',
          routineId: current.sessionId,
          stepIndex: current.currentStepIndex,
          executionId: `${current.sessionId}_${current.startedAt}`,
        },
        { kind: 'SaveActiveRoutine', session: confirming },
      ],
    };
  }

  return { next: current, effects: [] };
}

// ───────────────────────────────────────────────────────────
// Public — test/debug
// ───────────────────────────────────────────────────────────

/** 강제 IDLE 복귀 (test). production 미사용. */
export async function __forceReset(): Promise<void> {
  await clearSession();
  notifyListeners(null);
}
