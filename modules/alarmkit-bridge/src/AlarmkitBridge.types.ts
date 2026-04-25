export type AuthorizationState =
  | 'notDetermined'
  | 'denied'
  | 'authorized'
  | 'unsupported'
  | 'unknown';

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
};
