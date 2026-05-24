// v2.0 P2.4 — Action 5 source 진입점 통합.
//
// 5 source:
//   1. User UI         → buildUiAction*  (Start/Stop/Dismiss/Advance/Pause/Resume/Enable/Disable)
//   2. AlarmListener   → onAlarmFire   (AlarmkitBridge.addListener 결합 — P3)
//   3. AppState 'active' → onAppActive  (RN AppState change 결합 — P3)
//   4. setTimeout/Interval → onAutoTimeout / onEndAtReached
//   5. LA Intent signal → onLAControlSignal (LAControlSignal → action 변환 — P3)
//
// 본 P2 단계: helper 함수 정의만. 실제 구독은 P3 단계에서 App.tsx 부착 (subscribe pattern).
// 본 P2 단계: dispatch 직접 호출 helper + LAControlSignal → action 변환 router.

import { DeviceEventEmitter } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Logger } from '../utils/logger';
import { dispatch } from './SessionController';
import {
  stopRoutine,
  syncRoutineFromSnapshot,
} from '../utils/routineController';
import { loadAlarms } from '../constants/alarms';
import { loadRoutines } from '../constants/routines';
import { readRoutineSnapshot } from '../utils/appGroupSync';
import { isAdhocAlarmRoutine } from '../utils/alarmRoutineLink';
import { SESSION_EVENT_NAVIGATE } from './effectRunner';
import {
  SessionAction,
  Step,
  AlarmBinding,
  SessionKind,
  StopReason,
  MissionResult,
  AutoTimeoutReason,
  AlarmType,
} from '../types/session';

// ───────────────────────────────────────────────────────────
// 1. User UI helpers
// ───────────────────────────────────────────────────────────

// 3번 fix (2026-05-25) — dispatchStart 함수 폐기. caller 0건. SessionAction.Start union 분리로 인해 generic params 측 narrowing 불가.
//   호출처 = ActionDispatcher.onAlarmFire (C-1 simple_alarm) + routineController.dispatchStartRoutine (routine/ad_hoc) — 각각 dispatch() 직접 호출 (타입 narrowing 정합).

export async function dispatchStop(reason: StopReason) {
  return dispatch({ type: 'Stop', reason });
}

export async function dispatchDismiss(missionResult: MissionResult) {
  return dispatch({ type: 'Dismiss', missionResult });
}

export async function dispatchAdvance() {
  return dispatch({ type: 'Advance' });
}

export async function dispatchPause(timestamp: number) {
  return dispatch({ type: 'Pause', timestamp });
}

export async function dispatchResume(timestamp: number) {
  return dispatch({ type: 'Resume', timestamp });
}

export async function dispatchEnableAlarm(alarmEntityId: string) {
  return dispatch({ type: 'EnableAlarm', alarmEntityId });
}

export async function dispatchDisableAlarm(alarmEntityId: string) {
  return dispatch({ type: 'DisableAlarm', alarmEntityId });
}

// ───────────────────────────────────────────────────────────
// 2. AlarmListener — onAlarmStateChange 에서 'alerting' 받으면 호출
//    (영역 B 흡수 — App.tsx 측 옛 listener navigate 분기 대체)
// ───────────────────────────────────────────────────────────

import AlarmkitBridge from '../../modules/alarmkit-bridge';
import { deleteAlarmMetadata } from '../utils/alarmkitMappingTable';
import { isGhostAlarmFire } from './effectRunner';
// v2.0 C-1 — simple_alarm kind 자동 Session 생성용 (loadAlarms 측 이미 line 22 import 잔존)
import { getCachedDismissMethod } from '../utils/settingsCache';
import { DEFAULT_SETTINGS } from '../constants/settings';

export type OnAlarmFireResult = { ghost: boolean };

export async function onAlarmFire(params: {
  alarmId: string;
  entityId: string;
  alarmType: AlarmType;
}): Promise<OnAlarmFireResult> {
  // ⑨ guard (영역 B): alarm_main fire 시 alarm.enabled=false ghost 차단.
  //   transition 진입 전 silent stop + cancel + delete → NavigateAlarmScreen effect 미생성.
  //   prealert / confirm_prompt 는 검사 X (영역 D 흡수 후 보강).
  //   ghost=true 반환 시 옛 listener 측 early return → 옛 흐름 종료.
  if (params.alarmType === 'main') {
    if (await isGhostAlarmFire(params.alarmId, params.entityId)) {
      await AlarmkitBridge.stopAlarm(params.alarmId).catch(() => {});
      await AlarmkitBridge.cancelAlarm(params.alarmId).catch(() => {});
      await deleteAlarmMetadata(params.alarmId).catch(() => {});
      Logger.info('ActionDispatcher', `⑨ guard ghost silent stop alarmId=${params.alarmId} entityId=${params.entityId}`);
      return { ghost: true };
    }
    // v2.0 C-1 — simple_alarm kind 자동 Session 생성.
    //   alarm_main fire 시점 = 모든 alarm 측 simple_alarm Session 생성 (alarm.steps 유무 무관).
    //   alarm.steps 있는 ad-hoc routine 측 = 사용자 typing 후 startRoutineFromAlarm → ad_hoc_routine kind 측 Start dispatch (replaceExisting=true) 측 override.
    //   = alarm fire 시점 alarmBinding 설정 → transition OnAlarmFire 측 entity 매칭 → STEP_ALERTING 전이 + Dismiss effect 정상 발생.
    try {
      const alarms = await loadAlarms();
      const alarm = alarms.find((a) => a.id === params.entityId);
      if (alarm) {
        const dismissMethod = getCachedDismissMethod() ?? DEFAULT_SETTINGS.dismissMethod;
        await dispatch({
          type: 'Start',
          kind: 'simple_alarm',
          sessionId: params.entityId,
          steps: [
            {
              index: 0,
              name: alarm.label || 'alarm',
              durationSeconds: 0,
              endMethod: dismissMethod,
              soundName: '',
            },
          ],
          alarmBinding: {
            alarmEntityId: params.entityId,
            alarmType: 'main',
            alarmRepeat: 'once',
            currentAlarmId: params.alarmId,
            chainAlarmIds: [],
            chainCount: 0,
          },
          replaceExisting: true,
          routineName: alarm.label || 'alarm',
        });
      }
    } catch (e) {
      Logger.warn('ActionDispatcher', `C-1 simple_alarm Start dispatch error=${String(e)}`);
    }
  }
  await dispatch({ type: 'OnAlarmFire', ...params });
  return { ghost: false };
}

// ───────────────────────────────────────────────────────────
// 3. AppState 'active' 전환 시 호출
// ───────────────────────────────────────────────────────────

export async function onAppActive() {
  return dispatch({ type: 'OnAppActive' });
}

// ───────────────────────────────────────────────────────────
// 4. AutoTimer
//    - AlarmScreen 의 autoDismissNoResult (3분) → mission_3min
//    - AlarmScreen 의 RESULT_AUTO_CONFIRM_MS (30초) → result_30s
//    - ActiveRoutineSection 의 T8 endAt → onEndAtReached
// ───────────────────────────────────────────────────────────

export async function onAutoTimeout(reason: AutoTimeoutReason) {
  return dispatch({ type: 'OnAutoTimeout', reason });
}

export async function onEndAtReached() {
  return dispatch({ type: 'OnEndAtReached' });
}

// ───────────────────────────────────────────────────────────
// 5. LA Intent signal → action router
//
// LAControlSignal (appGroupSync.ts) 측 6 action 중 → SessionAction 변환:
//   'pause'             → Pause
//   'resume'            → Resume
//   'stop'              → Stop(la_widget)
//   'advance'           → silent ignore (FIX-⑤: native advance_done 신뢰)
//   'open_app_dismiss'  → Dismiss(미션완료 시) or Advance(awaitingConfirm) — context 따라 router
//   'advance_done'      → OnSnapshotChange
//
// 호출자: App.tsx 측 readControlSignal 측 polling.
// ───────────────────────────────────────────────────────────

export type LAControlAction =
  | 'pause'
  | 'resume'
  | 'stop'
  | 'advance'
  | 'open_app_dismiss'
  | 'advance_done';

export async function onLAControlSignal(params: {
  action: LAControlAction;
  routineId: string;
  timestamp: number;
  /**
   * 'open_app_dismiss' 측 컨텍스트:
   *   - awaitingConfirm=true (confirm_prompt 슬라이드) → Advance
   *   - awaitingConfirm=false (alarm_main 슬라이드) → 정책: chain 보존 (현 session 유지). navigate 만.
   */
  awaitingConfirm?: boolean;
}): Promise<void> {
  const { action, routineId, timestamp, awaitingConfirm } = params;

  switch (action) {
    // ─── 영역 F 흡수 — pause/resume/stop/advance/advance_done ─
    // v2.0 C.E — pauseRoutineFromLA/resumeRoutineFromLA 폐기. dispatch source:'la' 단독.
    //   transition 측 source='la' 시 PauseAlarmNative/ResumeAlarmNative effect 미생성 (LA 이중 호출 방지).
    //   SaveActiveRoutine + EmitEvent('routinePausedExternally'/'routineResumedExternally') effect 가 옛 동작 흡수.
    case 'pause':
      await dispatch({ type: 'Pause', timestamp, source: 'la' });
      return;
    case 'resume':
      await dispatch({ type: 'Resume', timestamp, source: 'la' });
      return;
    case 'stop':
      // v1.6 Phase 12 — 위젯 ✕ stop 시 RoutineListScreen activeManualRoutineId 정리 트리거.
      try {
        await stopRoutine();
      } finally {
        DeviceEventEmitter.emit('routineClearedExternally', { routineId });
      }
      await dispatch({ type: 'Stop', reason: 'la_widget' });
      return;
    case 'advance':
      // FIX-⑤ silent ignore. native advance_done 정공.
      Logger.info('ActionDispatcher', `LA 'advance' silent ignore (FIX-⑤)`);
      return;
    case 'advance_done':
      // v2.0 C.7 — syncRoutineFromSnapshot 본체가 dispatch(OnSnapshotChange) 호출 → 중복 회피 위해 본 case 측 dispatch 제거.
      await syncRoutineFromSnapshot(routineId);
      DeviceEventEmitter.emit('routineAdvancedExternally', { routineId });
      return;

    // ─── open_app_dismiss — 영역 C 흡수 (옛 App.tsx fast/standard 5분기 모두) ─
    case 'open_app_dismiss': {
      Logger.warn('LAControl-DBG', `open_app_dismiss 분기 진입 routineId=${routineId}`);

      // (1) 위반-11 부작용 fix (정식 사이클 §2-C 정합) — 옛 STEP_ALERTING 분기 제거.
      //   옛 가정: STEP_ALERTING = NavigateAlarmScreen effect 가 이미 AlarmScreen mount 시킴 → 중복 차단.
      //   위반-11 fix 후 (SessionController OnAlarmFire NavigateAlarmScreen effect 제거): alarm_main fire → STEP_ALERTING 전이 (effects []) → mount X.
      //   옛 분기 잔존 시: open_app_dismiss perform → STEP_ALERTING return → SESSION_EVENT_NAVIGATE Alarm emit X → mount X → 종료방식 출력 X → chain 회수 X.
      //   정정: STEP_ALERTING 가드 제거. (3) alarm_main 매칭 / (4) Tab navigate 흐름으로 진입.
      //   = 정식 사이클 §2-C "Face ID 인식 → §3 사이클 진입" 정상화. 발견-D (chain cancel mount 의존) 자동 해소.

      // (2) awaitingConfirm 측 — FIX-② confirm_prompt 슬라이드 = 다음 step
      const arRaw = await AsyncStorage.getItem('shuttimer_active_routine').catch(() => null);
      let arParsed: any = null;
      try { arParsed = arRaw ? JSON.parse(arRaw) : null; } catch {}
      const arAwaiting = arParsed?.awaitingConfirm === true;
      const isAdhoc = isAdhocAlarmRoutine(routineId);
      Logger.warn('LAControl-DBG', `open_app_dismiss awaitingConfirm=${arAwaiting} isAdhoc=${isAdhoc}`);

      // 위반-9 fix (정식 사이클 정합) — awaitingConfirm 자동 advance 제거.
      //   옛 v1.x 의도 (LA "Open App" = awaitingConfirm 시 자동 advance) = 정식 사이클과 충돌 → 의도 변경.
      //   정식 사이클: 자동 advance 절대 금지. 사용자 명시적 입력만 advance trigger.
      //   awaitingConfirm=true 상태에서도 (3) alarm_main 매칭 / (4) Tab navigate 흐름으로 진입.
      //   사용자가 AlarmScreen / Tab 화면에서 직접 처리.

      // (2.5) 옵션 A fix (정식 사이클 §3-B 7번, 2026-05-25 사용자 요구) — lastStep 잠금 해제 시 종료방식 화면 진입.
      //   ad-hoc routine / 일반 routine 마지막 step confirm_prompt fire 후 사용자 잠금 해제 → AlarmScreen 종료방식 미션.
      //   snapshot 측 lastStep 판별 (currentStepIndex + 1 >= totalSteps).
      //   옛 App.tsx:410-421 lastStep 자동 navigate 제거와 짝지어 사용자 입력 trigger 시점으로 이동.
      const snap = readRoutineSnapshot();
      if (snap && snap.routineId === routineId && snap.currentStepIndex + 1 >= snap.totalSteps) {
        const routines = await loadRoutines();
        const r = routines.find((x) => x.id === routineId);
        Logger.warn('LAControl-DBG', `lastStep 분기 → SESSION_EVENT_NAVIGATE Alarm fromRoutine=last_step routineId=${routineId} endMethod=${r?.endMethod ?? 'tap'}`);
        DeviceEventEmitter.emit(SESSION_EVENT_NAVIGATE, {
          target: 'Alarm',
          fromRoutine: 'last_step',
          routineId,
          endMethod: r?.endMethod ?? 'tap',
        });
        return;
      }

      // (3) alarm_main 매칭 → navigate Alarm (FIX-③ chain 보존)
      const alarms = await loadAlarms();
      const alarmEntity = alarms.find((x) => x.id === routineId);
      if (alarmEntity) {
        Logger.warn('LAControl-DBG', `alarm_main 매칭 → SESSION_EVENT_NAVIGATE Alarm entityId=${alarmEntity.id}`);
        DeviceEventEmitter.emit(SESSION_EVENT_NAVIGATE, {
          target: 'Alarm',
          alarmEntityId: alarmEntity.id,
        });
        return;
      }

      // (4) ad-hoc/routine — Tab navigate
      Logger.warn('LAControl-DBG', `Tab navigate target=${isAdhoc ? 'AlarmTab' : 'RoutineTab'}`);
      DeviceEventEmitter.emit(SESSION_EVENT_NAVIGATE, {
        target: isAdhoc ? 'AlarmTab' : 'RoutineTab',
      });
      return;
    }
  }
}
