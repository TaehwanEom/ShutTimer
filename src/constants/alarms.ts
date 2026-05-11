// v1.6+ 알람 데이터 모델 + CRUD + 발화 시각 계산.
// 루틴 (routines.ts) 과 별개 entity. AlarmKit 단독 (iOS 26+).

import AsyncStorage from '@react-native-async-storage/async-storage';
import { RoutineStep } from './routines';

export type AlarmRepeat = 'once' | 'daily' | 'weekly';

export type Alarm = {
  id: string;
  /** "HH:MM" 24h 발화 시각 */
  time: string;
  repeat: AlarmRepeat;
  /** repeat='weekly' 시 0(일)~6(토). 다른 mode 측 무시. */
  days: number[];
  label: string;
  enabled: boolean;
  createdAt: number;
  /**
   * v1.7 — 알람+루틴 통합. 발화 후 진행할 step 시퀀스. undefined / 빈 배열 = 단독 알람.
   * Phase 2 측 = 알람 dismiss 후 step runner 진입 (= β architecture).
   */
  steps?: RoutineStep[];
};

export const ALARMS_KEY = 'shuttimer_alarms';

// ─── 시간 계산 ──────────────────────────────────────

function parseHHMM(s: string): { h: number; m: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  if (h < 0 || h > 23 || mm < 0 || mm > 59) return null;
  return { h, m: mm };
}

/**
 * 알람의 다음 발화 시각 (ms timestamp). disabled / 시각 invalid → null.
 * - once / daily: 가장 가까운 미래 발화 (= 오늘 시각 미경과 시 = 오늘, else 내일)
 * - weekly: 선택 요일 측 가장 가까운 미래 발화. days 빈 배열 → null
 */
export function nextAlarmOccurrenceTime(alarm: Alarm, now: Date = new Date()): number | null {
  if (!alarm.enabled) return null;
  const t = parseHHMM(alarm.time);
  if (!t) return null;

  const buildAt = (offsetDays: number): Date => {
    const d = new Date(now);
    d.setDate(d.getDate() + offsetDays);
    d.setHours(t.h, t.m, 0, 0);
    return d;
  };

  if (alarm.repeat === 'once' || alarm.repeat === 'daily') {
    for (let offset = 0; offset < 8; offset++) {
      const d = buildAt(offset);
      if (d.getTime() > now.getTime()) return d.getTime();
    }
    return null;
  }

  // weekly
  if (alarm.days.length === 0) return null;
  for (let offset = 0; offset < 8; offset++) {
    const d = buildAt(offset);
    if (!alarm.days.includes(d.getDay())) continue;
    if (d.getTime() <= now.getTime()) continue;
    return d.getTime();
  }
  return null;
}

// ─── 유효성 검증 ────────────────────────────────────

function isValidRepeat(r: any): r is AlarmRepeat {
  return r === 'once' || r === 'daily' || r === 'weekly';
}

function isValidAlarmStep(s: any): boolean {
  return (
    s &&
    typeof s.id === 'string' &&
    typeof s.name === 'string' &&
    typeof s.durationSeconds === 'number' &&
    s.durationSeconds >= 0
  );
}

export function isValidAlarm(a: any): a is Alarm {
  if (
    !a ||
    typeof a.id !== 'string' ||
    typeof a.time !== 'string' ||
    parseHHMM(a.time) === null ||
    !isValidRepeat(a.repeat) ||
    !Array.isArray(a.days) ||
    !a.days.every((d: any) => typeof d === 'number' && d >= 0 && d <= 6) ||
    typeof a.label !== 'string' ||
    typeof a.enabled !== 'boolean' ||
    typeof a.createdAt !== 'number'
  ) {
    return false;
  }
  // steps 측 = optional. 존재 시 = 배열 + 모든 step valid.
  if (a.steps !== undefined) {
    if (!Array.isArray(a.steps)) return false;
    if (!a.steps.every(isValidAlarmStep)) return false;
  }
  return true;
}

// ─── CRUD ───────────────────────────────────────────

export async function loadAlarms(): Promise<Alarm[]> {
  try {
    const raw = await AsyncStorage.getItem(ALARMS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidAlarm);
  } catch {
    return [];
  }
}

export async function saveAlarms(list: Alarm[]): Promise<void> {
  await AsyncStorage.setItem(ALARMS_KEY, JSON.stringify(list));
}

export async function upsertAlarm(a: Alarm): Promise<Alarm[]> {
  const list = await loadAlarms();
  const idx = list.findIndex(x => x.id === a.id);
  if (idx >= 0) list[idx] = a;
  else list.push(a);
  await saveAlarms(list);
  return list;
}

export async function deleteAlarm(id: string): Promise<Alarm[]> {
  const list = await loadAlarms();
  const filtered = list.filter(x => x.id !== id);
  await saveAlarms(filtered);
  return filtered;
}

// ─── 헬퍼 ───────────────────────────────────────────

export function createAlarmId(): string {
  return `a_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
