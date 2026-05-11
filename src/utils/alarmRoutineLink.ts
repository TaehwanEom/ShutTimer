// v1.7 Phase 2-A — 알람+루틴 통합 백엔드.
// alarm.steps[] 보유 알람 발화 dismiss 후 → ad-hoc Routine 생성 + startRoutine 호출.
// β architecture — 루틴 엔진 (startRoutine / scheduler / LiveActivity) 재사용 + UI 격리 (= 루틴 탭 비노출).
//
// ad-hoc routine 식별 = id prefix `aa_` (alarm-adhoc).
// AlarmEdit import 모달 + RoutineListScreen 측 = isAdhocAlarmRoutine 필터로 비노출.

import { Alarm } from '../constants/alarms';
import {
  Routine,
  loadRoutines,
  upsertRoutine,
  deleteRoutine,
  loadActiveRoutine,
} from '../constants/routines';
import { startRoutine, stopRoutine, StartRoutineResult } from './routineController';
import { getCachedDismissMethod } from './settingsCache';
import { DEFAULT_SETTINGS } from '../constants/settings';
import { Logger } from './logger';

const ADHOC_PREFIX = 'aa_';
// v1.7 Phase 2-A backward compat — 이전 폐기 세션 측 prefix. AsyncStorage 측 잔존 데이터 정리 + filter 감지.
const LEGACY_ADHOC_PREFIX = 'alarm_';

/** ad-hoc 알람 routine id 생성. alarmId 와 1:1 매핑 (= 같은 알람 재발화 시 동일 id 재사용 → upsert overwrite). */
export function createAlarmAdhocRoutineId(alarmId: string): string {
  return `${ADHOC_PREFIX}${alarmId}`;
}

/**
 * routineId 가 ad-hoc 알람 routine 인지 검사 (= UI filter 측 사용).
 * v1.7 Phase 2-A backward compat — `aa_` (현 prefix) + `alarm_` (이전 폐기 세션 측) 둘 다 감지.
 */
export function isAdhocAlarmRoutine(routineId: string): boolean {
  return routineId.startsWith(ADHOC_PREFIX) || routineId.startsWith(LEGACY_ADHOC_PREFIX);
}

export type StartFromAlarmResult = StartRoutineResult | { kind: 'no_steps' };

/**
 * 알람 발화 dismiss 후 호출.
 * 1. 진행 중 다른 routine 있으면 stop (= 사용자 의도 = 알람 step 우선).
 * 2. alarm.steps → ad-hoc Routine 객체 → upsertRoutine (overwrite).
 * 3. startRoutine(adhocId, override=true) 호출 → 엔진 시작 (ActiveRoutine + scheduler + LA).
 */
export async function startRoutineFromAlarm(alarm: Alarm): Promise<StartFromAlarmResult> {
  if (!alarm.steps || alarm.steps.length === 0) {
    return { kind: 'no_steps' };
  }
  const adhocId = createAlarmAdhocRoutineId(alarm.id);

  // v1.7 Phase 2-A — 무조건 stop (= 같은 adhocId 라도 = 이전 진행 상태 carry-over 차단).
  // 알람 매 발화 = fresh start. 이전 ActiveRoutine 측 currentStepIndex / stepEndAt 등 영향 ❌.
  const existing = await loadActiveRoutine();
  if (existing) {
    await stopRoutine().catch(() => {});
  }

  // ad-hoc Routine — 알람 메타 → routine 메타 mapping.
  // schedule 측 = undefined (= manual mode = 예약 ❌, 즉시 실행). active=true 강제.
  const adhocRoutine: Routine = {
    id: adhocId,
    category: alarm.label || 'alarm',
    name: alarm.label || undefined,
    steps: alarm.steps,
    active: true,
    // v1.7 hotfix #DismissMethodPurge — alarm.dismissMethod 폐기 → 전역 SettingsScreen 측 read.
    endMethod: getCachedDismissMethod() ?? DEFAULT_SETTINGS.dismissMethod,
    autoCountdownSec: 5,
    createdAt: Date.now(),
  };
  await upsertRoutine(adhocRoutine);

  // 엔진 시작 — override 양쪽 = 사용자 dismiss 직후 의도 = 무조건 진행.
  const result = await startRoutine(adhocId, {
    overrideActive: true,
    overrideTimer: true,
  });
  Logger.info(
    'alarmRoutineLink',
    `startRoutineFromAlarm alarm=${alarm.id} steps=${alarm.steps.length} kind=${result.kind}`,
  );
  return result;
}

/**
 * 앱 시작 시 호출.
 * 1. ActiveRoutine 측 ad-hoc 인데 대응 routines 항목 존재 ❌ → stale → stopRoutine 호출 (LA + ar 정리).
 * 2. routines 측 ad-hoc routines 중 = ActiveRoutine 측 사용 안 하는 것 모두 삭제.
 * 정상 흐름 = stopRoutine 후 다음 startRoutineFromAlarm 시점에 upsert overwrite 로 자연 정리.
 * 비정상 종료 / 다른 알람 fire 안 함 / 이전 폐기 세션 잔존 = 누적 → 본 cleanup 으로 정리.
 */
export async function cleanupStaleAdhocRoutines(): Promise<void> {
  try {
    const routines = await loadRoutines();
    const ar = await loadActiveRoutine();

    // 1. ActiveRoutine ad-hoc 측 stale 검사 → stopRoutine.
    //    legacy `alarm_` prefix 측 = 이전 폐기 세션 잔존 = 항상 stale → 무조건 stop.
    //    현 prefix `aa_` 측 = routines 항목 존재 ❌ 시만 stop.
    if (ar && isAdhocAlarmRoutine(ar.routineId)) {
      const isLegacy = ar.routineId.startsWith(LEGACY_ADHOC_PREFIX);
      const exists = routines.find(r => r.id === ar.routineId);
      if (isLegacy || !exists) {
        await stopRoutine().catch(() => {});
        Logger.info('alarmRoutineLink', `cleanupStaleAdhocRoutines stopped stale ar=${ar.routineId} legacy=${isLegacy}`);
      }
    }

    // 2. routines 측 ad-hoc 잔존 정리. (1 단계 후 ar 갱신.)
    const updatedAr = await loadActiveRoutine();
    const activeAdhocId = updatedAr && isAdhocAlarmRoutine(updatedAr.routineId) ? updatedAr.routineId : null;
    let removed = 0;
    for (const r of routines) {
      if (isAdhocAlarmRoutine(r.id) && r.id !== activeAdhocId) {
        await deleteRoutine(r.id);
        removed += 1;
      }
    }
    if (removed > 0) {
      Logger.info('alarmRoutineLink', `cleanupStaleAdhocRoutines removed=${removed}`);
    }
  } catch (e) {
    Logger.warn('alarmRoutineLink', `cleanupStaleAdhocRoutines failed: ${e}`);
  }
}
