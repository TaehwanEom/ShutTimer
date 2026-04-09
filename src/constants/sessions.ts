export type SessionRecord = {
  id: string;
  date: string;    // YYYY-MM-DD
  icon: string;    // mission icon, 없으면 'timer'
  minutes: number; // 반올림 분
};

export const SESSIONS_STORAGE_KEY = 'shutimer_sessions';
