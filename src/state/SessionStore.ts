// v2.0 P2.2 — Session storage layer.
//
// 단일 active session 보관 (key=@shuttimer/session). 동시 active session 1개만 가정.
// read/write 양쪽 mutex로 race 보호 (= 기존 mappingTable mutex 패턴 정합, 단 read도 보호).
// 메모리 cache 1차 + AsyncStorage 백업. 읽기는 cache hit 시 즉시 반환.
// migration: legacy keys (ACTIVE_TIMER_KEY / ACTIVE_ROUTINE_KEY / IS_ROUTINE_ACTIVE_KEY / RoutineSnapshot) 흡수.
//   1회성 실행 + flag 가드 (반복 churn 차단). legacy keys는 1 release 보존 후 제거 (rollback 안전).
//
// 본 파일은 신규 파일. 기존 코드 수정 0. P3 단계에서 SessionController 가 호출.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Session, Step } from '../types/session';
import { Logger } from '../utils/logger';
import { loadActiveRoutine, loadRoutines } from '../constants/routines';
import { isAdhocAlarmRoutine } from '../utils/alarmRoutineLink';

// ───────────────────────────────────────────────────────────
// Storage keys + schema version
// ───────────────────────────────────────────────────────────

export const SESSION_KEY = '@shuttimer/session';
export const SESSION_MIGRATION_FLAG_KEY = '@shuttimer/session_migration_v1';

const CURRENT_SCHEMA_VERSION: 1 = 1;

// ───────────────────────────────────────────────────────────
// In-memory cache (write-through)
// ───────────────────────────────────────────────────────────

let cache: Session | null = null;
let cacheLoaded = false;

// ───────────────────────────────────────────────────────────
// Mutex — read/write 양쪽 보호.
//   기존 mappingTable mutex 는 write only → loadAlarmMetadata dirty read 가능 (N3).
//   본 SessionStore 는 read도 보호 → cache snapshot 일관성 보장.
// ───────────────────────────────────────────────────────────

let storeLock: Promise<unknown> = Promise.resolve();

function runExclusive<T>(fn: () => Promise<T>): Promise<T> {
  const result = storeLock.then(fn, fn);
  // chain 에러 무시. 다음 작업 진행 보장.
  storeLock = result.then(() => undefined, () => undefined);
  return result;
}

// ───────────────────────────────────────────────────────────
// Public API
// ───────────────────────────────────────────────────────────

/**
 * 현재 active session 읽기. cache hit 시 즉시 반환.
 * 첫 호출 시 AsyncStorage 에서 load + cache.
 */
export async function loadSession(): Promise<Session | null> {
  return runExclusive(async () => {
    if (cacheLoaded) return cache;
    try {
      const raw = await AsyncStorage.getItem(SESSION_KEY);
      if (!raw) {
        cache = null;
        cacheLoaded = true;
        return null;
      }
      const parsed = JSON.parse(raw);
      if (isValidSession(parsed)) {
        cache = parsed as Session;
      } else {
        Logger.warn('SessionStore', `loadSession invalid schema → null reset`);
        cache = null;
      }
      cacheLoaded = true;
      return cache;
    } catch (e) {
      Logger.warn('SessionStore', `loadSession error=${String(e)}`);
      cache = null;
      cacheLoaded = true;
      return null;
    }
  });
}

/**
 * session 저장. null 전달 시 session 삭제.
 * write-through: cache + AsyncStorage 동시 갱신.
 * updatedAt 자동 갱신.
 */
export async function saveSession(session: Session | null): Promise<void> {
  return runExclusive(async () => {
    try {
      if (session === null) {
        cache = null;
        cacheLoaded = true;
        // v2.0 P0-A R-4 fix — removeItem 측 retry + verify.
        //   log02 측 dispatch Stop CONFIRMING 후 cold-start 측 SCHEDULED 잔존 회귀.
        //   원인: AsyncStorage.removeItem 측 silent 실패 + catch warn → storage 측 옛 session JSON 잔존.
        //   fix: 3회 retry + getItem 측 verify (null 확인).
        let removed = false;
        for (let i = 0; i < 3; i++) {
          await AsyncStorage.removeItem(SESSION_KEY).catch(() => {});
          const check = await AsyncStorage.getItem(SESSION_KEY).catch(() => null);
          if (!check) {
            removed = true;
            break;
          }
          Logger.warn('SessionStore', `saveSession(null) removeItem retry=${i + 1}`);
        }
        if (!removed) {
          Logger.warn(
            'SessionStore',
            'saveSession(null) 3-retry FAIL — SESSION_KEY storage 측 옛 session 잔존 가능. cold-start 측 회귀 위험.'
          );
        }
        return;
      }
      const next: Session = { ...session, updatedAt: Date.now() };
      cache = next;
      cacheLoaded = true;
      await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(next));
    } catch (e) {
      Logger.warn('SessionStore', `saveSession error=${String(e)}`);
    }
  });
}

/** session 삭제 (= IDLE 복귀). */
export async function clearSession(): Promise<void> {
  await saveSession(null);
}

/** 테스트/migration 용 cache 무효화. 다음 loadSession 시 AsyncStorage 재read. */
export function invalidateCache(): void {
  cache = null;
  cacheLoaded = false;
}

// ───────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────

export function createSessionId(): string {
  return `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function isValidSession(p: any): p is Session {
  return (
    p &&
    typeof p === 'object' &&
    typeof p.sessionId === 'string' &&
    typeof p.kind === 'string' &&
    Array.isArray(p.steps) &&
    typeof p.currentStepIndex === 'number' &&
    typeof p.state === 'string' &&
    p.schemaVersion === CURRENT_SCHEMA_VERSION
  );
}

// ───────────────────────────────────────────────────────────
// Migration — legacy keys → Session 통합
//
// 호출: 앱 cold-start 1회. SessionController.bootstrap 측에서 가드.
// 안전성: 1회성 flag + legacy keys 1 release 보존 (rollback).
// ───────────────────────────────────────────────────────────

// v2.0 J — 실제 storage key 정합. 옛 키 정정 (이전 정의 오타).
const LEGACY_ACTIVE_ROUTINE_KEY = 'shuttimer_active_routine'; // 옛 ActiveRoutine
const LEGACY_IS_ROUTINE_ACTIVE_KEY = 'isRoutineActive';        // 옛 routineController.ts:47
const LEGACY_ACTIVE_TIMER_KEY = 'activeTimer';                 // 옛 routineController.ts:48 / HomeScreen.tsx:76

export async function migrateLegacyToSession(): Promise<{
  migrated: boolean;
  source: 'routine' | 'timer' | 'none';
}> {
  return runExclusive(async () => {
    // 1회성 가드
    const flag = await AsyncStorage.getItem(SESSION_MIGRATION_FLAG_KEY).catch(() => null);
    if (flag) {
      Logger.info('SessionStore', `migrateLegacyToSession skip — flag set`);
      return { migrated: false, source: 'none' as const };
    }

    // 이미 새 session 있으면 skip + flag set
    const existingRaw = await AsyncStorage.getItem(SESSION_KEY).catch(() => null);
    if (existingRaw) {
      await AsyncStorage.setItem(SESSION_MIGRATION_FLAG_KEY, String(Date.now())).catch(() => {});
      return { migrated: false, source: 'none' as const };
    }

    try {
      // routine 측 — 옛 ActiveRoutine → Session 변환
      const ar = await loadActiveRoutine();
      if (ar) {
        const routines = await loadRoutines();
        const target = routines.find((r) => r.id === ar.routineId);
        if (target) {
          const steps: Step[] = target.steps.map((s, idx) => ({
            index: idx,
            name: s.name,
            durationSeconds: s.durationSeconds,
            endMethod: target.endMethod,
            soundName: '',
          }));
          const now = Date.now();
          const kind = isAdhocAlarmRoutine(ar.routineId) ? 'ad_hoc_routine' : 'routine';
          const state: Session['state'] = ar.awaitingConfirm
            ? 'CONFIRMING'
            : ar.pausedAt !== null
              ? 'PAUSED'
              : 'SCHEDULED';
          const session: Session = {
            sessionId: ar.routineId,
            kind,
            steps,
            currentStepIndex: ar.currentStepIndex,
            startedAt: ar.startedAt,
            stepEndAt: ar.stepEndAt,
            deadlineAt: ar.deadlineAt,
            pausedAt: ar.pausedAt,
            state,
            awaitingConfirm: ar.awaitingConfirm,
            alarmBinding: null,
            pendingResult: null,
            laMeta: {
              routineName: target.name ?? target.category,
              stepName: target.steps[ar.currentStepIndex]?.name ?? '',
              stepIndex: ar.currentStepIndex,
              totalSteps: target.steps.length,
            },
            createdAt: now,
            updatedAt: now,
            schemaVersion: 1,
          };
          cache = session;
          cacheLoaded = true;
          await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(session));
          await AsyncStorage.setItem(SESSION_MIGRATION_FLAG_KEY, String(Date.now())).catch(() => {});
          Logger.warn(
            'SessionStore',
            `migrateLegacyToSession routine OK sessionId=${ar.routineId} kind=${kind} state=${state} stepIdx=${ar.currentStepIndex}`
          );
          return { migrated: true, source: 'routine' as const };
        }
        // routine entity 부재 (사용자가 삭제) — ar 폐기
        Logger.warn(
          'SessionStore',
          `migrateLegacyToSession routine entity not found id=${ar.routineId} — discarding stale ar`
        );
        await AsyncStorage.removeItem(LEGACY_ACTIVE_ROUTINE_KEY).catch(() => {});
        await AsyncStorage.removeItem(LEGACY_IS_ROUTINE_ACTIVE_KEY).catch(() => {});
      }

      // timer 측 — HomeScreen 측 timer kind 미통합 (별도 작업). flag만 set + 옛 동작 보존.
      const timerRaw = await AsyncStorage.getItem(LEGACY_ACTIVE_TIMER_KEY).catch(() => null);
      if (timerRaw) {
        Logger.info('SessionStore', `migrateLegacyToSession detected timer — preserved (timer kind 미통합)`);
        await AsyncStorage.setItem(SESSION_MIGRATION_FLAG_KEY, String(Date.now())).catch(() => {});
        return { migrated: false, source: 'timer' as const };
      }

      await AsyncStorage.setItem(SESSION_MIGRATION_FLAG_KEY, String(Date.now())).catch(() => {});
      return { migrated: false, source: 'none' as const };
    } catch (e) {
      Logger.warn('SessionStore', `migrateLegacyToSession error=${String(e)}`);
      return { migrated: false, source: 'none' as const };
    }
  });
}

// ───────────────────────────────────────────────────────────
// Test/debug helpers (production unused)
// ───────────────────────────────────────────────────────────

/** 테스트용 — migration flag 강제 reset. production code 미사용. */
export async function __resetMigrationFlag(): Promise<void> {
  await AsyncStorage.removeItem(SESSION_MIGRATION_FLAG_KEY).catch(() => {});
}
