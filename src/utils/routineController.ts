// v1.6 리팩토링: 루틴 상태 전환 단일 진입점.
// 모든 상태 변경은 이 파일 export 함수를 통해서만 발생.
// Phase 1+2: steps 기반 데이터 모델로 타입 보정. 로직 유지. loopCount/missions 제거.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { DeviceEventEmitter } from 'react-native';
import {
  Routine,
  ActiveRoutine,
  ROUTINE_DEADLINE_MS,
  loadRoutines,
  loadActiveRoutine,
  saveActiveRoutine,
  clearActiveRoutine,
  recordStepSession,
} from '../constants/routines';
import { clearPreloadedSound } from './alarmSoundPreload';
import {
  scheduleRoutineConfirmPrompt,
  cancelRoutineConfirmPrompt,
  cancelRoutinePrealerts,
  requestAlarmKitAuthorizationIfNeeded,
} from './routineScheduler';
import AlarmkitBridge from '../../modules/alarmkit-bridge';
import { listAllAlarmMetadata, deleteAlarmMetadata } from './alarmkitMappingTable';
import { Logger } from './logger';
import i18n from '../i18n';
import { SETTINGS_KEY } from '../constants/settings';
import { ALARM_SOUNDS, DEFAULT_SOUND_ID } from '../constants/sounds';
import {
  writeRoutineSnapshot,
  clearRoutineSnapshot,
  readRoutineSnapshot,
  clearChainAlarms,
  type RoutineSnapshot,
  type RoutineSnapshotStep,
} from './appGroupSync';

const IS_ROUTINE_ACTIVE_KEY = 'isRoutineActive';
const ACTIVE_TIMER_KEY = 'activeTimer';
const IS_TIMER_ACTIVE_KEY = 'isTimerActive';

// 현재 예약된 배경 알림 id — 모듈 레벨에서 보관 (UI 마운트/언마운트와 독립)
// v1.6 Phase 12 — 옵션 A (chain 일괄 등록) 폐기. confirm_prompt 단발만 유지.
let currentConfirmPromptId: string | null = null;
// v1.7 hotfix #LAUnify Phase 10-G1 — currentLiveActivityId 변수 제거 (LiveActivityBridge 모듈 폐기 영역).
// v1.7 hotfix #DupSched — 이중 schedule 차단 가드.
// root cause = startRoutineFromAlarm → startRoutine-fresh (#1) → AlarmListScreen mount → ActiveRoutineSection.init → startRoutine-resumed (#2)
// 동일 routineId + stepIdx + stepEndAt key 측 1초 이내 재호출 시 skip. 정상 호출 (= stepEndAt 다른 영역 = 다음 step / pause shift / cold restart) 측 영향 ❌.
let lastScheduleKey: string | null = null;
let lastScheduleAt = 0;

// ─── 결과 타입 ───────────────────────────────────────────────

export type StartRoutineResult =
  | { kind: 'started'; ar: ActiveRoutine; routine: Routine }
  | { kind: 'resumed'; ar: ActiveRoutine; routine: Routine }
  | { kind: 'needs_override'; existingRoutineId: string; newRoutineId: string }
  | { kind: 'needs_timer_override' }
  | { kind: 'not_found' };

export type MissionEndResult =
  | { kind: 'advance_auto'; ar: ActiveRoutine; routine: Routine }
  | { kind: 'advance_confirm'; ar: ActiveRoutine; routine: Routine }
  | { kind: 'end'; routine: Routine };

export type RestoreResult =
  | { kind: 'none' }
  | { kind: 'expired' }
  | { kind: 'run'; routineId: string }
  | { kind: 'alarm'; routineId: string };

// ─── 내부 헬퍼 ───────────────────────────────────────────────

function createFreshAr(r: Routine): ActiveRoutine {
  const now = Date.now();
  const firstStep = r.steps[0];
  const durationMs = firstStep ? Math.max(0, firstStep.durationSeconds) * 1000 : 60 * 1000;
  return {
    routineId: r.id,
    currentStepIndex: 0,
    stepEndAt: now + durationMs,
    pausedAt: null,
    startedAt: now,
    deadlineAt: now + ROUTINE_DEADLINE_MS,
    awaitingConfirm: false,
  };
}

/**
 * v1.6 Phase 12 — 현재 step 종료 시점에 발화할 confirm_prompt 알림 예약 (수동 모드).
 * 'auto' endMethod 영구 제거 — 모든 routine = confirm_prompt.
 *
 * v1.7 hotfix #DBG-DupSched — callerHint param 추가. 이중 schedule (= 동일 step 0.2초 차이 두 번 등록)
 * root cause 추적용. 6개 call site 측 hint 명시 → 다음 빌드 시 두 번째 호출 caller 정확 식별.
 */
async function scheduleBackgroundNotif(r: Routine, ar: ActiveRoutine, callerHint?: string): Promise<void> {
  Logger.warn('routine-DBG', `schedBgNotif ENTER caller=${callerHint ?? '(unknown)'} routineId=${r.id} stepIdx=${ar.currentStepIndex} pausedAt=${ar.pausedAt} prevConfirmPromptId=${currentConfirmPromptId ?? '(null)'}`);
  // v1.7 hotfix #DupSched — 동일 schedule 1초 이내 재호출 차단.
  // key = routineId:stepIdx:stepEndAt. 정상 호출 (다음 step / pause-resume / 콜드 스타트) 측 = stepEndAt 다른 영역 → key 다름 → 진입 정상.
  const key = `${r.id}:${ar.currentStepIndex}:${ar.stepEndAt}`;
  if (lastScheduleKey === key && Date.now() - lastScheduleAt < 1000) {
    Logger.warn('routine-DBG', `schedBgNotif SKIP duplicate caller=${callerHint ?? '(unknown)'} key=${key}`);
    return;
  }
  lastScheduleKey = key;
  lastScheduleAt = Date.now();
  if (currentConfirmPromptId) {
    await cancelRoutineConfirmPrompt(currentConfirmPromptId);
    currentConfirmPromptId = null;
  }
  if (ar.pausedAt !== null) return;

  // 마지막 step 이라도 종료 알림 필요 (RoutineAlarm / 위젯 manual_prompt 유도)
  const fireAt = new Date(ar.stepEndAt);
  // v1.6 hotfix B1 — alerting UI title 에 다음 step name 포함 ("다음 루틴 조깅"). 마지막 step 시 undefined.
  const nextStepName = r.steps[ar.currentStepIndex + 1]?.name;
  Logger.warn('routine', `schedBgNotif fireAt=${fireAt.toISOString()} stepIdx=${ar.currentStepIndex} next=${nextStepName ?? '(end)'}`);
  const id = await scheduleRoutineConfirmPrompt(r.id, fireAt, nextStepName);
  Logger.warn('routine', `schedBgNotif id=${id}`);
  currentConfirmPromptId = id;

  // v1.6 hotfix — App Group routine_snapshot mirror.
  // 잠금/백그라운드에서 AdvanceNextStepIntent.perform() 이 native 측 직접
  // AlarmManager.shared.stop(currentAlarmId) + 다음 step alarm schedule 하기 위함.
  // RN setInterval 백그라운드 정지 우회 — perform() 안에서 snapshot 읽고 처리.
  if (id) {
    await mirrorRoutineSnapshot(r, ar, id);
  }
}

/**
 * v1.6 hotfix — autoCountdownSec 0~60 clamp. default 5.
 * routine.autoCountdownSec 미지정 시 default. 범위 외 시 clamp.
 */
export function clampCountdown(sec: number | undefined): number {
  const v = typeof sec === 'number' ? sec : 5;
  return Math.max(0, Math.min(60, Math.floor(v)));
}

/**
 * v1.6 hotfix — routine_snapshot 작성. scheduleBackgroundNotif 내부 호출.
 * native 측 AdvanceNextStepIntent.perform() 가 읽어서 다음 step alarm 직접 등록.
 */
async function mirrorRoutineSnapshot(r: Routine, ar: ActiveRoutine, alarmId: string): Promise<void> {
  try {
    const soundId = (await AsyncStorage.getItem(SETTINGS_KEY.ALARM_SOUND)) ?? DEFAULT_SOUND_ID;
    const soundItem = ALARM_SOUNDS.find(s => s.id === soundId) ?? ALARM_SOUNDS[0];
    const pushSound = soundItem?.pushSound ?? '';
    // v1.7 hotfix #DBG-D — routine 측 사운드 매핑 결과 (= 알람 사운드 ❌ / 다른 사운드 root cause 추적용).
    Logger.warn('routine-DBG', `mirrorSnapshot soundId=${soundId} → pushSound=${pushSound || '(empty)'} routineId=${r.id}`);

    const steps: RoutineSnapshotStep[] = r.steps.map(s => ({
      name: s.name,
      durationSec: Math.max(0, s.durationSeconds),
      // v1.6 — 모든 step 이 동일 사용자 설정 사운드 (사운드 통일 정책 정합)
      soundName: pushSound,
    }));

    const snapshot: RoutineSnapshot = {
      routineId: r.id,
      // routine.name 은 optional — fallback = category (LA start/update 와 동일 정책)
      routineName: r.name ?? r.category,
      currentStepIndex: ar.currentStepIndex,
      totalSteps: r.steps.length,
      steps,
      currentAlarmId: alarmId,
      stepEndAt: ar.stepEndAt,
      i18nConfirmPromptTitle: i18n.t('routine.confirmPromptTitle', { defaultValue: '다음 루틴' }),
      i18nConfirmPromptStop: i18n.t('routine.confirmPromptStop', { defaultValue: '확인' }),
      i18nAdvanceLabel: i18n.t('routine.alarmAdvance', { defaultValue: '다음 진행' }),
      i18nRoutineCompleteTitle: i18n.t('routine.routineCompleteTitle', { defaultValue: '루틴 완료' }),
      savedAt: Date.now(),
      autoCountdownSec: clampCountdown(r.autoCountdownSec),
      completedStepIndices: [],
      routineEnded: false,
    };
    writeRoutineSnapshot(snapshot);
  } catch (e) {
    Logger.warn('routine', `snapshot mirror fail: ${String(e)}`);
  }
}

async function cancelBackgroundNotif(): Promise<void> {
  // v1.6 Phase 12 — chain alarm 일괄 cancel + clearChainAlarms 제거 (옵션 A 폐기).
  if (currentConfirmPromptId) {
    await cancelRoutineConfirmPrompt(currentConfirmPromptId);
    currentConfirmPromptId = null;
  }
  // v1.7 hotfix Phase 13 G4-D-2 — expo-notifications 측 잔존 정리 폐기 (= AlarmKit only).
  // AlarmKit 잔존 알람 cleanup (chain / confirm_prompt 만. prealert 는 rolling schedule)
  try {
    const metas = await listAllAlarmMetadata();
    for (const meta of metas) {
      if (meta.type === 'chain' || meta.type === 'confirm_prompt') {
        await AlarmkitBridge.cancelAlarm(meta.alarmId).catch(() => {});
        await deleteAlarmMetadata(meta.alarmId);
      }
    }
  } catch {}
  // v1.6 hotfix — App Group routine_snapshot cleanup. native 측 perform() 에서
  // stale snapshot 으로 잘못된 alarm 등록 회피.
  clearRoutineSnapshot();
}

async function findRoutine(routineId: string): Promise<Routine | null> {
  const list = await loadRoutines();
  return list.find(r => r.id === routineId) ?? null;
}

// v1.7 hotfix #LAUnify Phase 10-G1 — startOrUpdateLiveActivity / setLiveActivityStage / endLiveActivity 함수 폐기.
// AlarmKit framework가 .timer/.alarm factory 호출 시 자동으로 LA Activity를 시작/갱신/종료한다.
// 옛 LiveActivityBridge 모듈은 별도 ActivityKit Activity를 manual 관리하던 영역으로 두 LA 시스템이 충돌
// → areActivitiesEnabled=false 강제 땜빵 + 검정 바 root cause. 본 G1에서 모듈 통째 폐기.

/**
 * v1.7 hotfix #6 — alerting 시 ar.awaitingConfirm=true 동기 갱신.
 * App.tsx onAlarmStateChange listener (= JS thread active 시점) 측 호출.
 * idempotent — 이미 awaitingConfirm=true 시 noop.
 */
export async function markAwaitingConfirm(entityId: string): Promise<void> {
  const ar = await loadActiveRoutine();
  if (!ar || ar.routineId !== entityId || ar.awaitingConfirm) return;
  await saveActiveRoutine({ ...ar, awaitingConfirm: true });
  Logger.warn('routine', `markAwaitingConfirm entityId=${entityId} OK`);
  // ActiveRoutineSection 측 = subAwaitingConfirm listener → loadActiveRoutine + setAr → 모달 자동 재표시.
  DeviceEventEmitter.emit('routineAwaitingConfirmExternally', { routineId: entityId });
}

// v1.6 Phase 12 — reinstallChainsIfAuto 함수 제거 (auto 모드 영구 미사용).

async function fullCleanup(): Promise<void> {
  // v1.6 #9 — native cleanup: snapshot 기반 currentAlarm cancel + chain alarm 정리 (cancelBackgroundNotif loop 외 fallback).
  const snapshot = readRoutineSnapshot();
  if (snapshot?.currentAlarmId) {
    await AlarmkitBridge.cancelAlarm(snapshot.currentAlarmId).catch(() => {});
  }
  if (snapshot?.routineId) {
    clearChainAlarms(snapshot.routineId);
  }
  await cancelBackgroundNotif();
  await clearActiveRoutine();
  await AsyncStorage.removeItem(IS_ROUTINE_ACTIVE_KEY).catch(() => {});
  // v1.6 #9 — snapshot 명시적 정리 (cancelBackgroundNotif 끝에서 이미 호출, idempotent).
  clearRoutineSnapshot();
}

// ─── 공개 API ───────────────────────────────────────────────

/**
 * 루틴 시작 (또는 같은 루틴 복원).
 * 다른 루틴 진행 중이면 needs_override. 단일 타이머 진행 중이면 needs_timer_override.
 */
export async function startRoutine(
  routineId: string,
  options: { overrideActive?: boolean; overrideTimer?: boolean } = {}
): Promise<StartRoutineResult> {
  const target = await findRoutine(routineId);
  if (!target) return { kind: 'not_found' };

  // v1.7 hotfix Phase 13 G4-D-1 — AlarmKit 측 권한 자동 검증 (= expo-notifications 측 권한 요청 폐기 정합).
  try {
    await requestAlarmKitAuthorizationIfNeeded();
  } catch {}

  const activeTimerRaw = await AsyncStorage.getItem(ACTIVE_TIMER_KEY);
  if (activeTimerRaw && !options.overrideTimer) {
    return { kind: 'needs_timer_override' };
  }
  if (activeTimerRaw && options.overrideTimer) {
    await AsyncStorage.removeItem(ACTIVE_TIMER_KEY).catch(() => {});
    await AsyncStorage.removeItem(IS_TIMER_ACTIVE_KEY).catch(() => {});
    // v1.7 hotfix Phase 13 G4-D-2 — expo-notifications 측 단일 timer 정리 폐기 (= AlarmKit only = HomeScreen scheduleAlarm 측 AlarmKit 측만 등록).
    // preload 된 알람 사운드 정리 (HomeScreen 이 scheduleAlarm 시 createAsync 한 핸들 누수 방지)
    await clearPreloadedSound().catch(() => {});
    // HomeScreen 의 React state / setInterval 리셋 신호 — 루틴이 단일 타이머를 override 했음을 알림
    DeviceEventEmitter.emit('timerCancelledExternally');
  }

  const existing = await loadActiveRoutine();

  // v1.7 hotfix #3 — routine 시작 시 잔존 prealert 알람 일괄 cancel.
  // 정기 일정 routine = 시작 30분/5분 전 prealert 발화 → 사용자 dismiss 안 한 채 시작 시간 도달 시
  // = prealert (alerting) + 첫 step confirm_prompt (alerting) 둘 다 alerting → 중첩 ring.
  // routine 진입 시점에 모든 잔존 prealert 정리 (= notifIds + alarmKitIds 둘 다 cancel + record 삭제).
  await cancelRoutinePrealerts(routineId).catch(() => {});

  if (existing && existing.routineId === routineId) {
    if (Date.now() > existing.deadlineAt) {
      await fullCleanup();
      const fresh = createFreshAr(target);
      await saveActiveRoutine(fresh);
      await AsyncStorage.setItem(IS_ROUTINE_ACTIVE_KEY, 'true').catch(() => {});
      await scheduleBackgroundNotif(target, fresh, 'startRoutine-deadline-expired');
      return { kind: 'started', ar: fresh, routine: target };
    }
    await AsyncStorage.setItem(IS_ROUTINE_ACTIVE_KEY, 'true').catch(() => {});
    if (existing.pausedAt === null && !existing.awaitingConfirm) {
      await scheduleBackgroundNotif(target, existing, 'startRoutine-resumed');
    }
    return { kind: 'resumed', ar: existing, routine: target };
  }

  if (existing && existing.routineId !== routineId && !options.overrideActive) {
    return { kind: 'needs_override', existingRoutineId: existing.routineId, newRoutineId: routineId };
  }

  if (existing) await fullCleanup();
  const fresh = createFreshAr(target);
  await saveActiveRoutine(fresh);
  await AsyncStorage.setItem(IS_ROUTINE_ACTIVE_KEY, 'true').catch(() => {});
  await scheduleBackgroundNotif(target, fresh, 'startRoutine-fresh');
  return { kind: 'started', ar: fresh, routine: target };
}

/**
 * 현재 step 종료 처리.
 * - 세션 기록 (중복 방지: awaitingConfirm 플래그)
 * - 배경 알림 정리
 * - 다음 step 계산 후 ActiveRoutine 갱신
 */
export async function completeCurrentMission(): Promise<MissionEndResult | null> {
  const ar = await loadActiveRoutine();
  if (!ar) return null;
  const routine = await findRoutine(ar.routineId);
  if (!routine) {
    await fullCleanup();
    return null;
  }

  if (!ar.awaitingConfirm) {
    await recordStepSession(routine, ar.currentStepIndex);
  }

  // v1.6 hotfix — 단일 timer #2 와 동일 안티 패턴 제거. cancelBackgroundNotif 호출 시
  // AlarmKit alerting UI 즉시 dismiss 됨 (preempt cancel). 사용자 stop / 다음 진행 누름까지 alerting 지속이 정공.
  // 다음 step 등록 시 scheduleBackgroundNotif 가 currentConfirmPromptId 자동 cancel + 재등록 → 중복 ❌.
  // stop 시 fullCleanup 가 cancel.
  // await cancelBackgroundNotif();  // ← 제거

  // v1.6 Phase 12 — auto 분기 제거. 모든 endMethod 가 confirm 처리 (사용자 stop/dismiss/위젯 advance 후 진행).
  if (!ar.awaitingConfirm) {
    const pending: ActiveRoutine = { ...ar, awaitingConfirm: true };
    await saveActiveRoutine(pending);
    // v1.7 hotfix #LAUnify Phase 10-G1 — opted out of legacy LiveActivityBridge update.
    // AlarmKit alerting state → AlarmKitLiveActivity widget mode=.alert 자동 진입 → "다음 진행" 자동 표시.
    return { kind: 'advance_confirm', ar: pending, routine };
  }
  return { kind: 'advance_confirm', ar, routine };
}

/**
 * v1.6 Phase 12 — 위젯 "다음 진행" Button (AdvanceNextStepIntent) perform 후 호출.
 * confirmAndAdvance 와 동일 흐름 + routineId 검증.
 */
export async function advanceRoutineFromLA(routineId: string): Promise<MissionEndResult | null> {
  const ar = await loadActiveRoutine();
  if (!ar || ar.routineId !== routineId) return null;
  return await confirmAndAdvance();
}

/**
 * v1.6 hotfix — AdvanceNextStepIntent.perform() native 처리 완료 후 RN 후속 동기화.
 * native 가 이미 (a) 현재 alarm stop (b) 다음 step alarm schedule (c) snapshot 갱신 완료한 상태.
 * RN 은 ActiveRoutine + currentConfirmPromptId + LiveActivity 만 native 갱신본에 맞춰 동기화.
 */
export async function syncRoutineFromSnapshot(routineId: string): Promise<MissionEndResult | null> {
  const snapshot = readRoutineSnapshot();
  const ar = await loadActiveRoutine();
  if (!ar || ar.routineId !== routineId) return null;
  const routine = await findRoutine(ar.routineId);
  if (!routine) {
    await fullCleanup();
    return null;
  }

  // v1.6 hotfix B2-2 — native 가 누적한 완료 step session record flush.
  // record timing = 사용자 active 시점 (실제 진행 시점 ❌). 단 history 누락 회피.
  const completed = snapshot?.completedStepIndices ?? [];
  if (snapshot && completed.length > 0) {
    for (const completedIdx of completed) {
      try {
        await recordStepSession(routine, completedIdx);
      } catch (e) {
        Logger.warn('routine', `recordStepSession flush fail idx=${completedIdx} err=${String(e)}`);
      }
    }
  }

  // snapshot 부재 또는 routineEnded=true (native 마지막 step 처리) → routine 종료.
  if (!snapshot || snapshot.routineId !== routineId || snapshot.routineEnded === true) {
    await fullCleanup();
    return { kind: 'end', routine };
  }

  // native 갱신본 기준 ar 동기화. currentConfirmPromptId 갱신 (RN 측 다음 cancel 시 매칭).
  currentConfirmPromptId = snapshot.currentAlarmId;
  const nextAr: ActiveRoutine = {
    ...ar,
    currentStepIndex: snapshot.currentStepIndex,
    stepEndAt: snapshot.stepEndAt,
    pausedAt: null,
    awaitingConfirm: false,
  };
  await saveActiveRoutine(nextAr);
  // v1.7 hotfix #LAUnify Phase 10-G1 — AlarmKit factory가 새 alarm schedule 시 자동으로 LA Activity 갱신.
  // completedStepIndices flush 후 snapshot 갱신 (다음 record 누락 회피)
  if (completed.length > 0) {
    const cleared: RoutineSnapshot = { ...snapshot, completedStepIndices: [] };
    writeRoutineSnapshot(cleared);
  }
  return { kind: 'advance_auto', ar: nextAr, routine };
}

/**
 * 확인 후 진행 모드: 사용자 dismiss → "다음 step 시작" 탭.
 */
export async function confirmAndAdvance(): Promise<MissionEndResult | null> {
  const ar = await loadActiveRoutine();
  if (!ar) return null;
  const routine = await findRoutine(ar.routineId);
  if (!routine) {
    await fullCleanup();
    return null;
  }

  // v1.7 hotfix — alerting 상태 alarm 명시 cleanup.
  // currentConfirmPromptId 측 cancelAlarm 만으로 부족 가능 (= 모듈 레벨 변수 stale 또는 미설정 시).
  // (1) confirm_prompt = 정상 정리 (= 본 함수 의도).
  // (2) prealert = 잔존 시 정리 (= 시작 30분/5분 전 fire 후 dismiss 안 된 영역. 중첩 ring 회피).
  // (3) metadata 없는 alerting alarm = 안전망 (= prealert metadata 저장 누락 잔존 영역 또는 외부 영역).
  try {
    const alarms = await AlarmkitBridge.listAlarms();
    const metas = await listAllAlarmMetadata();
    for (const a of alarms) {
      if (a.state !== 'alerting') continue;
      const meta = metas.find(m => m.alarmId === a.id);
      if (meta && (meta.type === 'confirm_prompt' || meta.type === 'prealert')) {
        await AlarmkitBridge.stopAlarm(a.id).catch(() => {});
        await deleteAlarmMetadata(a.id).catch(() => {});
      } else if (!meta) {
        // 안전망: metadata 없는 alerting alarm 잔존 = 의도 ❌ → stop.
        await AlarmkitBridge.stopAlarm(a.id).catch(() => {});
      }
    }
  } catch {}

  const nextIdx = ar.currentStepIndex + 1;
  if (nextIdx >= routine.steps.length) {
    await fullCleanup();
    return { kind: 'end', routine };
  }

  const nextStep = routine.steps[nextIdx];
  const durationMs = Math.max(0, nextStep.durationSeconds) * 1000;
  const now = Date.now();
  const nextAr: ActiveRoutine = {
    ...ar,
    currentStepIndex: nextIdx,
    stepEndAt: now + durationMs,
    pausedAt: null,
    awaitingConfirm: false,
  };
  await saveActiveRoutine(nextAr);
  await scheduleBackgroundNotif(routine, nextAr, 'confirmAndAdvance');
  // v1.7 hotfix #LAUnify Phase 10-G1 — AlarmKit factory 자동 LA 갱신.
  return { kind: 'advance_auto', ar: nextAr, routine };
}

/** 일시정지. */
export async function pauseRoutine(): Promise<ActiveRoutine | null> {
  const ar = await loadActiveRoutine();
  if (!ar || ar.pausedAt !== null) return ar;
  const paused: ActiveRoutine = { ...ar, pausedAt: Date.now() };
  await saveActiveRoutine(paused);
  // v1.7 hotfix #G3 — Apple AlarmKitDemo 공식 패턴: AlarmKit framework 측 .pause(id:) 직접 호출.
  // 직전 = cancelBackgroundNotif() 측 = chain/confirm_prompt 모두 cancel → AlarmKit framework 측 paused state 진입 ❌
  //   + LA Activity 종료 ⚠️ (= 사용자분 측 "앱에서 일시정지하면 LA 안나오는 문제" root cause).
  // 정정 = readRoutineSnapshot() 측 currentAlarmId → AlarmkitBridge.pauseAlarm(id) → AlarmKit paused state + LA 자동 update.
  const snapshot = readRoutineSnapshot();
  if (snapshot?.currentAlarmId) {
    await AlarmkitBridge.pauseAlarm(snapshot.currentAlarmId).catch(() => {});
  }
  // v1.7 hotfix #LAUnify Phase 10-G1 — endLiveActivity 호출 제거. AlarmKit framework가 .pause(id:) 시 LA 자동 paused UI.
  return paused;
}

/** 재개. */
export async function resumeRoutine(): Promise<ActiveRoutine | null> {
  const ar = await loadActiveRoutine();
  if (!ar || ar.pausedAt === null) return ar;
  const routine = await findRoutine(ar.routineId);
  if (!routine) return null;
  const now = Date.now();
  const pauseDuration = now - ar.pausedAt;
  const resumed: ActiveRoutine = {
    ...ar,
    stepEndAt: ar.stepEndAt + pauseDuration,
    pausedAt: null,
  };
  await saveActiveRoutine(resumed);
  // v1.7 hotfix #G3 — Apple AlarmKitDemo 공식 패턴: AlarmKit framework 측 .resume(id:) 직접 호출.
  // 직전 = scheduleBackgroundNotif() 측 = 새 alarm schedule → 기존 alarm cancel + 새 alarmId 측 회귀 ⚠️.
  // 정정 = readRoutineSnapshot() 측 currentAlarmId → AlarmkitBridge.resumeAlarm(id) → countdown 복귀 + LA 자동 update.
  const snapshot = readRoutineSnapshot();
  if (snapshot?.currentAlarmId) {
    await AlarmkitBridge.resumeAlarm(snapshot.currentAlarmId).catch(() => {});
  }
  return resumed;
}

/** 전체 중단. */
export async function stopRoutine(): Promise<void> {
  await fullCleanup();
}

/**
 * v1.6 Phase 10-D — LA Intent (PauseRoutineIntent) 처리 후 RN 측 ar 동기화 만.
 * LA Intent 가 이미 AlarmKit pause(id:) 직접 호출 + Activity update paused:true 처리.
 * → RN 은 ar.pausedAt 만 갱신. chain alarm 재조작 X / endLiveActivity X.
 *
 * @param pauseTimestamp  signal.timestamp = LA Intent perform 시점.
 *                        RN polling 시점이 아닌 실제 사용자 LA 누름 시점 사용 (위험 #X 정정).
 */
export async function pauseRoutineFromLA(pauseTimestamp: number): Promise<ActiveRoutine | null> {
  const ar = await loadActiveRoutine();
  if (!ar || ar.pausedAt !== null) return ar;
  const paused: ActiveRoutine = { ...ar, pausedAt: pauseTimestamp };
  await saveActiveRoutine(paused);
  return paused;
}

/**
 * v1.6 Phase 10-D — LA Intent (ResumeRoutineIntent) 처리 후 RN 측 ar 동기화 만.
 * LA Intent 가 이미 AlarmKit resume(id:) 호출 + Activity update paused:false.
 * → RN 은 ar.stepEndAt shift + pausedAt=null 만. chain alarm 재예약 X.
 *
 * @param resumeTimestamp  signal.timestamp = LA Intent perform 시점.
 *                         pauseDuration = resumeTimestamp - ar.pausedAt 정확 계산 (위험 #X 정정).
 */
export async function resumeRoutineFromLA(resumeTimestamp: number): Promise<ActiveRoutine | null> {
  const ar = await loadActiveRoutine();
  if (!ar || ar.pausedAt === null) return ar;
  const pauseDuration = Math.max(0, resumeTimestamp - ar.pausedAt);
  const resumed: ActiveRoutine = {
    ...ar,
    stepEndAt: ar.stepEndAt + pauseDuration,
    pausedAt: null,
  };
  await saveActiveRoutine(resumed);
  // v1.7 hotfix #29 — LA 측 stepEndAt shift update (= 위젯 0:00 정정 root cause).
  // 직전 = ar 측 stepEndAt shift + LA update ❌ → LA 측 stepEndAt = 과거 시점 잔존 →
  //   resume 후 paused:false 갱신 (= LA Intent native) → countdown 분기 진입 →
  //   safeStepEndDate (= max(end, now+0.01)) → 0.01초 → 위젯 0:00 표시.
  // v1.7 hotfix #LAUnify Phase 10-G1 — AlarmKit factory 자동 LA 갱신.
  return resumed;
}

/**
 * 앱 기동 또는 포그라운드 복귀 시 호출.
 */
export async function restoreRoutineState(): Promise<RestoreResult> {
  const ar = await loadActiveRoutine();
  if (!ar) return { kind: 'none' };

  const routine = await findRoutine(ar.routineId);
  if (!routine) {
    await fullCleanup();
    return { kind: 'none' };
  }

  if (Date.now() > ar.deadlineAt) {
    await fullCleanup();
    return { kind: 'expired' };
  }

  // v1.7 hotfix #LAUnify Phase 10-G1 — 옛 LiveActivityBridge cleanup 코드 제거.
  // AlarmKit framework가 LA Activity lifecycle을 자동 관리 (cold-start 시 alarm 잔존하면 LA도 자동 표시).

  await AsyncStorage.setItem(IS_ROUTINE_ACTIVE_KEY, 'true').catch(() => {});

  if (ar.awaitingConfirm) {
    return { kind: 'alarm', routineId: routine.id };
  }

  if (ar.pausedAt !== null) {
    return { kind: 'run', routineId: routine.id };
  }

  // v1.6 옵션 A: BG/KILL 자동 진행 후 사용자 복귀 — 시간 차이만큼 다회 진행 처리.
  // 시스템 측 chain 알람은 시간이 되면 자동 fire 됐을 것. ar.currentStepIndex 만 갱신 안 된 상태.
  let cur: ActiveRoutine = ar;
  while (Date.now() >= cur.stepEndAt) {
    const result = await completeCurrentMission();
    if (!result) return { kind: 'none' };
    if (result.kind === 'end') return { kind: 'none' };
    if (result.kind === 'advance_confirm') return { kind: 'alarm', routineId: routine.id };
    cur = result.ar;
  }

  await scheduleBackgroundNotif(routine, cur, 'restoreRoutineState');
  // v1.7 hotfix #LAUnify Phase 10-G1 — AlarmKit factory 자동 LA 갱신.
  return { kind: 'run', routineId: routine.id };
}
