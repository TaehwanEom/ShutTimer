export type AuthorizationState =
  | 'notDetermined'
  | 'denied'
  | 'authorized'
  | 'unsupported'
  | 'unknown';

export type AlarmKitType = 'prealert' | 'chain' | 'confirm_prompt' | 'timer_main';

export type AlarmKitEndMethod = 'tap' | 'shake' | 'camera' | 'auto';

export type AlarmKitAlarmState = 'scheduled' | 'countdown' | 'paused' | 'alerting';

export type ScheduleAlarmParams = {
  /** 루틴 식별자 (ShutTimer 내부 매칭용) */
  routineId: string;
  /** 알람 화면 타이틀 */
  title: string;
  /** 발화 시각 (ms timestamp) */
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
};

/** v1.6 T1 — alarmUpdates AsyncSequence state 변화를 JS 측에 emit */
export type AlarmStateChangeEvent = {
  alarmId: string;
  state: AlarmKitAlarmState | 'removed';
};

/** v1.6 T1 — listAlarms 반환 (UUID[] → {id, state}[] 시그니처 변경) */
export type AlarmInfo = {
  id: string;
  state: AlarmKitAlarmState;
};
