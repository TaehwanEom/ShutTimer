// v1.6 Phase 1: 루틴 데이터 모델 재정의 (steps 기반).
// 단일 타이머(ACTIVE_TIMER_KEY)와 상호 배타적으로 동작.
// v1.6 미출시로 기존 shuttimer_routines (missions 기반) 데이터는 유효성 검증에서 탈락 → 자동 삭제.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { SESSIONS_STORAGE_KEY, SessionRecord } from './sessions';

// ─── 타입 ────────────────────────────────────────────────────

export type RoutineStep = {
  id: string;
  name: string;
  /** "HH:MM" 24h 포맷 */
  startTime: string;
  /** "HH:MM" 24h 포맷. startTime 보다 뒤 (자정 넘김 허용) */
  endTime: string;
  /** MISSION_POOL 키 또는 이모지/아이콘 식별자. 선택적. */
  icon?: string;
};

export type RoutineSchedule = {
  /** 실행 요일. 0(일)~6(토). 빈 배열 = 매일 */
  days: number[];
};

export type Routine = {
  id: string;
  name: string;
  /** 카테고리 id (운동/공부/약복용 등 Phase 4 확정). 빈 문자열 허용 (미분류) */
  category: string;
  steps: RoutineStep[];
  /** 예약 없는 수동 실행 루틴 허용. schedule 없거나 active=false면 예약 스킵. */
  schedule?: RoutineSchedule;
  /** 알람 사운드 id (ALARM_SOUNDS.id) */
  soundKey: string;
  /** 스케줄 on/off 토글. false면 예약 등록 안 됨. */
  active: boolean;
  /** true=자동 진행 / false=확인 후 진행 */
  autoAdvance: boolean;
  createdAt: number;
};

export type ActiveRoutine = {
  routineId: string;
  /** 0-based */
  currentStepIndex: number;
  /** 현재 step 종료 예정 timestamp. */
  stepEndAt: number;
  /** pause 시점 timestamp. null이면 진행 중. */
  pausedAt: number | null;
  startedAt: number;
  /** 24시간 경과 시 자동 중단 기준 */
  deadlineAt: number;
  /** 확인 후 진행 모드에서 step 종료 후 사용자 확인 대기 상태 */
  awaitingConfirm: boolean;
};

// ─── AsyncStorage 키 ─────────────────────────────────────────

export const ROUTINES_KEY = 'shuttimer_routines';
export const ACTIVE_ROUTINE_KEY = 'shuttimer_active_routine';
export const SCHEDULED_ROUTINE_NOTIFS_KEY = 'shuttimer_routine_notifs';

export const ROUTINE_DEADLINE_MS = 24 * 60 * 60 * 1000;
export const ROUTINE_PREALERT_MINUTES = 5;
export const IOS_NOTIFICATION_SAFE_CAP = 54;

// ─── 시간 계산 헬퍼 ──────────────────────────────────────────

/** "HH:MM" → 분 단위 (0~1439). invalid = null */
export function parseHHMM(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  if (h < 0 || h > 23 || mm < 0 || mm > 59) return null;
  return h * 60 + mm;
}

/** step duration (분). endTime < startTime 이면 자정 넘김으로 간주하여 +1440. */
export function durationFromStep(step: RoutineStep): number {
  const s = parseHHMM(step.startTime);
  const e = parseHHMM(step.endTime);
  if (s === null || e === null) return 0;
  const diff = e - s;
  return diff >= 0 ? diff : diff + 24 * 60;
}

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
// Phase 1: v1.6 미출시 → 기존 missions 기반 데이터는 이 검증에서 탈락 (자동 삭제).

function isValidStep(s: any): s is RoutineStep {
  return (
    s &&
    typeof s.id === 'string' &&
    typeof s.name === 'string' &&
    typeof s.startTime === 'string' &&
    typeof s.endTime === 'string' &&
    parseHHMM(s.startTime) !== null &&
    parseHHMM(s.endTime) !== null
  );
}

function isValidRoutine(r: any): r is Routine {
  return (
    r &&
    typeof r.id === 'string' &&
    typeof r.name === 'string' &&
    typeof r.category === 'string' &&
    Array.isArray(r.steps) &&
    r.steps.every(isValidStep) &&
    typeof r.soundKey === 'string' &&
    typeof r.active === 'boolean' &&
    typeof r.autoAdvance === 'boolean' &&
    typeof r.createdAt === 'number'
  );
}

// ─── 헬퍼 ────────────────────────────────────────────────────

export function createRoutineId(): string {
  return `r_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createStepId(): string {
  return `s_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

/** 루틴 총 소요시간 (분) — 모든 step duration 합. */
export function totalRoutineMinutes(r: Routine): number {
  return r.steps.reduce((acc, s) => acc + durationFromStep(s), 0);
}

/** 진행률 0~1. ActiveRoutine 기반. */
export function routineProgress(r: Routine, ar: ActiveRoutine): number {
  const total = Math.max(1, r.steps.length);
  return Math.min(1, Math.max(0, ar.currentStepIndex / total));
}

/**
 * step 단위 세션 기록. step.name 을 icon 필드에 그대로 저장 (B안).
 * RoutineRun(포그라운드) + RoutineAlarm(배경 알림 경로) 둘 다 호출.
 * 중복 방지는 호출자 측 awaitingConfirm 플래그로 제어.
 */
export async function recordStepSession(r: Routine, stepIdx: number): Promise<void> {
  const step = r.steps[stepIdx];
  if (!step) return;
  try {
    const raw = await AsyncStorage.getItem(SESSIONS_STORAGE_KEY);
    const list: SessionRecord[] = raw ? JSON.parse(raw) : [];
    const d = new Date();
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    list.push({
      id: `s_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      date,
      icon: step.name,
      minutes: durationFromStep(step),
    });
    await AsyncStorage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify(list));
  } catch {
    // 세션 저장 실패 무시
  }
}

/**
 * 루틴의 "다음 예약 발화 시각" 계산. 예약 발화 시각은 steps[0].startTime 기준.
 * active=false 또는 schedule 없으면 null.
 */
export function nextOccurrenceTime(r: Routine, now: Date = new Date()): number | null {
  if (!r.active || !r.schedule) return null;
  const first = r.steps[0];
  if (!first) return null;
  const startMin = parseHHMM(first.startTime);
  if (startMin === null) return null;
  const hour = Math.floor(startMin / 60);
  const minute = startMin % 60;

  const effectiveDays = r.schedule.days.length === 0
    ? [0, 1, 2, 3, 4, 5, 6]
    : r.schedule.days;

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
