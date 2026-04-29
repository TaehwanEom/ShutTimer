// v1.6 Phase 10-A — App Group UserDefaults sync helper.
// LiveActivityIntent (native) ↔ RN 동기화 통로.
// timer + routine 양쪽 사용 (분리 정책 = file-local helper, 별도 파일).
// v1.6 Phase 12 — routine 측 chain 등록 폐기 (옵션 A). 단 timer (홈) 측은 단일 alarm 등록 유지 = writeChainAlarms 보존.
//                'advance' action 추가 (위젯 "다음 진행" Button perform 신호).

import AlarmkitBridge from '../../modules/alarmkit-bridge';

// v1.6 hotfix — 'open_app_dismiss' 추가. timer_main slide-to-stop 시 OpenAppDismissIntent 작성.
// v1.6 hotfix — 'advance_done' 추가. AdvanceNextStepIntent.perform() native 처리 후 RN 후속 동기화 신호.
export type LAControlAction = 'pause' | 'resume' | 'stop' | 'advance' | 'open_app_dismiss' | 'advance_done';

export type LAControlSignal = {
  action: LAControlAction;
  timestamp: number;
  routineId: string;
};

const KEY_SIGNAL = 'la_control_signal';
const KEY_ALARM_IDS_PREFIX = 'chain_alarms_';
const KEY_ROUTINE_SNAPSHOT = 'routine_snapshot';

/** LA Intent perform() → RN polling. App Group 의 control signal 1회 read. */
export function readControlSignal(): LAControlSignal | null {
  try {
    const raw = AlarmkitBridge.readAppGroupString(KEY_SIGNAL);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      typeof parsed?.action !== 'string' ||
      typeof parsed?.timestamp !== 'number' ||
      typeof parsed?.routineId !== 'string'
    ) {
      return null;
    }
    return parsed as LAControlSignal;
  } catch {
    return null;
  }
}

/** signal 처리 후 호출 (다음 polling 시 중복 처리 방지). */
export function clearControlSignal(): void {
  try {
    AlarmkitBridge.removeAppGroupKey(KEY_SIGNAL);
  } catch {}
}

/**
 * timer (홈) 측 단일 alarm 등록 시 App Group write. LA Intent perform() 가 read 해 AlarmKit pause/resume/cancel 호출.
 * v1.6 Phase 12 — routine 측 미사용. timer 측만 사용.
 */
export function writeChainAlarms(routineId: string, alarmIds: string[]): void {
  try {
    AlarmkitBridge.writeAppGroupString(`${KEY_ALARM_IDS_PREFIX}${routineId}`, JSON.stringify(alarmIds));
  } catch {}
}

/** timer (홈) 측 alarm cancel 시 App Group cleanup. */
export function clearChainAlarms(routineId: string): void {
  try {
    AlarmkitBridge.removeAppGroupKey(`${KEY_ALARM_IDS_PREFIX}${routineId}`);
  } catch {}
}

// v1.6 hotfix — routine snapshot. 잠금/백그라운드에서 AdvanceNextStepIntent.perform()
// 이 native 측 직접 다음 step alarm schedule 하기 위한 routine 데이터 mirror.
// RN setInterval 백그라운드 정지 우회 — perform() 안에서 routine_snapshot 읽고
// AlarmManager.shared.stop(현재 alarm) + AlarmManager.shared.schedule(다음 step) 직접 호출.

export type RoutineSnapshotStep = {
  /** step 이름 (UI 표시용) */
  name: string;
  /** step duration 초 */
  durationSec: number;
  /** AlarmKit AlertSound 이름 (사용자 설정 사운드 push file 명) */
  soundName: string;
};

export type RoutineSnapshot = {
  routineId: string;
  /** 루틴 이름 (LA Attribute routineName 과 동일) */
  routineName: string;
  /** 0-based 현재 step index */
  currentStepIndex: number;
  /** 총 step 수 */
  totalSteps: number;
  /** 모든 step 정보 (다음 step alarm 등록 시 필요) */
  steps: RoutineSnapshotStep[];
  /** 현재 fire 된 confirm_prompt alarm 의 ID — perform() 시 stop(id:) 호출 대상 */
  currentAlarmId: string;
  /** 현재 step 종료 timestamp ms (LA / 검증용) */
  stepEndAt: number;
  /** i18n mirror — native i18n 직접 접근 ❌. RN 가 미리 번역해 mirror */
  i18nConfirmPromptTitle: string;
  i18nConfirmPromptStop: string;
  i18nAdvanceLabel: string;
  /** snapshot 작성 시점 ms (stale 검증) */
  savedAt: number;
  /**
   * v1.6 hotfix — "다음 루틴 진행" 누름 후 다음 step 시작 전 대기 시간 (초).
   * routine.autoCountdownSec ?? 5. native perform() 시 fireAt 계산에 사용.
   */
  autoCountdownSec: number;
  /**
   * v1.6 hotfix B2-2 — native 측 다음 step 진행 시 누적되는 완료 step indices.
   * RN syncRoutineFromSnapshot 시 flush → recordStepSession 호출 (사용자 active 시점 일괄 record).
   * record timing = 실제 step 진행 시점 ❌ — 사용자 active 시점.
   * optional = 기존 snapshot Codable 호환 (cf8eaa8 빌드 디코딩).
   */
  completedStepIndices?: number[];
  /**
   * v1.6 hotfix B2-2 — native 측 마지막 step 종료 시 true.
   * RN sync 가 flush + fullCleanup + clearSnapshot 처리.
   */
  routineEnded?: boolean;
};

/**
 * 다음 step 진행을 native 가 할 수 있게 routine 데이터 mirror.
 * scheduleBackgroundNotif 호출 직후 호출 — currentAlarmId 와 ar.stepEndAt 동기화 필수.
 */
export function writeRoutineSnapshot(snapshot: RoutineSnapshot): void {
  try {
    AlarmkitBridge.writeAppGroupString(KEY_ROUTINE_SNAPSHOT, JSON.stringify(snapshot));
  } catch {}
}

/** routine 종료 시 cleanup. */
export function clearRoutineSnapshot(): void {
  try {
    AlarmkitBridge.removeAppGroupKey(KEY_ROUTINE_SNAPSHOT);
  } catch {}
}

/** RN 측 polling 에서 'advance_done' 처리 시 native 갱신본 read. */
export function readRoutineSnapshot(): RoutineSnapshot | null {
  try {
    const raw = AlarmkitBridge.readAppGroupString(KEY_ROUTINE_SNAPSHOT);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.routineId !== 'string' || typeof parsed?.currentStepIndex !== 'number') {
      return null;
    }
    return parsed as RoutineSnapshot;
  } catch {
    return null;
  }
}
