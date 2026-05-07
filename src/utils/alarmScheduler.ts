// 알람 스케줄러 — AlarmKit 단독 (iOS 26+).
// .alarm(schedule:) factory + .relative(.weekly([...])) recurrence (= OS 자동 반복).
// 재예약 listener ❌ (= 결정 5-A 정합).
// 한 번만 비활성 listener: AlarmKit alerting event → alarm.repeat='once' detection → enabled=false 처리.
// sessions 기록: 알람 dismiss 시점 → SessionRecord (icon='alarm' 고정, minutes=0).

import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import AlarmkitBridge from '../../modules/alarmkit-bridge';
import {
  Alarm,
  loadAlarms,
  upsertAlarm,
  nextAlarmOccurrenceTime,
} from '../constants/alarms';
import {
  saveAlarmMetadata,
  deleteAlarmMetadata,
  listAllAlarmMetadata,
} from './alarmkitMappingTable';
import { ALARM_SOUNDS, DEFAULT_SOUND_ID } from '../constants/sounds';
import { Logger } from './logger';
import { SESSIONS_STORAGE_KEY, SessionRecord } from '../constants/sessions';

// ─── AlarmKit 가용성 ──────────────────────────────────────

function isAlarmKitAvailableSync(): boolean {
  if (Platform.OS !== 'ios') return false;
  const ver = parseInt(String(Platform.Version), 10);
  if (isNaN(ver) || ver < 26) return false;
  try {
    return AlarmkitBridge.isAvailable();
  } catch {
    return false;
  }
}

async function isAlarmKitReady(): Promise<boolean> {
  if (!isAlarmKitAvailableSync()) return false;
  try {
    const state = await AlarmkitBridge.getAuthorizationState();
    return state === 'authorized';
  } catch {
    return false;
  }
}

// ─── 사운드 resolve ──────────────────────────────────────

function resolveSoundName(soundKey: string): string | undefined {
  const item =
    ALARM_SOUNDS.find(s => s.id === soundKey) ??
    ALARM_SOUNDS.find(s => s.id === DEFAULT_SOUND_ID);
  return (item as any)?.pushSound;
}

// ─── 스케줄링 ────────────────────────────────────────────

/**
 * 알람 entity 측 AlarmKit 등록.
 * iOS 26+ + authorized 시만 진입. 그 외 = silent skip (= AlarmListScreen 측 Platform 분기 정합).
 *
 * recurrence 옵션:
 *   - repeat='once' → recurrence 미전달 = .timer(duration:) 분기 (= 단발)
 *   - repeat='daily' → recurrence: { mode: 'daily' } = .alarm(schedule:) + .relative(.weekly(7요일))
 *   - repeat='weekly' → recurrence: { mode: 'weekly', days: alarm.days } = .alarm(schedule:) + .relative(.weekly(선택 요일))
 */
export async function scheduleAlarmMain(alarm: Alarm): Promise<string | null> {
  if (!alarm.enabled) return null;
  if (!(await isAlarmKitReady())) return null;

  const fireAt = nextAlarmOccurrenceTime(alarm);
  if (fireAt === null) return null;

  const soundName = resolveSoundName(alarm.soundKey);
  // v1.7 hotfix #DBG-D — soundKey → soundName 매핑 결과 출력 (= 사운드 ❌ / 다른 사운드 root cause 추적용).
  // soundName=undefined 시 = ALARM_SOUNDS lookup ❌ → AlarmKit 측 .default fallback (= 시스템음).
  // Logger.warn (= AsyncStorage 측 영역) 측 사용 (= TestFlight console 미라우팅 회피, logger.ts L36 정합).
  Logger.warn('alarmScheduler-DBG', `scheduleAlarmMain alarmId=${alarm.id} soundKey=${alarm.soundKey} → soundName=${soundName ?? '(undefined)'}`);
  const title = alarm.label || '알람';

  try {
    let id: string;
    if (alarm.repeat === 'once') {
      id = await AlarmkitBridge.scheduleAlarm({
        entityId: alarm.id,
        title,
        fireAt,
        type: 'alarm_main',
        soundName,
      });
    } else {
      id = await AlarmkitBridge.scheduleAlarm({
        entityId: alarm.id,
        title,
        fireAt,
        type: 'alarm_main',
        soundName,
        recurrence:
          alarm.repeat === 'daily'
            ? { mode: 'daily' }
            : { mode: 'weekly', days: alarm.days },
      });
    }
    if (!id) return null;
    await saveAlarmMetadata({
      alarmId: id,
      type: 'alarm_main',
      entityId: alarm.id,
    });
    return id;
  } catch (e) {
    Logger.warn('alarmScheduler', `scheduleAlarmMain error=${String(e)}`);
    return null;
  }
}

/** 특정 AlarmKit alarm 취소 + metadata 삭제. */
export async function cancelAlarm(alarmKitId: string): Promise<void> {
  await AlarmkitBridge.cancelAlarm(alarmKitId).catch(() => {});
  await deleteAlarmMetadata(alarmKitId).catch(() => {});
}

/**
 * 특정 alarm entity 측 등록된 모든 AlarmKit alarm cancel + metadata 삭제.
 * mapping table 측 entityId 매칭으로 검출.
 */
export async function cancelAlarmsForEntity(alarmEntityId: string): Promise<void> {
  const all = await listAllAlarmMetadata();
  const targets = all.filter(
    m => m.type === 'alarm_main' && m.entityId === alarmEntityId
  );
  for (const meta of targets) {
    await cancelAlarm(meta.alarmId);
  }
}

/**
 * 앱 기동 시 호출. stale 'alarm_main' mapping cleanup + enabled=true 알람 재예약.
 * routineScheduler.syncRollingSchedule 와 별개 영역.
 */
export async function syncAllAlarms(): Promise<void> {
  if (!isAlarmKitAvailableSync()) return;

  // 1. stale 'alarm_main' mapping cleanup (= 이전 빌드 등록 영역)
  const allMeta = await listAllAlarmMetadata();
  for (const meta of allMeta) {
    if (meta.type === 'alarm_main') {
      await AlarmkitBridge.cancelAlarm(meta.alarmId).catch(() => {});
      await deleteAlarmMetadata(meta.alarmId).catch(() => {});
    }
  }

  // 2. enabled=true 알람 재예약
  const alarms = await loadAlarms();
  for (const alarm of alarms) {
    if (alarm.enabled) {
      await scheduleAlarmMain(alarm).catch(() => {});
    }
  }
}

// ─── 한 번만 비활성 ──────────────────────────────────────

/**
 * AlarmKit alerting event 시 호출 (= App.tsx 측 onAlarmStateChange listener 분기).
 * meta.type='alarm_main' + alarm.repeat='once' 시 = enabled=false 처리.
 */
export async function disableOnceAlarmIfNeeded(alarmEntityId: string): Promise<void> {
  const alarms = await loadAlarms();
  const target = alarms.find(a => a.id === alarmEntityId);
  if (!target) return;
  if (target.repeat !== 'once') return;
  const updated: Alarm = { ...target, enabled: false };
  await upsertAlarm(updated);
}

// ─── sessions 기록 ──────────────────────────────────────

/**
 * 알람 발화 + 해제 시 sessions 기록 추가.
 * icon='alarm' 고정 (= 결정 6-B). minutes=0 (= 알람 = 미션 ❌).
 */
export async function recordAlarmSession(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(SESSIONS_STORAGE_KEY);
    const list: SessionRecord[] = raw ? JSON.parse(raw) : [];
    const d = new Date();
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    list.push({
      id: `s_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      date,
      icon: 'alarm',
      minutes: 0,
    });
    await AsyncStorage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify(list));
  } catch {
    // 세션 저장 실패 무시
  }
}
