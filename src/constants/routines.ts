// v1.6: 루틴 기능 타입 정의 + AsyncStorage 키 + CRUD 헬퍼.
// 단일 타이머(ACTIVE_TIMER_KEY)와 상호 배타적으로 동작.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { SESSIONS_STORAGE_KEY, SessionRecord } from './sessions';

// ─── 타입 ────────────────────────────────────────────────────

export type RoutineMission = {
  /** missionIcons.ts의 MISSION_POOL 키 또는 'rest' 특수 키 (휴식 구간용) */
  missionKey: string;
  /** 미션 길이 (분 단위). 초 단위는 × 60 */
  durationMinutes: number;
};

export type RoutineSchedule = {
  /** 실행 요일. 0(일)~6(토). 빈 배열 = 매일 */
  days: number[];
  /** "07:00" 형태 HH:MM */
  time: string;
};

export type Routine = {
  id: string;
  name: string;
  missions: RoutineMission[];
  /** 전체 루틴 반복 횟수. 1 = 반복 없음, 2+ = N번 반복 */
  loopCount: number;
  /** 예약 없는 수동 실행 루틴 허용 — schedule 없으면 예약 알림 미예약 */
  schedule?: RoutineSchedule;
  /** true=자동 진행 / false=확인 후 진행 */
  autoAdvance: boolean;
  /** 마지막 미션 완전 종료 시 알람 dismiss 방식. 루틴 단위. */
  dismissMethod: 'tap' | 'shake';
  createdAt: number;
};

export type ActiveRoutine = {
  routineId: string;
  currentLoop: number;        // 1-based (첫 세트 = 1)
  currentStepIndex: number;   // 0-based
  /** 현재 미션 종료 예정 timestamp. Bug 5 endAt 패턴 재활용. */
  stepEndAt: number;
  /** pause 시점 timestamp. null이면 진행 중. */
  pausedAt: number | null;
  startedAt: number;
  /** I-1 "계속" 안전망 — 시작 후 24시간 경과 시 자동 중단 기준 */
  deadlineAt: number;
  /** 확인 후 진행 모드에서 미션 종료 후 사용자 확인 대기 상태 */
  awaitingConfirm: boolean;
};

// ─── AsyncStorage 키 ─────────────────────────────────────────

export const ROUTINES_KEY = 'shuttimer_routines';
export const ACTIVE_ROUTINE_KEY = 'shuttimer_active_routine';
export const SCHEDULED_ROUTINE_NOTIFS_KEY = 'shuttimer_routine_notifs';

// 24시간 안전망 (I-1 무응답 "계속" 자동 중단 기준)
export const ROUTINE_DEADLINE_MS = 24 * 60 * 60 * 1000;

// 시작 5분 전 푸시 알림
export const ROUTINE_PREALERT_MINUTES = 5;

// iOS 로컬 알림 한계 (앱당 64개). 여유 10개 남기고 54개를 루틴용 상한으로 설정.
// CALENDAR + repeats 방식으로 루틴당 최대 7개 (요일 수) 예약.
export const IOS_NOTIFICATION_SAFE_CAP = 54;

// ─── CRUD ────────────────────────────────────────────────────

export async function loadRoutines(): Promise<Routine[]> {
  try {
    const raw = await AsyncStorage.getItem(ROUTINES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidRoutine);
  } catch {
    return [];
  }
}

export async function saveRoutines(list: Routine[]): Promise<void> {
  await AsyncStorage.setItem(ROUTINES_KEY, JSON.stringify(list));
}

export async function upsertRoutine(r: Routine): Promise<Routine[]> {
  const list = await loadRoutines();
  const idx = list.findIndex(x => x.id === r.id);
  if (idx >= 0) list[idx] = r;
  else list.push(r);
  await saveRoutines(list);
  return list;
}

export async function deleteRoutine(id: string): Promise<Routine[]> {
  const list = await loadRoutines();
  const filtered = list.filter(x => x.id !== id);
  await saveRoutines(filtered);
  return filtered;
}

// ─── ActiveRoutine ───────────────────────────────────────────

export async function loadActiveRoutine(): Promise<ActiveRoutine | null> {
  try {
    const raw = await AsyncStorage.getItem(ACTIVE_ROUTINE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed as ActiveRoutine;
  } catch {
    return null;
  }
}

export async function saveActiveRoutine(ar: ActiveRoutine | null): Promise<void> {
  if (!ar) {
    await AsyncStorage.removeItem(ACTIVE_ROUTINE_KEY);
    return;
  }
  await AsyncStorage.setItem(ACTIVE_ROUTINE_KEY, JSON.stringify(ar));
}

export async function clearActiveRoutine(): Promise<void> {
  await AsyncStorage.removeItem(ACTIVE_ROUTINE_KEY);
}

// ─── 유효성 검증 ─────────────────────────────────────────────

function isValidRoutine(r: any): r is Routine {
  return (
    r &&
    typeof r.id === 'string' &&
    typeof r.name === 'string' &&
    Array.isArray(r.missions) &&
    r.missions.every((m: any) => typeof m?.missionKey === 'string' && typeof m?.durationMinutes === 'number') &&
    typeof r.loopCount === 'number' &&
    typeof r.autoAdvance === 'boolean' &&
    (r.dismissMethod === 'tap' || r.dismissMethod === 'shake') &&
    typeof r.createdAt === 'number'
  );
}

// ─── 헬퍼 ────────────────────────────────────────────────────

export function createRoutineId(): string {
  return `r_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** 루틴 총 소요시간 (분) — 루프 포함. 휴식 포함. */
export function totalRoutineMinutes(r: Routine): number {
  const perLoop = r.missions.reduce((acc, m) => acc + m.durationMinutes, 0);
  return perLoop * Math.max(1, r.loopCount);
}

/** 진행률 0~1. ActiveRoutine 기반. */
export function routineProgress(r: Routine, ar: ActiveRoutine): number {
  const total = r.missions.length * Math.max(1, r.loopCount);
  const done = (ar.currentLoop - 1) * r.missions.length + ar.currentStepIndex;
  return Math.min(1, Math.max(0, done / Math.max(1, total)));
}

/**
 * 미션 단위 세션 기록. 휴식은 기록 제외.
 * RoutineRun(포그라운드) + RoutineAlarm(배경 알림 경로) 둘 다 호출.
 * 중복 방지는 호출자 측 awaitingConfirm 플래그로 제어.
 */
export async function recordMissionSession(r: Routine, stepIdx: number): Promise<void> {
  const step = r.missions[stepIdx];
  if (!step || step.missionKey === 'rest') return;
  try {
    const raw = await AsyncStorage.getItem(SESSIONS_STORAGE_KEY);
    const list: SessionRecord[] = raw ? JSON.parse(raw) : [];
    const d = new Date();
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    list.push({
      id: `s_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      date,
      icon: step.missionKey,
      minutes: step.durationMinutes,
    });
    await AsyncStorage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify(list));
  } catch {
    // 세션 저장 실패 무시 (기능 흐름 유지)
  }
}

/**
 * 루틴의 "다음 예약 발화 시각" (시작 5분 전 기준이 아니라 루틴 시작 시각 기준) 계산.
 * schedule 없으면 null.
 * 정렬/우선순위 결정용.
 */
export function nextOccurrenceTime(r: Routine, now: Date = new Date()): number | null {
  if (!r.schedule) return null;
  const [hStr, mStr] = r.schedule.time.split(':');
  const hour = parseInt(hStr, 10);
  const minute = parseInt(mStr, 10);
  if (isNaN(hour) || isNaN(minute)) return null;

  const effectiveDays = r.schedule.days.length === 0
    ? [0, 1, 2, 3, 4, 5, 6]
    : r.schedule.days;

  // 오늘부터 최대 7일 탐색 (주 1회 반복이므로 7일 안에 반드시 있음)
  for (let offset = 0; offset < 8; offset++) {
    const d = new Date(now);
    d.setDate(d.getDate() + offset);
    d.setHours(hour, minute, 0, 0);
    if (!effectiveDays.includes(d.getDay())) continue;
    if (d.getTime() <= now.getTime()) continue;
    return d.getTime();
  }
  return null;
}
