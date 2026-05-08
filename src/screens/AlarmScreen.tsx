import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Vibration,
  Animated,
  Easing,
  AppState,
  Platform,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Accelerometer } from 'expo-sensors';
import { Audio, InterruptionModeIOS } from 'expo-av';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MaterialIcons } from '@expo/vector-icons';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { RootStackParamList } from '../../App';
import { colors } from '../constants/theme';
import { SETTINGS_KEY, DismissMethod, DEFAULT_SETTINGS, MissionDuration, MISSION_DURATION_OPTIONS } from '../constants/settings';
import { ALARM_SOUNDS, DEFAULT_SOUND_ID } from '../constants/sounds';
import * as ScreenOrientation from 'expo-screen-orientation';
import * as Notifications from 'expo-notifications';
import { useTranslation } from 'react-i18next';
import Constants from 'expo-constants';
import { consumeAlarmSound } from '../utils/alarmSoundPreload';
import AlarmkitBridge from '../../modules/alarmkit-bridge';
import { listAllAlarmMetadata, deleteAlarmMetadata } from '../utils/alarmkitMappingTable';
import { stopRoutine } from '../utils/routineController';
import { Logger } from '../utils/logger';
import { loadAlarms } from '../constants/alarms';
import { startRoutineFromAlarm, isAdhocAlarmRoutine } from '../utils/alarmRoutineLink';
// v1.5 VisionCamera + YOLOv10 Frame Processor
import { useSharedValue } from 'react-native-worklets-core';
import { type Detection } from '../utils/objectDetection';
import { getCachedDismissMethod } from '../utils/settingsCache';
// @v1.5 Phase A — 카메라 모드 child. shake/tap 시 useTensorflowModel + Camera 마운트 스킵.
import AlarmCameraMode from './AlarmCameraMode';
import { MISSION_EMOJI, MISSION_POOL, MISSION_LABEL, MISSION_COCO_LABELS, MISSION_CONFIDENCE_OVERRIDE } from '../constants/missionIcons';
// import { InterstitialAd, AdEventType, TestIds } from 'react-native-google-mobile-ads';
import AdBanner from '../components/AdBanner';
// @preserve IAP — Phase 2+ 복원용. 삭제 금지. (TS6133 회피 위해 import 라인 주석)
// import { usePurchase } from '../context/PurchaseContext';

const isExpoGo = (Constants as any).appOwnership === 'expo';

// v1.5: 알람 Audio 경로 진단 로그. Logger는 __DEV__ 가드라 프로덕션 미기록 → AsyncStorage 직접 기록.
// 재현 시 설정 화면의 로그 뷰어(또는 수동 AsyncStorage 조회)로 조회 가능.
const ALARM_AUDIO_LOG_KEY = 'alarm_audio_log';
const ALARM_AUDIO_LOG_MAX = 100;
const appendAlarmAudioLog = async (msg: string) => {
  try {
    const prev = await AsyncStorage.getItem(ALARM_AUDIO_LOG_KEY);
    const arr = prev ? JSON.parse(prev) : [];
    arr.push(`${new Date().toISOString()} ${msg}`);
    if (arr.length > ALARM_AUDIO_LOG_MAX) arr.splice(0, arr.length - ALARM_AUDIO_LOG_MAX);
    await AsyncStorage.setItem(ALARM_AUDIO_LOG_KEY, JSON.stringify(arr));
  } catch {
    // AsyncStorage 실패 무시 (로그 누락보다 런타임 안정성 우선)
  }
  if (__DEV__) console.warn(`[AlarmAudio] ${msg}`);
};

// PROD IDs kept for restoration after verification build
// iOS: ca-app-pub-3043284478228309/6510839159
// Android: ca-app-pub-3043284478228309/6667370376
let interstitial: any = null;
// v1.7 hotfix H1 — module-level 측 광고 ready boolean (= preload 영역 + CLOSED 시 자동 다음 load 영역).
// 본 영역 = AlarmScreen 측 useEffect 측 mount 시 load 호출 영역 ❌ (= 사용자분 측 dismiss 시점 = LOADED 도착 ❌).
// 정공 영역 = 앱 시작 시 1회 load + LOADED listener attach + CLOSED 시 다음 load = 항상 ready 영역 보장.
let interstitialLoaded = false;
if (!isExpoGo) {
  (async () => {
    try {
      const attStatus = await AsyncStorage.getItem('attStatus');
      const npa = attStatus === 'granted' ? false : true;
      const { InterstitialAd, AdEventType } = require('react-native-google-mobile-ads');
      const INTERSTITIAL_UNIT_ID = Platform.select({
        ios: 'ca-app-pub-3043284478228309/6510839159',
        android: 'ca-app-pub-3043284478228309/6667370376',
      }) as string;
      interstitial = InterstitialAd.createForAdRequest(INTERSTITIAL_UNIT_ID, {
        requestNonPersonalizedAdsOnly: npa,
      });
      // v1.7 hotfix H1 — module-level 측 LOADED / ERROR / CLOSED listener attach.
      // AlarmScreen useEffect 측 listener (= mount 시 attach 영역) 영역 영역 = handleAfterAdRef 측 = 별도 영역.
      interstitial.addAdEventListener(AdEventType.LOADED, () => {
        interstitialLoaded = true;
      });
      interstitial.addAdEventListener(AdEventType.ERROR, () => {
        interstitialLoaded = false;
      });
      interstitial.addAdEventListener(AdEventType.CLOSED, () => {
        interstitialLoaded = false;
        // 다음 광고 preload (= 표준 패턴 영역).
        try { interstitial.load(); } catch {}
      });
      // 앱 시작 시 1회 preload (= AlarmScreen mount 시 LOADED 영역 보장).
      try { interstitial.load(); } catch {}
    } catch (e) {
      console.warn('InterstitialAd failed to initialize:', e);
    }
  })();
}

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Alarm'>;
  route: RouteProp<RootStackParamList, 'Alarm'>;
};

type ResultState = 'idle' | 'success' | 'fail';
type AfterAdAction = 'result' | 'home';

// MISSION_POOL 은 ../constants/missionIcons 에서 import (Fluent Emoji 매핑 있는 미션만 — PoC와 동기화)

// v1.5 Frame Processor 상수 (PoC와 동일)
const TARGET_CONFIDENCE = 0.4;
// @v1.5 Phase A — THROTTLE_MS, HITS_REQUIRED는 AlarmCameraMode child로 이동 (frame processor 전용)
const RETRY_BANNER_MS = 1000;
// v1.5 감지 성공 피드백 애니메이션 (PoC와 동일)
const BLINK_ON_MS = 100;
const BLINK_OFF_MS = 80;
const BLINK_COUNT = 2;
const FEEDBACK_DELAY_MS = 300;
const COMPLETE_ANIM_MS = 900;

// MISSION_POOL 기반 초기 랜덤 (AsyncStorage 로드 전 첫 렌더용)
function pickInitialRandomMission(): string {
  return MISSION_POOL[Math.floor(Math.random() * MISSION_POOL.length)];
}

const SHAKE_THRESHOLD = 1.8;
const SHAKE_COUNT_REQUIRED = 3;
const SHAKE_COOLDOWN_MS = 500;
// v1.5: camera 미션은 사용자 설정 타이머 × 2회로 관리되므로 제거. tap/shake만 기존 5분 유지.
const AUTO_DISMISS_MS: Record<string, number> = {
  tap: 5 * 60 * 1000,
  shake: 5 * 60 * 1000,
};
const RESULT_AUTO_CONFIRM_MS = 30 * 1000;
const RESULT_BG = {
  success: '#2e7d32',
  fail: '#c62828',
};

export default function AlarmScreen({ navigation, route }: Props) {
  const { t } = useTranslation();
  // @preserve IAP — usePurchase 훅 호출. Phase 2+ 복원용. 삭제 금지.
  // const { isAdFree } = usePurchase();
  // @v1.5 Phase A — 카메라/tflite 관련 hook은 AlarmCameraMode child로 이동
  // (shake/tap 모드에서 useTensorflowModel 15MB 로드 + Camera 마운트 스킵 → JS thread 부하 제거)

  // v1.5 미션 상태
  const [selectedMissions, setSelectedMissions] = useState<string[]>(MISSION_POOL);
  const selectedMissionsRef = useRef<string[]>(MISSION_POOL);
  useEffect(() => { selectedMissionsRef.current = selectedMissions; }, [selectedMissions]);

  const pickRandomMission = useCallback((exclude?: string): string => {
    const src = selectedMissionsRef.current;
    const pool = exclude != null ? src.filter((m) => m !== exclude) : src;
    if (pool.length === 0) {
      // 단일 선택 + exclude 시: src 자체에서 반환 (0개면 MISSION_POOL fallback)
      if (src.length > 0) return src[0];
      return MISSION_POOL[Math.floor(Math.random() * MISSION_POOL.length)];
    }
    return pool[Math.floor(Math.random() * pool.length)];
  }, []);

  const [currentMission, setCurrentMission] = useState<string>(pickInitialRandomMission);
  const currentMissionRef = useRef(currentMission);
  useEffect(() => {
    currentMissionRef.current = currentMission;
  }, [currentMission]);

  const [missionDuration, setMissionDuration] = useState<MissionDuration>(DEFAULT_SETTINGS.missionDuration);
  const missionDurationRef = useRef<number>(DEFAULT_SETTINGS.missionDuration);
  const [attemptCount, setAttemptCount] = useState<1 | 2>(1);
  const [remainingMs, setRemainingMs] = useState<number>(DEFAULT_SETTINGS.missionDuration * 1000);
  const [isRetryBannerVisible, setIsRetryBannerVisible] = useState(false);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // v1.5 Worklet SharedValue
  const matched = useSharedValue(false);
  const lastRun = useSharedValue(0);
  const targetLabelsSV = useSharedValue<string[]>(MISSION_COCO_LABELS[currentMission] ?? []);
  const thresholdSV = useSharedValue<number>(
    MISSION_CONFIDENCE_OVERRIDE[currentMission] ?? TARGET_CONFIDENCE
  );
  const consecutiveHits = useSharedValue(0);
  const isShufflingSV = useSharedValue(false); // 슬롯머신 중 worklet 스캔 일시 차단

  // @preserve v1-camera — v1 expo-camera state. v1.5 전환으로 사용 안 함. 복원용 주석 유지.
  // const [flash, setFlash] = useState<'off' | 'on'>('off');
  // const [facing, setFacing] = useState<'back' | 'front'>('back');
  // const cameraRef = useRef<CameraView>(null);

  const [settingsLoaded, setSettingsLoaded] = useState(false);
  // v1.6 — goHome 호출 시점에 빈 화면 노출 (광고 닫힘 → AlarmScreen 한 frame 비치는 회귀 차단).
  const [dismissingHome, setDismissingHome] = useState(false);
  // App.tsx에서 사전 로드한 dismissMethod 사용 (AsyncStorage 비동기 지연 제거).
  // v1.6 #12 — routine 마지막 step 진입 시 route.params.endMethod 우선 (settingsCache 무시).
  // 캐시 미적중 시 default fallback. settingsLoaded 후 useEffect에서 정확값으로 갱신.
  const [dismissMethod, setDismissMethod] = useState<DismissMethod>(
    ((route.params as { endMethod?: DismissMethod } | undefined)?.endMethod) ??
    getCachedDismissMethod() ?? DEFAULT_SETTINGS.dismissMethod
  );
  const [vibrationEnabled, setVibrationEnabled] = useState(DEFAULT_SETTINGS.vibrationEnabled);
  const soundRef = useRef<Audio.Sound | null>(null);
  // v1.5: iOS Vibration API는 pattern/repeat 미지원 → 인자 없는 Vibration.vibrate()를 interval로 반복 호출
  const vibrationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // @preserve v1-camera — v1 실패 횟수 카운터. v1.5에서 2회 attempt로 대체.
  // const [failCount, setFailCount] = useState(0);
  // const [failMessage, setFailMessage] = useState(false);
  const [resultState, setResultState] = useState<ResultState>('idle');
  const shakeCountRef = useRef(0);
  const lastShakeTimeRef = useRef(0);

  // @v1.5 — 슬롯머신 효과 (다시 뽑기 시 1.2초 이미지만 일정 리듬 순환, 텍스트 숨김)
  // 구현: 모든 이미지를 pre-mount해두고 opacity만 swap → 첫 디코딩 지연 제거, 리듬 일정.
  const [isShuffling, setIsShuffling] = useState(false);
  const [shuffledList, setShuffledList] = useState<string[]>([]);
  const [shuffleIdx, setShuffleIdx] = useState(0);
  const shuffleIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const shuffleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearShuffle = useCallback(() => {
    if (shuffleIntervalRef.current) {
      clearInterval(shuffleIntervalRef.current);
      shuffleIntervalRef.current = null;
    }
    if (shuffleTimeoutRef.current) {
      clearTimeout(shuffleTimeoutRef.current);
      shuffleTimeoutRef.current = null;
    }
  }, []);

  const adLoadedRef = useRef(false);
  const dismissedRef = useRef(false);
  const resultEnteredRef = useRef(false);
  const autoResultTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const accelSubRef = useRef<{ remove: () => void } | null>(null);
  const pendingResultRef = useRef<'success' | 'fail' | null>(null);
  const afterAdActionRef = useRef<AfterAdAction>('home');
  const handleAfterAdRef = useRef<() => void>(() => {});

  const stopAudioAndVibration = useCallback(async () => {
    // v1.7 hotfix #DBG-C — stopAudioAndVibration 진입 (= dismiss 시점 + AlarmKit cleanup 결과 추적용).
    // Logger.warn (= AsyncStorage 영역 → 설정 측 "로그 공유" 측 조회 영역. TestFlight console 미라우팅 회피).
    Logger.warn('AlarmScreen-DBG', `stopAudioAndVibration 진입 AppState=${AppState.currentState}`);
    Vibration.cancel();
    // v1.5: Vibration interval도 함께 정리 (dismiss 시 진동 재시작 방지)
    if (vibrationIntervalRef.current) {
      clearInterval(vibrationIntervalRef.current);
      vibrationIntervalRef.current = null;
    }
    // v1.6 hotfix — AlarmKit timer_main alarm cancel (시스템 alerting UI 사운드 중단).
    // 미적용 시 stopAsync 가 expo-av 만 정리해 system alerting 사운드 잔존 → 지속 울림.
    // type='timer_main' 만 filter — 루틴 진행 중 일반 타이머 dismiss 시 routine 알람 보존.
    try {
      const metas = await listAllAlarmMetadata();
      Logger.warn('AlarmScreen-DBG', `stopAudioAndVibration metas.count=${metas.length}`);
      for (const m of metas) {
        if (m.type === 'timer_main') {
          await AlarmkitBridge.cancelAlarm(m.alarmId).catch(() => {});
          await deleteAlarmMetadata(m.alarmId).catch(() => {});
        }
      }
      // v1.6 후속 hotfix — 시스템 측 잔존 alerting 알람 cleanup (= mapping table 측 ❌ 영역).
      // dismiss 시점 = 모든 alerting 영역 정리 정공 (= 활성 영역 ❌, alerting 상태만).
      // alerting 상태 = stopAlarm(id:) 명시 호출 (= cancel(id:) ≠ stop(id:), Apple AlarmKit 공식).
      const alarms = await AlarmkitBridge.listAlarms();
      const alertingCount = alarms.filter(a => a.state === 'alerting').length;
      Logger.warn('AlarmScreen-DBG', `stopAudioAndVibration alarms.count=${alarms.length} alertingCount=${alertingCount}`);
      for (const a of alarms) {
        if (a.state === 'alerting') {
          Logger.warn('AlarmScreen-DBG', `stopAudioAndVibration stopAlarm id=${a.id}`);
          await AlarmkitBridge.stopAlarm(a.id).catch((e: any) => {
            Logger.warn('AlarmScreen-DBG', `stopAudioAndVibration stopAlarm throw=${String(e)}`);
          });
          await deleteAlarmMetadata(a.id).catch(() => {});
        }
      }
    } catch (e) {
      Logger.warn('AlarmScreen-DBG', `stopAudioAndVibration outer throw=${String(e)}`);
    }
    // 미발화 예약 알림 취소 + 이미 발화된 배너/OS 사운드 dismiss (race 방지 위해 await)
    await Promise.all([
      Notifications.cancelAllScheduledNotificationsAsync().catch(() => {}),
      Notifications.dismissAllNotificationsAsync().catch(() => {}),
    ]);
    // AlarmScreen 비활성 플래그 먼저 제거 (App.tsx listener가 즉시 navigate 차단 해제)
    await AsyncStorage.removeItem('isAlarmActive').catch(() => {});
    const s = soundRef.current;
    soundRef.current = null;
    if (s) {
      await s.stopAsync().catch(() => {});
      await s.unloadAsync().catch(() => {});
    }
    accelSubRef.current?.remove();
    accelSubRef.current = null;
  }, []);

  // 이중 가드 — routine 진행 중 단일 timer 알림 발화로 잘못 진입한 경우 즉시 RoutineList 로 redirect.
  // (RoutineList 가 active routine sync 로 inline 진행 영역 자동 마운트)
  useEffect(() => {
    // v1.6 #12 — 마지막 step camera 정공 진입은 redirect ❌ (의도된 navigate).
    const fromRoutine = (route.params as { fromRoutine?: string } | undefined)?.fromRoutine;
    if (fromRoutine === 'last_step') return;
    // v1.7 hotfix N1 — alarm entity 측 발화 (= alarmEntityId 영역) 시 = redirect skip 영역.
    // 의도 = "routine 진행 중 단일 timer 잘못 진입" 영역만 redirect. 알람 entity 측 발화 = AlarmScreen 정상 진입 영역 (= tap / shake / scan 영역).
    // 직전 = isRoutineActive=true + non-adhoc routine 측 영역 시 = 알람 entity 측 AlarmScreen mount → 약 0.3초 후 강제 unmount → 사용자 dismiss method 진입 ❌ 회귀.
    const alarmEntityId = (route.params as { alarmEntityId?: string } | undefined)?.alarmEntityId;
    if (alarmEntityId) return;
    AsyncStorage.getItem('isRoutineActive').then(async v => {
      if (v !== 'true') return;
      const arRaw = await AsyncStorage.getItem('shuttimer_active_routine').catch(() => null);
      if (!arRaw) return;
      try {
        const ar = JSON.parse(arRaw);
        // v1.7 hotfix — adhoc 루틴 (= 알람 entity 측 영역) 시 = RoutineList 강제 이동 ❌ → AlarmScreen 그대로 영역 (= 진동 / 사운드 dismiss 가능 영역).
        if (ar?.routineId && !isAdhocAlarmRoutine(ar.routineId)) {
          navigation.replace('RoutineList');
        }
      } catch {}
    }).catch(() => {});
  }, [navigation, route.params]);

  // AlarmScreen 마운트 즉시 isAlarmActive 플래그 설정 (사운드 로드보다 먼저)
  // 언마운트 시 플래그 확실히 제거 (비정상 종료 복구)
  useEffect(() => {
    // v1.7 hotfix #DBG-C — mount 시점 + route.params 영역 (= AlarmScreen 1초 사라짐 root cause 추적용).
    Logger.warn('AlarmScreen-DBG', `mount AppState=${AppState.currentState} routeParams=${JSON.stringify(route.params ?? {})}`);
    AsyncStorage.setItem('isAlarmActive', 'true').catch(() => {});
    // v1.7 hotfix — mount 시 = expo banner dismiss (= 백그라운드 → banner tap 진입 시 잔존 banner 영역 정리).
    Notifications.dismissAllNotificationsAsync()
      .then(() => Logger.warn('AlarmScreen-DBG', 'mount dismissAllNotifications OK'))
      .catch((e: any) => Logger.warn('AlarmScreen-DBG', `mount dismissAllNotifications throw=${String(e)}`));
    return () => {
      Logger.warn('AlarmScreen-DBG', 'unmount');
      AsyncStorage.removeItem('isAlarmActive').catch(() => {});
    };
  }, []);

  const goHome = useCallback(async () => {
    if (dismissedRef.current) return;
    dismissedRef.current = true;
    setDismissingHome(true);
    if (autoResultTimeoutRef.current) {
      clearTimeout(autoResultTimeoutRef.current);
      autoResultTimeoutRef.current = null;
    }
    // v1.6 #12 — 마지막 step 진입한 경우 routine 정상 종료 + RoutineList 복귀.
    // v1.7 hotfix #StopNav — adhoc routine (= aa_ prefix) 측 = AlarmTab 진입 정합 (= 알람 entity 등록 영역 = 메뉴바 보존).
    // non-adhoc routine 측 = 기존 RoutineList 복귀 (= 일반 루틴 영역). 사용자 보고 = "알람 루틴 → 메뉴바 없는 페이지 전환" root cause 정정.
    const fromRoutine = (route.params as { fromRoutine?: string } | undefined)?.fromRoutine;
    const routeRoutineId = (route.params as { routineId?: string } | undefined)?.routineId;
    if (fromRoutine === 'last_step') {
      await stopRoutine().catch(() => {});
      if (routeRoutineId && isAdhocAlarmRoutine(routeRoutineId)) {
        (navigation as any).reset({ index: 0, routes: [{ name: 'Home', state: { routes: [{ name: 'AlarmTab' }] } }] });
      } else {
        navigation.reset({ index: 1, routes: [{ name: 'Home' }, { name: 'RoutineList' }] });
      }
      return;
    }
    // v1.7 Phase 2-A — 알람 entity 측 dismiss 후 = alarm.steps 보유 시 ad-hoc routine 시작.
    // v1.7 hotfix #24 — 시작 위치 = 복귀 위치 규칙. alarmEntityId 있음 = AlarmTab 측 등록 알람 = AlarmTab 복귀.
    //   steps 있음 = ad-hoc routine 시작 추가 (= Phase 2-A). steps 무관 = AlarmTab reset 통일.
    //   직전 = steps 없는 단순 알람 측 fall-through → HomeTab 진입 회귀.
    const alarmEntityId = (route.params as { alarmEntityId?: string } | undefined)?.alarmEntityId;
    if (alarmEntityId) {
      try {
        const alarms = await loadAlarms();
        const a = alarms.find(x => x.id === alarmEntityId);
        if (a && a.steps && a.steps.length > 0) {
          await startRoutineFromAlarm(a).catch(() => {});
        }
      } catch {
        // alarm 로드 / 시작 실패 = AlarmTab 복귀 정공 유지 (= 시작 위치 보존).
      }
      navigation.reset({
        index: 0,
        routes: [{
          name: 'Home',
          state: { routes: [{ name: 'AlarmTab' }] },
        }],
      });
      return;
    }
    navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
  }, [navigation, route.params]);

  // 광고 종료 후 분기: 카메라 결과 화면 OR 홈
  const handleAfterAd = useCallback(() => {
    if (dismissedRef.current) return;
    if (afterAdActionRef.current === 'result' && pendingResultRef.current) {
      setResultState(pendingResultRef.current);
      if (autoResultTimeoutRef.current) clearTimeout(autoResultTimeoutRef.current);
      autoResultTimeoutRef.current = setTimeout(goHome, RESULT_AUTO_CONFIRM_MS);
    } else {
      goHome();
    }
  }, [goHome]);

  // handleAfterAdRef 동기화 (광고 CLOSED 리스너에서 최신 참조 보장)
  useEffect(() => {
    handleAfterAdRef.current = handleAfterAd;
  }, [handleAfterAd]);

  /**
   * ═══════════════════════════════════════════════════════════
   *  @preserve IAP (Interstitial isAdFree 분기) — Phase 2+ 재활성화용
   *  보존 결정일: 2026-04-14 (위치 이전: 2026-04-15, 광고→결과 흐름 재설계)
   *  비활성화 사유: IAP 보류 (B안). 알람 종료 시 항상 Interstitial 시도.
   *  재활성화 조건: 사업자등록 + ASC Paid Apps Agreement 활성화
   *  ⚠️ 이 블록 삭제 금지. 주석 해제만으로 복원 가능해야 함.
   *
   *  @preserve-original (handleConfirm 내부):
   *  if (!isAdFree && adLoadedRef.current) {
   *    interstitial.show().catch(() => navigation.reset({ index: 0, routes: [{ name: 'Home' }] }));
   *  } else {
   *    navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
   *  }
   *
   *  재활성화 시 적용 위치: enterResult + autoDismissNoResult 두 곳의
   *  adLoadedRef.current 체크 앞에 `!isAdFree &&` 가드 추가.
   * ═══════════════════════════════════════════════════════════
   */
  const enterResult = useCallback(async (result: 'success' | 'fail') => {
    if (resultEnteredRef.current) return;
    resultEnteredRef.current = true;
    // cancel/dismiss/sound stop 완료 후 광고/네비게이션 진행 (race 방지)
    await stopAudioAndVibration();
    pendingResultRef.current = result;
    afterAdActionRef.current = dismissMethod === 'camera' ? 'result' : 'home';
    // @v1.0.1 — 카메라 모드: 광고 show 전에 resultState 미리 세팅.
    // 광고 오버레이 뒤에서 카메라가 unmount되어, 광고 닫힐 때 카메라가 순간 보이는 현상 방지.
    if (dismissMethod === 'camera') {
      setResultState(result);
    }
    // v1.7 hotfix H1 — module-level interstitialLoaded 측 검사 (= preload 영역 정합).
    // 본 영역 = adLoadedRef.current 측 = AlarmScreen useEffect 측 listener attach 영역 영역.
    // module-level interstitialLoaded 측 = 앱 시작 시 1회 load + CLOSED 시 다음 load = 항상 ready 영역 영역.
    Logger.warn('Ad-DBG', `enterResult interstitialLoaded=${interstitialLoaded} interstitial=${!!interstitial} dismissMethod=${dismissMethod}`);
    if (interstitialLoaded && interstitial) {
      Logger.warn('Ad-DBG', 'enterResult interstitial.show 호출');
      interstitial.show().catch((e: any) => {
        Logger.warn('Ad-DBG', `enterResult show throw=${String(e)}`);
        handleAfterAd();
      });
    } else {
      Logger.warn('Ad-DBG', `enterResult skip → handleAfterAd 직접 (= 광고 ❌)`);
      handleAfterAd();
    }
  }, [stopAudioAndVibration, dismissMethod, handleAfterAd]);

  const autoDismissNoResult = useCallback(async () => {
    if (dismissedRef.current) return;
    await stopAudioAndVibration();
    afterAdActionRef.current = 'home';
    // v1.7 hotfix H1 — module-level interstitialLoaded 측 검사 (= preload 영역 정합).
    Logger.warn('Ad-DBG', `autoDismissNoResult interstitialLoaded=${interstitialLoaded} interstitial=${!!interstitial}`);
    if (interstitialLoaded && interstitial) {
      Logger.warn('Ad-DBG', 'autoDismissNoResult interstitial.show 호출');
      interstitial.show().catch((e: any) => {
        Logger.warn('Ad-DBG', `autoDismissNoResult show throw=${String(e)}`);
        goHome();
      });
    } else {
      Logger.warn('Ad-DBG', `autoDismissNoResult skip → goHome 직접 (= 광고 ❌)`);
      goHome();
    }
  }, [stopAudioAndVibration, goHome]);

  // 전면 광고 CLOSED listener (= AlarmScreen 측 handleAfterAd 호출 영역).
  // v1.7 hotfix H1 — LOADED / ERROR listener + load() 호출 = module-level 측 영역 (= preload 정합).
  // 본 useEffect 측 = handleAfterAdRef 측 = AlarmScreen 측 ref 영역만 = CLOSED listener 측만 attach 영역.
  useEffect(() => {
    dismissedRef.current = false;
    resultEnteredRef.current = false;

    // v1.7 hotfix #DBG-Ad — useEffect 진입 영역 (= 광고 ❌ root cause 추적용).
    Logger.warn('Ad-DBG', `useEffect 진입 isExpoGo=${isExpoGo} interstitial=${!!interstitial} interstitialLoaded=${interstitialLoaded}`);

    // @preserve IAP — 원본: if (isAdFree || isExpoGo || !interstitial) return;
    if (isExpoGo || !interstitial) {
      Logger.warn('Ad-DBG', `useEffect skip (isExpoGo=${isExpoGo} interstitial=${!!interstitial})`);
      return;
    }

    try {
      const { AdEventType } = require('react-native-google-mobile-ads');

      const unsubClosed = interstitial.addAdEventListener(AdEventType.CLOSED, () => {
        Logger.warn('Ad-DBG', 'CLOSED event 도착 (AlarmScreen-level)');
        handleAfterAdRef.current();
      });

      return () => {
        unsubClosed();
      };
    } catch (e) {
      Logger.warn('Ad-DBG', `AdEventType import 실패=${String(e)}`);
      console.warn('AdEventType failed to load:', e);
    }
    // @preserve IAP — deps 원본: [navigation, isAdFree, isExpoGo]
  }, [navigation, isExpoGo]);

  // 자동 종료 타이머 (결과 화면 미진입 시에만)
  // v1.5: camera 미션은 사용자 설정 타이머 × 2회로 별도 관리하므로 제외
  useEffect(() => {
    if (!settingsLoaded || resultState !== 'idle') return;
    if (dismissMethod === 'camera') return;
    const timeout = setTimeout(autoDismissNoResult, AUTO_DISMISS_MS[dismissMethod] ?? 3 * 60 * 1000);
    return () => clearTimeout(timeout);
  }, [dismissMethod, settingsLoaded, autoDismissNoResult, resultState]);

  // 컴포넌트 언마운트 시 30초 타이머 정리
  useEffect(() => {
    return () => {
      if (autoResultTimeoutRef.current) {
        clearTimeout(autoResultTimeoutRef.current);
        autoResultTimeoutRef.current = null;
      }
    };
  }, []);

  // portrait 잠금 + 예약 알림 전부 취소 (안전장치)
  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
    Notifications.cancelAllScheduledNotificationsAsync();
  }, []);

  useEffect(() => {
    AsyncStorage.multiGet([SETTINGS_KEY.DISMISS_METHOD, SETTINGS_KEY.VIBRATION_ENABLED, SETTINGS_KEY.ALARM_SOUND, SETTINGS_KEY.ALARM_ENABLED, SETTINGS_KEY.MISSION_DURATION, SETTINGS_KEY.SELECTED_MISSIONS]).then(pairs => {
      const method = pairs[0][1] as DismissMethod | null;
      const vibration = pairs[1][1];
      const soundId = pairs[2][1] ?? DEFAULT_SOUND_ID;
      const alarmRaw = pairs[3][1];
      const durationRaw = pairs[4][1];
      const selectedRaw = pairs[5][1];
      const alarmEnabled = alarmRaw !== 'false';
      // v1.6 #12 — routine 마지막 step 진입 시 settingsCache override ❌ (route.params.endMethod 우선).
      const routeEndMethod = (route.params as { endMethod?: DismissMethod } | undefined)?.endMethod;
      if (method && !routeEndMethod) setDismissMethod(method);
      if (vibration !== null) setVibrationEnabled(vibration === 'true');
      if (durationRaw !== null) {
        const n = parseInt(durationRaw, 10);
        if ((MISSION_DURATION_OPTIONS as readonly number[]).includes(n)) {
          setMissionDuration(n as MissionDuration);
          missionDurationRef.current = n;
          setRemainingMs(n * 1000);
        }
      }
      // 사용자 선택 미션 풀 로드 — JSON 파싱 실패/빈 값은 MISSION_POOL 전체 fallback
      if (selectedRaw) {
        try {
          const arr = JSON.parse(selectedRaw);
          if (Array.isArray(arr)) {
            const valid = arr.filter((k): k is string => typeof k === 'string' && MISSION_POOL.includes(k));
            if (valid.length >= 1) {
              setSelectedMissions(valid);
              selectedMissionsRef.current = valid;
              // 현재 미션이 valid에 없으면 재선택
              if (!valid.includes(currentMissionRef.current)) {
                const next = valid[Math.floor(Math.random() * valid.length)];
                setCurrentMission(next);
                targetLabelsSV.value = MISSION_COCO_LABELS[next] ?? [];
                thresholdSV.value = MISSION_CONFIDENCE_OVERRIDE[next] ?? TARGET_CONFIDENCE;
              }
            }
          }
        } catch {}
      }
      setSettingsLoaded(true);
    });
  }, []);

  // v1.5: 알람 사운드 재생을 별도 useEffect로 분리. 설정 로드(multiGet+미션 파싱) 대기 제거로 딜레이 단축.
  //       HomeScreen.scheduleAlarm이 preloadAlarmSound를 호출했으면 consumeAlarmSound()로 즉시 playAsync.
  //       preload 실패/콜드스타트 시 createAsync fallback.
  // v1.7 hotfix — b8c7ce8 revert 영역. SUPPRESS_ALARMKIT_BANNER_IN_FG=true 정합 = AlarmScreen 측 expo-av 사운드 강제 영역.
  useEffect(() => {
    Promise.all([
      AsyncStorage.getItem(SETTINGS_KEY.ALARM_SOUND),
      AsyncStorage.getItem(SETTINGS_KEY.ALARM_ENABLED),
    ]).then(([soundIdRaw, alarmRaw]) => {
      const alarmEnabled = alarmRaw !== 'false';
      if (!alarmEnabled) return;
      // v1.6+ 알람 측 진입 시 = navigate params 측 alarmSoundKey 우선 (= 알람별 사운드).
      // 그 외 (= 타이머 / 루틴) = 전역 SETTINGS_KEY.ALARM_SOUND 측 사용.
      const alarmSoundKey = (route.params as { alarmSoundKey?: string } | undefined)?.alarmSoundKey;
      const soundId = alarmSoundKey ?? soundIdRaw ?? DEFAULT_SOUND_ID;

      // Fallback: createAsync (preload 없거나 invalid 상태에서 호출)
      const runFallback = () => {
        const soundItem = ALARM_SOUNDS.find(s => s.id === soundId) ?? ALARM_SOUNDS[0];
        Audio.Sound.createAsync(soundItem.source, { isLooping: true }).then(({ sound }) => {
          if (resultEnteredRef.current || dismissedRef.current) {
            sound.unloadAsync().catch(() => {});
            return;
          }
          soundRef.current = sound;
          sound.playAsync().catch((e: any) => appendAlarmAudioLog(`playAsync fail: ${e?.message || e}`));
        }).catch((e: any) => appendAlarmAudioLog(`createAsync fail: ${e?.message || e}`));
      };

      Audio.setAudioModeAsync({ playsInSilentModeIOS: true, staysActiveInBackground: true, interruptionModeIOS: InterruptionModeIOS.DoNotMix })
        .then(() => {
          const preloaded = consumeAlarmSound();
          if (!preloaded) {
            runFallback();
            return;
          }
          // v1.5: preload 상태 검증 — iOS 백그라운드 리소스 회수 대비. isLoaded=false면 fallback.
          preloaded.getStatusAsync().then((status: any) => {
            if (resultEnteredRef.current || dismissedRef.current) {
              preloaded.unloadAsync().catch(() => {});
              return;
            }
            if (status?.isLoaded) {
              soundRef.current = preloaded;
              preloaded.playAsync().catch((e: any) => appendAlarmAudioLog(`playAsync(preloaded) fail: ${e?.message || e}`));
            } else {
              appendAlarmAudioLog('preloaded invalidated, fallback to createAsync');
              preloaded.unloadAsync().catch(() => {});
              runFallback();
            }
          }).catch((e: any) => {
            appendAlarmAudioLog(`preloaded getStatus fail: ${e?.message || e}`);
            preloaded.unloadAsync().catch(() => {});
            runFallback();
          });
        })
        .catch((e: any) => appendAlarmAudioLog(`setAudioModeAsync fail: ${e?.message || e}`));
    }).catch((e: any) => appendAlarmAudioLog(`AsyncStorage.get (audio) fail: ${e?.message || e}`));

    return () => {
      soundRef.current?.stopAsync().catch(() => {});
      soundRef.current?.unloadAsync().catch(() => {});
    };
  }, []);

  // 진동 + AppState 복귀 시 재시작 + Audio 인터럽션 복구
  // v1.5: AppState 콜백에 resultEnteredRef/dismissedRef 가드 (광고 쇼 중 inactive→active 전환으로 인한 재시작 방지)
  //       Audio 복구는 vibrationEnabled와 독립 (진동 OFF 유저도 AVAudioSession 인터럽션 후 재생 재개)
  //       expo-av는 InterruptionTypeEnded 자동 처리 안 하므로 수동으로 setAudioModeAsync → playAsync 체인
  //       iOS/Android 공통: Vibration.vibrate() 인자 없이 호출 → 기본 진동 모터 1회. setInterval 1000ms로 반복 (지속 진동 체감)
  useEffect(() => {
    if (resultState !== 'idle') return;

    const startVibe = () => {
      if (!vibrationEnabled) return;
      // 중복 방지: 기존 interval 먼저 clear
      if (vibrationIntervalRef.current) {
        clearInterval(vibrationIntervalRef.current);
        vibrationIntervalRef.current = null;
      }
      Vibration.vibrate();
      vibrationIntervalRef.current = setInterval(() => {
        Vibration.vibrate();
      }, 1000);
    };

    const stopVibe = () => {
      if (vibrationIntervalRef.current) {
        clearInterval(vibrationIntervalRef.current);
        vibrationIntervalRef.current = null;
      }
      Vibration.cancel();
    };

    startVibe();

    const sub = AppState.addEventListener('change', (state) => {
      if (resultEnteredRef.current || dismissedRef.current) return;
      if (state !== 'active') return;

      startVibe();

      const s = soundRef.current;
      if (s) {
        s.getStatusAsync().then((status: any) => {
          if (status?.isLoaded && !status.isPlaying) {
            Audio.setAudioModeAsync({ playsInSilentModeIOS: true, staysActiveInBackground: true, interruptionModeIOS: InterruptionModeIOS.DoNotMix })
              .then(() => s.playAsync())
              .catch((e: any) => appendAlarmAudioLog(`resume: ${e?.message || e}`));
          }
        }).catch((e: any) => appendAlarmAudioLog(`getStatusAsync: ${e?.message || e}`));
      }
    });

    return () => {
      stopVibe();
      sub.remove();
    };
  }, [vibrationEnabled, resultState]);

  // 흔들기 감지 (결과 화면 진입 시 자동 해제)
  useEffect(() => {
    if (dismissMethod !== 'shake' || resultState !== 'idle') return;

    shakeCountRef.current = 0;
    lastShakeTimeRef.current = 0;
    Accelerometer.setUpdateInterval(100);
    const sub = Accelerometer.addListener(({ x, y, z }) => {
      const total = Math.sqrt(x * x + y * y + z * z);
      const now = Date.now();
      if (total > SHAKE_THRESHOLD && now - lastShakeTimeRef.current > SHAKE_COOLDOWN_MS) {
        lastShakeTimeRef.current = now;
        shakeCountRef.current += 1;
        if (shakeCountRef.current >= SHAKE_COUNT_REQUIRED) {
          sub.remove();
          accelSubRef.current = null;
          enterResult('success');
        }
      }
    });
    accelSubRef.current = sub;
    return () => {
      sub.remove();
      accelSubRef.current = null;
    };
  }, [dismissMethod, resultState, enterResult]);

  // Shake 애니메이션 — 훅은 항상 최상단
  const pulse = useRef(new Animated.Value(1)).current;
  const ripple1 = useRef(new Animated.Value(0)).current;
  const ripple2 = useRef(new Animated.Value(0)).current;
  const rotate = useRef(new Animated.Value(0)).current;

  // @v1.5 — 남은 5초 이하 경고 깜빡 (opacity만 조작, native driver 가능)
  const dangerBlink = useRef(new Animated.Value(0)).current;
  // @v1.5 — 감지 성공 피드백 (연두 blink 2회 + 연두 채움 bottom→top)
  const successBlink = useRef(new Animated.Value(0)).current;
  const successFill = useRef(new Animated.Value(0)).current;
  const [successAnimating, setSuccessAnimating] = useState(false);
  // @v1.5 — 스캔 라인 애니메이션 (연두 글로우, 가시 영역 왕복)
  const scanLine = useRef(new Animated.Value(0)).current;

  const tapRipple1 = useRef(new Animated.Value(0)).current;
  const tapRipple2 = useRef(new Animated.Value(0)).current;
  const tapFingerScale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (dismissMethod !== 'shake' || resultState !== 'idle') return;

    const pulseAnim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.1, duration: 600, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 600, useNativeDriver: true }),
      ])
    );
    const rippleAnim1 = Animated.loop(
      Animated.timing(ripple1, { toValue: 1, duration: 700, useNativeDriver: true })
    );
    const rippleAnim2 = Animated.loop(
      Animated.sequence([
        Animated.delay(350),
        Animated.timing(ripple2, { toValue: 1, duration: 700, useNativeDriver: true }),
      ])
    );
    const rotateAnim = Animated.loop(
      Animated.sequence([
        Animated.timing(rotate, { toValue: 1, duration: 75, useNativeDriver: true }),
        Animated.timing(rotate, { toValue: -1, duration: 150, useNativeDriver: true }),
        Animated.timing(rotate, { toValue: 0, duration: 75, useNativeDriver: true }),
      ])
    );

    pulseAnim.start();
    rippleAnim1.start();
    rippleAnim2.start();
    rotateAnim.start();

    return () => {
      pulseAnim.stop();
      rippleAnim1.stop();
      rippleAnim2.stop();
      rotateAnim.stop();
      pulse.setValue(1);
      ripple1.setValue(0);
      ripple2.setValue(0);
      rotate.setValue(0);
    };
  }, [dismissMethod, resultState]);

  useEffect(() => {
    if (dismissMethod !== 'tap' || resultState !== 'idle') return;

    const fingerAnim = Animated.loop(
      Animated.sequence([
        Animated.timing(tapFingerScale, { toValue: 0.75, duration: 120, useNativeDriver: true, easing: Easing.in(Easing.ease) }),
        Animated.timing(tapFingerScale, { toValue: 1, duration: 250, useNativeDriver: true, easing: Easing.out(Easing.back(2)) }),
        Animated.delay(1000),
      ])
    );
    const rippleAnim1 = Animated.loop(
      Animated.timing(tapRipple1, { toValue: 1, duration: 1200, useNativeDriver: true })
    );
    const rippleAnim2 = Animated.loop(
      Animated.sequence([
        Animated.delay(600),
        Animated.timing(tapRipple2, { toValue: 1, duration: 1200, useNativeDriver: true }),
      ])
    );

    fingerAnim.start();
    rippleAnim1.start();
    rippleAnim2.start();

    return () => {
      fingerAnim.stop(); rippleAnim1.stop(); rippleAnim2.stop();
      tapFingerScale.setValue(1); tapRipple1.setValue(0); tapRipple2.setValue(0);
    };
  }, [dismissMethod, resultState]);

  const rippleStyle = (anim: Animated.Value) => ({
    position: 'absolute' as const,
    width: 180,
    height: 180,
    borderRadius: 90,
    borderWidth: 2,
    borderColor: colors.onPrimary,
    opacity: anim.interpolate({ inputRange: [0, 1], outputRange: [0.6, 0] }),
    transform: [{ scale: anim.interpolate({ inputRange: [0, 1], outputRange: [1, 2.2] }) }],
  });

  // @preserve v1-camera — v1 handleShutter (expo-camera takePictureAsync + ML Kit). v1.5에서 Frame Processor 자동 감지로 대체.
  // const handleShutter = async () => { ... };

  // v1.5 Frame Processor — 3프레임 연속 매칭 시 연두 피드백 시퀀스 후 성공 처리
  const triggerDetectionSequence = useCallback((_match: Detection) => {
    setSuccessAnimating(true);
    successBlink.setValue(0);
    successFill.setValue(0);

    const blinkSeq: Animated.CompositeAnimation[] = [];
    for (let i = 0; i < BLINK_COUNT; i++) {
      blinkSeq.push(
        Animated.timing(successBlink, { toValue: 1, duration: BLINK_ON_MS, useNativeDriver: true }),
        Animated.timing(successBlink, { toValue: 0, duration: BLINK_OFF_MS, useNativeDriver: true }),
      );
    }

    Animated.sequence([
      ...blinkSeq,
      Animated.delay(FEEDBACK_DELAY_MS),
    ]).start(() => {
      Animated.timing(successFill, {
        toValue: 1,
        duration: COMPLETE_ANIM_MS,
        useNativeDriver: false, // height 조작이라 false 필수
      }).start(() => {
        enterResult('success');
      });
    });
  }, [enterResult, successBlink, successFill]);

  // @v1.5 Phase A — onMatchJS + frameProcessor + Camera 컴포넌트는 AlarmCameraMode child로 이동
  // 부모는 SharedValue를 소유하고 child에 props로 전달 (단일 참조 + worklet 동작 보장)

  // 미션 변경 시 SharedValue 동기화 (타겟 라벨 + 임계값)
  useEffect(() => {
    targetLabelsSV.value = MISSION_COCO_LABELS[currentMission] ?? [];
    thresholdSV.value = MISSION_CONFIDENCE_OVERRIDE[currentMission] ?? TARGET_CONFIDENCE;
  }, [currentMission, targetLabelsSV, thresholdSV]);

  // v1.5 카운트다운 (camera 미션만, 슬롯머신 중엔 일시정지)
  useEffect(() => {
    if (dismissMethod !== 'camera') return;
    if (resultState !== 'idle') return;
    if (isRetryBannerVisible) return;
    if (isShuffling) return;
    if (matched.value) return;
    const id = setInterval(() => {
      setRemainingMs((prev) => Math.max(0, prev - 1000));
    }, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dismissMethod, resultState, isRetryBannerVisible, isShuffling]);

  // v1.5 만료 처리 (setTimeout useRef로 취소 버그 방지)
  useEffect(() => {
    if (dismissMethod !== 'camera') return;
    if (resultState !== 'idle') return;
    if (isRetryBannerVisible) return;
    if (isShuffling) return;
    if (remainingMs > 0) return;
    if (matched.value) return;

    if (attemptCount === 1) {
      setIsRetryBannerVisible(true);
      retryTimeoutRef.current = setTimeout(() => {
        consecutiveHits.value = 0;
        matched.value = false;
        setRemainingMs(missionDurationRef.current * 1000);
        setAttemptCount(2);
        setIsRetryBannerVisible(false);
        retryTimeoutRef.current = null;
      }, RETRY_BANNER_MS);
    } else {
      enterResult('fail');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remainingMs, dismissMethod, resultState, isRetryBannerVisible, attemptCount, isShuffling]);

  // 언마운트 시 재시도 타이머 정리
  useEffect(() => {
    return () => {
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
    };
  }, []);

  // v1.5 다시 뽑기 — 슬롯머신 효과(1.2초 이미지만 회전, 텍스트 숨김)
  const reshuffleMission = useCallback(() => {
    if (isRetryBannerVisible) return;
    if (shuffleIntervalRef.current || shuffleTimeoutRef.current) return;

    // 1) worklet 스캔 일시 차단 + 이전 match 잔여 완전 리셋 (reshuffle 후 즉시 성공 버그 방지)
    isShufflingSV.value = true;
    consecutiveHits.value = 0;
    matched.value = false;
    lastRun.value = Date.now();

    // 2) 최종 미션 즉시 확정
    const final = pickRandomMission(currentMissionRef.current);
    setCurrentMission(final);
    targetLabelsSV.value = MISSION_COCO_LABELS[final] ?? [];
    thresholdSV.value = MISSION_CONFIDENCE_OVERRIDE[final] ?? TARGET_CONFIDENCE;

    // 3) 비주얼 슬롯머신 — 모든 이미지 pre-mount, idx만 변경
    const visualPool = MISSION_POOL.filter((k) => k !== final);
    const shuffled = [...visualPool].sort(() => Math.random() - 0.5);
    if (shuffled.length === 0) shuffled.push(final);
    setShuffledList(shuffled);
    setShuffleIdx(0);
    setIsShuffling(true);
    shuffleIntervalRef.current = setInterval(() => {
      setShuffleIdx((i) => (i + 1) % shuffled.length);
    }, 60);

    // 4) 1.2초 후 종료 — 해제 직전에도 리셋 재적용 (해제 직후 즉시 성공 방지)
    shuffleTimeoutRef.current = setTimeout(() => {
      if (shuffleIntervalRef.current) {
        clearInterval(shuffleIntervalRef.current);
        shuffleIntervalRef.current = null;
      }
      shuffleTimeoutRef.current = null;
      setShuffledList([]);
      setShuffleIdx(0);
      setIsShuffling(false);
      consecutiveHits.value = 0;
      matched.value = false;
      lastRun.value = Date.now();
      isShufflingSV.value = false;
    }, 1200);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRetryBannerVisible]);

  // 언마운트 시 슬롯머신 타이머 정리
  useEffect(() => {
    return () => clearShuffle();
  }, [clearShuffle]);

  // 스캔 라인 왕복 애니메이션 (카메라 모드 — 다시뽑기·재시도 중에도 지속, 감지 성공 시만 정지)
  // @v1.5 Phase A — hasCameraPermission/device 체크는 child에서 처리. 부모는 scan line 값만 관리.
  useEffect(() => {
    if (dismissMethod !== 'camera') return;
    const active = resultState === 'idle' && !successAnimating;
    if (!active) {
      scanLine.stopAnimation(() => scanLine.setValue(0));
      return;
    }
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(scanLine, { toValue: 1, duration: 1600, useNativeDriver: true }),
        Animated.timing(scanLine, { toValue: 0, duration: 1600, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [dismissMethod, resultState, successAnimating, scanLine]);

  // 남은 5초 이하 경고 깜빡 loop
  useEffect(() => {
    if (dismissMethod !== 'camera') return;
    const remainingSeconds = Math.ceil(remainingMs / 1000);
    const active = remainingSeconds <= 5 && remainingSeconds > 0 && !isShuffling && !isRetryBannerVisible && resultState === 'idle';
    if (!active) {
      dangerBlink.stopAnimation(() => dangerBlink.setValue(0));
      return;
    }
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(dangerBlink, { toValue: 1, duration: 400, useNativeDriver: true }),
        Animated.timing(dangerBlink, { toValue: 0, duration: 400, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [remainingMs, dismissMethod, isShuffling, isRetryBannerVisible, resultState, dangerBlink]);

  // 설정 로드 전 빈 화면 / goHome 호출 후 빈 검은 화면 (광고 닫힘 → 화면 전환 잔상 차단)
  if (!settingsLoaded) {
    return <SafeAreaView style={styles.container} />;
  }
  if (dismissingHome) {
    return <SafeAreaView style={[styles.container, { backgroundColor: '#000' }]} />;
  }

  // 결과 화면 (최우선 렌더)
  if (resultState !== 'idle') {
    const bgColor = RESULT_BG[resultState];
    const iconName = resultState === 'success' ? 'check-circle' : 'cancel';
    const titleKey = resultState === 'success' ? 'alarm.resultSuccess' : 'alarm.resultFail';
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: bgColor }]}>
        <View style={styles.header}>
          <View>
            <Text style={styles.headerTitle}>ShutTimer</Text>
          </View>
        </View>

        <View style={styles.centerSection}>
          <View style={styles.resultIconWrapper}>
            <MaterialIcons name={iconName} size={140} color={colors.onPrimary} />
          </View>
          <Text style={[styles.resultTitle]}>{t(titleKey)}</Text>
        </View>

        <View style={styles.tapSection}>
          <TouchableOpacity style={styles.tapButton} onPress={goHome} activeOpacity={0.8}>
            <Text style={[styles.tapButtonText, { color: bgColor }]}>{t('alarm.resultConfirm')}</Text>
          </TouchableOpacity>
        </View>
        <AdBanner />
      </SafeAreaView>
    );
  }

  // Camera 모드 레이아웃 (v1.5: VisionCamera + YOLOv10 + Fluent Emoji 아이콘)
  if (dismissMethod === 'camera') {
    const missionLabel = t(`missions.${currentMission}`, { defaultValue: MISSION_LABEL[currentMission] ?? currentMission });
    const currentEmoji = MISSION_EMOJI[currentMission];
    const remainingSeconds = Math.ceil(remainingMs / 1000);
    const isDanger = remainingSeconds <= 5 && remainingSeconds > 0 && !isShuffling && !isRetryBannerVisible;
    // 한국어 조사: 마지막 글자 받침 유무로 "을/를" 결정 (다른 언어는 조사 무시)
    const lastChar = missionLabel[missionLabel.length - 1] ?? '';
    const code = lastChar.charCodeAt(0);
    const hasBatchim = code >= 0xAC00 && code <= 0xD7A3 && (code - 0xAC00) % 28 !== 0;
    const josa = hasBatchim ? '을' : '를';
    const missionSentence = t('alarm.missionSentence', { mission: missionLabel, josa });
    const screenW = Dimensions.get('window').width;
    const boxWidth = screenW - 32; // 좌우 16px 여백 (여백 최소화)
    const boxHeight = boxWidth * 1.25; // 세로로 살짝 긴 박스 (높이 축소)

    return (
      <SafeAreaView style={[styles.container, { backgroundColor: '#000' }]}>
        <View style={styles.header}>
          <View>
            <Text style={styles.headerTitle}>ShutTimer</Text>
          </View>
        </View>

        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'flex-start', paddingTop: 8 }}>
          {/* @v1.5 Phase A — 카메라 + tflite + flip + reshuffle UI는 child로 이동 */}
          <AlarmCameraMode
            matched={matched}
            lastRun={lastRun}
            targetLabelsSV={targetLabelsSV}
            thresholdSV={thresholdSV}
            consecutiveHits={consecutiveHits}
            isShufflingSV={isShufflingSV}
            currentMission={currentMission}
            currentEmoji={currentEmoji}
            missionLabel={missionLabel}
            missionSentence={missionSentence}
            isShuffling={isShuffling}
            shuffledList={shuffledList}
            shuffleIdx={shuffleIdx}
            isRetryBannerVisible={isRetryBannerVisible}
            successAnimating={successAnimating}
            resultState={resultState}
            isDanger={isDanger}
            remainingSeconds={remainingSeconds}
            successBlink={successBlink}
            successFill={successFill}
            scanLine={scanLine}
            dangerBlink={dangerBlink}
            boxWidth={boxWidth}
            boxHeight={boxHeight}
            onMatchDetected={triggerDetectionSequence}
            onReshuffle={reshuffleMission}
            t={t}
            permissionButtonStyle={styles.permissionButton}
            permissionButtonTextStyle={styles.permissionButtonText}
          />
        </View>
      </SafeAreaView>
    );
  }

  // Tap 모드 레이아웃
  if (dismissMethod === 'tap') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <View>
            <Text style={styles.headerTitle}>ShutTimer</Text>
          </View>
        </View>

        <View style={[styles.centerSection, { paddingTop: 40 }]}>
          <View style={styles.rippleWrapper}>
            <Animated.View style={rippleStyle(tapRipple1)} />
            <Animated.View style={rippleStyle(tapRipple2)} />
            <View style={styles.centerIconWrapper}>
              <Animated.View style={{ transform: [{ scale: tapFingerScale }] }}>
                <MaterialIcons name="touch-app" size={96} color={colors.onPrimary} style={{ opacity: 0.9 }} />
              </Animated.View>
            </View>
          </View>
          <View style={{ alignItems: 'center', gap: 6 }}>
            <Text style={styles.centerTitle}>{t('alarm.timerDone')}</Text>
            <Text style={styles.centerSubtitle}>{t('alarm.tapInstruction')}</Text>
          </View>
        </View>

        <View style={styles.tapSection}>
          <TouchableOpacity style={styles.tapButton} onPress={() => enterResult('success')} activeOpacity={0.8}>
            <Text style={styles.tapButtonText}>{t('alarm.tapButton')}</Text>
          </TouchableOpacity>
        </View>
        <AdBanner />
      </SafeAreaView>
    );
  }

  // Shake 모드 레이아웃
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>ShutTimer</Text>
        </View>
      </View>

      <View style={styles.centerSection}>
        <View style={styles.rippleWrapper}>
          <Animated.View style={rippleStyle(ripple1)} />
          <Animated.View style={rippleStyle(ripple2)} />
          <Animated.View style={[styles.centerIconWrapper, {
            transform: [
              { scale: pulse },
              { rotate: rotate.interpolate({ inputRange: [-1, 1], outputRange: ['-20deg', '20deg'] }) },
            ],
          }]}>
            <MaterialIcons name="vibration" size={96} color={colors.onPrimary} style={{ opacity: 0.9 }} />
          </Animated.View>
        </View>
        <Text style={styles.centerTitle}>{t('alarm.timerDone')}</Text>
        <Text style={styles.centerSubtitle}>{t('alarm.shakeInstruction')}</Text>
      </View>
      <AdBanner />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.primary,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: 32,
    paddingTop: 16,
    paddingBottom: 8,
  },
  headerSubtitle: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.onPrimary,
    opacity: 0.6,
    letterSpacing: 3,
  },
  headerTitle: {
    fontSize: 32,
    fontWeight: '800',
    color: colors.onPrimary,
    letterSpacing: -1,
    marginTop: 4,
  },
  // Camera 모드
  viewfinderSection: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 48,
  },
  viewfinder: {
    width: 320,
    height: 320,
    borderRadius: 160,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  instructionWrapper: {
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 32,
  },
  instructionText: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.onPrimary,
    textAlign: 'center',
    lineHeight: 26,
    letterSpacing: -0.3,
  },
  instructionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: colors.onPrimary,
  },
  instructionBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.primary,
    letterSpacing: 1,
  },
  permissionButton: {
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
  },
  permissionButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.onPrimary,
    letterSpacing: 0.5,
  },
  shutterSection: {
    paddingBottom: 64,
    alignItems: 'center',
    gap: 32,
  },
  cameraControls: {
    flexDirection: 'row',
    gap: 48,
  },
  cameraControlBtn: {
    alignItems: 'center',
    gap: 6,
  },
  cameraControlLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.onPrimary,
    opacity: 0.8,
    letterSpacing: 1,
  },
  // Tap / Shake 공통
  centerSection: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
    paddingHorizontal: 40,
  },
  rippleWrapper: {
    width: 180,
    height: 180,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 100,
  },
  centerIconWrapper: {
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: colors.onPrimary,
    letterSpacing: -0.5,
  },
  centerSubtitle: {
    fontSize: 15,
    fontWeight: '500',
    color: colors.onPrimary,
    opacity: 0.7,
    textAlign: 'center',
    letterSpacing: -0.2,
  },
  // Tap 모드 버튼
  tapSection: {
    paddingBottom: 64,
    paddingHorizontal: 32,
  },
  tapButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    width: '100%',
    paddingVertical: 24,
    borderRadius: 20,
    backgroundColor: colors.onPrimary,
  },
  tapButtonText: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.primary,
    letterSpacing: -0.3,
  },
  guideText: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.onPrimary,
    textAlign: 'center',
    opacity: 0.9,
    marginBottom: 12,
    paddingHorizontal: 24,
  },
  // 결과 화면
  resultIconWrapper: {
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 40,
  },
  resultTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: colors.onPrimary,
    textAlign: 'center',
    letterSpacing: -0.3,
    paddingHorizontal: 24,
  },
});
