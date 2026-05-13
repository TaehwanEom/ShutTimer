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
import { SETTINGS_KEY } from '../constants/settings';

// ─── AlarmKit 가용성 ──────────────────────────────────────

// v1.7 hotfix #G7 Phase 2-B — main app target 26.0 강제 정합 → iOS 측 = AlarmKit 항상 사용 가능. Android 측만 분기 잔존.
function isAlarmKitAvailableSync(): boolean {
  return Platform.OS === 'ios';
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

/**
 * 매번 설정 사운드 (= SettingsScreen 측 SETTINGS_KEY.ALARM_SOUND key) 측 read.
 * alarm.soundKey 측 인자 폐기 (= 사운드 picker UI 폐기 정합).
 * 사용자분 측 SettingsScreen 측 사운드 변경 시 = 모든 알람/루틴 측 = 자동 follow ✅.
 */
async function resolveSoundName(): Promise<string | undefined> {
  const soundId = (await AsyncStorage.getItem(SETTINGS_KEY.ALARM_SOUND)) ?? DEFAULT_SOUND_ID;
  const item =
    ALARM_SOUNDS.find(s => s.id === soundId) ??
    ALARM_SOUNDS.find(s => s.id === DEFAULT_SOUND_ID);
  return (item as any)?.pushSound;
}

// ─── 스케줄링 ────────────────────────────────────────────

/**
 * v1.8 #AlarmRepeatLazy — 알람 entity 측 AlarmKit 등록 + lazy chain (= 발화 후 다음 chain 추가).
 * iOS 26+ + authorized 시만 진입. 그 외 = silent skip (= AlarmListScreen 측 Platform 분기 정합).
 *
 * 정책 (= 사용자분 측 명시 v1.8).
 *   - OS 자체 반복 (= .alarm(schedule:)) 폐기. 모든 repeat 측 .timer(duration:) lazy chain 통일.
 *   - 첫 schedule = 1개만 (= lock screen LA 1개). chainIndex=0, chainBaseFireAt=fireAt.
 *   - 발화 (alerting) 시 → App.tsx onAlarmStateChange listener 측 = scheduleAlarmChainNext 호출.
 *   - 누적 50회 (= 100분) 도달 시 = 더 schedule ❌.
 *   - dismiss → cancelAlarmsForEntity → mapping entityId 동일 chain 일괄 cancel.
 *   - daily/weekly 다음 occurrence 재예약 = 콜드 스타트 syncAllAlarms 측 정합.
 *
 * @returns 첫 alarm ID. chain N개 측 ID = mapping table 측 entityId lookup.
 */
const CHAIN_INTERVAL_MS = 120000; // 2분
export const CHAIN_TOTAL_BUDGET = 50; // 100분 / 2분

export async function scheduleAlarmMain(alarm: Alarm): Promise<string | null> {
  if (!alarm.enabled) return null;
  if (!(await isAlarmKitReady())) return null;

  const baseFireAt = nextAlarmOccurrenceTime(alarm);
  if (baseFireAt === null) return null;

  return scheduleChainAlarmAt(alarm, baseFireAt, 0, baseFireAt);
}

/**
 * v1.8 #AlarmRepeatLazy — lazy chain 측 다음 chain schedule (= listener 측 호출).
 * App.tsx onAlarmStateChange listener 측 alerting 시 = 본 함수 호출.
 * chainIndex >= CHAIN_TOTAL_BUDGET 시 = caller 측 사전 차단 정합 (= 본 함수 측 가드 ❌).
 */
export async function scheduleAlarmChainNext(
  alarm: Alarm,
  chainBaseFireAt: number,
  nextChainIndex: number
): Promise<string | null> {
  if (!alarm.enabled) return null;
  if (!(await isAlarmKitReady())) return null;
  const fireAt = chainBaseFireAt + nextChainIndex * CHAIN_INTERVAL_MS;
  return scheduleChainAlarmAt(alarm, fireAt, nextChainIndex, chainBaseFireAt);
}

/** chain 측 단일 schedule + mapping 저장. */
async function scheduleChainAlarmAt(
  alarm: Alarm,
  fireAt: number,
  chainIndex: number,
  chainBaseFireAt: number
): Promise<string | null> {
  const soundName = await resolveSoundName();
  const title = alarm.label || '알람';
  // v1.8 #LACountdownTitle — lock screen LA 측 = "다음 알람\n남은 시간" 2줄 표시.
  // root cause = widget extension (WidgetLiveActivity.swift:267) 측 = `metadata.routineName` 측 직접 렌더링.
  //   → AlarmPresentation.Countdown.title 측 무시 → countdownTitle param 측 영향 ❌.
  //   정정 = laRoutineName 측 직접 정정 + widget 측 lineLimit(2) 정정 결합.
  // alerting 시 화면 title 측 = alarm.label or '알람' 유지 (= AlarmScreen 측 별도 영역 → 회귀 ❌).
  const countdownTitle = '다음 알람\n남은 시간';
  Logger.warn(
    'alarmScheduler-DBG',
    `scheduleChain alarmId=${alarm.id} chainIndex=${chainIndex} fireAt=${fireAt} soundName=${soundName ?? '(undefined)'}`
  );
  const laMeta = {
    laStepName: title,
    laStepIndex: 0,
    laTotalSteps: 1,
    laStage: 'step',
    laRoutineId: alarm.id,
    laRoutineName: '다음 알람\n남은 시간', // v1.8 #LACountdownTitle — widget LA 측 2줄 정합 (lineLimit(2)).
  } as const;
  try {
    const id = await AlarmkitBridge.scheduleAlarm({
      entityId: alarm.id,
      title,
      countdownTitle,
      fireAt,
      type: 'alarm_main',
      soundName,
      ...laMeta,
    });
    if (!id) return null;
    await saveAlarmMetadata({
      alarmId: id,
      type: 'alarm_main',
      entityId: alarm.id,
      chainIndex,
      chainBaseFireAt,
    });
    return id;
  } catch (e) {
    Logger.warn('alarmScheduler', `scheduleChain chainIndex=${chainIndex} error=${String(e)}`);
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

/**
 * 콜드 스타트 시점 호출. AlarmKit framework 측 영속 alarm 중 = JS mapping table 측 등록 ❌ alarm cleanup.
 * 이전 빌드 측 잔존 / mapping 손상 영역 측 유령 알람 정리.
 * syncAllAlarms 후 호출 = mapping 측 정상 alarm = scheduleAlarm 후 saveAlarmMetadata 등록 보존 영역.
 */
export async function cleanupGhostAlarms(): Promise<number> {
  if (!isAlarmKitAvailableSync()) return 0;

  try {
    const frameworkAlarms = await AlarmkitBridge.listAlarms();
    const allMeta = await listAllAlarmMetadata();
    const knownIds = new Set(allMeta.map(m => m.alarmId));
    const ghostIds: string[] = frameworkAlarms
      .map(a => a.id)
      .filter(id => !knownIds.has(id));

    Logger.warn(
      'GhostCleanup',
      `frameworkCount=${frameworkAlarms.length} mappingCount=${allMeta.length} ghostCount=${ghostIds.length} ids=[${ghostIds.join(',')}]`
    );

    for (const ghostId of ghostIds) {
      await AlarmkitBridge.cancelAlarm(ghostId).catch(() => {});
    }
    return ghostIds.length;
  } catch (e) {
    Logger.warn('GhostCleanup', `error=${String(e)}`);
    return 0;
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
