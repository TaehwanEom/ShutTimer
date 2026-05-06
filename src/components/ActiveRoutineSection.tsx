// 일반(manual) 루틴 inline 진행 섹션.
// RoutineRunScreen 의 핵심 로직 + UI 추출. navigation 의존(goBack) 부분은 onClose callback 으로 대체.
// 풀스크린이 아닌 카드 내부 inline 영역에 사용.

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  AppState,
  Animated,
  Modal,
  Vibration,
  DeviceEventEmitter,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import Svg, { Circle as SvgCircle } from 'react-native-svg';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from '@react-navigation/native';
import { Audio, InterruptionModeIOS } from 'expo-av';
import { Accelerometer } from 'expo-sensors';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTranslation } from 'react-i18next';
import { RootStackParamList } from '../../App';
import { useTheme } from '../context/ThemeContext';
import { ThemeColors } from '../constants/theme';
import { Routine, ActiveRoutine, loadActiveRoutine, loadRoutines } from '../constants/routines';
import {
  startRoutine,
  completeCurrentMission,
  confirmAndAdvance,
  pauseRoutine,
  resumeRoutine,
  stopRoutine,
} from '../utils/routineController';
import { ALARM_SOUNDS, DEFAULT_SOUND_ID } from '../constants/sounds';
import { SETTINGS_KEY } from '../constants/settings';

const AnimatedSvgCircle = Animated.createAnimatedComponent(SvgCircle);

// v1.6 #12 — 마지막 step (모든 endMethod) = AlarmScreen navigate 시 중복 push 차단.
// sig: routineId + currentStepIndex. AlarmScreen 의 stopRoutine 후에는 routine 정리되므로 sig 무효.
let lastStepNavigatedFor: string | null = null;

function formatDurationLabel(sec: number): string {
  if (sec <= 0) return '0분';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const parts: string[] = [];
  if (h > 0) parts.push(`${h}시간`);
  if (m > 0) parts.push(`${m}분`);
  if (s > 0) parts.push(`${s}초`);
  if (parts.length === 0) parts.push('0분');
  return parts.join(' ');
}

type Props = {
  routineId: string;
  /** 진행 종료 시 (정지/완료) 호출 — 부모가 active state clear */
  onClose: () => void;
};

export default function ActiveRoutineSection({ routineId, onClose }: Props) {
  // camera endMethod 분기 시 RoutineAlarm 으로 navigate 하기 위해 hook 사용 (props 타입 충돌 회피)
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { colors, isDark } = useTheme();
  const { t } = useTranslation();
  const styles = makeStyles(colors);

  const [routine, setRoutine] = useState<Routine | null>(null);
  const [ar, setAr] = useState<ActiveRoutine | null>(null);
  const [remainingSec, setRemainingSec] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const completingRef = useRef(false);
  const [modalVisible, setModalVisible] = useState(false);
  // v1.6 Phase 12 — 'auto' / 'complete' stage 제거 (auto 모드 영구 미사용).
  // v1.6 — 'alarm' 단계 (알람 종료 모달) 제거. step 종료 시 즉시 'next' 단계 (다음 진행 모달).
  // v1.6 — 'nextCountdown' 단계 제거. "다음 루틴 시작" 누르면 즉시 다음 step 진행.
  const [modalStage, setModalStage] = useState<'alarm' | 'next'>('next');
  const modalVisibleRef = useRef(false);
  useEffect(() => { modalVisibleRef.current = modalVisible; }, [modalVisible]);

  // ─── 마운트: controller.startRoutine ─────────────────────
  // init 중복 호출 차단 — StrictMode 또는 빠른 unmount/remount 시 askUser dialog 가 두 번 뜨는 버그 방지
  const initStartedRef = useRef(false);
  useEffect(() => {
    if (initStartedRef.current) return;
    initStartedRef.current = true;
    // v1.6 #12 — 새 routine 시작 시 module-level navigate 가드 reset (재시도 / 다른 routine 진입 시 차단 방지).
    lastStepNavigatedFor = null;
    let cancelled = false;
    const init = async () => {
      const res = await startRoutine(routineId);
      if (cancelled) return;
      if (res.kind === 'not_found') {
        Alert.alert(t('routine.notFound', { defaultValue: '루틴을 찾을 수 없습니다' }));
        onClose();
        return;
      }
      if (res.kind === 'needs_timer_override') {
        // v1.6 hotfix — popup 통일: 1버튼 [확인] + 진행 중 타이머 화면(Home, 자동 복원) 이동.
        // 기존 override 즉시 시작 패턴 폐기 — 사용자가 직접 timer stop 결정 (안전성 우선).
        Alert.alert(
          t('routine.timerConflictTitle', { defaultValue: '진행 중인 타이머' }),
          t('routine.timerConflictBody', { defaultValue: '단일 타이머를 먼저 정지해야 루틴을 시작할 수 있습니다.' }),
          [{
            text: t('common.confirm', { defaultValue: '확인' }),
            onPress: () => navigation.navigate('Home'),
          }],
        );
        onClose();
        return;
      }
      if (res.kind === 'needs_override') {
        const proceed = await askUser(
          t('routine.routineConflictTitle', { defaultValue: '진행 중인 루틴' }),
          t('routine.routineConflictBody', { defaultValue: '다른 루틴이 진행 중입니다. 중단하고 이 루틴을 시작하시겠어요?' }),
          t('routine.routineConflictProceed', { defaultValue: '새 루틴 시작' }),
          t,
        );
        if (!proceed) { onClose(); return; }
        const retry = await startRoutine(routineId, { overrideActive: true });
        applyStart(retry);
        return;
      }
      applyStart(res);
    };
    const applyStart = (res: { kind: 'started' | 'resumed'; ar: ActiveRoutine; routine: Routine } | { kind: string }) => {
      if (res.kind === 'started' || res.kind === 'resumed') {
        const r = res as { kind: 'started' | 'resumed'; ar: ActiveRoutine; routine: Routine };
        setRoutine(r.routine);
        setAr(r.ar);
        setIsPaused(r.ar.pausedAt !== null);
        if (r.ar.awaitingConfirm) {
          const isLastStep = r.ar.currentStepIndex + 1 >= r.routine.steps.length;
          if (isLastStep) {
            // v1.6 #12 — 마지막 step (모든 endMethod) = AlarmScreen navigate.
            const sig = `${r.routine.id}-${r.ar.currentStepIndex}`;
            const currentRoute = (navigation as any).getState?.()?.routes?.slice(-1)?.[0]?.name;
            if (lastStepNavigatedFor !== sig && currentRoute !== 'Alarm') {
              lastStepNavigatedFor = sig;
              navigation.navigate('Alarm', {
                fromRoutine: 'last_step',
                routineId: r.routine.id,
                endMethod: r.routine.endMethod,
              });
            }
          } else {
            // v1.6 A-1 — 모달 통일. 일반 step = 'next' 모달.
            setModalStage('next');
            setModalVisible(true);
            startAlarmEffects();
          }
        }
      }
    };
    init();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routineId]);

  // ─── 카운트다운 tick ──────────────────────────────────────
  useEffect(() => {
    console.log('[V1 timer-tick] effect run', { routine: !!routine, ar: !!ar, isPaused, pausedAt: ar?.pausedAt, awaitingConfirm: ar?.awaitingConfirm, modalVisible });
    // v1.6 #4-C Fix 1 — ar.pausedAt 가드 추가. 위젯 pause 신호 폴링 처리 후 ar.pausedAt 가 갱신됐지만
    // setIsPaused(true) emit 가 race 로 늦으면 tick 진행 → 시간 mismatch. ar.pausedAt 검사로 확실 차단.
    if (!routine || !ar || isPaused || ar.pausedAt !== null || ar.awaitingConfirm || modalVisible) {
      if (tickRef.current) { console.log('[V1 timer-tick] EARLY CLEANUP'); clearInterval(tickRef.current); tickRef.current = null; }
      return;
    }
    console.log('[V1 timer-tick] START interval');
    const update = () => {
      const remainMs = ar.stepEndAt - Date.now();
      setRemainingSec(Math.max(0, Math.ceil(remainMs / 1000)));
      if (remainMs <= 0) handleMissionEnd();
    };
    update();
    tickRef.current = setInterval(update, 500);
    return () => {
      console.log('[V1 timer-tick] EFFECT CLEANUP');
      if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routine, ar, isPaused, modalVisible]);

  // ─── AppState 복귀 시 endAt 기준 재계산 ─────────────────
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && ar && !isPaused && !ar.awaitingConfirm) {
        const remainMs = ar.stepEndAt - Date.now();
        setRemainingSec(Math.max(0, Math.ceil(remainMs / 1000)));
        if (remainMs <= 0) handleMissionEnd();
      }
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ar, isPaused]);

  // ─── 알람 효과 (refs) ─────────────────────────────────────
  const soundRef = useRef<Audio.Sound | null>(null);
  const vibrationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const accelSubRef = useRef<{ remove: () => void } | null>(null);
  const shakeCountRef = useRef(0);
  const lastShakeTimeRef = useRef(0);
  const SHAKE_THRESHOLD = 2.5;
  const SHAKE_COOLDOWN_MS = 400;
  const SHAKE_COUNT_REQUIRED = 2;

  const stopAlarmAudio = useCallback(() => {
    const s = soundRef.current;
    soundRef.current = null;
    if (s) {
      s.stopAsync().catch(() => {});
      s.unloadAsync().catch(() => {});
    }
  }, []);

  const stopAlarmVibe = useCallback(() => {
    if (vibrationIntervalRef.current) {
      clearInterval(vibrationIntervalRef.current);
      vibrationIntervalRef.current = null;
    }
    Vibration.cancel();
  }, []);

  const startAlarmEffects = useCallback(async () => {
    // v1.7 hotfix #13 — AlarmKit native 사운드 ↔ expo-av 사운드 중첩 회피.
    // active 시점 측: AlarmKit fire → JS listener cancelAlarm → AlarmKit stop. 단 Apple 측 fade-out (= ms ~ 수백ms) 후도 사운드 잔존.
    // 200ms 지연 후 expo-av 시작 → AlarmKit fade-out 완료 후 단독 출력 → 중첩 ❌.
    // background 시점 측: JS thread 정지 → 본 호출 자체 ❌. AlarmKit 사운드 단독 정합.
    await new Promise(resolve => setTimeout(resolve, 200));

    const [soundId, alarmRaw, vibRaw] = await Promise.all([
      AsyncStorage.getItem(SETTINGS_KEY.ALARM_SOUND),
      AsyncStorage.getItem(SETTINGS_KEY.ALARM_ENABLED),
      AsyncStorage.getItem(SETTINGS_KEY.VIBRATION_ENABLED),
    ]);
    const alarmEnabled = alarmRaw !== 'false';
    const vibrationEnabled = vibRaw !== 'false';
    const effectiveId = soundId ?? DEFAULT_SOUND_ID;
    const item = ALARM_SOUNDS.find(s => s.id === effectiveId) ?? ALARM_SOUNDS[0];

    if (alarmEnabled) {
      try {
        // ★ 이전 sound 누수 방지 — iOS audio handle 누적 → 몇 번 후 무음 fix
        if (soundRef.current) {
          const prev = soundRef.current;
          soundRef.current = null;
          await prev.stopAsync().catch(() => {});
          await prev.unloadAsync().catch(() => {});
        }
        // 단일 타이머 알람 (AlarmScreen.tsx:472) 과 동일 옵션 — 옵션 축소 시 iOS default mixing 으로
        // AdMob WebView 미디어 재생 중에 ducking/silence 처리됨. DoNotMix 로 audio session 명시 점유 필요.
        await Audio.setAudioModeAsync({
          playsInSilentModeIOS: true,
          staysActiveInBackground: true,
          interruptionModeIOS: InterruptionModeIOS.DoNotMix,
        });
        const { sound } = await Audio.Sound.createAsync(item.source, {
          isLooping: true,
          shouldPlay: true,   // create 와 동시에 즉시 재생 (별도 playAsync 불필요)
          volume: 1.0,
        });
        soundRef.current = sound;
        console.log('[alarm] sound START', item.id);
      } catch (e) {
        console.warn('[alarm] startAlarmEffects fail', e);
      }
    } else {
      console.log('[alarm] alarmEnabled=false → skip');
    }

    if (vibrationEnabled) {
      Vibration.vibrate();
      vibrationIntervalRef.current = setInterval(() => Vibration.vibrate(), 1000);
    }
  }, []);

  // ─── 미션 종료 처리 ──────────────────────────────────────
  const handleMissionEnd = useCallback(async () => {
    if (completingRef.current) return;
    if (modalVisibleRef.current) return;
    if (!routine || !ar) return;

    // v1.6 Phase 12 — endMethod === 'auto' 분기 제거 (auto 모드 영구 미사용).
    completingRef.current = true;
    try {
      const res = await completeCurrentMission();
      if (!res) return;
      if (res.kind === 'end') {
        onClose();
        return;
      }
      if (res.kind === 'advance_auto') {
        setRoutine(res.routine);
        setAr(res.ar);
        return;
      }
      if (res.kind === 'advance_confirm') {
        setRoutine(res.routine);
        setAr(res.ar);
        const isLastStep = res.ar.currentStepIndex + 1 >= res.routine.steps.length;
        if (isLastStep) {
          // v1.6 #12 — 마지막 step (모든 endMethod) = AlarmScreen navigate.
          const sig = `${res.routine.id}-${res.ar.currentStepIndex}`;
          const currentRoute = (navigation as any).getState?.()?.routes?.slice(-1)?.[0]?.name;
          if (lastStepNavigatedFor !== sig && currentRoute !== 'Alarm') {
            lastStepNavigatedFor = sig;
            navigation.navigate('Alarm', {
              fromRoutine: 'last_step',
              routineId: res.routine.id,
              endMethod: res.routine.endMethod,
            });
          }
          return;
        }
        // v1.6 A-1 — 모달 통일. 일반 step = 'next' 모달.
        setModalStage('next');
        setModalVisible(true);
        startAlarmEffects();
        return;
      }
    } finally {
      completingRef.current = false;
    }
  }, [routine, ar, navigation, onClose, startAlarmEffects]);

  // ─── 일시정지 / 재개 ─────────────────────────────────────
  const handlePauseResume = useCallback(async () => {
    if (!routine || !ar) return;
    if (isPaused) {
      const next = await resumeRoutine();
      if (next) { setAr(next); setIsPaused(false); }
    } else {
      const next = await pauseRoutine();
      if (next) { setAr(next); setIsPaused(true); }
    }
  }, [routine, ar, isPaused]);

  // ─── 길게 누르기 게이지 (1초 hold → 정지) ─────────────
  const longPressAnim = useRef(new Animated.Value(0)).current;
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFiredRef = useRef(false);
  const LONG_PRESS_DURATION = 1000;
  const BTN_SIZE = 72;
  const BTN_RADIUS = 42;
  const BTN_CIRCUMFERENCE = 2 * Math.PI * BTN_RADIUS;

  const handlePrimaryPressIn = useCallback(() => {
    longPressFiredRef.current = false;
    longPressTimerRef.current = setTimeout(() => {
      longPressAnim.setValue(0);
      Animated.timing(longPressAnim, {
        toValue: 1,
        duration: LONG_PRESS_DURATION,
        useNativeDriver: false,
      }).start();
      longPressTimerRef.current = setTimeout(async () => {
        longPressFiredRef.current = true;
        longPressAnim.setValue(0);
        await stopRoutine();
        onClose();
      }, LONG_PRESS_DURATION);
    }, 300);
  }, [longPressAnim, onClose]);

  const handlePrimaryPressOut = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    longPressAnim.stopAnimation();
    Animated.timing(longPressAnim, { toValue: 0, duration: 150, useNativeDriver: false }).start();
  }, [longPressAnim]);

  useEffect(() => {
    return () => {
      if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    };
  }, []);

  const longPressDashoffset = longPressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [BTN_CIRCUMFERENCE, 0],
  });

  // ─── Modal handlers ──────────────────────────────────────
  const handleAlarmDismiss = useCallback(async () => {
    stopAlarmAudio();
    stopAlarmVibe();
    if (!routine || !ar) return;
    if (ar.currentStepIndex + 1 >= routine.steps.length) {
      setModalVisible(false);
      setModalStage('alarm');
      const res = await confirmAndAdvance();
      if (!res || res.kind === 'end') {
        onClose();
      }
      return;
    }
    setModalStage('next');
  }, [routine, ar, onClose, stopAlarmAudio, stopAlarmVibe]);

  const handleStartNext = useCallback(async () => {
    if (completingRef.current) return;
    completingRef.current = true;
    try {
      stopAlarmAudio();
      stopAlarmVibe();
      const res = await confirmAndAdvance();
      if (!res || res.kind === 'end') {
        setModalVisible(false);
        setModalStage('alarm');
        onClose();
        return;
      }
      if (res.kind === 'advance_auto') {
        setRoutine(res.routine);
        setAr(res.ar);
        setModalVisible(false);
        setModalStage('alarm');
      }
    } finally {
      completingRef.current = false;
    }
  }, [onClose]);

  const handleStopFromModal = useCallback(async () => {
    if (completingRef.current) return;
    completingRef.current = true;
    try {
      stopAlarmAudio();
      stopAlarmVibe();
      await stopRoutine();
      setModalVisible(false);
      setModalStage('alarm');
      onClose();
    } finally {
      completingRef.current = false;
    }
  }, [onClose, stopAlarmAudio, stopAlarmVibe]);

  // v1.6 Phase 12 — handleAutoNow 함수 제거 (auto 모드 영구 미사용 + 무한 루프 영역 함께 제거).

  // v1.6 Phase 12 — handleCompleteConfirm 제거 ('complete' stage 미사용).

  // 흔들기 감지 — v1.6 A-1: 모달 통일 후 'next' 단계 안에서 흔들기 = 자동 진행 트리거.
  // 일반 step = "다음 루틴 시작" 누른 효과. 마지막 step = "루틴 완료" 누른 효과 (handleStartNext 가 'end' 분기 → onClose).
  useEffect(() => {
    if (!modalVisible || modalStage !== 'next' || !routine || routine.endMethod !== 'shake') return;
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
          handleStartNext();
        }
      }
    });
    accelSubRef.current = sub;
    return () => {
      sub.remove();
      accelSubRef.current = null;
    };
  }, [modalVisible, modalStage, routine, handleStartNext]);

  // v1.6 — 위젯 / 잠금 alerting 측 외부 다음 진행 / 정지 → app modal dismiss + 사운드 stop + state sync.
  useEffect(() => {
    const subAdvance = DeviceEventEmitter.addListener('routineAdvancedExternally', async (payload: { routineId: string }) => {
      if (!routineId || payload?.routineId !== routineId) return;
      stopAlarmAudio();
      stopAlarmVibe();
      setModalVisible(false);
      // routine state 측 갱신 — 다음 step UI 즉시 표시.
      const nextAr = await loadActiveRoutine();
      if (nextAr) {
        setAr(nextAr);
        const routines = await loadRoutines();
        const r = routines.find(x => x.id === nextAr.routineId);
        if (r) setRoutine(r);
      }
    });
    const subCleared = DeviceEventEmitter.addListener('routineClearedExternally', (payload: { routineId: string }) => {
      if (!routineId || payload?.routineId !== routineId) return;
      stopAlarmAudio();
      stopAlarmVibe();
      setModalVisible(false);
      onClose();
    });
    // v1.6 #4-C Fix 3 — 위젯 측 Pause / Resume 처리 후 RN ar 동기화.
    // routineId match 가드 제거: payload.routineId !== local routineId 라도 AsyncStorage 의 ar 신뢰
    //   (active routine 단일 invariant 보장 → mismatch 케이스 = stale routineId 차단 무관, ar 갱신 우선).
    const subPaused = DeviceEventEmitter.addListener('routinePausedExternally', async (_payload: { routineId: string }) => {
      const nextAr = await loadActiveRoutine();
      if (nextAr && nextAr.routineId === routineId) {
        setAr(nextAr);
        setIsPaused(nextAr.pausedAt !== null);
      }
    });
    const subResumed = DeviceEventEmitter.addListener('routineResumedExternally', async (_payload: { routineId: string }) => {
      const nextAr = await loadActiveRoutine();
      if (nextAr && nextAr.routineId === routineId) {
        setAr(nextAr);
        setIsPaused(nextAr.pausedAt !== null);
      }
    });
    return () => {
      subAdvance.remove();
      subCleared.remove();
      subPaused.remove();
      subResumed.remove();
    };
  }, [routineId, onClose, stopAlarmAudio, stopAlarmVibe]);

  // unmount cleanup
  useEffect(() => {
    return () => {
      stopAlarmAudio();
      stopAlarmVibe();
      accelSubRef.current?.remove();
      accelSubRef.current = null;
    };
  }, [stopAlarmAudio, stopAlarmVibe]);

  // ─── UI ──────────────────────────────────────────────────
  if (!routine || !ar) {
    return null;
  }

  const step = routine.steps[ar.currentStepIndex];
  const missionLabel = step?.name ?? '';
  const m = Math.floor(remainingSec / 60);
  const s = remainingSec % 60;
  const hasNext = ar.currentStepIndex + 1 < routine.steps.length;

  return (
    <View style={styles.container}>
      <View style={styles.missionBox}>
        <Text style={styles.missionStepIdx}>
          {ar.currentStepIndex + 1} / {routine.steps.length}
        </Text>
        <Text style={styles.missionName} numberOfLines={2}>{missionLabel}</Text>
      </View>

      <Text style={styles.timerText}>
        {String(m).padStart(2, '0')}:{String(s).padStart(2, '0')}
      </Text>

      <View style={styles.controls}>
        <View style={{ width: BTN_SIZE + 16, height: BTN_SIZE + 16, alignItems: 'center', justifyContent: 'center' }}>
          <Svg width={BTN_SIZE + 16} height={BTN_SIZE + 16} style={{ position: 'absolute' }}>
            <SvgCircle
              cx={(BTN_SIZE + 16) / 2}
              cy={(BTN_SIZE + 16) / 2}
              r={BTN_RADIUS}
              fill="none"
              stroke={colors.outlineVariant}
              strokeWidth={3}
              opacity={0.3}
            />
            <AnimatedSvgCircle
              cx={(BTN_SIZE + 16) / 2}
              cy={(BTN_SIZE + 16) / 2}
              r={BTN_RADIUS}
              fill="none"
              stroke={colors.primary}
              strokeWidth={3}
              strokeDasharray={BTN_CIRCUMFERENCE}
              strokeDashoffset={longPressDashoffset}
              strokeLinecap="round"
              rotation="-90"
              origin={`${(BTN_SIZE + 16) / 2}, ${(BTN_SIZE + 16) / 2}`}
            />
          </Svg>
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => { if (longPressFiredRef.current) return; handlePauseResume(); }}
            onPressIn={handlePrimaryPressIn}
            onPressOut={handlePrimaryPressOut}
            activeOpacity={0.85}
          >
            <MaterialIcons
              name={isPaused ? 'play-arrow' : 'pause'}
              size={36}
              color={colors.onPrimary}
            />
          </TouchableOpacity>
        </View>
      </View>

      {hasNext && (
        <ScrollView
          style={{ marginTop: 16, maxHeight: 220 }}
          contentContainerStyle={{ paddingBottom: 8 }}
          showsVerticalScrollIndicator={false}
          nestedScrollEnabled
        >
          {routine.steps.map((s2, idx) => {
            if (idx <= ar.currentStepIndex) return null;
            return (
              <View
                key={s2.id}
                style={{
                  backgroundColor: isDark ? colors.surfaceContainerLow : '#d1dceaff',
                  borderRadius: 12,
                  padding: 14,
                  marginBottom: 8,
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Text
                    style={{ flex: 1, fontSize: 15, fontWeight: '700', color: colors.onBackground }}
                    numberOfLines={1}
                  >
                    {s2.name}
                  </Text>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: colors.onBackground }}>
                    {formatDurationLabel(s2.durationSeconds)}
                  </Text>
                </View>
              </View>
            );
          })}
        </ScrollView>
      )}

      {/* tap/shake/auto 알람 Modal */}
      <Modal visible={modalVisible} transparent animationType="fade" onRequestClose={() => {}}>
        <View style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.4)',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
        }}>
          <View style={{
            width: '100%',
            maxWidth: 360,
            backgroundColor: colors.background,
            borderRadius: 20,
            paddingVertical: 36,
            paddingHorizontal: 24,
            alignItems: 'center',
          }}>
            {modalStage === 'alarm' && routine && ar && (
              <>
                <View style={{
                  width: 96, height: 96, borderRadius: 48,
                  backgroundColor: colors.primary,
                  alignItems: 'center', justifyContent: 'center',
                  marginBottom: 24,
                }}>
                  <MaterialIcons name="notifications-active" size={56} color={colors.onPrimary} />
                </View>
                <Text style={{ fontSize: 14, color: colors.secondary, marginBottom: 6 }}>{t('routine.run.alarmTitle', { defaultValue: '루틴 완료' })}</Text>
                <Text
                  style={{ fontSize: 24, fontWeight: '800', color: colors.onBackground, marginBottom: 32, textAlign: 'center' }}
                  numberOfLines={2}
                >
                  {routine.steps[ar.currentStepIndex]?.name ?? ''}
                </Text>
                {routine.endMethod === 'shake' ? (
                  <Text style={{ fontSize: 14, color: colors.secondary, fontWeight: '700', marginBottom: 12 }}>
                    흔들어서 계속
                  </Text>
                ) : (
                  <TouchableOpacity
                    onPress={handleAlarmDismiss}
                    style={{
                      width: '100%',
                      backgroundColor: colors.primary,
                      paddingVertical: 16,
                      borderRadius: 14,
                      alignItems: 'center',
                    }}
                  >
                    <Text style={{ fontSize: 16, fontWeight: '800', color: colors.onPrimary }}>{t('routine.run.dismissAlarm', { defaultValue: '알람 종료' })}</Text>
                  </TouchableOpacity>
                )}
              </>
            )}

            {modalStage === 'next' && routine && ar && (() => {
              const nextStep = routine.steps[ar.currentStepIndex + 1];
              const willEnd = !nextStep;
              return (
                <>
                  <View style={{
                    width: 96, height: 96, borderRadius: 48,
                    backgroundColor: colors.primary,
                    alignItems: 'center', justifyContent: 'center',
                    marginBottom: 24,
                  }}>
                    <MaterialIcons name="check" size={56} color={colors.onPrimary} />
                  </View>
                  {willEnd ? (
                    <>
                      <Text
                        style={{ fontSize: 28, fontWeight: '800', color: colors.onBackground, marginBottom: 16, textAlign: 'center' }}
                        numberOfLines={2}
                      >
                        {t('routine.run.completeTitle', { defaultValue: '루틴 완료' })}
                      </Text>
                      <Text style={{ fontSize: 14, color: colors.secondary, marginBottom: 20 }}>
                        {t('routine.run.completeQuestion', { defaultValue: '모든 루틴을 완료했습니다' })}
                      </Text>
                      <TouchableOpacity
                        onPress={handleStartNext}
                        style={{
                          width: '100%',
                          backgroundColor: colors.primary,
                          paddingVertical: 16,
                          borderRadius: 14,
                          alignItems: 'center',
                        }}
                      >
                        <Text style={{ fontSize: 16, fontWeight: '800', color: colors.onPrimary }}>{t('routine.run.completeRoutine', { defaultValue: '루틴 완료' })}</Text>
                      </TouchableOpacity>
                    </>
                  ) : (
                    <>
                      <Text style={{ fontSize: 14, color: colors.secondary, marginBottom: 6 }}>{t('routine.run.nextLabel', { defaultValue: '다음' })}</Text>
                      <Text
                        style={{ fontSize: 28, fontWeight: '800', color: colors.onBackground, marginBottom: 16, textAlign: 'center' }}
                        numberOfLines={2}
                      >
                        {nextStep!.name}
                      </Text>
                      <Text style={{ fontSize: 14, color: colors.secondary, marginBottom: 20 }}>
                        {t('routine.run.nextQuestion', { defaultValue: '다음 루틴 진행하겠습니까?' })}
                      </Text>
                      <TouchableOpacity
                        onPress={handleStartNext}
                        style={{
                          width: '100%',
                          backgroundColor: colors.primary,
                          paddingVertical: 16,
                          borderRadius: 14,
                          alignItems: 'center',
                          marginBottom: 16,
                        }}
                      >
                        <Text style={{ fontSize: 16, fontWeight: '800', color: colors.onPrimary }}>{t('routine.run.startNext', { defaultValue: '다음 루틴 시작' })}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={handleStopFromModal}>
                        <Text style={{ fontSize: 14, fontWeight: '700', color: colors.error }}>{t('routine.run.stop', { defaultValue: '루틴 정지' })}</Text>
                      </TouchableOpacity>
                    </>
                  )}
                </>
              );
            })()}

            {/* v1.6 — 'nextCountdown' / 'auto' / 'complete' modal UI 제거. "다음 루틴 시작" 즉시 진행. */}
          </View>
        </View>
      </Modal>
    </View>
  );
}

async function askUser(
  title: string,
  body: string,
  proceedLabel: string,
  t: ReturnType<typeof useTranslation>['t'],
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    Alert.alert(
      title,
      body,
      [
        { text: t('common.cancel', { defaultValue: '취소' }), style: 'cancel', onPress: () => resolve(false) },
        { text: proceedLabel, style: 'destructive', onPress: () => resolve(true) },
      ],
      { cancelable: false },
    );
  });
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: {
    paddingTop: 12,
    paddingHorizontal: 4,
  },
  missionBox: { alignItems: 'center', gap: 4 },
  missionStepIdx: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.secondary,
    letterSpacing: 1,
  },
  missionName: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.onBackground,
    textAlign: 'center',
  },
  timerText: {
    fontSize: 56,
    fontWeight: '800',
    color: colors.primary,
    textAlign: 'center',
    marginTop: 8,
    letterSpacing: -1.5,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  primaryBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
});
