// v1.6 T1 — AlarmKit alarmId → 메타데이터 mapping table.
// Alarm struct 에 metadata 필드 부재 (swiftinterface L223-229) 로 JS 측 보관.
// scheduleConfirmPromptViaAlarmKit / scheduleRoutinePrealerts / scheduleAlarmMain 측 등록 시 저장 + cancel 시 삭제.
// App.tsx onAlarmStateChange listener 가 alarmId 로 lookup 후 confirm_prompt / prealert / alarm_main / timer_main 분기.

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AlarmKitType, AlarmKitEndMethod } from '../../modules/alarmkit-bridge';

const ALARM_METADATA_KEY = 'shuttimer_alarmkit_metadata';

export type AlarmMetaRecord = {
  alarmId: string;
  type: AlarmKitType;
  /** v1.6+ — entityId (= 카테고리 B rename, 결정 4-B). 루틴/타이머/알람 식별자 공통. */
  entityId: string;
  nextStepIndex?: number;
  endMethod?: AlarmKitEndMethod;
  createdAt: number;
  /**
   * v1.8 #AlarmRepeatLazy — chain 순번 (= 0..49). type='alarm_main' 측만 사용.
   * 첫 alarm = 0. listener 측 = chainIndex+1 측 다음 chain schedule.
   */
  chainIndex?: number;
  /**
   * v1.8 #AlarmRepeatLazy — 첫 chain fireAt (ms timestamp). type='alarm_main' 측만 사용.
   * 다음 chain fireAt = chainBaseFireAt + chainIndex * 120000.
   */
  chainBaseFireAt?: number;
  /**
   * v1.9 #SoftDelete — cancelAlarmsForEntity 측 F0 시점 = deleted=true set (= 정식 delete X).
   *   F2 verify retry 후 = stale=0 시점 = 정식 delete. stale>0 시 = metadata 잔존 → 다음 fire 시
   *   App.tsx listener 측 = deleted===true 시 silent native cancel + return (= 사용자 화면 진입 X).
   *   직전 = F0 정식 delete → cancel 실패 시 = native banner+사운드 잔존 fire = orphan 동일 회귀.
   */
  deleted?: boolean;
  /**
   * 2026-06-24 #RealertMetaCleanup — type='confirm_prompt' 중 단계 종료 재알림 체인 멤버 표시.
   *   primary confirm_prompt(.timer 카운트다운)는 false/undefined, 2분 간격 재알림(.fixed)은 true.
   *   발화 후 OS가 .fixed를 자동 제거하나 JS metadata는 잔존 → listener가 realert=true만 발화 후 정식 삭제(장부 누수 차단).
   *   primary는 advance/#ConfirmPromptDedup이 정리하므로 보존.
   */
  realert?: boolean;
};

async function loadAll(): Promise<AlarmMetaRecord[]> {
  try {
    const raw = await AsyncStorage.getItem(ALARM_METADATA_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function saveAll(list: AlarmMetaRecord[]): Promise<void> {
  await AsyncStorage.setItem(ALARM_METADATA_KEY, JSON.stringify(list));
}

// v1.8 #MappingLock — 장부 read-modify-write 직렬화 뮤텍스.
//   직전: saveAlarmMetadata / deleteAlarmMetadata 가 lock 없이 loadAll → modify → saveAll 수행 →
//     동시 호출 시(콜드 스타트 syncRollingSchedule ∥ syncAllAlarms·migrateSoundRename) 한쪽 항목 유실
//     → AlarmKit 등록은 됐는데 장부엔 없는 "유령 알람" 발생 (= churn / orphan root cause).
//   정정: 모든 장부 mutation 을 단일 promise chain 으로 직렬화 → read-modify-write 원자성 보장.
let mappingWriteChain: Promise<unknown> = Promise.resolve();

function runMappingExclusive<T>(fn: () => Promise<T>): Promise<T> {
  const result = mappingWriteChain.then(fn, fn);
  // 다음 작업은 result 가 settle(성공/실패 무관)된 뒤 진행. 에러는 삼켜 chain 정지 방지.
  mappingWriteChain = result.then(() => undefined, () => undefined);
  return result;
}

export async function saveAlarmMetadata(
  meta: Omit<AlarmMetaRecord, 'createdAt'>
): Promise<void> {
  return runMappingExclusive(async () => {
    const all = await loadAll();
    const next = all.filter(r => r.alarmId !== meta.alarmId);
    next.push({ ...meta, createdAt: Date.now() });
    await saveAll(next);
  });
}

export async function loadAlarmMetadata(alarmId: string): Promise<AlarmMetaRecord | null> {
  // v1.9 #ReadLockRace — runMappingExclusive 측 wrap → markAlarmDeleted 측 write chain 완료 후 read 보장.
  //   직전 = 직접 loadAll().find() → markAlarmDeleted 측 write 측 진행 중 시 = read 측 deleted=false 읽음 → listener silent skip 실패.
  return runMappingExclusive(async () => {
    const all = await loadAll();
    return all.find(r => r.alarmId === alarmId) ?? null;
  });
}

export async function deleteAlarmMetadata(alarmId: string): Promise<void> {
  return runMappingExclusive(async () => {
    const all = await loadAll();
    const next = all.filter(r => r.alarmId !== alarmId);
    await saveAll(next);
  });
}

/**
 * v1.9 #SoftDelete — alarmId 측 deleted=true flag set (= 정식 delete X).
 *   cancelAlarmsForEntity 측 F0 시점 호출. F2 verify 후 stale=0 시점 = 정식 deleteAlarmMetadata 호출.
 *   listener (App.tsx onAlarmStateChange) 측 = meta.deleted===true 감지 시 = silent native cancel + return.
 */
export async function markAlarmDeleted(alarmId: string): Promise<void> {
  return runMappingExclusive(async () => {
    const all = await loadAll();
    const next = all.map(r => (r.alarmId === alarmId ? { ...r, deleted: true } : r));
    await saveAll(next);
  });
}

export async function listAllAlarmMetadata(): Promise<AlarmMetaRecord[]> {
  // v1.9 #ReadLockRace — runMappingExclusive 측 wrap → write chain 완료 후 read 보장.
  return runMappingExclusive(async () => loadAll());
}

export async function clearAllAlarmMetadata(): Promise<void> {
  return runMappingExclusive(async () => {
    await AsyncStorage.removeItem(ALARM_METADATA_KEY);
  });
}
