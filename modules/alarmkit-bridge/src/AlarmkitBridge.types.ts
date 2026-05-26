export type AuthorizationState =
  | 'notDetermined'
  | 'denied'
  | 'authorized'
  | 'unknown';

// v1.6+ — 'alarm_main' 추가 (= 알람 entity 측 정시 발화).
export type AlarmKitType = 'prealert' | 'chain' | 'confirm_prompt' | 'timer_main' | 'alarm_main';

export type AlarmKitEndMethod = 'tap' | 'shake' | 'camera' | 'auto';

export type AlarmKitAlarmState = 'scheduled' | 'countdown' | 'paused' | 'alerting';

/**
 * v1.6+ — recurrence 옵션 (= AlarmKit `.relative(.weekly([...]))` 측 OS 자동 반복).
 * mode='never' = 단발 (= 기존 .timer(duration:) 분기 유지).
 * mode='daily' = 7요일 자동 반복.
 * mode='weekly' = 선택 요일 (days: 0~6) 자동 반복. days 빈 배열 = invalid.
 */
export type AlarmRecurrence = {
  mode: 'never' | 'daily' | 'weekly';
  days?: number[];
};

export type ScheduleAlarmParams = {
  /**
   * v1.6+ — entity 식별자 (= 카테고리 B 일반화, rename 결정 4-B).
   * 루틴 / 타이머 / 알람 등 모든 entity 측 식별자 공통 필드.
   */
  entityId: string;
  /** 알람 화면 타이틀 */
  title: string;
  /**
   * v1.8 #LACountdownTitle — countdown presentation 측 별도 title (= lock screen LA 측 표시).
   * 미전달 시 = `title` 측 fallback (= 기존 호환).
   * 사용 예 = alarm_main type 측 = "알람 남은 시간" (= alerting 측 alarm.label 유지).
   */
  countdownTitle?: string;
  /** 발화 시각 (ms timestamp). recurrence != nil 시 = 시각 (HH:MM) 추출용으로 사용 */
  fireAt: number;
  /** 정지 버튼 라벨 (기본 "Stop") */
  stopLabel?: string;
  /** 사운드 파일 (현재 unused, 추후 확장) */
  soundName?: string;
  /** v1.6 T1 — 알람 종류. 미지정 시 'prealert' (기존 호환) */
  type?: AlarmKitType;
  /** chain 전용 — 다음 step index */
  nextStepIndex?: number;
  /** confirm_prompt 전용 — endMethod 분기 */
  endMethod?: AlarmKitEndMethod;
  /** v1.6 hotfix — 잠금화면 alerting UI 의 보조 버튼 라벨. confirm_prompt 타입에 한해 "다음 진행" 버튼 노출 (AdvanceNextStepIntent 결합) */
  secondaryLabel?: string;
  /**
   * v1.6+ — recurrence 옵션 (= type='alarm_main' 측 사용).
   * mode='daily'/'weekly' 시 = `.alarm(schedule:)` factory + `.relative(.weekly([...]))` 분기.
   * mode='never' 또는 미지정 = 기존 `.timer(duration:)` 분기 유지.
   */
  recurrence?: AlarmRecurrence;
  /**
   * v1.7 hotfix #LAUnify Phase 3 — AlarmKit framework 자동 LA Activity 측 = AlarmAttributes
   * metadata 측 step 데이터 표시 영역. widget extension 측 AlarmAttributes layout (= Phase 6 영역)
   * 측 = 본 metadata 측 사용 → step / progress 표시.
   * 미전달 시 = native 측 default 영역 (= 호환).
   */
  laStepName?: string;
  laStepIndex?: number;
  laTotalSteps?: number;
  laStage?: string;
  laPaused?: boolean;
  laPausedAt?: number;
  laRoutineId?: string;
  laRoutineName?: string;
};

/**
 * v1.6 T1 — alarmUpdates AsyncSequence state 변화를 JS 측에 emit.
 * v1.7 hotfix #G5 Phase A — preAlertSeconds + fixedFireMs + relativeHour/Minute 신규 field 추가.
 *   AlarmKit framework 측 = `alarm.countdownDuration?.preAlert` (= TimeInterval?) + `alarm.schedule` (= .fixed(Date) / .relative(Time)) 측 = JS 측 emit.
 *   removed event 측 = state='removed' + 신규 field 미포함 (= alarm instance 측 ❌ 영역).
 */
export type AlarmStateChangeEvent = {
  alarmId: string;
  // Phase 3-3 (2026-05-26, Android): 'secondary_action' 추가 — FSI notification 측 secondary button (= "다음 진행") 측 사용자 탭 → AlarmActionReceiver 측 emit.
  state: AlarmKitAlarmState | 'removed' | 'secondary_action';
  preAlertSeconds?: number;
  fixedFireMs?: number;
  relativeHour?: number;
  relativeMinute?: number;
};

/**
 * v1.6 T1 — listAlarms 반환 (UUID[] → {id, state}[] 시그니처 변경).
 * v1.7 hotfix #G5 Phase A — preAlertSeconds + fixedFireMs + relativeHour/Minute 신규 field 추가.
 * v1.7 hotfix #ColdStartLA-2 — hasLiveActivity field 추가 (= Apple Developer Forum #729651 정합).
 *   `Activity<AlarmAttributes<...>>.activities` 측 source of truth → cold start 측 잔존 LA 측정 영역.
 *   false 측 = 옛 alarm cancel + 새 schedule 강제 (= 새 LA Activity 시작).
 */
export type AlarmInfo = {
  id: string;
  state: AlarmKitAlarmState;
  preAlertSeconds?: number;
  fixedFireMs?: number;
  relativeHour?: number;
  relativeMinute?: number;
  hasLiveActivity?: boolean;
};
