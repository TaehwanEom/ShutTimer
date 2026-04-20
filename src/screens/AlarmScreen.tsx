import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  Vibration,
  Animated,
  Easing,
  AppState,
  Platform,
  Dimensions,
} from 'react-native';
// @preserve v1-camera — v1의 expo-camera / ML Kit 경로. v1.5 VisionCamera+YOLO로 전환됨. 복원 가능성 위해 import 주석 유지.
// import { CameraView, useCameraPermissions } from 'expo-camera';
// import ImageLabeling from '@react-native-ml-kit/image-labeling';
import { Accelerometer } from 'expo-sensors';
import { Audio } from 'expo-av';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MaterialIcons } from '@expo/vector-icons';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { RootStackParamList } from '../../App';
import Svg, { Circle } from 'react-native-svg';
import { colors } from '../constants/theme';
import { SETTINGS_KEY, DismissMethod, DEFAULT_SETTINGS, MissionDuration, MISSION_DURATION_OPTIONS } from '../constants/settings';
import { ALARM_SOUNDS, DEFAULT_SOUND_ID } from '../constants/sounds';
import * as ScreenOrientation from 'expo-screen-orientation';
import * as Notifications from 'expo-notifications';
import { useTranslation } from 'react-i18next';
import Constants from 'expo-constants';
// v1.5 VisionCamera + YOLOv10 Frame Processor
import { Camera, useCameraDevice, useCameraPermission, useFrameProcessor } from 'react-native-vision-camera';
import { useTensorflowModel } from 'react-native-fast-tflite';
import { NitroModules } from 'react-native-nitro-modules';
import { useResizePlugin } from 'vision-camera-resize-plugin';
import { useRunOnJS, useSharedValue } from 'react-native-worklets-core';
import { parseYolov10Output, type Detection } from '../utils/objectDetection';
import { getCachedDismissMethod } from '../utils/settingsCache';
import { MISSION_EMOJI, MISSION_POOL, MISSION_LABEL, MISSION_COCO_LABELS, MISSION_CONFIDENCE_OVERRIDE } from '../constants/missionIcons';
import { Image } from 'react-native';
// import { InterstitialAd, AdEventType, TestIds } from 'react-native-google-mobile-ads';
import AdBanner from '../components/AdBanner';
// @preserve IAP — Phase 2+ 복원용. 삭제 금지. (TS6133 회피 위해 import 라인 주석)
// import { usePurchase } from '../context/PurchaseContext';

const isExpoGo = (Constants as any).appOwnership === 'expo';

// PROD IDs kept for restoration after verification build
// iOS: ca-app-pub-3043284478228309/6510839159
// Android: ca-app-pub-3043284478228309/6667370376
let interstitial: any = null;
if (!isExpoGo) {
  (async () => {
    try {
      const attStatus = await AsyncStorage.getItem('attStatus');
      const npa = attStatus === 'granted' ? false : true;
      const { InterstitialAd } = require('react-native-google-mobile-ads');
      const INTERSTITIAL_UNIT_ID = Platform.select({
        ios: 'ca-app-pub-3043284478228309/6510839159',
        android: 'ca-app-pub-3043284478228309/6667370376',
      }) as string;
      interstitial = InterstitialAd.createForAdRequest(INTERSTITIAL_UNIT_ID, {
        requestNonPersonalizedAdsOnly: npa,
      });
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

// @preserve v1-ml-kit — v1 ML Kit 기반 라벨 매핑. v1.5에서 MISSION_COCO_LABELS로 대체.
// const MISSION_LABELS: Record<string, string[]> = { ... };
// const VERIFIED_ICONS = ['tv', 'toys', 'clean-hands', 'pets', 'local-cafe'];
// const RANDOM_TARGETS = VERIFIED_ICONS.map(icon => ({ ... }));

// MISSION_POOL 은 ../constants/missionIcons 에서 import (Fluent Emoji 매핑 있는 미션만 — PoC와 동기화)

// v1.5 Frame Processor 상수 (PoC와 동일)
const TARGET_CONFIDENCE = 0.4;
const THROTTLE_MS = 800;
const HITS_REQUIRED = 3;
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
const VIBRATION_PATTERN = [0, 500, 300, 500, 300, 500];
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

export default function AlarmScreen({ navigation }: Props) {
  const { t } = useTranslation();
  // @preserve IAP — usePurchase 훅 호출. Phase 2+ 복원용. 삭제 금지.
  // const { isAdFree } = usePurchase();
  // v1.5: VisionCamera 기반
  const { hasPermission: hasCameraPermission, requestPermission } = useCameraPermission();
  const [cameraPosition, setCameraPosition] = useState<'back' | 'front'>('back');
  const device = useCameraDevice(cameraPosition);
  // 카메라 전환 중 frame processor + tflite race 방지: isActive 일시 차단 + onStarted 동기화
  const [isFlipping, setIsFlipping] = useState(false);
  const flipTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toggleCamera = useCallback(() => {
    if (isFlipping) return;
    setIsFlipping(true);
    setCameraPosition((p) => (p === 'back' ? 'front' : 'back'));
    if (flipTimeoutRef.current) clearTimeout(flipTimeoutRef.current);
    flipTimeoutRef.current = setTimeout(() => setIsFlipping(false), 1000);
  }, [isFlipping]);
  useEffect(() => {
    return () => {
      if (flipTimeoutRef.current) clearTimeout(flipTimeoutRef.current);
    };
  }, []);

  // v1.5 카메라 format (fieldOfView ≤ 70, stabilization off, 해상도 ≥ 640)
  const FOV_MAX = 70;
  const format = useMemo(() => {
    if (!device) return undefined;
    const candidates = device.formats
      .filter((f) => f.fieldOfView != null)
      .filter((f) => f.videoStabilizationModes.includes('off'))
      .filter((f) => f.videoWidth >= 640 && f.videoHeight >= 640)
      .filter((f) => f.fieldOfView <= FOV_MAX)
      .sort((a, b) => b.fieldOfView - a.fieldOfView);
    return candidates[0] ?? device.formats[0];
  }, [device]);

  // v1.5 YOLOv10 모델 + box/unbox
  const plugin = useTensorflowModel(
    require('../../assets/models/yolov10s_float16.tflite'),
    Platform.OS === 'ios' ? ['core-ml'] : []
  );
  const model = plugin.state === 'loaded' ? plugin.model : undefined;
  const boxedModel = useMemo(
    () => (model != null ? NitroModules.box(model) : undefined),
    [model]
  );
  const { resize } = useResizePlugin();

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
  // App.tsx에서 사전 로드한 dismissMethod 사용 (AsyncStorage 비동기 지연 제거).
  // 캐시 미적중 시 default fallback. settingsLoaded 후 useEffect에서 정확값으로 갱신.
  const [dismissMethod, setDismissMethod] = useState<DismissMethod>(
    getCachedDismissMethod() ?? DEFAULT_SETTINGS.dismissMethod
  );
  const [vibrationEnabled, setVibrationEnabled] = useState(DEFAULT_SETTINGS.vibrationEnabled);
  const soundRef = useRef<Audio.Sound | null>(null);
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

  const stopAudioAndVibration = useCallback(() => {
    Vibration.cancel();
    Notifications.cancelAllScheduledNotificationsAsync();
    soundRef.current?.stopAsync().catch(() => {});
    soundRef.current?.unloadAsync().catch(() => {});
    soundRef.current = null;
    accelSubRef.current?.remove();
    accelSubRef.current = null;
    // AlarmScreen 비활성: 다른 알림 음소거 해제
    AsyncStorage.removeItem('isAlarmActive').catch(() => {});
  }, []);

  // AlarmScreen 마운트 즉시 isAlarmActive 플래그 설정 (사운드 로드보다 먼저)
  // 언마운트 시 플래그 확실히 제거 (비정상 종료 복구)
  useEffect(() => {
    AsyncStorage.setItem('isAlarmActive', 'true').catch(() => {});
    return () => {
      AsyncStorage.removeItem('isAlarmActive').catch(() => {});
    };
  }, []);

  const goHome = useCallback(() => {
    if (dismissedRef.current) return;
    dismissedRef.current = true;
    if (autoResultTimeoutRef.current) {
      clearTimeout(autoResultTimeoutRef.current);
      autoResultTimeoutRef.current = null;
    }
    navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
  }, [navigation]);

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
  const enterResult = useCallback((result: 'success' | 'fail') => {
    if (resultEnteredRef.current) return;
    resultEnteredRef.current = true;
    stopAudioAndVibration();
    pendingResultRef.current = result;
    afterAdActionRef.current = dismissMethod === 'camera' ? 'result' : 'home';
    if (adLoadedRef.current && interstitial) {
      interstitial.show().catch(handleAfterAd);
    } else {
      handleAfterAd();
    }
  }, [stopAudioAndVibration, dismissMethod, handleAfterAd]);

  const autoDismissNoResult = useCallback(() => {
    if (dismissedRef.current) return;
    stopAudioAndVibration();
    afterAdActionRef.current = 'home';
    if (adLoadedRef.current && interstitial) {
      interstitial.show().catch(goHome);
    } else {
      goHome();
    }
  }, [stopAudioAndVibration, goHome]);

  // 전면 광고 로드
  useEffect(() => {
    adLoadedRef.current = false;
    dismissedRef.current = false;
    resultEnteredRef.current = false;

    // @preserve IAP — 원본: if (isAdFree || isExpoGo || !interstitial) return;
    if (isExpoGo || !interstitial) return;

    try {
      const { AdEventType } = require('react-native-google-mobile-ads');

      const unsubLoaded = interstitial.addAdEventListener(AdEventType.LOADED, () => {
        adLoadedRef.current = true;
      });
      const unsubClosed = interstitial.addAdEventListener(AdEventType.CLOSED, () => {
        handleAfterAdRef.current();
      });
      const unsubError = interstitial.addAdEventListener(AdEventType.ERROR, (error: any) => {
        console.warn('Interstitial ad failed:', error?.code, error?.message, error);
      });

      interstitial.load();

      return () => {
        unsubLoaded();
        unsubClosed();
        unsubError();
      };
    } catch (e) {
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
      if (method) setDismissMethod(method);
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

      if (!alarmEnabled) return;

      // 알람 사운드 재생
      const soundItem = ALARM_SOUNDS.find(s => s.id === soundId) ?? ALARM_SOUNDS[0];
      Audio.setAudioModeAsync({ playsInSilentModeIOS: true, staysActiveInBackground: true }).then(() => {
        Audio.Sound.createAsync(soundItem.source, { isLooping: true }).then(({ sound }) => {
          // 로드 완료 시점에 이미 dismiss/결과 진입됐으면 재생하지 않고 언로드
          if (resultEnteredRef.current || dismissedRef.current) {
            sound.unloadAsync().catch(() => {});
            return;
          }
          soundRef.current = sound;
          sound.playAsync();
          // isAlarmActive 플래그는 마운트 시 상단 useEffect에서 이미 설정됨 (중복 설정 제거)
        }).catch(() => {});
      });
    });

    return () => {
      soundRef.current?.stopAsync().catch(() => {});
      soundRef.current?.unloadAsync().catch(() => {});
    };
  }, []);

  // 진동 + 백그라운드 복귀 시 재시작 (결과 화면에선 중단)
  useEffect(() => {
    if (!vibrationEnabled || resultState !== 'idle') return;
    Vibration.vibrate(VIBRATION_PATTERN, true);

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        Vibration.vibrate(VIBRATION_PATTERN, true);
      }
    });

    return () => {
      Vibration.cancel();
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

  const onMatchJS = useRunOnJS((match: Detection) => {
    triggerDetectionSequence(match);
  }, [triggerDetectionSequence]);

  const frameProcessor = useFrameProcessor((frame) => {
    'worklet';
    if (matched.value) return;
    if (isShufflingSV.value) return;
    if (boxedModel == null) return;
    const now = Date.now();
    if (now - lastRun.value < THROTTLE_MS) return;
    lastRun.value = now;
    try {
      const tflite = boxedModel.unbox();
      const resized = resize(frame, {
        scale: { width: 640, height: 640 },
        pixelFormat: 'rgb',
        dataType: 'float32',
      });
      const inputBuffer = resized.buffer.slice(
        resized.byteOffset,
        resized.byteOffset + resized.byteLength
      ) as ArrayBuffer;
      const outputs = tflite.runSync([inputBuffer]);
      const output = new Float32Array(outputs[0]);
      const match = parseYolov10Output(output, targetLabelsSV.value, thresholdSV.value);
      if (match) {
        consecutiveHits.value += 1;
        if (consecutiveHits.value >= HITS_REQUIRED) {
          matched.value = true;
          onMatchJS(match);
        }
      } else {
        consecutiveHits.value = 0;
      }
    } catch (e) {
      // worklet 에러는 다음 프레임에서 재시도
    }
  }, [boxedModel, resize, onMatchJS]);

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

    // 1) worklet 스캔 일시 차단 (matched는 성공 신호 전용이므로 건드리지 않음)
    isShufflingSV.value = true;
    consecutiveHits.value = 0;

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

    // 4) 1.2초 후 종료
    shuffleTimeoutRef.current = setTimeout(() => {
      if (shuffleIntervalRef.current) {
        clearInterval(shuffleIntervalRef.current);
        shuffleIntervalRef.current = null;
      }
      shuffleTimeoutRef.current = null;
      setShuffledList([]);
      setShuffleIdx(0);
      setIsShuffling(false);
      isShufflingSV.value = false;
    }, 1200);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRetryBannerVisible]);

  // 언마운트 시 슬롯머신 타이머 정리
  useEffect(() => {
    return () => clearShuffle();
  }, [clearShuffle]);

  // 스캔 라인 왕복 애니메이션 (카메라 모드 — 다시뽑기·재시도 중에도 지속, 감지 성공 시만 정지)
  useEffect(() => {
    if (dismissMethod !== 'camera') return;
    const active =
      resultState === 'idle' &&
      !successAnimating &&
      hasCameraPermission &&
      device != null;
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
  }, [dismissMethod, resultState, successAnimating, hasCameraPermission, device, scanLine]);

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

  // 설정 로드 전 빈 화면
  if (!settingsLoaded) {
    return <SafeAreaView style={styles.container} />;
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
          {/* 카메라 박스 */}
          <View style={{ width: boxWidth, height: boxHeight, borderRadius: 16, overflow: 'hidden', backgroundColor: '#111' }}>
            {hasCameraPermission && device ? (
              <>
                <Camera
                  style={StyleSheet.absoluteFill}
                  device={device}
                  isActive={resultState === 'idle' && !isFlipping}
                  frameProcessor={frameProcessor}
                  resizeMode="cover"
                  videoStabilizationMode="off"
                  photo={false}
                  video={false}
                  onStarted={() => {
                    if (flipTimeoutRef.current) clearTimeout(flipTimeoutRef.current);
                    setIsFlipping(false);
                  }}
                  {...(format ? { format } : {})}
                />
                {/* 감지 성공 피드백 — 연두 깜빡 (전면) */}
                <Animated.View pointerEvents="none" style={[
                  StyleSheet.absoluteFill,
                  {
                    backgroundColor: '#32CD32',
                    opacity: successBlink.interpolate({ inputRange: [0, 1], outputRange: [0, 0.4] }),
                  },
                ]} />
                {/* 감지 성공 피드백 — 연두 채움 (top → bottom) */}
                <Animated.View pointerEvents="none" style={{
                  position: 'absolute', top: 0, left: 0, right: 0,
                  backgroundColor: '#32CD32',
                  height: successFill.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
                  opacity: successFill.interpolate({ inputRange: [0, 1], outputRange: [0.3, 0.55] }),
                }} />
                {/* 박스 상단 어둠 + 이모지 + 풀 문장 (슬롯머신 중엔 이모지만 일정 리듬 순환, 텍스트 숨김) */}
                <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, paddingVertical: 16, paddingHorizontal: 12, backgroundColor: 'rgba(0,0,0,0.65)', alignItems: 'center', gap: 8 }}>
                  <View style={{ width: 60, height: 60, position: 'relative' }}>
                    {/* 최종 이미지: 항상 mount → 디코딩 선행. 슬롯머신 중엔 opacity 0 */}
                    {currentEmoji ? (
                      <Image
                        source={currentEmoji}
                        style={{ position: 'absolute', top: 0, left: 0, width: 60, height: 60, opacity: isShuffling ? 0 : 1 }}
                        resizeMode="contain"
                      />
                    ) : (
                      <View style={{ opacity: isShuffling ? 0 : 1 }}>
                        <MaterialIcons name={currentMission as React.ComponentProps<typeof MaterialIcons>['name']} size={54} color="#fff" />
                      </View>
                    )}
                    {/* 슬롯머신 이미지들: 같은 컨테이너에 pre-mount, idx만 opacity 1 */}
                    {isShuffling && shuffledList.map((k, i) => (
                      <Image
                        key={k}
                        source={MISSION_EMOJI[k]}
                        style={{ position: 'absolute', top: 0, left: 0, width: 60, height: 60, opacity: i === shuffleIdx ? 1 : 0 }}
                        resizeMode="contain"
                      />
                    ))}
                  </View>
                  <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700', minHeight: 20, textAlign: 'center' }}>
                    {isShuffling ? '' : missionSentence}
                  </Text>
                </View>
                {/* 박스 하단 어둠 + 남은 초 (5초 이하는 빨강 깜빡) */}
                <View pointerEvents="none" style={{ position: 'absolute', bottom: 0, left: 0, right: 0, paddingVertical: 10, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' }}>
                  <Animated.Text style={{
                    color: isDanger ? '#ff3b30' : '#fff',
                    fontSize: 28, fontWeight: '900', fontVariant: ['tabular-nums'],
                    opacity: isDanger ? dangerBlink.interpolate({ inputRange: [0, 1], outputRange: [1, 0.25] }) : 1,
                  }}>
                    {remainingSeconds}{t('settings.secondsUnit', { defaultValue: '초' })}
                  </Animated.Text>
                </View>
                {/* 스캔 라인 — 오버레이 제외 가시 영역 내 왕복 (연두 글로우). 감지 성공 시 숨김 */}
                <View pointerEvents="none" style={{ position: 'absolute', top: 120, bottom: 50, left: 0, right: 0, overflow: 'hidden', opacity: successAnimating ? 0 : 1 }}>
                  <Animated.View style={{
                    position: 'absolute',
                    top: 0, left: 0, right: 0,
                    height: 2,
                    backgroundColor: '#B8E986',
                    transform: [{
                      translateY: scanLine.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0, Math.max(0, boxHeight - 120 - 50 - 2)],
                      }),
                    }],
                    // iOS 글로우
                    shadowColor: '#B8E986',
                    shadowOpacity: 0.9,
                    shadowRadius: 12,
                    shadowOffset: { width: 0, height: 0 },
                    // Android 글로우 근사 (shadow 제어 어려움 → 엘리베이션 대신 아래 확장 View로 발광감)
                    elevation: 8,
                  }}>
                    <View style={{ position: 'absolute', top: -8, left: 0, right: 0, height: 18, backgroundColor: '#B8E986', opacity: 0.25 }} />
                  </Animated.View>
                </View>
                {/* 중앙 크로스헤어 — 원(반지름 22) + 십자(18px) */}
                <View pointerEvents="none" style={{ position: 'absolute', top: 120, bottom: 50, left: 0, right: 0, alignItems: 'center', justifyContent: 'center' }}>
                  <Svg width={48} height={48} style={{ position: 'absolute' }}>
                    <Circle cx={24} cy={24} r={22} stroke="#B8E986" strokeWidth={2} fill="none" />
                  </Svg>
                  <View style={{ width: 18, height: 2, backgroundColor: '#B8E986', position: 'absolute' }} />
                  <View style={{ width: 2, height: 18, backgroundColor: '#B8E986', position: 'absolute' }} />
                </View>
                {/* 재시도 배너 */}
                {isRetryBannerVisible && (
                  <View style={{ position: 'absolute', top: '35%', left: 12, right: 12, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.8)', alignItems: 'center', gap: 4 }} pointerEvents="none">
                    <Text style={{ color: '#fff', fontSize: 22, fontWeight: '900' }}>
                      {t('alarm.retrying', { defaultValue: '재시도' })}
                    </Text>
                    <Text style={{ color: '#ddd', fontSize: 12, fontWeight: '600', textAlign: 'center' }}>
                      {t('alarm.missionRetryHint', { mission: missionLabel, defaultValue: `${missionLabel}을 다시 찾아주세요` })}
                    </Text>
                  </View>
                )}
              </>
            ) : (
              <View style={[StyleSheet.absoluteFillObject, { alignItems: 'center', justifyContent: 'center', padding: 24 }]}>
                <Text style={{ color: '#fff', fontSize: 14, marginBottom: 12, textAlign: 'center' }}>{t('alarm.takePhoto')}</Text>
                <TouchableOpacity style={styles.permissionButton} onPress={requestPermission}>
                  <Text style={styles.permissionButtonText}>{t('alarm.allowCamera')}</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>

          {/* 다시 뽑기 + 카메라 전환 — 카메라 박스 바로 아래에 가로 배치 */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 32, marginTop: 8 }}>
            <TouchableOpacity
              onPress={reshuffleMission}
              disabled={isRetryBannerVisible || isShuffling}
              style={[{ alignItems: 'center', gap: 4, paddingVertical: 10 }, (isRetryBannerVisible || isShuffling) && { opacity: 0.4 }]}
            >
              <MaterialIcons name="shuffle" size={26} color="#fff" style={{ opacity: 0.9 }} />
              <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600', opacity: 0.85 }}>
                {t('alarm.reshuffle', { defaultValue: '다시 뽑기' })}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={toggleCamera}
              disabled={isShuffling}
              style={[{ alignItems: 'center', gap: 4, paddingVertical: 10 }, isShuffling && { opacity: 0.4 }]}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <MaterialIcons name="flip-camera-ios" size={26} color="#fff" style={{ opacity: 0.9 }} />
              <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600', opacity: 0.85 }}>
                {t('alarm.flipCamera', { defaultValue: '카메라 전환' })}
              </Text>
            </TouchableOpacity>
          </View>

        </View>

        <AdBanner />
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
