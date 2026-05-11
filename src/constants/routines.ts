// v1.6 신 데이터 모델: 루틴 묶음 = 카테고리 + 시작시간 + 시퀀셜 step 들.
// 각 step 은 이름 + duration(초). 첫 step 은 schedule.startTime 부터, 이후는 자동 누적 (시간 갭 무시).
// Routine.name 제거 — 카테고리가 묶음 식별, step.name 이 작업 식별.
// 단일 타이머(ACTIVE_TIMER_KEY)와 상호 배타.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { SESSIONS_STORAGE_KEY, SessionRecord } from './sessions';

// ─── 타입 ────────────────────────────────────────────────────

export type RoutineStep = {
  id: string;
  name: string;
  /** 작업 길이 (초 단위). 0 이상. */
  durationSeconds: number;
  /** MISSION_POOL 키 또는 이모지/아이콘 식별자. 선택적. */
  icon?: string;
};

export type RoutineSchedule = {
  /** "HH:MM" 24h. 첫 step 시작 시각 (= 루틴 묶음 시작 시각). */
  startTime: string;
  /** 실행 요일. 0(일)~6(토). 빈 배열 = 매일 */
  days: number[];
};

/** step 종료 방식. auto = 알람 없이 즉시 다음 step. 나머지 3종은 알람 출력 후 해당 방식으로 종료. */
// v1.6 Phase 12 — 'auto' 제거. iOS 백그라운드 자동 진행 = 서버 push 인프라 필요 (별도 사이클).
// 기존 'auto' 데이터 = loadRoutines 안 silent migration → 'tap' 변환 (사용자 데이터 보존).
export type RoutineEndMethod = 'tap' | 'shake' | 'camera';

export type Routine = {
  id: string;
  /** 카테고리 id (FIXED_CATEGORIES 또는 custom_xxx). 필수. */
  category: string;
  /** 루틴 이름 (부제). 선택적. 비우면 카테고리 라벨로 표기. */
  name?: string;
  steps: RoutineStep[];
  /** 예약 없는 수동 실행 루틴 허용. schedule 없거나 active=false면 예약 스킵. */
  schedule?: RoutineSchedule;
  /** 스케줄 on/off 토글. false면 예약 등록 안 됨. */
  active: boolean;
  /** step 종료 방식. */
  endMethod: RoutineEndMethod;
  /**
   * v1.6 hotfix — "다음 루틴 진행" 누름 후 다음 step 시작까지 대기 시간 (초).
   * 0~60 범위. default 5. 양쪽 흐름 (앱 내 + 잠금/백그라운드) 동일 카운트.
   * 의미 변경 (이전 'auto' 모드 카운트 → 진행 후 대기 카운트). 필드 보존.
   */
  autoCountdownSec?: number;
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
/** v1.6 T2 — 다단계 prealert 시간 (분). 시작 30분 전 + 5분 전 2회 알림. */
export const ROUTINE_PREALERT_MINUTES_LIST: readonly number[] = [30, 5];
/** @deprecated v1.6 T2 — 다단계로 전환됨. ROUTINE_PREALERT_MINUTES_LIST 사용. */
export const ROUTINE_PREALERT_MINUTES = 5;
export const IOS_NOTIFICATION_SAFE_CAP = 54;

// ─── 모드 헬퍼 ───────────────────────────────────────────────
// schedule 유무로 예약/일반 구분 (단일 source of truth, invalid state 불가)
export type RoutineMode = 'scheduled' | 'manual';
export function getRoutineMode(r: Routine): RoutineMode {
  return r.schedule ? 'scheduled' : 'manual';
}
export function getRoutineTotalSeconds(r: Routine): number {
  return r.steps.reduce((acc, s) => acc + s.durationSeconds, 0);
}

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

/** 분 단위 → "HH:MM" */
export function formatHHMM(totalMin: number): string {
  const m = ((totalMin % (24 * 60)) + 24 * 60) % (24 * 60);
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

// ─── CRUD ────────────────────────────────────────────────────

export async function loadRoutines(): Promise<Routine[]> {
  try {
    const raw = await AsyncStorage.getItem(ROUTINES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // v1.6 Phase 12 — silent migration: 'auto' endMethod = 'tap' 으로 변환 (사용자 데이터 보존).
    const migrated = parsed.map((r: any) => {
      if (r && r.endMethod === 'auto') {
        return { ...r, endMethod: 'tap' };
      }
      return r;
    });
    return migrated.filter(isValidRoutine);
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
// 신 모델: durationSeconds 기반. 기존 durationMinutes / startTime/endTime 데이터는 자동 탈락.

function isValidStep(s: any): s is RoutineStep {
  return (
    s &&
    typeof s.id === 'string' &&
    typeof s.name === 'string' &&
    typeof s.durationSeconds === 'number' &&
    s.durationSeconds >= 0
  );
}

function isValidSchedule(s: any): s is RoutineSchedule {
  return (
    s &&
    typeof s.startTime === 'string' &&
    parseHHMM(s.startTime) !== null &&
    Array.isArray(s.days) &&
    s.days.every((d: any) => typeof d === 'number' && d >= 0 && d <= 6)
  );
}

function isValidRoutine(r: any): r is Routine {
  return (
    r &&
    typeof r.id === 'string' &&
    typeof r.category === 'string' &&
    Array.isArray(r.steps) &&
    r.steps.every(isValidStep) &&
    (r.schedule === undefined || isValidSchedule(r.schedule)) &&
    typeof r.active === 'boolean' &&
    (r.endMethod === 'tap' || r.endMethod === 'shake' || r.endMethod === 'camera') &&
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

/** 루틴 총 소요시간 (초) — 모든 step duration 합. */
export function totalRoutineSeconds(r: Routine): number {
  return r.steps.reduce((acc, s) => acc + Math.max(0, s.durationSeconds), 0);
}

/** 진행률 0~1. ActiveRoutine 기반. */
export function routineProgress(r: Routine, ar: ActiveRoutine): number {
  const total = Math.max(1, r.steps.length);
  return Math.min(1, Math.max(0, ar.currentStepIndex / total));
}

/**
 * 특정 step 의 표시용 시작 시각 (분 단위, schedule.startTime 기준 누적).
 * step[0] = schedule.startTime
 * step[i] = schedule.startTime + sum(step[0..i-1].durationSeconds / 60)
 * schedule 없으면 null.
 */
export function stepStartMinutes(r: Routine, stepIdx: number): number | null {
  if (!r.schedule) return null;
  const base = parseHHMM(r.schedule.startTime);
  if (base === null) return null;
  let accSeconds = 0;
  for (let i = 0; i < stepIdx && i < r.steps.length; i++) {
    accSeconds += Math.max(0, r.steps[i].durationSeconds);
  }
  return base + Math.floor(accSeconds / 60);
}

/** step 표시용 시작 시각 ("HH:MM"). schedule 없으면 null. */
export function stepStartTimeStr(r: Routine, stepIdx: number): string | null {
  const m = stepStartMinutes(r, stepIdx);
  return m === null ? null : formatHHMM(m);
}

/**
 * step 단위 세션 기록. step.name 을 icon 필드에 그대로 저장 (B안).
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
      minutes: Math.round(Math.max(0, step.durationSeconds) / 60),
    });
    await AsyncStorage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify(list));
  } catch {
    // 세션 저장 실패 무시
  }
}

/**
 * 루틴의 "다음 예약 발화 시각" 계산. schedule.startTime 기준.
 * active=false 또는 schedule 없으면 null.
 */
export function nextOccurrenceTime(r: Routine, now: Date = new Date()): number | null {
  if (!r.active || !r.schedule) return null;
  const startMin = parseHHMM(r.schedule.startTime);
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
