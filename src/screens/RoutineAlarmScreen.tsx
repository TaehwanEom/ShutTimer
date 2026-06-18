// v1.6 Phase 6: 신 데이터 모델 + endMethod 4분기 적용. 상태 전환은 routineController 위임.
// 사운드/진동 + endMethod별 dismiss UI + "다음 step 시작" 버튼.
// 배경 알림으로 직접 진입한 경우 controller.completeCurrentMission()으로 세션 기록 등 자동 처리.
// camera 모드: 랜덤 MISSION_POOL 1개 노출 + 탭 dismiss (v1.5 AlarmCameraMode 통합은 Phase 6.5에서 별도).

import React, { useState, useEffect, useRef, useCallback } from 'react';
// v2.0 C-3-3 — useActiveRoutineAr hook 도입
import { useActiveRoutineAr } from '../state/useSession';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Vibration,
  AppState,
  BackHandler,
  Animated,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { Accelerometer } from 'expo-sensors';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTranslation } from 'react-i18next';
import { RootStackParamList } from '../../App';
import { useTheme } from '../context/ThemeContext';
import { ThemeColors } from '../constants/theme';
import {
  Routine,
  RoutineEndMethod,
  loadRoutines,
  loadActiveRoutine,
  getRoutineMode,
} from '../constants/routines';
import {
  completeCurrentMission,
  confirmAndAdvance,
  stopRoutine,
} from '../utils/routineController';
import { ALARM_SOUNDS, DEFAULT_SOUND_ID } from '../constants/sounds';
import { MISSION_POOL, MISSION_EMOJI, MISSION_LABEL, MISSION_COCO_LABELS, MISSION_CONFIDENCE_OVERRIDE } from '../constants/missionIcons';
import { useSharedValue } from 'react-native-worklets-core';
import AlarmCameraMode from './AlarmCameraMode';
import AlarmMathMode from '../components/AlarmMathMode';
import AlarmTypingMode from '../components/AlarmTypingMode';
import TapChargeMission from '../components/TapChargeMission';
import { getCachedDismissMethod } from '../utils/settingsCache';
import { DEFAULT_SETTINGS } from '../constants/settings';
import type { Detection } from '../utils/objectDetection';
import { SETTINGS_KEY } from '../constants/settings';
import { Logger } from '../utils/logger';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'RoutineAlarm'>;
  route: RouteProp<RootStackParamList, 'RoutineAlarm'>;
};

const SHAKE_THRESHOLD = 2.5;
const SHAKE_COOLDOWN_MS = 400;
const SHAKE_COUNT_REQUIRED = 2;
// v1.6 Phase 6.5 — AlarmCameraMode 의 v1.5 검증 임계값 (분리 정책: 자체 선언, AlarmScreen import X)
const TARGET_CONFIDENCE = 0.4;
// v1.6 Phase 6.5 — 카메라 모드 검증 흐름 상수 (AlarmScreen 동일 값 차용)
const RETRY_BANNER_MS = 1000;
const BLINK_ON_MS = 100;
const BLINK_OFF_MS = 80;
const BLINK_COUNT = 2;
const FEEDBACK_DELAY_MS = 300;
const COMPLETE_ANIM_MS = 900;
const ROUTINE_CAMERA_DURATION_SEC = 30; // routine 카메라 미션 시간 (AlarmScreen DEFAULT_SETTINGS.missionDuration 동일)

export default function RoutineAlarmScreen({ navigation, route }: Props) {
  const { colors } = useTheme();
  const { t, i18n } = useTranslation();
  const styles = makeStyles(colors);

  const [routine, setRoutine] = useState<Routine | null>(null);
  // v2.0 C-3-3 — useState<ActiveRoutine> 측 useActiveRoutineAr() 측 대체. dispatch 자동 갱신.
  const { ar } = useActiveRoutineAr();
  const [dismissed, setDismissed] = useState(false);
  // v1.6 hotfix — dismissed 후 자동 진행 카운트다운 (autoCountdownSec → 0). 0 시 즉시 진행.
  const [countdown, setCountdown] = useState<number | null>(null);
  // camera 모드: 랜덤 MISSION_POOL 1개 — mount 시 한 번 픽
  const [cameraMission, setCameraMission] = useState<string | null>(null);
  const soundRef = useRef<AudioPlayer | null>(null);
  const vibrationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const shakeCountRef = useRef(0);
  const lastShakeTimeRef = useRef(0);
  const accelSubRef = useRef<{ remove: () => void } | null>(null);

  // ─── v1.6 Phase 6.5 — AlarmCameraMode 마운트용 부모-측 state/SV ─────
  // 분리 정책: AlarmScreen 의 동일 패턴을 차용. 코드/state 는 RoutineAlarm 자체 인스턴스 — AlarmScreen import X.
  // SharedValues 6개 — frame processor + AlarmCameraMode props 용
  const matched = useSharedValue(false);
  const lastRun = useSharedValue(0);
  const targetLabelsSV = useSharedValue<string[]>([]);
  const thresholdSV = useSharedValue<number>(TARGET_CONFIDENCE);
  const consecutiveHits = useSharedValue(0);
  const isShufflingSV = useSharedValue(false);

  // 슬롯머신 state — 재돌림 (Step D) + AlarmCameraMode props 용
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
    setIsShuffling(false);
    setShuffledList([]);
    setShuffleIdx(0);
  }, []);

  // UI 상태 — AlarmCameraMode props 요구치
  const [isRetryBannerVisible, setIsRetryBannerVisible] = useState(false);
  const [successAnimating, setSuccessAnimating] = useState(false);
  const [resultState] = useState<'idle' | 'success' | 'fail'>('idle'); // routine 에선 'idle' 고정 (인식 후 즉시 handleDismiss)
  const [attemptCount, setAttemptCount] = useState<1 | 2>(1);
  const [remainingMs, setRemainingMs] = useState<number>(ROUTINE_CAMERA_DURATION_SEC * 1000);
  // v1.8 — SettingsScreen 측 missionDuration 동적 load (= 0 시 제한 없음).
  const [missionDuration, setMissionDuration] = useState<number>(ROUTINE_CAMERA_DURATION_SEC);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentMissionRef = useRef<string | null>(null);
  const missionDurationRef = useRef<number>(ROUTINE_CAMERA_DURATION_SEC);
  // cameraMission 갱신 시 ref 동기화 (slot reshuffle 함수에서 사용)
  useEffect(() => {
    currentMissionRef.current = cameraMission;
  }, [cameraMission]);
  // remainingMs 기반 — AlarmCameraMode props 의 remainingSeconds (Math.ceil)
  const remainingSeconds = Math.ceil(remainingMs / 1000);
  // remainingMs 기반 — AlarmCameraMode props 의 isDanger (≤5초 + 활성 상태)
  const isDanger = remainingSeconds <= 5 && remainingSeconds > 0 && !isShuffling && !isRetryBannerVisible && resultState === 'idle';

  // 애니메이션 — AlarmCameraMode props 요구치
  const successBlink = useRef(new Animated.Value(0)).current;
  const successFill = useRef(new Animated.Value(0)).current;
  const scanLine = useRef(new Animated.Value(0)).current;
  const dangerBlink = useRef(new Animated.Value(0)).current;

  // 레이아웃 — AlarmCameraMode props 요구치. useWindowDimensions 측 = 동적 정합 (= 회전/화면 swap 시 자동 update).
  // useState(0) 사용 시 마운트 직후 0×0 → 빈 화면 회귀 (Step C 회귀 fix).
  const { width: screenW } = useWindowDimensions();
  const boxWidth = screenW - 32; // 좌우 16px 여백 (AlarmScreen 동일)
  const boxHeight = boxWidth * 1.25; // 세로로 살짝 긴 박스

  // ─── 마운트: 배경 경로 여부 감지하여 세션 기록 보완 ────
  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      const list = await loadRoutines();
      const original = list.find(r => r.id === route.params.routineId);
      let existing = await loadActiveRoutine();
      if (!original || !existing || cancelled) {
        navigation.goBack();
        return;
      }

      // v1.8 #DismissMethodPurge-Routine — endMethod = 전역 설정 측 값 사용 (= 알람 정합).
      // routine.endMethod 필드 = storage 측 잔존, 사용 ❌.
      const globalEndMethod = (getCachedDismissMethod() ?? DEFAULT_SETTINGS.dismissMethod) as RoutineEndMethod;

      // 이중 가드 — globalEndMethod !== 'camera' && !== 'math' && !== 'typing' && !== 'random' 면 RoutineList 로 redirect (inline 진행).
      // (App.tsx 알림 핸들러/콜드 스타트가 이미 분기하지만, 예측 못한 경로 fallback)
      if (
        globalEndMethod !== 'camera' &&
        globalEndMethod !== 'math' &&
        globalEndMethod !== 'typing' &&
        globalEndMethod !== 'tapcharge' &&
        globalEndMethod !== 'random'
      ) {
        // v1.8 — RoutineList Stack.Screen 제거. MainTabsNavigator RoutineTab 측으로 reset.
        navigation.reset({ index: 0, routes: [{ name: 'Home', state: { routes: [{ name: 'RoutineTab' }] } }] } as any);
        return;
      }

      // 'random' 영역 = 5개 (tap/shake/camera/math/typing) 중 1개 즉시 선택. 매 발화 다름.
      let target: Routine = { ...original, endMethod: globalEndMethod };
      if (globalEndMethod === 'random') {
        const options: RoutineEndMethod[] = ['tap', 'shake', 'camera', 'math', 'typing', 'tapcharge'];
        const pick = options[Math.floor(Math.random() * options.length)];
        target = { ...original, endMethod: pick };
      }

      // 배경 알림으로 직접 진입한 경로면 awaitingConfirm=false 상태.
      // controller.completeCurrentMission()이 세션 기록 + awaitingConfirm=true 저장.
      if (!existing.awaitingConfirm) {
        const res = await completeCurrentMission();
        if (res && res.kind === 'end') {
          // 마지막 step 완료 → 루틴이 속한 탭 (예약/일반) 으로 RoutineList 복귀
          const tab = getRoutineMode(target);
          // v1.7 hotfix #NavigateRoutineTab-AlarmScreens — Tab Navigator 측 RoutineTab 측 진입 (= 메뉴바 ✅).
          (navigation as any).reset({ index: 0, routes: [{ name: 'Home', state: { routes: [{ name: 'RoutineTab', params: { initialTab: tab } }] } }] });
          return;
        }
        existing = await loadActiveRoutine();
        if (!existing) {
          navigation.goBack();
          return;
        }
      }

      setRoutine(target);
      // v2.0 C-3-3 — setAr 폐기. useActiveRoutineAr 측 자동 갱신.

      // camera 모드면 랜덤 미션 픽 (1회)
      if (target.endMethod === 'camera' && MISSION_POOL.length > 0) {
        const pick = MISSION_POOL[Math.floor(Math.random() * MISSION_POOL.length)];
        setCameraMission(pick);
      }

      // 사운드/진동 시작
      const [soundId, alarmRaw, vibRaw, missionDurRaw] = await Promise.all([
        AsyncStorage.getItem(SETTINGS_KEY.ALARM_SOUND),
        AsyncStorage.getItem(SETTINGS_KEY.ALARM_ENABLED),
        AsyncStorage.getItem(SETTINGS_KEY.VIBRATION_ENABLED),
        AsyncStorage.getItem(SETTINGS_KEY.MISSION_DURATION),
      ]);
      // v1.8 — SettingsScreen 측 missionDuration 동적 load (= 0 시 제한 없음).
      const n = parseInt(missionDurRaw ?? '', 10);
      const validDur = !isNaN(n) && (n === 0 || (n >= 10 && n <= 60)) ? n : ROUTINE_CAMERA_DURATION_SEC;
      if (!cancelled) {
        setMissionDuration(validDur);
        missionDurationRef.current = validDur;
        if (validDur > 0) setRemainingMs(validDur * 1000);
      }
      const alarmEnabled = alarmRaw !== 'false';
      const vibrationEnabled = vibRaw !== 'false';
      const effectiveId = soundId ?? DEFAULT_SOUND_ID;
      const item = ALARM_SOUNDS.find(s => s.id === effectiveId) ?? ALARM_SOUNDS[0];

      if (alarmEnabled) {
        // v1.7 hotfix #ExpoAudio Phase 4-D — expo-av → expo-audio swap + LoadGate 패턴 적용.
        setAudioModeAsync({
          playsInSilentMode: true,
          shouldPlayInBackground: true,
          interruptionMode: 'doNotMix',
        })
          .then(() => {
            if (cancelled) return;
            try {
              const player = createAudioPlayer(item.source);
              player.loop = true;
              if (cancelled) {
                try { player.release(); } catch {}
                return;
              }
              soundRef.current = player;
              const playWhenLoaded = () => {
                if (player.isLoaded) {
                  try { player.play(); } catch {}
                  return;
                }
                const sub = player.addListener('playbackStatusUpdate', (status) => {
                  if (status?.isLoaded) {
                    sub.remove();
                    if (cancelled) return;
                    try { player.play(); } catch {}
                  }
                });
              };
              playWhenLoaded();
            } catch {}
          })
          .catch(() => {});
      }

      if (vibrationEnabled) {
        Vibration.vibrate();
        vibrationIntervalRef.current = setInterval(() => Vibration.vibrate(), 1000);
      }
    };
    init();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.params.routineId]);

  // ─── cleanup ──────────────────────────────────────────────
  useEffect(() => {
    return () => {
      stopAudio();
      stopVibe();
      accelSubRef.current?.remove();
      accelSubRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── frame processor 갱신 — cameraMission 변경 시 SV 재설정 ──
  useEffect(() => {
    if (!cameraMission) return;
    targetLabelsSV.value = MISSION_COCO_LABELS[cameraMission] ?? [];
    thresholdSV.value = MISSION_CONFIDENCE_OVERRIDE[cameraMission] ?? TARGET_CONFIDENCE;
  }, [cameraMission, targetLabelsSV, thresholdSV]);

  // ─── 흔들기 감지 (endMethod === 'shake' 만) ──────────────
  useEffect(() => {
    if (!routine || dismissed || routine.endMethod !== 'shake') return;
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
          handleDismiss();
        }
      }
    });
    accelSubRef.current = sub;
    return () => {
      sub.remove();
      accelSubRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routine, dismissed]);

  // ─── 뒤로가기 차단 ───────────────────────────────────────
  useEffect(() => {
    const handler = () => true;
    const sub = BackHandler.addEventListener('hardwareBackPress', handler);
    return () => sub.remove();
  }, []);

  // ─── AppState 복귀: 24시간 데드라인 재체크 + Audio/Vibration 재시작 ────
  useEffect(() => {
    const sub = AppState.addEventListener('change', async (state) => {
      if (state !== 'active' || !ar) return;
      if (Date.now() > ar.deadlineAt) {
        await stopRoutine();
        stopAudio();
        stopVibe();
        const tab = routine ? getRoutineMode(routine) : undefined;
        (navigation as any).reset({ index: 0, routes: [{ name: 'Home', state: { routes: [{ name: 'RoutineTab', params: tab ? { initialTab: tab } : undefined }] } }] });
        return;
      }
      if (dismissed || !routine) return;

      // 진동 재시작
      const vibRaw = await AsyncStorage.getItem(SETTINGS_KEY.VIBRATION_ENABLED);
      const vibrationEnabled = vibRaw !== 'false';
      if (vibrationEnabled) {
        if (vibrationIntervalRef.current) clearInterval(vibrationIntervalRef.current);
        Vibration.vibrate();
        vibrationIntervalRef.current = setInterval(() => Vibration.vibrate(), 1000);
      }

      // Audio 재시작 (= AppState=active 진입 시 = 사운드 재개 영역)
      // v1.7 hotfix #ExpoAudio Phase 4-D — expo-audio sync property + setAudioModeAsync 새 API.
      const s = soundRef.current;
      if (s) {
        if (s.isLoaded && !s.playing) {
          setAudioModeAsync({
            playsInSilentMode: true,
            shouldPlayInBackground: true,
            interruptionMode: 'doNotMix',
          })
            .then(() => { try { s.play(); } catch {} })
            .catch(() => {});
        }
      }
    });
    return () => sub.remove();
  }, [ar, navigation, dismissed, routine]);

  // ─── dismiss: 사운드/진동 정지 ───────────────────────────
  const handleDismiss = useCallback(() => {
    if (dismissed) return;
    setDismissed(true);
    stopAudio();
    stopVibe();
  }, [dismissed]);

  // ─── v1.6 Phase 6.5 카메라 모드 핸들러 (AlarmScreen 패턴 그대로 차용) ──
  // 인식 성공 시 — blink 시퀀스 → fill 애니메이션 → handleDismiss (routine 의 4-stage modal 흐름으로)
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
        useNativeDriver: false,
      }).start(() => {
        handleDismiss();
      });
    });
  }, [handleDismiss, successBlink, successFill]);

  // 슬롯머신 재돌림 — AlarmScreen.tsx:783-826 패턴. 분리 정책 (D-2-i): MISSION_POOL 전체 사용 (selectedMissions 분기 X).
  const reshuffleMission = useCallback(() => {
    if (isRetryBannerVisible) return;
    if (shuffleIntervalRef.current || shuffleTimeoutRef.current) return;

    isShufflingSV.value = true;
    consecutiveHits.value = 0;
    matched.value = false;
    lastRun.value = Date.now();

    // MISSION_POOL 전체 픽 (현재 cameraMission 제외)
    const exclude = currentMissionRef.current;
    const pool = exclude ? MISSION_POOL.filter(m => m !== exclude) : MISSION_POOL;
    const final = pool.length > 0
      ? pool[Math.floor(Math.random() * pool.length)]
      : MISSION_POOL[Math.floor(Math.random() * MISSION_POOL.length)];
    setCameraMission(final);
    targetLabelsSV.value = MISSION_COCO_LABELS[final] ?? [];
    thresholdSV.value = MISSION_CONFIDENCE_OVERRIDE[final] ?? TARGET_CONFIDENCE;

    const visualPool = MISSION_POOL.filter((k) => k !== final);
    const shuffled = [...visualPool].sort(() => Math.random() - 0.5);
    if (shuffled.length === 0) shuffled.push(final);
    setShuffledList(shuffled);
    setShuffleIdx(0);
    setIsShuffling(true);
    shuffleIntervalRef.current = setInterval(() => {
      setShuffleIdx((i) => (i + 1) % shuffled.length);
    }, 60);

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

  // 카운트다운 — camera 분기 + 슬롯머신/재시도/성공 중엔 일시정지. dismissed 후 정지.
  useEffect(() => {
    if (routine?.endMethod !== 'camera') return;
    if (dismissed) return;
    if (resultState !== 'idle') return;
    if (isRetryBannerVisible) return;
    if (isShuffling) return;
    if (matched.value) return;
    if (missionDuration === 0) return; // v1.8 — 제한 없음 시 카운트다운 skip.
    const id = setInterval(() => {
      setRemainingMs((prev) => Math.max(0, prev - 1000));
    }, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routine?.endMethod, dismissed, resultState, isRetryBannerVisible, isShuffling, missionDuration]);

  // 만료 처리 — 1차 시간 초과 = 재시도 배너 1초 후 시간 리셋. 2차 시간 초과 = handleDismiss (routine 다음 흐름).
  useEffect(() => {
    if (routine?.endMethod !== 'camera') return;
    if (dismissed) return;
    if (resultState !== 'idle') return;
    if (isRetryBannerVisible) return;
    if (isShuffling) return;
    if (missionDuration === 0) return; // v1.8 — 제한 없음 시 만료 처리 skip.
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
      handleDismiss();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remainingMs, routine?.endMethod, dismissed, resultState, isRetryBannerVisible, attemptCount, isShuffling, missionDuration]);

  // retryTimeoutRef cleanup
  useEffect(() => {
    return () => {
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
    };
  }, []);

  // clearShuffle cleanup (언마운트)
  useEffect(() => {
    return () => clearShuffle();
  }, [clearShuffle]);

  // 스캔 라인 애니메이션 (camera + idle + !successAnimating). dismissed 후 정지.
  useEffect(() => {
    if (routine?.endMethod !== 'camera') return;
    const active = !dismissed && resultState === 'idle' && !successAnimating;
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
  }, [routine?.endMethod, dismissed, resultState, successAnimating, scanLine]);

  // 위험 깜빡 (≤5초). dismissed 후 정지.
  useEffect(() => {
    if (routine?.endMethod !== 'camera') return;
    if (dismissed || !isDanger) {
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
  }, [routine?.endMethod, dismissed, isDanger, dangerBlink]);

  // v1.6 hotfix — dismissed=true 진입 시 autoCountdownSec 카운트다운 자동 시작.
  // 카운트 종료 → handleStartNext 자동 호출 (앱 내 + 잠금/백그라운드 양쪽 흐름 동일 카운트 정합).
  // 카운트 0 (사용자 setting) = 즉시 진행. 카운트 중 ✕ → handleStop (취소).
  useEffect(() => {
    if (!dismissed || !routine || !ar) return;
    // willEnd (마지막 step) = 카운트 ❌. "완료" 버튼만 표시.
    const nextIdxLocal = ar.currentStepIndex + 1;
    if (nextIdxLocal >= routine.steps.length) return;
    const initial = Math.max(0, Math.min(60, Math.floor(routine.autoCountdownSec ?? 5)));
    if (initial === 0) {
      // 즉시 진행
      handleStartNext();
      return;
    }
    setCountdown(initial);
    const tick = setInterval(() => {
      setCountdown(prev => {
        if (prev === null) return prev;
        if (prev <= 1) {
          clearInterval(tick);
          handleStartNext();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(tick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dismissed, routine, ar]);

  // ─── "다음 미션 시작" → controller.confirmAndAdvance ──
  const handleStartNext = useCallback(async () => {
    const res = await confirmAndAdvance();
    const tab = routine ? getRoutineMode(routine) : undefined;
    const params = tab ? { initialTab: tab } : undefined;
    if (!res) {
      // fallback — 루틴이 속한 탭으로 RoutineTab 복귀
      (navigation as any).reset({ index: 0, routes: [{ name: 'Home', state: { routes: [{ name: 'RoutineTab', params }] } }] });
      return;
    }
    if (res.kind === 'end') {
      // 마지막 step 완료 → 루틴이 속한 탭으로 RoutineTab 복귀
      (navigation as any).reset({ index: 0, routes: [{ name: 'Home', state: { routes: [{ name: 'RoutineTab', params }] } }] });
      return;
    }
    // advance_auto — 다음 step 부터는 RoutineTab 의 inline 진행 영역에서 처리
    (navigation as any).reset({
      index: 0,
      routes: [
        { name: 'Home', state: { routes: [{ name: 'RoutineTab', params }] } },
      ],
    });
  }, [navigation, routine]);

  // ─── 정리 헬퍼 ───────────────────────────────────────────
  const stopAudio = () => {
    const s = soundRef.current;
    soundRef.current = null;
    if (s) {
      try { s.release(); } catch {}
    }
  };
  const stopVibe = () => {
    if (vibrationIntervalRef.current) {
      clearInterval(vibrationIntervalRef.current);
      vibrationIntervalRef.current = null;
    }
    Vibration.cancel();
  };

  // ─── 루틴 중단 ──────────────────────────────────────────
  const handleStop = useCallback(async () => {
    // v1.7 hotfix #DBG-StopNav — 정지 누름 진입 + reset 직전 currentRoute / routineId 추적용.
    // 사용자 보고 = "알람 루틴 정지 → RoutineList 진입" root cause 식별 (= 본 경로 진입 시점 추적).
    const currentRoute = (navigation as any).getState?.()?.routes?.slice(-1)?.[0]?.name;
    Logger.warn('StopNav-DBG', `RoutineAlarmScreen.handleStop ENTER routineId=${routine?.id ?? '(null)'} currentRoute=${currentRoute ?? '(unknown)'}`);
    stopAudio();
    stopVibe();
    await stopRoutine();
    const tab = routine ? getRoutineMode(routine) : undefined;
    const params = tab ? { initialTab: tab } : undefined;
    Logger.warn('StopNav-DBG', `RoutineAlarmScreen.handleStop reset → RoutineTab tab=${tab ?? '(none)'}`);
    (navigation as any).reset({ index: 0, routes: [{ name: 'Home', state: { routes: [{ name: 'RoutineTab', params }] } }] });
  }, [navigation, routine]);

  if (!routine || !ar) {
    return <SafeAreaView style={styles.container} />;
  }

  // 단일 순회: nextIdx >= steps.length 면 루틴 종료
  const nextIdx = ar.currentStepIndex + 1;
  const willEnd = nextIdx >= routine.steps.length;
  const nextStep = willEnd ? null : routine.steps[nextIdx];
  const nextLabel = nextStep ? nextStep.name : '';
  const nextDurationMin = nextStep ? Math.round(Math.max(0, nextStep.durationSeconds) / 60) : 0;

  // dismiss UI 분기
  const renderDismissArea = () => {
    if (routine.endMethod === 'tap') {
      return (
        <TouchableOpacity style={styles.routineTapShell} activeOpacity={0.92} onPress={handleDismiss}>
          <View style={styles.routineTapCard}>
            <View style={styles.routineTapIconWrapper}>
              <MaterialIcons name="touch-app" size={70} color={colors.primary} />
            </View>
            <Text style={styles.routineTapTitle}>{t('routine.missionComplete', { defaultValue: '미션 완료' })}</Text>
            <Text style={styles.routineTapHint}>{t('routine.tapToDismiss', { defaultValue: '화면을 탭하여 계속' })}</Text>
          </View>
          <View style={styles.routineTapButton}>
            <MaterialIcons name="check" size={22} color="#FFFFFF" />
            <Text style={styles.routineTapButtonText}>{t('routine.continue', { defaultValue: '계속하기' })}</Text>
          </View>
        </TouchableOpacity>
      );
    }
    if (routine.endMethod === 'shake') {
      return (
        <View style={styles.dismissArea}>
          <MaterialIcons name="alarm" size={96} color={colors.primary} />
          <Text style={styles.completeText}>{t('routine.missionComplete', { defaultValue: '미션 완료' })}</Text>
          <Text style={styles.dismissHint}>{t('routine.shakeToDismiss', { defaultValue: '흔들어서 계속' })}</Text>
        </View>
      );
    }
    if (routine.endMethod === 'math') {
      return (
        <View style={{ flex: 1 }}>
          <AlarmMathMode colors={colors} t={t} onSuccess={handleDismiss} />
        </View>
      );
    }
    if (routine.endMethod === 'typing') {
      return (
        <View style={{ flex: 1 }}>
          <AlarmTypingMode colors={colors} t={t} locale={i18n.language} onSuccess={handleDismiss} />
        </View>
      );
    }
    if (routine.endMethod === 'tapcharge') {
      return (
        <View style={{ flex: 1 }}>
          <TapChargeMission colors={colors} t={t} onSuccess={handleDismiss} />
        </View>
      );
    }
    if (routine.endMethod === 'camera' && cameraMission) {
      // v1.6 Phase 6.5 — Step C: AlarmCameraMode 마운트 (props 29개 매핑).
      // onMatchDetected / onReshuffle 은 Step D 에서 정식 핸들러로 교체 (현재 placeholder).
      // wrapper: AlarmScreen 패턴 (헤더 + flex:1 박스 영역) 차용 — 분리 정책: 코드 별도 작성.
      return (
        <View style={{ flex: 1, backgroundColor: '#F6F7FB' }}>
          <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 }}>
            <Text style={{ fontSize: 30, fontWeight: '900', color: '#111827', letterSpacing: -0.5 }}>
              ShutTimer
            </Text>
          </View>
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'flex-start', paddingTop: 8 }}>
        <AlarmCameraMode
          matched={matched}
          lastRun={lastRun}
          targetLabelsSV={targetLabelsSV}
          thresholdSV={thresholdSV}
          consecutiveHits={consecutiveHits}
          isShufflingSV={isShufflingSV}
          currentMission={cameraMission}
          currentEmoji={MISSION_EMOJI[cameraMission]}
          missionLabel={MISSION_LABEL[cameraMission] ?? cameraMission}
          missionSentence={t('routine.cameraScanHint', { defaultValue: '대상을 찾아 사진 촬영' })}
          isShuffling={isShuffling}
          shuffledList={shuffledList}
          shuffleIdx={shuffleIdx}
          isRetryBannerVisible={isRetryBannerVisible}
          successAnimating={successAnimating}
          resultState={resultState}
          isDanger={isDanger}
          remainingSeconds={remainingSeconds}
          unlimited={missionDuration === 0}
          successBlink={successBlink}
          successFill={successFill}
          scanLine={scanLine}
          dangerBlink={dangerBlink}
          boxWidth={boxWidth}
          boxHeight={boxHeight}
          onMatchDetected={triggerDetectionSequence}
          onReshuffle={reshuffleMission}
          t={t}
          permissionButtonStyle={{ backgroundColor: colors.primary, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12 }}
          permissionButtonTextStyle={{ color: colors.onPrimary, fontSize: 16, fontWeight: '700' }}
        />
          </View>
        </View>
      );
    }
    // endMethod === 'auto' 는 이 화면 자체에 도달하지 않음 (controller가 직접 advance).
    // 안전장치: tap 동작으로 fallback.
    return (
      <TouchableOpacity style={styles.dismissArea} activeOpacity={0.9} onPress={handleDismiss}>
        <MaterialIcons name="alarm" size={96} color={colors.primary} />
        <Text style={styles.completeText}>{t('routine.missionComplete', { defaultValue: '미션 완료' })}</Text>
      </TouchableOpacity>
    );
  };

  // camera 분기 진입 시 SafeAreaView 자체를 카메라 셸 배경으로 맞춤.
  // 다른 분기 (tap/shake/auto) 는 기존 styles.container 그대로 — 회귀 X.
  // dismissed 후 (다음 미션 modal) 는 흰 배경으로 복원 — 라이트 theme 색상 충돌 방지.
  const isCameraMode = routine?.endMethod === 'camera' && !dismissed;
  return (
    <SafeAreaView style={[styles.container, isCameraMode && { backgroundColor: '#F6F7FB' }]}>
      {!dismissed ? (
        renderDismissArea()
      ) : (
        <View style={styles.resultBox}>
          <MaterialIcons name="check-circle" size={72} color={colors.primary} />
          {willEnd ? (
            <>
              <Text style={styles.bigText}>
                {t('routine.allComplete', { defaultValue: '모든 미션 완료!' })}
              </Text>
              <TouchableOpacity style={styles.primaryBtn} onPress={handleStartNext}>
                <Text style={styles.primaryBtnText}>
                  {t('routine.finish', { defaultValue: '완료' })}
                </Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={styles.nextLabel}>
                {t('routine.nextMission', { defaultValue: '다음 미션' })}
              </Text>
              <Text style={styles.bigText}>{nextLabel}</Text>
              <Text style={styles.nextDuration}>
                {nextDurationMin} {t('routine.minutesUnit', { defaultValue: '분' })}
              </Text>
              {/* v1.6 hotfix — autoCountdownSec 카운트 표시 (자동 진행). ✕ 누르면 취소(routine 종료). */}
              {countdown !== null && countdown > 0 && (
                <Text style={styles.nextDuration}>
                  {t('routine.advanceCountdown', { defaultValue: '{{n}}초 후 자동 진행', n: countdown })}
                </Text>
              )}
              <TouchableOpacity style={styles.secondaryBtn} onPress={handleStop}>
                <Text style={styles.secondaryBtnText}>
                  {t('routine.stopRoutine', { defaultValue: '루틴 중단' })}
                </Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      )}
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  dismissArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  completeText: {
    fontSize: 28,
    fontWeight: '800',
    color: colors.onBackground,
  },
  dismissHint: {
    fontSize: 14,
    color: colors.secondary,
    opacity: 0.8,
  },
  routineTapShell: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 40,
    backgroundColor: '#F6F7FB',
    gap: 28,
  },
  routineTapCard: {
    width: '100%',
    maxWidth: 360,
    alignItems: 'center',
    gap: 14,
    paddingVertical: 40,
    paddingHorizontal: 24,
    borderRadius: 28,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E9ECF3',
    shadowColor: '#111827',
    shadowOpacity: 0.08,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 14 },
    elevation: 4,
  },
  routineTapIconWrapper: {
    width: 108,
    height: 108,
    borderRadius: 54,
    backgroundColor: '#FFF1F1',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#FFD7D7',
    marginBottom: 8,
  },
  routineTapTitle: {
    fontSize: 28,
    fontWeight: '900',
    color: colors.onBackground,
    letterSpacing: -0.5,
    textAlign: 'center',
  },
  routineTapHint: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.secondary,
    opacity: 0.85,
    textAlign: 'center',
    lineHeight: 22,
  },
  routineTapButton: {
    width: '100%',
    maxWidth: 360,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 20,
    borderRadius: 22,
    backgroundColor: colors.primary,
    shadowColor: colors.primary,
    shadowOpacity: 0.24,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 5,
  },
  routineTapButtonText: {
    fontSize: 18,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: -0.2,
  },
  cameraEmoji: {
    width: 96,
    height: 96,
  },
  resultBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 12,
  },
  nextLabel: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.secondary,
    letterSpacing: 0.8,
    marginTop: 12,
  },
  bigText: {
    fontSize: 32,
    fontWeight: '800',
    color: colors.onBackground,
    textAlign: 'center',
  },
  nextDuration: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.primary,
    marginBottom: 16,
  },
  primaryBtn: {
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 14,
    backgroundColor: colors.primary,
    marginTop: 12,
  },
  primaryBtnText: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.onPrimary,
  },
  secondaryBtn: {
    marginTop: 8,
    paddingVertical: 10,
    paddingHorizontal: 24,
  },
  secondaryBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.error,
  },
});
