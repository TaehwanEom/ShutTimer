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
  markAlarmDeleted,
  listAllAlarmMetadata,
} from './alarmkitMappingTable';
import { ALARM_SOUNDS, DEFAULT_SOUND_ID } from '../constants/sounds';
import { Logger } from './logger';
import i18n from '../i18n';
import { SESSIONS_STORAGE_KEY, SessionRecord } from '../constants/sessions';
import { SETTINGS_KEY } from '../constants/settings';

// ─── AlarmKit 가용성 ──────────────────────────────────────

// v1.7 hotfix #G7 Phase 2-B — main app target 26.0 강제 정합 → iOS 측 = AlarmKit 항상 사용 가능.
// Phase 3-0a (2026-05-26): Android 도 알람 엔진 활성화 (= alarmkit-bridge Android Module 측 setAlarmClock 정합).
//   Phase 3-1 (Module UUID 항상 발급) + Phase 3-2 (AlarmReceiver 반복 재예약) 완료 정합 후 가드 해제.
function isAlarmKitAvailableSync(): boolean {
  return Platform.OS === 'ios' || Platform.OS === 'android';
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
 * v1.8 #AlarmChainEager — 알람 entity 측 AlarmKit 등록 + 2분 간격 chain 전체 미리 예약.
 * 정책 (= 사용자분 측 명시):
 *   - native 측 .alarm(schedule:) factory 측 사용 = AlarmPresentation 측 alert-only = LA 측 생성 ❌
 *   - chain = 알람 등록 시점에 전체 미리 예약 (= 활성 알람 갯수 분배, 최대 30개) → 잠금/앱 종료 상태에서도 OS가 전부 발화.
 *   - v1.8 #AlarmChainRecurring — chainIndex 0/1+ 모두 .relative OS 반복 (daily/weekly) → 재예약 없이 매주/매일 자동 갱신. 'once' 만 .fixed 단발.
 *   - 직전 lazy chain (= 발화 listener 측 다음 1개 등록) 폐기 — 잠금 상태 앱 suspend 시 listener 미발화 → chain 끊김 회귀 root cause.
 *   - 발화 (alerting) 시 → 'once' 측 자동 disable (= disableOnceAlarmIfNeeded 측 listener 분기 정합).
 *   - dismiss → cancelAlarmsForEntity → mapping entityId 일괄 cancel.
 *
 * @returns 첫 alarm ID. chain 전체 ID = mapping table 측 entityId lookup.
 */

/** v1.8 — alarm.repeat → AlarmRecurrence 매핑. */
function mapAlarmRepeatToRecurrence(alarm: Alarm): { mode: 'never' | 'daily' | 'weekly'; days?: number[] } {
  if (alarm.repeat === 'daily') return { mode: 'daily' };
  if (alarm.repeat === 'weekly') return { mode: 'weekly', days: alarm.days };
  return { mode: 'never' }; // 'once' → never (= native 측 .fixed(date) 분기)
}

// v2.0 #ChainFixedSafety (2026-05-28) — 체인 멤버 1건의 recurrence 계산.
//   iOS 전용 버그: AlarmKit `.relative(daily)` 측 = fireAt 의 HH:MM 만 추출 (= 날짜 무시) → 콜드 부팅 /
//     토글 OFF→ON / 편집 시점이 알람 시각 ~ 알람+60분 윈도우 안일 때 = chainIndex 12+ 의 HH:MM 측 = 오늘 미래 → 즉시 발화.
//     = 유저 보고 "02:17 알람인데 02:41에 갑자기 울림" 회귀 root cause (log01.md 2026-05-27).
//   Android 측 = 본 버그 ❌. setAlarmClock 측 = 절대 timestamp 사용 + AlarmReceiver 측 자동 +1일 재예약.
//     = chainIndex 1+ 측 = daily/weekly 측 유지 (= 매일 native 자동 반복 = 안전 체인 robust 보존).
//   iOS 정정: chainIndex 1+ 측 = .fixed (= mode:'never') 단발. fireAt 의 날짜 + 시각 모두 보존 → 유령 발화 차단.
//     - chainIndex 0 = 기준 알람 → mapAlarmRepeatToRecurrence (= OS 자동 daily/weekly 반복) 유지.
//     - chainIndex 1+ = .fixed → 등록 당일만 발화. 다음날부터 = chainIndex 0 alerting listener 측 재예약 +
//       syncAllAlarms 측 분기 B-skip 측 누락 감지 시 재예약 (= 본 file rearmSafetyChain).
//     - trade-off: 앱 완전 종료 + 사용자 미오픈 시 = 다음날 안전 체인 X → chainIndex 0 만 발화 (= 본 알람은 들음).
//       유령 발화 차단 우선 (= 유저 명시 선택).
function chainMemberRecurrence(
  alarm: Alarm,
  chainIndex: number,
  fireAt: number,
  chainBaseFireAt: number
): { mode: 'never' | 'daily' | 'weekly'; days?: number[] } {
  if (chainIndex === 0) return mapAlarmRepeatToRecurrence(alarm);
  // iOS chainIndex 1+ = .fixed (유령 발화 차단). 재예약 = rearmSafetyChain.
  if (Platform.OS === 'ios') return { mode: 'never' };
  // Android chainIndex 1+ = native 자동 반복 유지 (버그 ❌ + 안전 체인 robust).
  if (alarm.repeat === 'once') return { mode: 'never' };
  if (alarm.repeat === 'daily') return { mode: 'daily' };
  // weekly — 자정 크로스 시 요일 shift.
  const dayOffset = androidChainMemberDayOffset(chainBaseFireAt, fireAt);
  const shiftedDays = alarm.days.map(d => (d + dayOffset) % 7);
  return { mode: 'weekly', days: shiftedDays };
}

// Android weekly chain 멤버 측 자정-크로스 시 요일 보정. 체인 60분 → 자정은 1회만 넘을 수 있어 결과는 0 또는 1.
function androidChainMemberDayOffset(baseFireAt: number, memberFireAt: number): number {
  const startOfDay = (ms: number): number => {
    const d = new Date(ms);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };
  return Math.round((startOfDay(memberFireAt) - startOfDay(baseFireAt)) / 86400000);
}

export async function scheduleAlarmMain(alarm: Alarm): Promise<string | null> {
  if (!alarm.enabled) return null;
  if (!(await isAlarmKitReady())) return null;

  const baseFireAt = nextAlarmOccurrenceTime(alarm);
  if (baseFireAt === null) return null;

  // v1.8 #AlarmChainEager — 활성 알람 갯수만큼 chain 예산 분배 (= AlarmKit 총 알람 수 제한 대응).
  //   1개 활성 → 30개, 2개 → 15개, 10개 → 3개. 최소 1개 보장.
  const all = await loadAlarms();
  const activeCount = Math.max(1, all.filter(a => a.enabled).length);
  const chainTotal = ALARM_CHAIN_MAX_INDEX + 1; // 30
  const chainCount = Math.max(1, Math.min(chainTotal, Math.floor(chainTotal / activeCount)));

  // v1.8 #AlarmChainEager — chain 전체를 등록 시점에 미리 예약 (= 잠금/앱 종료 상태 OS 자동 발화).
  let firstId: string | null = null;
  let scheduledIds: string[] = [];
  for (let i = 0; i < chainCount; i++) {
    const fireAt = baseFireAt + i * ALARM_CHAIN_INTERVAL_MS;
    const id = await scheduleAlarmAt(alarm, fireAt, i, baseFireAt);
    if (firstId === null) firstId = id;
    if (id) scheduledIds.push(id);
  }
  // v1.9 #ChainBaseFireAtVerify — 일관성 검증. chain 측 saveAlarmMetadata 실패 시 = chainBaseFireAt 측 missing → syncAllAlarms 측 base=null 오인.
  //   verify = chainCount = 실제 schedule 성공 count 측 비교. mismatch 시 warn (= retry 측 future).
  if (scheduledIds.length !== chainCount) {
    Logger.warn('alarmScheduler-DBG', `scheduleAlarmMain chain mismatch entityId=${alarm.id} expected=${chainCount} actual=${scheduledIds.length}`);
  }
  return firstId;
}

/** 단일 chain alarm schedule + mapping 저장. recurrence = chainMemberRecurrence (chainIndex 0 = daily/weekly/never, chainIndex 1+ = never). */
async function scheduleAlarmAt(
  alarm: Alarm,
  fireAt: number,
  chainIndex: number,
  chainBaseFireAt: number
): Promise<string | null> {
  const soundName = await resolveSoundName();
  const title = alarm.label || i18n.t('alarm.defaultTitle', { defaultValue: '알람' });
  // v1.8 — alarm 측 = native .alarm(schedule:) factory + alert-only presentation (스케줄 시 LA 미생성).
  // 2026-06-24 #LAAlertI18n — 단, 발화(alert) 시점엔 AlarmKit이 위젯 ActivityConfiguration으로 LA를 띄워
  //   metadata.routineName 을 노출함(Log_0624 line 383 .fixed alert 시 Activity.count 1→2 실측 확인).
  //   직전 = 하드코딩 한국어 '다음 알람\n남은 시간' → 영문 앱에도 한국어 노출 + alert엔 "남은 시간" 무의미.
  //   정정 = localized title(alarm.label || i18n alarm.defaultTitle) 사용 → 알람명 표시 + 다국어 정합.
  const countdownTitle = title;
  // v2.0 #ChainFixedSafety (2026-05-28) — chainIndex 0 = .relative(daily/weekly) OS 반복. chainIndex 1+ = .fixed 단발.
  const recurrence = chainMemberRecurrence(alarm, chainIndex, fireAt, chainBaseFireAt);
  Logger.warn(
    'alarmScheduler-DBG',
    `scheduleAlarm alarmId=${alarm.id} chainIndex=${chainIndex} fireAt=${fireAt} recurrence=${recurrence.mode} soundName=${soundName ?? '(undefined)'}`
  );
  const laMeta = {
    laStepName: title,
    laStepIndex: 0,
    laTotalSteps: 1,
    laStage: 'step',
    laRoutineId: alarm.id,
    // 2026-06-24 #LAAlertI18n — 하드코딩 '다음 알람\n남은 시간' → localized title(알람명). 위젯 LA(.alert) leading 노출 정합.
    laRoutineName: title,
    // 2026-06-25 — 위젯 LA(.alert) 큰 글씨 안내 문구(알람 종료 시). 현지화 전달.
    laAlertMessage: i18n.t('alarm.laAlertMessage', { defaultValue: '종료 미션을 진행' }),
  } as const;
  let nativeId: string | null = null;
  try {
    nativeId = await AlarmkitBridge.scheduleAlarm({
      entityId: alarm.id,
      title,
      countdownTitle,
      fireAt,
      type: 'alarm_main',
      soundName,
      recurrence,
      ...laMeta,
    });
    if (!nativeId) return null;
    await saveAlarmMetadata({
      alarmId: nativeId,
      type: 'alarm_main',
      entityId: alarm.id,
      chainIndex,
      chainBaseFireAt,
    });
    return nativeId;
  } catch (e) {
    // v1.9 #ScheduleAtomicity — saveAlarmMetadata 실패 시 = native id 측 orphan 회피 위해 cancel rollback.
    //   직전 = catch → return null → native 측 잔존 (= mapping 측 X) → orphan.
    Logger.warn('alarmScheduler', `scheduleAlarm error=${String(e)} (rollback nativeId=${nativeId ?? '(none)'})`);
    if (nativeId) {
      await AlarmkitBridge.cancelAlarm(nativeId).catch(() => {});
    }
    return null;
  }
}

/** 특정 AlarmKit alarm 취소 + metadata 삭제. */
export async function cancelAlarm(alarmKitId: string): Promise<void> {
  await AlarmkitBridge.cancelAlarm(alarmKitId).catch(() => {});
  await deleteAlarmMetadata(alarmKitId).catch(() => {});
}

// v2.0 #ChainFixedSafety (2026-05-28) — safety chain (chainIndex 1+) 재예약.
//   iOS 전용. Android 측 = chainIndex 1+ daily/weekly 측 native 자동 반복 → 재예약 불필요.
//   chainIndex 0 alerting listener 측 또는 syncAllAlarms 측 누락 감지 시 호출.
//   baseFireAt 기준 i*2분 간격으로 chainCount-1 개 schedule. chainIndex 0 은 본 함수 측 X (= 별도 OS 반복 / 별도 호출).
//   사전 조건: 호출 측 = 기존 chainIndex 1+ metadata 정리 완료 (= 중복 schedule 회피).
export async function rearmSafetyChain(alarm: Alarm, baseFireAt: number): Promise<void> {
  if (Platform.OS !== 'ios') return;
  if (!alarm.enabled) return;
  if (!(await isAlarmKitReady())) return;
  const all = await loadAlarms();
  const activeCount = Math.max(1, all.filter(a => a.enabled).length);
  const chainTotal = ALARM_CHAIN_MAX_INDEX + 1;
  const chainCount = Math.max(1, Math.min(chainTotal, Math.floor(chainTotal / activeCount)));
  if (chainCount <= 1) return; // safety chain 없음 (= chainIndex 0 만 활성)
  Logger.warn('alarmScheduler-DBG', `rearmSafetyChain entityId=${alarm.id} baseFireAt=${baseFireAt} chainCount=${chainCount}`);
  for (let i = 1; i < chainCount; i++) {
    const fireAt = baseFireAt + i * ALARM_CHAIN_INTERVAL_MS;
    await scheduleAlarmAt(alarm, fireAt, i, baseFireAt);
  }
}

// v2.1 #ChainRebalance (2026-05-28) — 활성 알람 갯수 변경 시 기존 알람 chain 재계산.
//   문제: chainCount = floor(30 / activeCount) 측 = scheduleAlarmMain 호출 시점 계산만 함 → 새 알람 추가/삭제 시 기존 알람의 chain 갯수 변경 X.
//     누적 = activeCount=5 알람 enable 시 = 30+15+10+7+6 = 68개 → AlarmKit framework limit (~64) 초과 위험.
//   정정: EnableAlarm + DisableAlarm effect 측 후속 호출 → 모든 활성 알람 chainCount 재계산 + 다르면 cancel + 재schedule.
//   idempotent: current=target 시 skip → 무한 루프 X. Platform 공통 (= iOS + Android 양쪽 적용).
export async function rebalanceAllChains(): Promise<void> {
  if (!isAlarmKitAvailableSync()) return;
  try {
    const alarms = await loadAlarms();
    const activeAlarms = alarms.filter(a => a.enabled);
    if (activeAlarms.length === 0) return;
    const chainTotal = ALARM_CHAIN_MAX_INDEX + 1;
    const targetChainCount = Math.max(1, Math.min(chainTotal, Math.floor(chainTotal / activeAlarms.length)));

    const allMeta = await listAllAlarmMetadata();
    let rebalancedCount = 0;
    for (const alarm of activeAlarms) {
      const currentChain = allMeta.filter(
        m => m.type === 'alarm_main' && m.entityId === alarm.id && m.deleted !== true
      );
      const currentChainCount = currentChain.length;
      // chainCount 일치 시 = skip (idempotent 보장)
      if (currentChainCount === targetChainCount) continue;
      // v2.2 #DailyDismissPreserve (2026-05-28) — daily/weekly 알람 측 chain[0] 1개만 = preserve 상태 → skip rebalance.
      //   cancelSafetyChainPreservingDaily 호출 후 = chain[0] 1개 + chain[1..N] 0개 = preserve.
      //   rebalance 측 chain[0] cancel + 재schedule 회피 (= UUID 안정성 + native call 효율).
      //   syncAllAlarms 분기 B-skip 측 = cold start 시 rearmSafetyChain 측 = chain[1..N] 자동 복구.
      const isRecurring = alarm.repeat === 'daily' || alarm.repeat === 'weekly';
      const isPreserveState = currentChain.length === 1 && (currentChain[0]?.chainIndex ?? -1) === 0;
      if (isRecurring && isPreserveState) {
        Logger.warn(
          'alarmScheduler-DBG',
          `rebalanceAllChains skip preserve state entityId=${alarm.id} (= dismiss 후 chain[0] 보존)`
        );
        continue;
      }
      Logger.warn(
        'alarmScheduler-DBG',
        `rebalanceAllChains entityId=${alarm.id} current=${currentChainCount} target=${targetChainCount}`
      );
      // 옛 chain 전체 cancel + scheduleAlarmMain 재호출
      for (const meta of currentChain) await cancelAlarm(meta.alarmId);
      await scheduleAlarmMain(alarm).catch(() => {});
      rebalancedCount += 1;
    }
    if (rebalancedCount > 0) {
      Logger.warn('alarmScheduler-DBG', `rebalanceAllChains 완료 rebalanced=${rebalancedCount} target=${targetChainCount} activeAlarms=${activeAlarms.length}`);
    }
  } catch (e) {
    Logger.warn('alarmScheduler-DBG', `rebalanceAllChains error=${String(e)}`);
  }
}

// v2.0 #ChainFixedSafety (2026-05-28) — 소비된 safety chain (chainIndex 1+ .fixed 발화 완료) metadata cleanup.
//   iOS 전용. Android 측 = chainIndex 1+ daily/weekly 측 alarmId 재사용 (소비 X) → 본 함수 호출 시 정상 알람 metadata 삭제 회귀.
//   .fixed 알람 측 발화 시 = AlarmKit framework 측 자동 제거 but JS metadata 측 잔존 → orphan.
//   listener (App.tsx) 측 = chainIndex >= 1 fire 시 즉시 deleteAlarmMetadata 호출 (= 일반 경로 cleanup).
//   본 함수 = listener 측 누락 (= 앱 종료 중 fire) 시 syncAllAlarms 호출 측 보완.
//   targetEntityId 지정 시 = 해당 entity 측 chainIndex 1+ metadata 만 검사. 미지정 시 = alarm_main 측 전체.
export async function cleanupConsumedSafetyChain(targetEntityId?: string): Promise<number> {
  if (Platform.OS !== 'ios') return 0;
  if (!isAlarmKitAvailableSync()) return 0;
  try {
    const frameworkAlarms = await AlarmkitBridge.listAlarms();
    const frameworkIds = new Set(frameworkAlarms.map(a => a.id));
    const allMeta = await listAllAlarmMetadata();
    const targets = allMeta.filter(m => {
      if (m.type !== 'alarm_main') return false;
      if ((m.chainIndex ?? 0) < 1) return false; // chainIndex 0 은 본 함수 측 X
      if (targetEntityId != null && m.entityId !== targetEntityId) return false;
      if (m.deleted === true) return false; // soft-deleted 측 = 별도 경로
      return !frameworkIds.has(m.alarmId);
    });
    for (const meta of targets) {
      await deleteAlarmMetadata(meta.alarmId).catch(() => {});
    }
    if (targets.length > 0) {
      Logger.warn('alarmScheduler-DBG', `cleanupConsumedSafetyChain removed=${targets.length} entityFilter=${targetEntityId ?? '(all)'}`);
    }
    return targets.length;
  } catch (e) {
    Logger.warn('alarmScheduler-DBG', `cleanupConsumedSafetyChain error=${String(e)}`);
    return 0;
  }
}

/**
 * 특정 alarm entity 측 등록된 모든 AlarmKit alarm cancel + metadata 삭제.
 * mapping table 측 entityId 매칭으로 검출.
 * v1.8 #OnceAutoDisable — cancel 루프 후 = 'once' 알람 측 자동 disable (= 회귀 정정).
 *   직전 = lazy chain 측 disableOnceAlarmIfNeeded 측 위치 이동 → dismiss 경로 측 호출 ❌ 회귀.
 *   정정 = cancelAlarmsForEntity 측 = 모든 dismiss 경로 측 단일 funnel → 본 위치 측 disableOnce 추가.
 *   edit 경로 측 = cancel → upsertAlarm (= 사용자 enabled 측 덮어쓰기) → schedule 순서 측 = 회귀 ❌.
 */
export async function cancelAlarmsForEntity(alarmEntityId: string): Promise<void> {
  const all = await listAllAlarmMetadata();
  // Sub A-4 fix (2026-05-25, Timer 통합) — filter 확장. timer_main 도 cancel 대상.
  //   Timer dismiss → dispatch Dismiss → CancelAlarmChain effect → 본 함수 호출 → entityId 매칭 alarm_main + timer_main 모두 cancel.
  const targets = all.filter(
    m => (m.type === 'alarm_main' || m.type === 'timer_main') && m.entityId === alarmEntityId
  );
  const targetIds = new Set(targets.map(t => t.alarmId));

  // v1.8 #ChainCancelVerify + 2026-05-25 사용자 보고 회귀 fix — 옛 안전망 (#AlarmChainRevive) 복원 + verify retry 통합.
  //   사용자 보고 #1 (2026-05-23): 미션 완료 후 metas=50 → listAlarms=25 잔존 → 12분 후 잔존 chain fire.
  //   사용자 보고 #2 (2026-05-25): 9:36 dismiss 후 28분 뒤 (10:04) 잔존 chain fire → 앱 화면 진입까지.
  //   원인 #2: 옛 코드 (metadata 먼저 삭제) → fix #1 (cancel → verify → metadata 마지막) 변경으로 안전망 소실.
  //     OS race로 verify 통과 후에도 native 잔존 → metadata 정상 → fire 시 meta lookup 성공 → 화면 진입.
  //   정정: F0 metadata 먼저 삭제 (옛 안전망 복원) + F1 cancel + F2 verify retry (신 기능 유지).
  //     = 다층 방어. cancel 모두 실패해도 metadata 없음 → fire 시 silent skip (사용자 화면 영향 X).

  // F0: v1.9 #SoftDelete — metadata 측 deleted=true flag set (= 정식 delete 측 F3로 이동).
  //   직전 = F0 정식 delete → cancel 실패 + OS race → native banner+사운드 잔존 fire (= orphan 동일 회귀).
  //   정정 = soft delete (deleted=true) → listener 측 = deleted=true 감지 시 silent native cancel + return
  //   → 사용자 화면 진입 X. F2 verify=0 보장 시점 = F3 정식 delete (= 안전한 시점, 다음 fire 위험 X).
  for (const meta of targets) {
    await markAlarmDeleted(meta.alarmId).catch(() => {});
  }

  // F1: cancel 시도 (catch 풀어 native 실패 식별 + 카운트)
  let nativeFailCount = 0;
  for (const meta of targets) {
    try {
      await AlarmkitBridge.cancelAlarm(meta.alarmId);
    } catch (e) {
      nativeFailCount++;
      Logger.warn('cancelEntity-DBG', `attempt-1 cancelAlarm fail alarmId=${meta.alarmId} err=${String(e)}`);
    }
  }

  // F2: verify — native 측 targetIds 잔존 확인 + 최대 3회 retry (100ms delay).
  let stale: string[] = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    const nativeAlarms = await AlarmkitBridge.listAlarms();
    stale = nativeAlarms.filter(a => targetIds.has(a.id)).map(a => a.id);
    if (stale.length === 0) break;
    Logger.warn('cancelEntity-DBG', `verify attempt=${attempt} stale=${stale.length} ids=[${stale.join(',')}]`);
    for (const id of stale) {
      try {
        await AlarmkitBridge.cancelAlarm(id);
      } catch (e) {
        Logger.warn('cancelEntity-DBG', `retry cancel fail alarmId=${id} err=${String(e)}`);
      }
    }
    await new Promise(r => setTimeout(r, 100));
  }

  // F3: v1.9 #SoftDelete — stale=0 시 정식 deleteAlarmMetadata. stale>0 시 = metadata 잔존 (= deleted=true).
  //   listener 측 deleted=true 감지 시 silent native cancel + return. cleanupGhostAlarms 측도 추가 정리.
  if (stale.length === 0) {
    for (const meta of targets) {
      await deleteAlarmMetadata(meta.alarmId).catch(() => {});
    }
  } else {
    Logger.warn('cancelEntity-DBG', `FINAL stale alarms remain count=${stale.length} ids=[${stale.join(',')}] entityId=${alarmEntityId} (metadata deleted=true 잔존, listener 측 silent skip)`);
  }

  Logger.warn('cancelEntity-DBG', `done entityId=${alarmEntityId} targets=${targets.length} nativeFail=${nativeFailCount} finalStale=${stale.length}`);
  await disableOnceAlarmIfNeeded(alarmEntityId).catch(() => {});
}

// v2.2 #DailyDismissPreserve (2026-05-28) — Dismiss / Advance lastStep 측 = chain[0] (.relative daily/weekly) 보존 + chain[1..29] (safety chain) 만 cancel.
//   문제: 사용자 dismiss → cancelAlarmsForEntity → chain[0..29] 전부 cancel → iOS .relative(daily) OS 자동 반복 사라짐 → 다음날 알람 X (= 사용자 cold start까지).
//   정정: daily/weekly 알람 측 = chain[0] 보존 (= OS 자동 반복) + chain[1..29] 만 F0~F3 cancel. 다음날 chain[0] fire → listener 측 rearmSafetyChain → 정상.
//   once 알람 / lookup 실패 / Android Platform = cancelAlarmsForEntity 위임 (= 기존 동작 보존, 회귀 0).
//   chain[0] alerting 중 = AlarmkitBridge.stopAlarm 호출 (= alerting 종료 + .relative daily 보존).
export async function cancelSafetyChainPreservingDaily(alarmEntityId: string): Promise<void> {
  // #LockedColdStartGap (2026-06-21) — 해제(dismiss/stop) 시점 기록 → 콜드 스타트 fallback 재진입 차단.
  //   본 함수는 Dismiss / Stop / lastStep 모든 해제 경로의 공통 chokepoint. iOS 내부 게이트는 recordHandledFire에 있음.
  await recordHandledFire(alarmEntityId).catch(() => {});
  // iOS 외 = 기존 cancelAlarmsForEntity 위임 (= Android 회귀 0). production Android 빌드 사이클 시 별도 fix.
  if (Platform.OS !== 'ios') {
    return cancelAlarmsForEntity(alarmEntityId);
  }
  const alarms = await loadAlarms();
  const alarm = alarms.find(a => a.id === alarmEntityId);
  // 알람 lookup 실패 또는 once = 기존 동작 (= 전체 cancel + disableOnce).
  if (!alarm || alarm.repeat === 'once') {
    return cancelAlarmsForEntity(alarmEntityId);
  }
  // daily / weekly: chain[0] 보존 + chain[1..29] cancel.
  const allMeta = await listAllAlarmMetadata();
  const safetyTargets = allMeta.filter(
    m => m.type === 'alarm_main' && m.entityId === alarmEntityId && (m.chainIndex ?? 0) >= 1
  );
  const chain0Meta = allMeta.find(
    m => m.type === 'alarm_main' && m.entityId === alarmEntityId && (m.chainIndex ?? 0) === 0
  );
  Logger.warn('cancelSafetyChain-DBG', `start entityId=${alarmEntityId} repeat=${alarm.repeat} safety=${safetyTargets.length} chain0=${chain0Meta?.alarmId ?? 'NULL'}`);

  const safetyIds = new Set(safetyTargets.map(t => t.alarmId));

  // F0: soft delete (= cancelAlarmsForEntity 측 안전망 패턴 동일).
  for (const meta of safetyTargets) {
    await markAlarmDeleted(meta.alarmId).catch(() => {});
  }

  // F1: cancel.
  let nativeFailCount = 0;
  for (const meta of safetyTargets) {
    try {
      await AlarmkitBridge.cancelAlarm(meta.alarmId);
    } catch (e) {
      nativeFailCount++;
      Logger.warn('cancelSafetyChain-DBG', `attempt-1 cancelAlarm fail alarmId=${meta.alarmId} err=${String(e)}`);
    }
  }

  // F2: verify retry (= cancelAlarmsForEntity 패턴 동일).
  let stale: string[] = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    const nativeAlarms = await AlarmkitBridge.listAlarms();
    stale = nativeAlarms.filter(a => safetyIds.has(a.id)).map(a => a.id);
    if (stale.length === 0) break;
    Logger.warn('cancelSafetyChain-DBG', `verify attempt=${attempt} stale=${stale.length}`);
    for (const id of stale) {
      try {
        await AlarmkitBridge.cancelAlarm(id);
      } catch (e) {
        Logger.warn('cancelSafetyChain-DBG', `retry cancel fail alarmId=${id} err=${String(e)}`);
      }
    }
    await new Promise(r => setTimeout(r, 100));
  }

  // F3: stale=0 시 정식 deleteAlarmMetadata.
  if (stale.length === 0) {
    for (const meta of safetyTargets) {
      await deleteAlarmMetadata(meta.alarmId).catch(() => {});
    }
  } else {
    Logger.warn('cancelSafetyChain-DBG', `FINAL stale=${stale.length} ids=[${stale.join(',')}] (metadata deleted=true 잔존)`);
  }

  // chain[0] alerting 중 = stopAlarm (= alerting 종료 + .relative daily/weekly OS 자동 반복 보존).
  //   AlarmkitBridge.stopAlarm 측 = framework 측 alerting 측 stop intent perform → .relative recurrence 측 다음 발화 보존.
  //   cancelAlarm 측 = 전체 cancel (= recurrence 사라짐) → 사용 ❌.
  //   chain[0] 측 alerting 아닐 때 = stopAlarm 호출 X (= iOS AlarmKit 측 = .alerting 전용 API. scheduled 측 호출 시 동작 불확실).
  //   → listAlarms 측 state 확인 후 분기.
  if (chain0Meta) {
    let chain0IsAlerting = false;
    try {
      const nativeAlarms = await AlarmkitBridge.listAlarms();
      const chain0Native = nativeAlarms.find(a => a.id === chain0Meta.alarmId);
      chain0IsAlerting = chain0Native?.state === 'alerting';
    } catch (e) {
      Logger.warn('cancelSafetyChain-DBG', `chain[0] state lookup fail alarmId=${chain0Meta.alarmId} err=${String(e)}`);
    }
    if (chain0IsAlerting) {
      try {
        await AlarmkitBridge.stopAlarm(chain0Meta.alarmId);
        Logger.warn('cancelSafetyChain-DBG', `chain[0] alerting → stopAlarm 호출 alarmId=${chain0Meta.alarmId} (.relative 보존)`);
      } catch (e) {
        Logger.warn('cancelSafetyChain-DBG', `chain[0] stopAlarm fail alarmId=${chain0Meta.alarmId} err=${String(e)}`);
      }
    } else {
      Logger.warn('cancelSafetyChain-DBG', `chain[0] alerting X → stopAlarm 측 skip alarmId=${chain0Meta.alarmId} (.relative 보존)`);
    }
  }

  Logger.warn('cancelSafetyChain-DBG', `done entityId=${alarmEntityId} safety=${safetyTargets.length} nativeFail=${nativeFailCount} finalStale=${stale.length} chain0Preserved=${chain0Meta != null}`);
}

// v1.8 #AlarmChainEager — 간격 chain. 알람 등록 시점 scheduleAlarmMain 측에서 chain 전체 미리 예약.
//   직전 lazy chain (scheduleAlarmChainNext = 발화 listener 측 다음 1개 등록) 폐기 — 잠금 suspend 시 미발화 회귀.
//   v1.9 — chain 50 → 30 축소 (= 100분 → 60분 ringing 보장).
// 2026-06-27 #AlarmFastReFire — 알람(타이머/루틴 제외)을 끈 직후 즉시 재발화: iOS 체인 간격 2분 → 2초.
//   커버 5분 유지 위해 멤버 30 → 150 (= 150회 × 2초 = 5분). AlarmKit 한도는 보도상 무제한이나 실기기 검증 필요.
//   Android는 별도 알람 엔진 + chainIndex 1+ native 자동반복 전제(60분/자정 1회) → 현행 유지(회귀 0).
//   ※ 의존 로직(chainLifespanMs, App.tsx ACTIVE_WINDOW_MS)은 본 상수로 자동 스케일 → iOS 총 작동시간 = 5분.
export const ALARM_CHAIN_INTERVAL_MS = Platform.OS === 'ios' ? 2000 : 120000; // iOS 2초 / Android 2분(현행)
export const ALARM_CHAIN_MAX_INDEX = Platform.OS === 'ios' ? 149 : 29; // iOS 150회×2초=5분 / Android 30회×2분=60분

// #LockedColdStartGap (2026-06-21) — entity별 "사용자가 발화를 처리(해제/루틴시작)한 시각" 기록.
//   콜드 스타트 fallback이 lastAlarmOccurrenceTime(과거 발화 시각)과 비교해 "이미 처리한 발화 재진입"을 차단.
//   기존 재진입 차단은 안전체인 메타 존재 여부였으나, daily는 chain[0]이 항상 보존돼 해제 여부를 구분 못 함 → 명시 타임스탬프 신설.
//   iOS 전용 (fallback이 iOS 전용). Android는 기록·조회 모두 미사용.
const HANDLED_FIRE_KEY = '@shuttimer/handled_fire_at_v1';
export async function recordHandledFire(entityId: string, at: number = Date.now()): Promise<void> {
  if (Platform.OS !== 'ios') return;
  try {
    const raw = await AsyncStorage.getItem(HANDLED_FIRE_KEY);
    const map: Record<string, number> = raw ? JSON.parse(raw) : {};
    map[entityId] = at;
    await AsyncStorage.setItem(HANDLED_FIRE_KEY, JSON.stringify(map));
  } catch {
    // 기록 실패 무시 — 최악의 경우 fallback이 1회 재진입(중복 알람 화면) 가능, 안전 방향.
  }
}
export async function getHandledFireAt(entityId: string): Promise<number | null> {
  try {
    const raw = await AsyncStorage.getItem(HANDLED_FIRE_KEY);
    if (!raw) return null;
    const map = JSON.parse(raw);
    const v = map?.[entityId];
    return typeof v === 'number' ? v : null;
  } catch {
    return null;
  }
}

/**
 * 앱 기동 / 루틴 복원 시 호출. alarm_main 체인 정합성 동기화.
 * v1.8 #ChainWipeFix — 멱등화. "전부 cancel + 재예약" → "이미 정상인 체인은 그대로 둔다".
 *   직전: 콜드 스타트마다 alarm_main 전체 cancel 후 nextAlarmOccurrenceTime(=오늘 지나면 내일)로
 *     재예약 → 밀어서 중지로 콜드 스타트 시 오늘 진행 중이던 체인이 통째로 소멸하던 회귀.
 *   정정: entityId 그룹별 분기 — 고아 정리(A) / 살아있는 체인 skip(B) / 체인 없는 알람만 신규 예약(C).
 *   호출자: App.tsx 콜드 스타트, routineController.restorePendingDisabledAlarms (루틴 복원).
 *   plan: docs/plan-2026-05-22-ios-chain-wipe-fix.md (FIX-2026-05-22-chain-wipe).
 * routineScheduler.syncRollingSchedule 와 별개 영역.
 */
export async function syncAllAlarms(): Promise<void> {
  if (!isAlarmKitAvailableSync()) return;

  // v2.0 #ChainFixedSafety (2026-05-28) — 분기 B/C 진입 전 = 소비된 safety chain (chainIndex 1+ .fixed 발화 완료)
  //   metadata 측 orphan cleanup. listener (App.tsx) 측 = 일반 경로 정리 but 앱 종료 중 fire 등 누락 케이스 보완.
  //   = 분기 B-skip 측 safety chain 누락 감지 정확도 확보.
  await cleanupConsumedSafetyChain().catch(() => {});

  const now = Date.now();
  // 'once' 체인 수명 = 30회 × 2분 = 60분. 기준시각 + 수명 < now → 전 멤버 발화 완료 = 죽은 체인.
  const chainLifespanMs = (ALARM_CHAIN_MAX_INDEX + 1) * ALARM_CHAIN_INTERVAL_MS;

  // alarm_main mapping을 entityId 기준 그룹화.
  const allMeta = await listAllAlarmMetadata();
  const chainMeta = allMeta.filter(m => m.type === 'alarm_main');
  const byEntity = new Map<string, typeof chainMeta>();
  for (const meta of chainMeta) {
    const list = byEntity.get(meta.entityId);
    if (list) list.push(meta);
    else byEntity.set(meta.entityId, [meta]);
  }

  const alarmById = new Map<string, Alarm>();
  for (const a of await loadAlarms()) alarmById.set(a.id, a);

  // ── 분기 A/B — mapping이 있는 entityId 처리 ──
  for (const [entityId, metas] of Array.from(byEntity.entries())) {
    const alarm = alarmById.get(entityId);

    // 분기 A — 대응 알람 없음(삭제) / enabled=false(인앱 OFF) → 고아 mapping 정리.
    if (!alarm || !alarm.enabled) {
      for (const meta of metas) await cancelAlarm(meta.alarmId);
      continue;
    }

    // 분기 B-once — 체인이 죽었으면(전 멤버 발화 완료) 정리 + 알람 disable. 살아있으면 skip.
    // v1.9 #ChainBaseFireAtFallback — base=null 측 (= v1.7 이전 migration metadata) 시 = 측 native listAlarms
    //   verify 후 결정 (= chain member 실제 존재 시 = 살아있음 처리, 없으면 = cleanup).
    //   직전 = base=null → chainDead=true → 활성 once 알람 무조건 disable 회귀 영역.
    if (alarm.repeat === 'once') {
      const base = metas.find(m => m.chainBaseFireAt != null)?.chainBaseFireAt;
      let chainDead: boolean;
      if (base == null) {
        // fallback = native verify
        try {
          const nativeAlarms = await AlarmkitBridge.listAlarms();
          const nativeIds = new Set(nativeAlarms.map(a => a.id));
          const aliveCount = metas.filter(m => nativeIds.has(m.alarmId)).length;
          chainDead = aliveCount === 0;
          if (chainDead) {
            Logger.warn('alarmScheduler-DBG', `once chain base=null + native verify=0 → cleanup entityId=${entityId}`);
          }
        } catch {
          // verify 실패 시 = 안전한 쪽 (= 살아있음 처리, 활성 알람 보존)
          chainDead = false;
        }
      } else {
        chainDead = base + chainLifespanMs < now;
      }
      if (chainDead) {
        for (const meta of metas) await cancelAlarm(meta.alarmId);
        await disableOnceAlarmIfNeeded(entityId).catch(() => {});
      }
      continue;
    }

    // 분기 B-skip — daily/weekly: chainIndex 0 = .relative OS 반복 체인. 진행 중/미래 유효 → 그대로 둔다.
    //   v2.0 #ChainFixedSafety (2026-05-28) — safety chain (chainIndex 1+) 측 = .fixed 단발 → 발화 후 소비됨.
    //     발화 = next chainIndex 0 occurrence 측 = 다음 day 측 = safety chain 측 누락 → 재예약 필요.
    //     검사: chainIndex 0 metadata 존재 + chainIndex 1+ metadata 누락 → rearmSafetyChain.
    //     baseFireAt = nextAlarmOccurrenceTime (= 미래) → AlarmKit 측 .fixed 측 = 날짜+시각 보존 → 유령 발화 차단.
    //   v2.2 #DailyDismissPreserve (2026-05-28) — deleted=true filter 추가.
    //     직전 = deleted 무관 filter → cancelAlarmsForEntity / cancelSafetyChainPreservingDaily 측 F2 verify 실패 시 =
    //       deleted=true 잔존 metadata → hasChainSafety=true false negative → rearm 측 누락 → 다음날 안전망 0 회귀.
    //     정정 = deleted!==true filter → 실제 active safety chain 측만 count → F2 실패 시도 정확한 rearm trigger.
    //     hasChain0 측 동일 fix (= deleted=true 잔존 chain[0] 측 false positive 회피).
    const hasChain0 = metas.some(m => (m.chainIndex ?? 0) === 0 && m.deleted !== true);
    const hasChainSafety = metas.some(m => (m.chainIndex ?? 0) >= 1 && m.deleted !== true);
    if (hasChain0 && !hasChainSafety) {
      const nextBase = nextAlarmOccurrenceTime(alarm);
      if (nextBase != null) {
        Logger.warn('alarmScheduler-DBG', `분기B-skip safety chain 재무장 entityId=${entityId} repeat=${alarm.repeat} nextBase=${nextBase}`);
        await rearmSafetyChain(alarm, nextBase).catch(() => {});
      }
    }
  }

  // ── 분기 C — enabled인데 alarm_main 체인이 하나도 없는 알람 신규 예약 ──
  //   분기 B가 once 알람을 disable 했을 수 있어 알람·mapping 상태 재로드.
  //   v2.2 #DailyDismissPreserve (2026-05-28) — deleted!==true filter 추가.
  //     직전 = deleted 무관 filter → cancelAlarmsForEntity F2 실패 시 = deleted=true 잔존 → entitiesWithChain 측 포함 →
  //       scheduleAlarmMain 미호출 → cold start 측 알람 측 없음 회귀 (= 옛 한계).
  //     정정 = deleted!==true filter → 실제 active chain 측만 인지 → F2 실패 시 cold start 측 신규 schedule 보장.
  const freshAlarms = await loadAlarms();
  const entitiesWithChain = new Set(
    (await listAllAlarmMetadata())
      .filter(m => m.type === 'alarm_main' && m.deleted !== true)
      .map(m => m.entityId)
  );
  // M0 진단: K14 미스터리 1 후보 — 분기 C 진입 시 schedule 대상 entityId 박기 (cold-start duplicate schedule 추적).
  const scheduleTargets = freshAlarms.filter(a => a.enabled && !entitiesWithChain.has(a.id));
  if (scheduleTargets.length > 0) {
    Logger.warn('alarmScheduler-DBG', `syncAllAlarms 분기C 진입 targets=${scheduleTargets.length} ids=[${scheduleTargets.map(a => a.id).join(',')}] entitiesWithChain.size=${entitiesWithChain.size}`);
  }
  for (const alarm of scheduleTargets) {
    await scheduleAlarmMain(alarm).catch(() => {});
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
    // v1.9 #SoftDeleteGhostFix — deleted=true metadata 측 = ghost 인정 (= cancel 대상).
    //   직전 = knownIds = all meta (deleted 무관) → deleted=true 측 = ghost 측 X → cleanup 측 누락 → 잔존.
    //   정정 = deleted=true 측 knownIds 제외 → ghost 인정 + cancel + 정식 deleteAlarmMetadata.
    const knownIds = new Set(allMeta.filter(m => !m.deleted).map(m => m.alarmId));
    const ghostIds: string[] = frameworkAlarms
      .map(a => a.id)
      .filter(id => !knownIds.has(id));

    Logger.warn(
      'GhostCleanup',
      `frameworkCount=${frameworkAlarms.length} mappingCount=${allMeta.length} ghostCount=${ghostIds.length} ids=[${ghostIds.join(',')}]`
    );

    for (const ghostId of ghostIds) {
      await AlarmkitBridge.cancelAlarm(ghostId).catch(() => {});
      // v1.9 #SoftDeleteGhostFix — deleted=true metadata 측 = native cancel 후 정식 deleteAlarmMetadata.
      await deleteAlarmMetadata(ghostId).catch(() => {});
    }

    // 2026-06-24 #StrandedTombstoneSweep — deleted=true 인데 native framework 에도 부재한 메타는
    //   ghostIds(=native에 살아있는 미등록 id) 후보가 아니고, knownIds(=deleted!==true)에서도 제외돼
    //   어떤 cleanup 경로로도 정식 삭제되지 않아 장부가 단조 증가한다.
    //   실제 누수원: cancelAlarmsForEntity F2 verify 가 3회 실패해 deleted=true 로 남은 alarm_main/timer_main
    //   tombstone 이, 이후 OS 에서 사라져 framework 목록에서도 빠진 경우. (confirm_prompt realert 는 hard-delete 라 해당 X.)
    //   native 부재를 확인했으므로(향후 이벤트 없음) tombstone 을 정식 제거해 장부 성장 차단.
    //   검수 반영 — listAlarms 가 일시적으로 빈 배열을 success 반환하는 race 시 살아있는 tombstone 까지
    //   stranded 로 오인해 과삭제할 수 있으므로, framework 목록이 비었는데 장부엔 있으면 sweep skip.
    const frameworkIdSet = new Set(frameworkAlarms.map(a => a.id));
    const stranded = allMeta.filter(m => m.deleted === true && !frameworkIdSet.has(m.alarmId));
    if (stranded.length > 0 && !(frameworkAlarms.length === 0 && allMeta.length > 0)) {
      Logger.warn('GhostCleanup', `strandedTombstone sweep count=${stranded.length}`);
      for (const m of stranded) {
        await deleteAlarmMetadata(m.alarmId).catch(() => {});
      }
    } else if (stranded.length > 0) {
      Logger.warn('GhostCleanup', `strandedTombstone sweep skip — listAlarms 빈 반환 race 의심 (stranded=${stranded.length})`);
    }
    return ghostIds.length;
  } catch (e) {
    Logger.warn('GhostCleanup', `error=${String(e)}`);
    return 0;
  }
}

// ─── v1.8 #SoundRenameMigration — 사운드 파일 리네임 회귀 1회성 정정 ──────────────

/**
 * 사운드 파일 리네임(커밋 4fa2e2a, 2026-05-21) 회귀 정정 — 콜드 스타트 1회 실행.
 *   문제: 리네임 이전 빌드에서 켠 alarm_main 체인은 옛 파일명(notification_alarm.wav 등)을
 *     .named(...)로 OS에 박아둠. 리네임 후 빌드 번들엔 그 파일이 없음 →
 *     AlarmKit이 발화 시 못 찾고 OS default(= 아이폰 기본 알람음)로 폴백.
 *   정정: 켜진 알람 전체를 옛 체인 cancel + scheduleAlarmMain 재등록.
 *     재등록 시 resolveSoundName()이 현재 파일명을 박음 → 번들 존재 → 정상 발화.
 *   안전: AsyncStorage 플래그 1회 가드 → 반복 실행(churn) 구조 아님.
 *     prealert/confirm_prompt 는 syncRollingSchedule 이 매 콜드 스타트 재생성 → 별도 처리 불필요.
 *   cancelAlarmsForEntity 미사용 — 그 함수는 disableOnceAlarmIfNeeded 부수효과로
 *     미발화 'once' 알람을 꺼버림. 여기선 alarm_main meta 만 직접 cancel.
 */
const SOUND_RENAME_MIGRATION_KEY = '@shuttimer/sound_rename_migration_v1';

export async function migrateSoundRename(): Promise<void> {
  if (!isAlarmKitAvailableSync()) return;
  try {
    if (await AsyncStorage.getItem(SOUND_RENAME_MIGRATION_KEY)) {
      Logger.warn('alarmScheduler', 'migrateSoundRename skip — 이미 실행됨 (flag set)');
      return;
    }
    Logger.warn('alarmScheduler', 'migrateSoundRename 시작 — 사운드 리네임 회귀 정정');

    const alarms = await loadAlarms();
    const allMeta = await listAllAlarmMetadata();
    let count = 0;
    for (const alarm of alarms) {
      if (!alarm.enabled) continue;
      // 옛 체인 직접 cancel — disable 부수효과 없는 cancelAlarm 사용.
      const chainMetas = allMeta.filter(
        m => m.type === 'alarm_main' && m.entityId === alarm.id
      );
      for (const meta of chainMetas) await cancelAlarm(meta.alarmId);
      // 현재 사운드명으로 재등록.
      await scheduleAlarmMain(alarm);
      count += 1;
    }
    await AsyncStorage.setItem(SOUND_RENAME_MIGRATION_KEY, String(Date.now()));
    Logger.warn('alarmScheduler', `migrateSoundRename 완료 — ${count}개 알람 재등록`);
  } catch (e) {
    Logger.warn('alarmScheduler', `migrateSoundRename error=${String(e)}`);
  }
}

// ─── v2.0 #ChainFixedSafetyMigration — 옛 .relative(daily) 체인 → .fixed 체인 1회성 정정 ──────────────

/**
 * v2.0 #ChainFixedSafety 도입 (2026-05-28) 회귀 정정 — 콜드 스타트 1회 실행. iOS 전용.
 *   문제: 옛 빌드(v1.8~v1.9)에서 켠 alarm_main 체인 측 = chainIndex 1+ 측 = .relative(daily/weekly) 측 OS 영속.
 *     새 빌드 측 = chainIndex 1+ 측 = .fixed 정정 but 옛 framework 알람 측 = OS 레벨 → 자동 갱신 ❌.
 *     listener (App.tsx) 측 chainIndex >= 1 fire 시 deleteAlarmMetadata 호출 → 다음날부터 메타 lookup NULL →
 *     in-app 처리 ❌ (= 알람 소리 나는데 화면 진입 ❌) 회귀.
 *   정정: 켜진 알람 전체 측 옛 체인 cancel + scheduleAlarmMain 재등록.
 *     재등록 시 = 새 chainMemberRecurrence (= chainIndex 1+ never) 적용 → .fixed 체인.
 *     baseFireAt = nextAlarmOccurrenceTime (= 미래) → AlarmKit .fixed 측 = 날짜 보존 → 유령 발화 ❌.
 *   안전: AsyncStorage 플래그 1회 가드. cancelAlarm 측 = 부수효과 X (= disableOnce X).
 *   Android 측 = chainIndex 1+ daily/weekly 측 유지 → 본 마이그레이션 측 X.
 */
const CHAIN_FIXED_SAFETY_MIGRATION_KEY = '@shuttimer/chain_fixed_safety_migration_v2_0';

// #SoundChangeReschedule (2026-06-23) — 알람 사운드 변경 시 이미 예약된 안전체인을 새 사운드로 재예약.
//   문제: handleSoundSelect는 ALARM_SOUND 설정만 저장 → 이미 AlarmKit에 예약된 체인은 옛 사운드가 박혀 있어,
//     잠금 상태 발화 시 옛 소리가 나오고, 콜드 스타트 재무장 때만 새 소리로 바뀜(사용자 보고 = "옛 소리 나다 갑자기 새 소리").
//   근거: scheduleAlarmMain → scheduleAlarmAt → resolveSoundName()이 매번 현재 ALARM_SOUND를 읽음(line 54).
//     syncAllAlarms는 멱등(기존 체인 skip)이라 부적합 → migrateChainFixedSafety와 동일한 "전체 cancel + 재예약" 필요.
//   iOS 전용: Android는 별도 알람 엔진(AlarmScheduler.kt) → 회귀 방지 위해 미적용(Android 사운드 갱신은 별도 과제).
//   호출: SettingsScreen.handleSoundSelect에서 setItem(ALARM_SOUND) 완료 후 1회.
export async function rescheduleAllAlarmChains(): Promise<void> {
  if (Platform.OS !== 'ios') return;
  if (!isAlarmKitAvailableSync()) return;
  try {
    const alarms = await loadAlarms();
    const allMeta = await listAllAlarmMetadata();
    let count = 0;
    for (const alarm of alarms) {
      if (!alarm.enabled) continue;
      // 옛 체인(chain[0..N]) 전체 cancel — disable 부수효과 없는 cancelAlarm 사용(migrate와 동일 패턴).
      const chainMetas = allMeta.filter(m => m.type === 'alarm_main' && m.entityId === alarm.id);
      for (const meta of chainMetas) await cancelAlarm(meta.alarmId);
      // scheduleAlarmMain → resolveSoundName()이 현재 사운드를 박아 새 사운드로 전체 재예약.
      await scheduleAlarmMain(alarm);
      count += 1;
    }
    Logger.warn('alarmScheduler', `rescheduleAllAlarmChains 완료 — ${count}개 알람 현재 사운드로 재예약`);
  } catch (e) {
    Logger.warn('alarmScheduler', `rescheduleAllAlarmChains error=${String(e)}`);
  }
}

export async function migrateChainFixedSafety(): Promise<void> {
  if (Platform.OS !== 'ios') return;
  if (!isAlarmKitAvailableSync()) return;
  try {
    if (await AsyncStorage.getItem(CHAIN_FIXED_SAFETY_MIGRATION_KEY)) {
      Logger.warn('alarmScheduler', 'migrateChainFixedSafety skip — 이미 실행됨 (flag set)');
      return;
    }
    Logger.warn('alarmScheduler', 'migrateChainFixedSafety 시작 — .relative(daily) 체인 → .fixed 정정');

    const alarms = await loadAlarms();
    const allMeta = await listAllAlarmMetadata();
    let count = 0;
    for (const alarm of alarms) {
      if (!alarm.enabled) continue;
      // 옛 체인 직접 cancel — disable 부수효과 없는 cancelAlarm 사용.
      const chainMetas = allMeta.filter(
        m => m.type === 'alarm_main' && m.entityId === alarm.id
      );
      for (const meta of chainMetas) await cancelAlarm(meta.alarmId);
      // 새 chainMemberRecurrence (= chainIndex 1+ .fixed) 측 재등록.
      await scheduleAlarmMain(alarm);
      count += 1;
    }
    await AsyncStorage.setItem(CHAIN_FIXED_SAFETY_MIGRATION_KEY, String(Date.now()));
    Logger.warn('alarmScheduler', `migrateChainFixedSafety 완료 — ${count}개 알람 재등록`);
  } catch (e) {
    Logger.warn('alarmScheduler', `migrateChainFixedSafety error=${String(e)}`);
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
 * v1.8 #CalendarCategory — type='alarm' + label 측 저장. 알람 카테고리 측 분리.
 */
export async function recordAlarmSession(label?: string): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(SESSIONS_STORAGE_KEY);
    const list: SessionRecord[] = raw ? JSON.parse(raw) : [];
    // v1.9 #AlarmRecordDedup — 동일 label 측 = 30초 내 record 측 dedup.
    //   직전 = 사용자 측 같은 알람 측 = 재시도 (= dismiss fail + 재시도) 시 = 매번 push → 히스토리 중복 회귀.
    //   정정 = 30초 내 동일 label 측 type='alarm' record 측 = skip.
    const nowMs = Date.now();
    const normLabel = label && label.trim().length > 0 ? label.trim() : undefined;
    const dup = list.some(s => {
      if (s.type !== 'alarm' || s.label !== normLabel) return false;
      const m = s.id.match(/^s_(\d+)_/);
      if (!m) return false;
      const sMs = parseInt(m[1], 10);
      return Math.abs(nowMs - sMs) < 30000;
    });
    if (dup) return;
    const d = new Date();
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    list.push({
      id: `s_${nowMs}_${Math.random().toString(36).slice(2, 6)}`,
      date,
      icon: 'alarm',
      minutes: 0,
      type: 'alarm',
      totalSeconds: 0,
      label: normLabel,
    });
    await AsyncStorage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify(list));
  } catch {
    // 세션 저장 실패 무시
  }
}
