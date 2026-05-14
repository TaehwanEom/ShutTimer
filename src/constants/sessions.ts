// 캘린더 세션 기록 측 타입 정의 + AsyncStorage 키
export type SessionType = 'timer' | 'routine' | 'alarm' | 'alarmRoutine';

export type SessionRecord = {
  id: string;
  date: string;    // YYYY-MM-DD
  icon: string;    // mission icon (= timer 측) / 'alarm' / step.name 측 (= legacy)
  minutes: number; // 반올림 분 (= legacy 호환)
  // v1.8 #CalendarCategory — 카테고리 분리 + 초 단위 정확 표시 + 라벨/실행 그룹화.
  type?: SessionType;          // 카테고리 (= timer/routine/alarm/alarmRoutine)
  totalSeconds?: number;       // 초 단위 정확 (= 타이머 + step 측)
  label?: string;              // 알람 라벨 / 루틴 이름
  routineId?: string;          // 같은 루틴/알람 측 grouping key
  stepName?: string;           // step 단위 record 측 step 이름
  executionId?: string;        // 같은 routineId 측 매 실행별 별도 그룹 분리 키
};

export const SESSIONS_STORAGE_KEY = 'shutimer_sessions';
