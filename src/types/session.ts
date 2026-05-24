// v2.0 P2.1 — Session 도메인 모델 (timer / simple_alarm / routine / ad_hoc_routine 4종 통합).
//
// 본 모델은 기존 ACTIVE_TIMER_KEY / ACTIVE_ROUTINE_KEY / IS_ROUTINE_ACTIVE_KEY / RoutineSnapshot 을 흡수.
// 모든 state 변경은 SessionController.dispatch(action) 단일 진입점만 통과.
// 기존 코드는 P3 단계에서 dispatch 호출로 변환됨. 본 P2 단계는 신규 파일만 작성, 기존 코드 0 수정.

// ───────────────────────────────────────────────────────────
// SessionKind — 4종 본질 통합
// ───────────────────────────────────────────────────────────

export type SessionKind =
  | 'timer'           // HomeScreen 단일 타이머 (1 step + duration)
  | 'simple_alarm'    // alarm.steps 없는 알람 (1 step + fire 시각)
  | 'routine'         // 정기 routine (N step + schedule)
  | 'ad_hoc_routine'; // alarm.steps 있는 알람 발화로 시작 (N step + 알람 발화 trigger)

// ───────────────────────────────────────────────────────────
// SessionState — 7 상태
// ───────────────────────────────────────────────────────────

export type SessionState =
  | 'IDLE'           // 활동 없음
  | 'SCHEDULED'      // 알람 예약, 대기
  | 'STEP_ALERTING'  // 알람 발화 + 미션 화면 노출
  | 'CONFIRMING'     // step 끝, 사용자 확인 대기 (awaitingConfirm=true)
  | 'ADVANCING'      // 다음 step 등록 진행 (일시적)
  | 'PAUSED'         // 일시정지
  | 'COMPLETED';     // 완료 (IDLE로 cleanup 예정)

// ───────────────────────────────────────────────────────────
// Step — routine/timer/alarm 공통 step 단위
// ───────────────────────────────────────────────────────────

export type StepEndMethod = 'tap' | 'shake' | 'camera' | 'math' | 'typing' | 'random';

export interface Step {
  index: number;                  // 0-based
  name: string;                   // UI 표시용
  durationSeconds: number;        // 0 이상
  endMethod: StepEndMethod;       // 미션 종료 방식
  soundName: string;              // AlarmKit AlertSound name (예: 'alarm_01.wav')
}

// ───────────────────────────────────────────────────────────
// AlarmBinding — Session ↔ AlarmKit 알람 entity 연결
// ───────────────────────────────────────────────────────────

export type AlarmRepeat = 'once' | 'daily' | 'weekly';
export type AlarmType = 'main' | 'confirm_prompt' | 'prealert';

export interface AlarmBinding {
  /** AlarmKit 알람 entity ID (= existing alarm.id 또는 routine.id) */
  alarmEntityId: string;

  /** 알람 반복 모드. v1.8 #AlarmChainRecurring 정합 */
  alarmRepeat: AlarmRepeat;

  /** weekly recurrence 요일 (0=일~6=토). 빈 배열 = 매일. */
  alarmDays?: number[];

  /** 현재 schedule된 alarm 종류 */
  alarmType: AlarmType;

  /** 현재 alerting/scheduled 중인 AlarmKit alarm ID (LA 연결 대상) */
  currentAlarmId: string | null;

  /**
   * v1.8 #AlarmChainEager — 등록 시점에 미리 예약된 chain alarm IDs.
   * chainCount = floor(50 / activeAlarmCount). 최소 1, 최대 50.
   */
  chainAlarmIds: string[];

  /** chain 총 갯수 (분배 계산용) */
  chainCount: number;
}

// ───────────────────────────────────────────────────────────
// Session — 핵심 도메인 모델 (단일 active session, 동시 1개)
// ───────────────────────────────────────────────────────────

export interface Session {
  /** 고유 ID. P2 SessionStore.createSessionId 로 생성 */
  sessionId: string;

  /** 4종 본질 구분 */
  kind: SessionKind;

  /** step 진행 단계 (1개 timer/simple, N개 routine/ad_hoc) */
  steps: Step[];
  currentStepIndex: number;

  /** 시간 추적 */
  startedAt: number;       // session 시작 시각 (ms)
  stepEndAt: number;       // 현재 step 종료 예정 시각 (ms)
  deadlineAt: number;      // session 전체 데드라인 (= startedAt + 24h)
  pausedAt: number | null; // pause 시점 ms (null = 진행 중)

  /** 상태머신 현재 상태 */
  state: SessionState;

  /** step 끝났는데 사용자 확인 대기 중 (markAwaitingConfirm 정합) */
  awaitingConfirm: boolean;

  /** AlarmKit 알람 entity 연결 (timer / routine 측은 별도, alarm 측은 있음) */
  alarmBinding: AlarmBinding | null;

  /** 미션 결과 (handleAfterAd 측 정합. success/fail → 광고 → Advance 분기) */
  pendingResult: 'success' | 'fail' | null;

  /**
   * Live Activity (워치 Smart Stack 포함) metadata mirror.
   * native ↔ JS 양방향 동기화에 필요. RoutineSnapshot 측 i18n 필드와 정합.
   */
  laMeta?: {
    routineName: string;
    stepName: string;
    stepIndex: number;
    totalSteps: number;
  };

  /** 생성/갱신 timestamp (ms) */
  createdAt: number;
  updatedAt: number;

  /** migration 대비 schema version */
  schemaVersion: 1;
}

// ───────────────────────────────────────────────────────────
// SessionAction — 13개 + Source 5종
// ───────────────────────────────────────────────────────────
//
// Source 매핑 (P1.3):
//   1. User UI         → Start / Stop / Dismiss / Advance / Pause / Resume / EnableAlarm / DisableAlarm
//   2. AlarmListener   → OnAlarmFire
//   3. AppState 'active' → OnAppActive
//   4. setTimeout/Interval → OnAutoTimeout / OnEndAtReached
//   5. LA Intent signal → Dismiss / Advance / Stop / Pause / Resume / OnSnapshotChange

export type StopReason = 'user_button' | 'la_widget' | 'override';
export type MissionResult = 'success' | 'fail';
export type AutoTimeoutReason = 'mission_3min' | 'result_30s';

export type SessionAction =
  // User UI ─────────────────────────────────────────────────
  | {
      type: 'Start';
      kind: SessionKind;
      /**
       * v2.0 C.A — sessionId override. caller 가 결정.
       *   - routine          → routine.id
       *   - simple_alarm     → alarm.id
       *   - ad_hoc_routine   → ADHOC_PREFIX + alarm.id ('aa_a_xxx')
       *   - timer            → 'tm_' + random
       * 미전달 시 createSessionId() fallback.
       * native AdvanceNextStepIntent / snapshot routineId 와 정합 (entity ID 그대로 사용).
       */
      sessionId?: string;
      steps: Step[];
      alarmBinding?: AlarmBinding;
      /** ad-hoc routine 무조건 override 정합 (alarmRoutineLink.startRoutineFromAlarm:54-57) */
      replaceExisting?: boolean;
      /** session deadline 계산용. 미전달 시 startedAt + 24h */
      deadlineAt?: number;
      /**
       * v2.0 C.A — routine name. WriteRoutineSnapshot effect 측 routineName 인자 정합.
       *   - timer: '타이머' or 사용자 표시명
       *   - simple_alarm: alarm.label
       *   - routine: routine.name ?? routine.category
       *   - ad_hoc_routine: routine.name ?? alarm.label
       */
      routineName?: string;
      /** v2.0 C.A — currentStep 정보 (LA metadata 정합용. 첫 step 기본) */
      laMeta?: {
        routineName: string;
        stepName: string;
        stepIndex: number;
        totalSteps: number;
      };
      /** v2.0 C.C — routine.autoCountdownSec mirror. snapshot 측 autoCountdownSec 필드 정합. */
      autoCountdownSec?: number;
    }
  | { type: 'Stop'; reason: StopReason }
  | { type: 'Dismiss'; missionResult: MissionResult }
  | { type: 'Advance' }
  | {
      type: 'Pause';
      timestamp: number;
      /**
       * v2.0 C.E — Pause source. 'la' 시 native AlarmKit pause 이미 LA Intent 측에서 처리됨 → PauseAlarmNative effect 생략.
       *   default 'ui' (사용자 직접 누름 → native pause 필요).
       */
      source?: 'ui' | 'la';
    }
  | {
      type: 'Resume';
      timestamp: number;
      source?: 'ui' | 'la';
    }
  /**
   * v2.0 C.D — 진행 중 session 측 native (LA / snapshot / IS_ROUTINE_ACTIVE_KEY) 재동기.
   *   옛 startRoutine 측 'resumed' 분기 (= 같은 routineId 재호출 시 IS_ROUTINE_ACTIVE_KEY + scheduleBackgroundNotif 갱신) 등가.
   *   pausedAt 있음 또는 awaitingConfirm=true 시 skip (옛 분기 정합).
   */
  | { type: 'Resync' }
  | { type: 'EnableAlarm'; alarmEntityId: string }
  | { type: 'DisableAlarm'; alarmEntityId: string }

  // System ─────────────────────────────────────────────────
  | {
      type: 'OnAlarmFire';
      alarmId: string;
      entityId: string;
      alarmType: AlarmType;
    }
  | {
      type: 'OnSnapshotChange';
      routineId: string;
      /** v2.0 C.H — native AdvanceNextStepIntent 측 갱신본 snapshot 정보. */
      nextStepIndex: number;
      stepEndAt: number;
      currentAlarmId: string;
      completedStepIndices: number[];
    }
  | { type: 'OnAppActive' }
  | { type: 'OnAutoTimeout'; reason: AutoTimeoutReason }
  | { type: 'OnEndAtReached' };

// ───────────────────────────────────────────────────────────
// SessionSubscriber — UI 갱신용 listener
// ───────────────────────────────────────────────────────────

export type SessionListener = (session: Session | null) => void;
