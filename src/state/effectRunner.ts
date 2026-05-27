// v2.0 P3.1 — SessionController.SideEffect 를 실제 alarm/routine bridge 호출로 결합.
//
// SessionController.transition() 이 반환한 SideEffect 를 dispatch 가 effectRunner 에 위임.
// 본 파일이 그 runner 구현. P2 단계엔 Logger placeholder 였던 부분을 P3 단계에서 채움.
//
// UI 영역 (Navigate / ShowAd) 은 DeviceEventEmitter 로 위임 → 컴포넌트 측 listen.
// 그 외 (Schedule/Cancel/Restore/Record) 는 직접 alarmScheduler/routineScheduler 호출.
//
// ⑨ guard 핵심 위치:
//   - CancelAlarmChain effect → cancelAlarmsForEntity (이미 F1+F2 적용)
//   - OnAlarmFire 측 P3.6 에서 alarm.enabled 검사 추가 (App.tsx 의 onAlarmStateChange listener 결합 시점)
//   - OnAppActive 측 cleanup 강화 (disabled entity chain 정리)

import { DeviceEventEmitter } from 'react-native';
import { Logger } from '../utils/logger';
import { registerEffectRunner, SideEffect } from './SessionController';
import {
  scheduleAlarmMain,
  cancelAlarmsForEntity,
} from '../utils/alarmScheduler';
import {
  scheduleRoutineConfirmPrompt,
  cancelRoutineConfirmPrompt,
} from '../utils/routineScheduler';
import AlarmkitBridge from '../../modules/alarmkit-bridge';
import {
  loadAlarms,
} from '../constants/alarms';
import {
  Alarm,
} from '../constants/alarms';
import {
  listAllAlarmMetadata,
  deleteAlarmMetadata,
  saveAlarmMetadata,
} from '../utils/alarmkitMappingTable';
import {
  PENDING_DISABLED_ALARMS_KEY,
  ACTIVE_ROUTINE_KEY,
  ActiveRoutine,
  loadRoutines,
  recordStepSession,
} from '../constants/routines';
import { restorePendingDisabledAlarms } from '../utils/routineController';
import { cancelRoutinePrealerts } from '../utils/routineScheduler';
import {
  writeRoutineSnapshot,
  clearRoutineSnapshot,
  RoutineSnapshot,
  RoutineSnapshotStep,
} from '../utils/appGroupSync';
import { Session } from '../types/session';
import i18n from '../i18n';
import { SETTINGS_KEY } from '../constants/settings';
import { ALARM_SOUNDS, DEFAULT_SOUND_ID } from '../constants/sounds';
import AsyncStorage from '@react-native-async-storage/async-storage';

// v2.0 D.2 — IS_ROUTINE_ACTIVE_KEY (옛 routineController 측 사용 키와 동일)
const IS_ROUTINE_ACTIVE_KEY = 'isRoutineActive';

// ───────────────────────────────────────────────────────────
// v2.0 C — effectRunner 측 모듈 상태 (옛 routineController.ts 측 모듈 변수 답습).
//
// currentRunningAlarmId — 직전 ScheduleConfirmPrompt 측 반환 id.
//   pause/resume/snapshot 측 동일 id 사용 (옛 currentConfirmPromptId 동등).
// lastScheduleKey/At — DupSched 가드 (옛 routineController.ts:55-56 동등).
//   동일 routineId:stepIdx:stepEndAt 1초 이내 재호출 차단.
// ───────────────────────────────────────────────────────────

let currentRunningAlarmId: string | null = null;
let lastScheduleKey: string | null = null;
let lastScheduleAt = 0;

/** 옛 routineController.clampCountdown 동등. */
function clampCountdown(sec: number | undefined): number {
  const v = typeof sec === 'number' ? sec : 5;
  return Math.max(0, Math.min(60, Math.floor(v)));
}

// ───────────────────────────────────────────────────────────
// v2.0 C — Session ↔ ActiveRoutine (옛) 호환 mirror.
//   목적: ActiveRoutineSection / RoutineAlarmScreen / RoutineList 가 옛 ar 사용 중.
//   UI 측 useSession 도입 전 임시 호환. (C.11+ 단계 후 본 mirror 폐기 가능)
// ───────────────────────────────────────────────────────────

export function sessionToActiveRoutine(session: Session): ActiveRoutine {
  return {
    routineId: session.alarmBinding?.alarmEntityId ?? session.sessionId,
    currentStepIndex: session.currentStepIndex,
    stepEndAt: session.stepEndAt,
    pausedAt: session.pausedAt,
    startedAt: session.startedAt,
    deadlineAt: session.deadlineAt,
    awaitingConfirm: session.awaitingConfirm,
  };
}

// ───────────────────────────────────────────────────────────
// DeviceEventEmitter 이벤트 채널 (UI 위임 영역)
// ───────────────────────────────────────────────────────────

export const SESSION_EVENT_NAVIGATE = 'session_navigate';
export const SESSION_EVENT_SHOW_AD = 'session_show_ad';
export const SESSION_EVENT_LISTENER = 'session_listener_event';

// ───────────────────────────────────────────────────────────
// effectRunner 본체
// ───────────────────────────────────────────────────────────

async function runEffect(effect: SideEffect): Promise<void> {
  switch (effect.kind) {
    // ─── alarm 측 ────────────────────────────────────────
    case 'ScheduleAlarmChain': {
      const { binding } = effect;
      const alarms = await loadAlarms();
      const target = alarms.find((a) => a.id === binding.alarmEntityId);
      if (!target) {
        Logger.warn(
          'effectRunner',
          `ScheduleAlarmChain alarm not found entityId=${binding.alarmEntityId}`
        );
        return;
      }
      await scheduleAlarmMain(target).catch((e) => {
        Logger.warn('effectRunner', `ScheduleAlarmChain error=${String(e)}`);
      });
      return;
    }

    case 'CancelAlarmChain': {
      // F1+F2 transactional cancel 이 이미 cancelAlarmsForEntity 내부에 적용됨
      await cancelAlarmsForEntity(effect.alarmEntityId).catch((e) => {
        Logger.warn('effectRunner', `CancelAlarmChain error=${String(e)}`);
      });
      return;
    }

    // Sub A-2 fix (2026-05-25, Timer 통합) — 단발성 알람 schedule.
    //   AlarmkitBridge.scheduleAlarm({type: 'timer_main'}) 1회 호출 + saveAlarmMetadata.
    //   사운드 = settings cache read (= HomeScreen 측 옛 코드 정합).
    case 'ScheduleAlarmOnce': {
      try {
        const soundId = (await AsyncStorage.getItem(SETTINGS_KEY.ALARM_SOUND)) ?? DEFAULT_SOUND_ID;
        const soundItem = ALARM_SOUNDS.find((s) => s.id === soundId) ?? ALARM_SOUNDS[0];
        const id = await AlarmkitBridge.scheduleAlarm({
          entityId: effect.entityId,
          title: effect.title,
          fireAt: effect.fireAt,
          stopLabel: effect.stopLabel ?? '확인',
          type: 'timer_main',
          soundName: soundItem.pushSound,
          laStepName: effect.laStepName ?? '타이머',
          laStepIndex: 0,
          laTotalSteps: 1,
          laStage: 'step',
          laRoutineId: effect.entityId,
          laRoutineName: effect.laRoutineName ?? '타이머',
        });
        if (id) {
          await saveAlarmMetadata({ alarmId: id, type: 'timer_main', entityId: effect.entityId });
          Logger.warn('effectRunner', `ScheduleAlarmOnce id=${id} entityId=${effect.entityId} fireAt=${effect.fireAt}`);
        } else {
          Logger.warn('effectRunner', `ScheduleAlarmOnce returned null id entityId=${effect.entityId}`);
        }
      } catch (e) {
        Logger.warn('effectRunner', `ScheduleAlarmOnce error=${String(e)}`);
      }
      return;
    }

    case 'StopAlarmNative': {
      await AlarmkitBridge.stopAlarm(effect.alarmId).catch((e) => {
        Logger.warn('effectRunner', `StopAlarmNative error=${String(e)}`);
      });
      return;
    }

    // ─── routine 측 ─────────────────────────────────────
    case 'ScheduleConfirmPrompt': {
      // v2.0 C — 옛 scheduleBackgroundNotif 등가 처리.
      //   DupSched 가드 + 이전 confirm_prompt cancel + LA metadata 7인자 전달 + currentRunningAlarmId 캐싱.
      const key = `${effect.routineId}:${effect.stepIndex ?? 0}:${effect.fireAt}`;
      if (lastScheduleKey === key && Date.now() - lastScheduleAt < 1000) {
        Logger.warn('effectRunner', `ScheduleConfirmPrompt SKIP duplicate key=${key}`);
        return;
      }
      lastScheduleKey = key;
      lastScheduleAt = Date.now();
      // 이전 confirm_prompt 측 정리 (옛 currentConfirmPromptId 패턴)
      if (currentRunningAlarmId) {
        await cancelRoutineConfirmPrompt(currentRunningAlarmId).catch(() => {});
        currentRunningAlarmId = null;
      }
      // v2.0 #ConfirmPromptDedup (2026-05-28) — entityId 매칭 모든 잔존 confirm_prompt 강제 cancel.
      //   직전 = currentRunningAlarmId 측 단일만 cancel → JS bridge reset / Resync race / Start+Advance 다른 path 측 race 시
      //   다른 alarmId 잔존 가능 → 같은 routine 측 confirm_prompt 2개 동시 alerting → user 1회 press 측 = 양쪽 처리 +
      //   추가 press 유발 → AdvanceNextStepIntent 다중 발화 → step skip + 조기 종료 회귀 (log01.md 2026-05-27 06:35).
      //   정정 = mapping table 측 type=confirm_prompt + entityId=routineId 측 모든 alarmId cancel + metadata 정식 delete.
      try {
        const allMeta = await listAllAlarmMetadata();
        const staleConfirms = allMeta.filter(m =>
          m.type === 'confirm_prompt' &&
          m.entityId === effect.routineId &&
          m.deleted !== true
        );
        if (staleConfirms.length > 0) {
          Logger.warn('effectRunner', `ScheduleConfirmPrompt stale dedup count=${staleConfirms.length} routineId=${effect.routineId} ids=[${staleConfirms.map(m => m.alarmId).join(',')}]`);
          for (const meta of staleConfirms) {
            await AlarmkitBridge.cancelAlarm(meta.alarmId).catch(() => {});
            await deleteAlarmMetadata(meta.alarmId).catch(() => {});
          }
        }
      } catch (e) {
        Logger.warn('effectRunner', `ScheduleConfirmPrompt stale dedup error=${String(e)}`);
      }
      try {
        const id = await scheduleRoutineConfirmPrompt(
          effect.routineId,
          new Date(effect.fireAt),
          effect.nextStepName,
          effect.routineName,
          effect.currentStepName,
          effect.stepIndex,
          effect.totalSteps,
        );
        currentRunningAlarmId = id;
        Logger.warn('effectRunner', `ScheduleConfirmPrompt id=${id ?? '(null)'} key=${key}`);
      } catch (e) {
        Logger.warn('effectRunner', `ScheduleConfirmPrompt error=${String(e)}`);
      }
      return;
    }

    case 'CancelConfirmPrompt': {
      // routineScheduler.cancelRoutineConfirmPrompt 호출
      // 본 P3.1 단계: cancelAlarm 직접
      await AlarmkitBridge.cancelAlarm(effect.alarmId).catch(() => {});
      await deleteAlarmMetadata(effect.alarmId).catch(() => {});
      if (currentRunningAlarmId === effect.alarmId) currentRunningAlarmId = null;
      return;
    }

    // ─── PENDING_DISABLED 측 ───────────────────────────
    case 'RestorePendingDisabled': {
      // routineController.restorePendingDisabledAlarms 호출 — 일반 routine 시작 시 임시 disable 한 알람 복원.
      await restorePendingDisabledAlarms().catch((e) => {
        Logger.warn('effectRunner', `RestorePendingDisabled error=${String(e)}`);
      });
      return;
    }

    // ─── 세션 기록 ──────────────────────────────────────
    case 'RecordStepSession': {
      try {
        const routines = await loadRoutines();
        const routine = routines.find((r) => r.id === effect.routineId);
        if (routine) {
          await recordStepSession(routine, effect.stepIndex, effect.executionId);
        }
      } catch (e) {
        Logger.warn('effectRunner', `RecordStepSession error=${String(e)}`);
      }
      return;
    }

    // ─── UI 위임 영역 ───────────────────────────────────
    case 'EmitEvent': {
      DeviceEventEmitter.emit(effect.event, effect.payload ?? {});
      return;
    }

    case 'ShowInterstitialAd': {
      DeviceEventEmitter.emit(SESSION_EVENT_SHOW_AD, {});
      return;
    }

    case 'NavigateAlarmScreen': {
      DeviceEventEmitter.emit(SESSION_EVENT_NAVIGATE, {
        target: 'Alarm',
        alarmEntityId: effect.alarmEntityId,
      });
      return;
    }

    case 'NavigateHome': {
      DeviceEventEmitter.emit(SESSION_EVENT_NAVIGATE, { target: 'Home' });
      return;
    }

    // ─── 영역 D.2 신규 4종 ──────────────────────────────
    case 'SetIsRoutineActive': {
      try {
        if (effect.active) {
          await AsyncStorage.setItem(IS_ROUTINE_ACTIVE_KEY, 'true');
        } else {
          await AsyncStorage.removeItem(IS_ROUTINE_ACTIVE_KEY);
        }
      } catch (e) {
        Logger.warn('effectRunner', `SetIsRoutineActive error=${String(e)}`);
      }
      return;
    }

    case 'PauseAlarmNative': {
      // Apple AlarmKit framework pause → LA paused state 자동 진입.
      // v2.0 C.B — effectRunner 측 currentRunningAlarmId 사용 (kind 무관, binding 미사용).
      // v1.9 #PauseResumeFallback — currentRunningAlarmId null 시 = native listAlarms 측 countdown alarm 측 lookup.
      //   race 시점 (= confirm_prompt cancel + 새 schedule 사이) 측 widget pause 클릭 → null skip → LA pause 미발동 회귀.
      //   정정 = fallback = countdown alarm 측 = pause 호출 (= active alarm 측 단일 가정).
      let targetId = currentRunningAlarmId;
      if (!targetId) {
        try {
          const nativeAlarms = await AlarmkitBridge.listAlarms();
          const countdown = nativeAlarms.find(a => a.state === 'countdown');
          targetId = countdown?.id ?? null;
          if (targetId) Logger.warn('effectRunner', `PauseAlarmNative fallback native lookup id=${targetId}`);
        } catch {}
      }
      if (!targetId) {
        Logger.warn('effectRunner', 'PauseAlarmNative skip — currentRunningAlarmId null + native lookup miss');
        return;
      }
      await AlarmkitBridge.pauseAlarm(targetId).catch((e: any) => {
        Logger.warn('effectRunner', `PauseAlarmNative error=${String(e)}`);
      });
      return;
    }

    case 'ResumeAlarmNative': {
      // Apple AlarmKit framework resume → LA countdown 복귀.
      // v2.0 C.B — effectRunner 측 currentRunningAlarmId 사용.
      // v1.9 #PauseResumeFallback — null 시 = native paused alarm 측 lookup.
      let targetId = currentRunningAlarmId;
      if (!targetId) {
        try {
          const nativeAlarms = await AlarmkitBridge.listAlarms();
          const paused = nativeAlarms.find(a => a.state === 'paused');
          targetId = paused?.id ?? null;
          if (targetId) Logger.warn('effectRunner', `ResumeAlarmNative fallback native lookup id=${targetId}`);
        } catch {}
      }
      if (!targetId) {
        Logger.warn('effectRunner', 'ResumeAlarmNative skip — currentRunningAlarmId null + native lookup miss');
        return;
      }
      await AlarmkitBridge.resumeAlarm(targetId).catch((e: any) => {
        Logger.warn('effectRunner', `ResumeAlarmNative error=${String(e)}`);
      });
      return;
    }

    case 'CleanupAlertingAlarms': {
      // 옛 confirmAndAdvance (routineController:481-500) 측 alerting alarm 일괄 stop loop.
      //   confirm_prompt / prealert / metadata 없는 alerting 정리.
      // v1.9 #CleanupAlertingFull — stopAlarm만 호출 시 = 측 = alarm 측 alerting → scheduled 복귀 측 = 다음 시점 측 다시 alerting 가능.
      //   정정 = stopAlarm + cancelAlarm 둘 다 호출 (= idempotent + 완전 정리). meta=null orphan 측 도 동일.
      try {
        const alarms = await AlarmkitBridge.listAlarms();
        const metas = await listAllAlarmMetadata();
        for (const a of alarms) {
          if (a.state !== 'alerting') continue;
          const meta = metas.find((m) => m.alarmId === a.id);
          if (meta && (meta.type === 'confirm_prompt' || meta.type === 'prealert')) {
            await AlarmkitBridge.stopAlarm(a.id).catch(() => {});
            await AlarmkitBridge.cancelAlarm(a.id).catch(() => {});
            await deleteAlarmMetadata(a.id).catch(() => {});
          } else if (!meta) {
            // metadata 없는 alerting = orphan = 안전망 stop + cancel (= 완전 정리).
            await AlarmkitBridge.stopAlarm(a.id).catch(() => {});
            await AlarmkitBridge.cancelAlarm(a.id).catch(() => {});
          }
        }
      } catch (e) {
        Logger.warn('effectRunner', `CleanupAlertingAlarms error=${String(e)}`);
      }
      return;
    }

    // ─── 영역 C 신규 4종 (routineController wrapper 측 호환) ─
    case 'SaveActiveRoutine': {
      // Session → 옛 ar mirror. UI useSession 도입 전 임시.
      try {
        const ar = sessionToActiveRoutine(effect.session);
        await AsyncStorage.setItem(ACTIVE_ROUTINE_KEY, JSON.stringify(ar));
      } catch (e) {
        Logger.warn('effectRunner', `SaveActiveRoutine error=${String(e)}`);
      }
      return;
    }

    case 'ClearActiveRoutine': {
      // v2.0 C.F — 옛 fullCleanup → cancelBackgroundNotif 등가 통합.
      //   1. currentRunningAlarmId 측 confirm_prompt cancel
      //   2. mapping table 측 chain/confirm_prompt 잔존 일괄 cancel
      //   3. App Group snapshot 정리
      //   4. ACTIVE_ROUTINE_KEY 제거
      //   5. dupSched 키 reset
      try {
        if (currentRunningAlarmId) {
          await cancelRoutineConfirmPrompt(currentRunningAlarmId).catch(() => {});
        }
        currentRunningAlarmId = null;
        lastScheduleKey = null;
        lastScheduleAt = 0;
        try {
          const metas = await listAllAlarmMetadata();
          for (const meta of metas) {
            if (meta.type === 'chain' || meta.type === 'confirm_prompt') {
              await AlarmkitBridge.cancelAlarm(meta.alarmId).catch(() => {});
              await deleteAlarmMetadata(meta.alarmId).catch(() => {});
            }
          }
        } catch (e) {
          Logger.warn('effectRunner', `ClearActiveRoutine cleanup error=${String(e)}`);
        }
        clearRoutineSnapshot();
        await AsyncStorage.removeItem(ACTIVE_ROUTINE_KEY);
      } catch (e) {
        Logger.warn('effectRunner', `ClearActiveRoutine error=${String(e)}`);
      }
      return;
    }

    case 'WriteRoutineSnapshot': {
      // 옛 mirrorRoutineSnapshot 등가 — native AdvanceNextStepIntent 가 백그라운드에서 읽음.
      // v2.0 C.C — sound id 매핑 + i18n.t + autoCountdownSec + completedStepIndices/routineEnded 보강.
      try {
        const s = effect.session;
        // 사용자 설정 사운드 (단일 timer 와 동일 정책 — 옛 mirrorRoutineSnapshot 정합)
        const soundId = (await AsyncStorage.getItem(SETTINGS_KEY.ALARM_SOUND)) ?? DEFAULT_SOUND_ID;
        const soundItem = ALARM_SOUNDS.find((x) => x.id === soundId) ?? ALARM_SOUNDS[0];
        const pushSound = soundItem?.pushSound ?? '';

        const steps: RoutineSnapshotStep[] = s.steps.map((step) => ({
          name: step.name,
          durationSec: Math.max(0, step.durationSeconds),
          // 옛 정책 — 모든 step 동일 사용자 설정 사운드
          soundName: pushSound,
        }));

        const snapshot: RoutineSnapshot = {
          routineId: s.alarmBinding?.alarmEntityId ?? s.sessionId,
          routineName: effect.routineName ?? s.laMeta?.routineName ?? '',
          currentStepIndex: s.currentStepIndex,
          totalSteps: s.steps.length,
          steps,
          // v2.0 C.B — effectRunner 측 currentRunningAlarmId 사용 (옛 mirrorRoutineSnapshot alarmId 인자 등가)
          currentAlarmId: currentRunningAlarmId ?? '',
          stepEndAt: s.stepEndAt,
          i18nConfirmPromptTitle: i18n.t('routine.confirmPromptTitle', { defaultValue: '다음 루틴' }),
          i18nConfirmPromptStop: i18n.t('routine.confirmPromptStop', { defaultValue: '확인' }),
          i18nAdvanceLabel: i18n.t('routine.alarmAdvance', { defaultValue: '다음 진행' }),
          i18nRoutineCompleteTitle:
            effect.routineCompleteTitle ??
            i18n.t('routine.routineCompleteTitle', { defaultValue: '루틴 완료' }),
          savedAt: Date.now(),
          autoCountdownSec: clampCountdown(effect.autoCountdownSec),
          completedStepIndices: [],
          routineEnded: false,
        };
        writeRoutineSnapshot(snapshot);
      } catch (e) {
        Logger.warn('effectRunner', `WriteRoutineSnapshot error=${String(e)}`);
      }
      return;
    }

    case 'CancelRoutinePrealerts': {
      // 옛 cancelRoutinePrealerts — 잔존 prealert 일괄 cancel.
      await cancelRoutinePrealerts(effect.routineId).catch((e) => {
        Logger.warn('effectRunner', `CancelRoutinePrealerts error=${String(e)}`);
      });
      return;
    }

    case 'SetCurrentRunningAlarmId': {
      // v2.0 C.H — native AdvanceNextStepIntent 측 새 alarm id 동기.
      //   옛 syncRoutineFromSnapshot line 490 (currentConfirmPromptId = snapshot.currentAlarmId) 등가.
      currentRunningAlarmId = effect.alarmId || null;
      return;
    }
  }
}

// ───────────────────────────────────────────────────────────
// v2.0 C — Stop / fullCleanup 측 추가 helper.
// ClearActiveRoutine effect 와 clearRoutineSnapshot 같이 처리.
// ───────────────────────────────────────────────────────────

export async function fullCleanupViaEffects(): Promise<void> {
  try {
    clearRoutineSnapshot();
  } catch {}
  try {
    await AsyncStorage.removeItem(ACTIVE_ROUTINE_KEY);
    await AsyncStorage.removeItem(IS_ROUTINE_ACTIVE_KEY);
  } catch {}
  // v2.0 C — currentRunningAlarmId / dupSched 키 reset
  currentRunningAlarmId = null;
  lastScheduleKey = null;
  lastScheduleAt = 0;
}

// ───────────────────────────────────────────────────────────
// ⑨ guard helpers (P3.6 에서 onAlarmStateChange listener 결합 시 사용)
// ───────────────────────────────────────────────────────────

/**
 * alarm.enabled=false 인 entity 의 alarm fire 검사.
 * true 반환 시 silent stop + cancel + delete metadata 처리해야 함.
 * P3.6 App.tsx onAlarmStateChange listener 측에서 호출.
 */
export async function isGhostAlarmFire(alarmId: string, entityId: string): Promise<boolean> {
  try {
    const alarms = await loadAlarms();
    const alarm = alarms.find((a: Alarm) => a.id === entityId);
    if (alarm && !alarm.enabled) {
      Logger.warn(
        'effectRunner',
        `⑨ guard: ghost alarm fire detected entityId=${entityId} alarmId=${alarmId}`
      );
      return true;
    }
    return false;
  } catch (e) {
    Logger.warn('effectRunner', `isGhostAlarmFire error=${String(e)}`);
    return false;
  }
}

/**
 * cold-start 측 ghost cleanup 강화.
 * disabled alarm entity 의 chain 잔존을 mapping table 기준으로 정리.
 * P3.6 App.tsx 측 OnAppActive effect 또는 cold-start init 측에서 호출.
 */
export async function cleanupDisabledEntityChains(): Promise<number> {
  try {
    const alarms = await loadAlarms();
    const enabledEntityIds = new Set(alarms.filter((a: Alarm) => a.enabled).map((a: Alarm) => a.id));
    const allMeta = await listAllAlarmMetadata();
    let cleaned = 0;
    for (const meta of allMeta) {
      if (meta.type === 'alarm_main' && !enabledEntityIds.has(meta.entityId)) {
        await AlarmkitBridge.cancelAlarm(meta.alarmId).catch(() => {});
        await deleteAlarmMetadata(meta.alarmId).catch(() => {});
        cleaned += 1;
      }
    }
    if (cleaned > 0) {
      Logger.warn(
        'effectRunner',
        `⑨ guard: cleanupDisabledEntityChains cleaned=${cleaned}`
      );
    }
    return cleaned;
  } catch (e) {
    Logger.warn('effectRunner', `cleanupDisabledEntityChains error=${String(e)}`);
    return 0;
  }
}

// ───────────────────────────────────────────────────────────
// 부트스트랩 — App.tsx 초기화 시점에 호출.
// P3.6 에서 App.tsx import 추가.
// ───────────────────────────────────────────────────────────

let bootstrapped = false;

export function bootstrapEffectRunner(): void {
  if (bootstrapped) return;
  registerEffectRunner(runEffect);
  bootstrapped = true;
  Logger.info('effectRunner', 'bootstrapped');
}
