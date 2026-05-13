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

export async function saveAlarmMetadata(
  meta: Omit<AlarmMetaRecord, 'createdAt'>
): Promise<void> {
  const all = await loadAll();
  const next = all.filter(r => r.alarmId !== meta.alarmId);
  next.push({ ...meta, createdAt: Date.now() });
  await saveAll(next);
}

export async function loadAlarmMetadata(alarmId: string): Promise<AlarmMetaRecord | null> {
  const all = await loadAll();
  return all.find(r => r.alarmId === alarmId) ?? null;
}

export async function deleteAlarmMetadata(alarmId: string): Promise<void> {
  const all = await loadAll();
  const next = all.filter(r => r.alarmId !== alarmId);
  await saveAll(next);
}

export async function listAllAlarmMetadata(): Promise<AlarmMetaRecord[]> {
  return loadAll();
}

export async function clearAllAlarmMetadata(): Promise<void> {
  await AsyncStorage.removeItem(ALARM_METADATA_KEY);
}
