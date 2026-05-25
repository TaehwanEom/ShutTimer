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

// v1.8 #AlarmChainRecurring — 체인 멤버가 기준 알람 대비 며칠 뒤 날짜에 발화하는지.
// 체인 길이 최대 60분 (30회 × 2분) → 자정은 1회만 넘을 수 있어 결과는 0 또는 1.
// weekly 알람의 자정-크로스 멤버 요일 보정용. 로컬 시각 기준 (= nextAlarmOccurrenceTime 정합).
function chainMemberDayOffset(baseFireAt: number, memberFireAt: number): number {
  const startOfDay = (ms: number): number => {
    const d = new Date(ms);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };
  return Math.round((startOfDay(memberFireAt) - startOfDay(baseFireAt)) / 86400000);
}

// v1.8 #AlarmChainRecurring — 체인 멤버 1건의 recurrence 계산.
// 직전 = chainIndex 1+ 가 { mode:'never' } → native .fixed(단발) → 예약 당일 1회만 →
//   앱 미실행 시 다음날부터 chainIndex 0 하나만 남아 체인 소멸 (= 잠금화면 슬라이드 중지 시 회귀 root cause).
// 정정 = chainIndex 1+ 도 chainIndex 0 처럼 .relative 반복 → 재예약 없이 OS 자동 매주/매일 반복.
//   - chainIndex 0 = 기준 알람 → 현행 mapAlarmRepeatToRecurrence 유지 (= 회귀 차단).
//   - 'once' = 1회성 → 체인 멤버도 never(.fixed) 유지 (= 반복 ❌, 발화 후 disableOnceAlarmIfNeeded 정합).
//   - 'daily' = 자정 넘어도 매일 → daily 그대로.
//   - 'weekly' = 자정 넘는 멤버는 요일 +dayOffset shift (= 다음날 새벽 올바른 요일에 반복).
function chainMemberRecurrence(
  alarm: Alarm,
  chainIndex: number,
  fireAt: number,
  chainBaseFireAt: number
): { mode: 'never' | 'daily' | 'weekly'; days?: number[] } {
  if (chainIndex === 0) return mapAlarmRepeatToRecurrence(alarm);
  if (alarm.repeat === 'once') return { mode: 'never' };
  if (alarm.repeat === 'daily') return { mode: 'daily' };
  // weekly — 자정 크로스 시 요일 shift.
  const dayOffset = chainMemberDayOffset(chainBaseFireAt, fireAt);
  const shiftedDays = alarm.days.map(d => (d + dayOffset) % 7);
  return { mode: 'weekly', days: shiftedDays };
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

/** v1.8 #AlarmChainEager — 단일 chain alarm schedule + mapping 저장. recurrence = chainMemberRecurrence (chainIndex 1+ 도 .relative 반복, 'once' 만 .fixed). */
async function scheduleAlarmAt(
  alarm: Alarm,
  fireAt: number,
  chainIndex: number,
  chainBaseFireAt: number
): Promise<string | null> {
  const soundName = await resolveSoundName();
  const title = alarm.label || '알람';
  // v1.8 — alarm 측 = LA 안 만듦 (= native .alarm(schedule:) factory + alert-only presentation 측).
  // countdownTitle / laMeta 측 = .alarm 분기 측 unused. 호환성 위해 전달은 유지.
  const countdownTitle = '다음 알람\n남은 시간';
  // v1.8 #AlarmChainRecurring — chainIndex 0/1+ 모두 .relative OS 반복 (daily/weekly). 'once' 만 .fixed 단발.
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
    laRoutineName: '다음 알람\n남은 시간',
  } as const;
  try {
    const id = await AlarmkitBridge.scheduleAlarm({
      entityId: alarm.id,
      title,
      countdownTitle,
      fireAt,
      type: 'alarm_main',
      soundName,
      recurrence,
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
    Logger.warn('alarmScheduler', `scheduleAlarm error=${String(e)}`);
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

// v1.8 #AlarmChainEager — 2분 간격 chain. 알람 등록 시점 scheduleAlarmMain 측에서 chain 전체 미리 예약.
//   chainIndex 0..29 = 총 30회 = 60분. 활성 알람 갯수만큼 분배.
//   직전 lazy chain (scheduleAlarmChainNext = 발화 listener 측 다음 1개 등록) 폐기 — 잠금 suspend 시 미발화 회귀.
//   v1.9 — chain 50 → 30 축소 (= 100분 → 60분 ringing 보장). 사용자 100분까지 도달하지 않을 영역.
export const ALARM_CHAIN_INTERVAL_MS = 120000; // 2분
export const ALARM_CHAIN_MAX_INDEX = 29; // chainIndex 0..29 = 총 30회 = 60분

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

    // 분기 B-skip — daily/weekly: .relative OS 반복 체인. 진행 중/미래 유효 → 그대로 둔다.
    //   ← 이번 버그 핵심 수정. 콜드 스타트가 진행 중인 체인을 더 이상 건드리지 않는다.
  }

  // ── 분기 C — enabled인데 alarm_main 체인이 하나도 없는 알람 신규 예약 ──
  //   분기 B가 once 알람을 disable 했을 수 있어 알람·mapping 상태 재로드.
  const freshAlarms = await loadAlarms();
  const entitiesWithChain = new Set(
    (await listAllAlarmMetadata())
      .filter(m => m.type === 'alarm_main')
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
    const d = new Date();
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    list.push({
      id: `s_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      date,
      icon: 'alarm',
      minutes: 0,
      type: 'alarm',
      totalSeconds: 0,
      label: label && label.trim().length > 0 ? label.trim() : undefined,
    });
    await AsyncStorage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify(list));
  } catch {
    // 세션 저장 실패 무시
  }
}
