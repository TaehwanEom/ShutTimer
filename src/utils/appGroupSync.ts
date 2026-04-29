// v1.6 Phase 10-A — App Group UserDefaults sync helper.
// LiveActivityIntent (native) ↔ RN 동기화 통로.
// timer + routine 양쪽 사용 (분리 정책 = file-local helper, 별도 파일).
// v1.6 Phase 12 — routine 측 chain 등록 폐기 (옵션 A). 단 timer (홈) 측은 단일 alarm 등록 유지 = writeChainAlarms 보존.
//                'advance' action 추가 (위젯 "다음 진행" Button perform 신호).

import AlarmkitBridge from '../../modules/alarmkit-bridge';

// v1.6 hotfix — 'open_app_dismiss' 추가. timer_main slide-to-stop 시 OpenAppDismissIntent 작성.
export type LAControlAction = 'pause' | 'resume' | 'stop' | 'advance' | 'open_app_dismiss';

export type LAControlSignal = {
  action: LAControlAction;
  timestamp: number;
  routineId: string;
};

const KEY_SIGNAL = 'la_control_signal';
const KEY_ALARM_IDS_PREFIX = 'chain_alarms_';

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
