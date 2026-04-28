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
import { Routine, ActiveRoutine } from '../constants/routines';
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

// tap/shake/camera 모드의 'nextCountdown' stage 카운트다운 시간 (초). 사용자 prep 시간.
const NEXT_COUNTDOWN_SEC = 5;

// camera 모드 awaitingConfirm 시 RoutineAlarm 자동 진입 — 같은 step 의 같은 awaitingConfirm 세션이면 1회만 navigate.
// (사용자가 RoutineAlarm 에서 dismiss 후 RoutineList 로 돌아왔을 때 무한 loop 차단)
// sig: routineId + startedAt + currentStepIndex. step 진행 / 새 routine 시작 시 sig 변경 → 재진입 허용.
let cameraScanNavigatedFor: string | null = null;

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
  const [modalStage, setModalStage] = useState<'alarm' | 'next' | 'nextCountdown'>('alarm');
  const [autoCountdown, setAutoCountdown] = useState(60);
  const modalVisibleRef = useRef(false);
  useEffect(() => { modalVisibleRef.current = modalVisible; }, [modalVisible]);

  // ─── 마운트: controller.startRoutine ─────────────────────
  // init 중복 호출 차단 — StrictMode 또는 빠른 unmount/remount 시 askUser dialog 가 두 번 뜨는 버그 방지
  const initStartedRef = useRef(false);
  useEffect(() => {
    if (initStartedRef.current) return;
    initStartedRef.current = true;
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
        const proceed = await askUser(
          t('routine.timerConflictTitle', { defaultValue: '진행 중인 타이머' }),
          t('routine.timerConflictBody', { defaultValue: '진행 중인 단일 타이머가 있습니다. 취소하고 루틴을 시작하시겠어요?' }),
          t('routine.timerConflictProceed', { defaultValue: '루틴 시작' }),
          t,
        );
        if (!proceed) { onClose(); return; }
        const retry = await startRoutine(routineId, { overrideTimer: true });
        applyStart(retry);
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
          if (r.routine.endMethod === 'camera') {
            const sig = `${r.routine.id}-${r.ar.startedAt}-${r.ar.currentStepIndex}`;
            if (cameraScanNavigatedFor !== sig) {
              cameraScanNavigatedFor = sig;
              // App.tsx 콜드 스타트 핸들러가 이미 RoutineAlarm 로 navigate 했으면 skip (이중 push 차단)
              const currentRoute = (navigation as any).getState?.()?.routes?.slice(-1)?.[0]?.name;
              if (currentRoute !== 'RoutineAlarm') {
                navigation.navigate('RoutineAlarm', { routineId: r.routine.id });
              }
            }
          } else {
            setModalStage('alarm');
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
    console.log('[V1 timer-tick] effect run', { routine: !!routine, ar: !!ar, isPaused, awaitingConfirm: ar?.awaitingConfirm, modalVisible });
    if (!routine || !ar || isPaused || ar.awaitingConfirm || modalVisible) {
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
        if (res.routine.endMethod === 'camera') {
          navigation.navigate('RoutineAlarm', { routineId: res.routine.id });
        } else {
          setModalStage('alarm');
          setModalVisible(true);
          startAlarmEffects();
        }
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

  // ─── 'nextCountdown' stage 게이지 — 5초 동안 0→1 선형 보간 (depletion 시각화)
  const nextCountdownAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (modalStage !== 'nextCountdown') return;
    nextCountdownAnim.setValue(0);
    const animation = Animated.timing(nextCountdownAnim, {
      toValue: 1,
      duration: NEXT_COUNTDOWN_SEC * 1000,
      useNativeDriver: false, // SVG strokeDashoffset 은 native driver 미지원
    });
    animation.start();
    return () => animation.stop();
  }, [modalStage, nextCountdownAnim]);

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

  // 'next' → 'nextCountdown' 전환. tap/shake/camera 모드 prep 시간 (NEXT_COUNTDOWN_SEC 초) 노출.
  const handleStartNextWithCountdown = useCallback(() => {
    setAutoCountdown(NEXT_COUNTDOWN_SEC);
    setModalStage('nextCountdown');
  }, []);

  // 'nextCountdown' → 'next' preview 복귀. 사용자가 카운트다운 도중 취소 시.
  const handleCancelCountdown = useCallback(() => {
    setModalStage('next');
  }, []);

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

  // v1.6 Phase 12 — 'auto' / 'complete' stage 제거. 'nextCountdown' 만 처리 (tap/shake/camera 모드 prep 카운트다운).
  useEffect(() => {
    if (!modalVisible) return;
    if (modalStage !== 'nextCountdown') return;
    if (autoCountdown <= 0) {
      handleStartNext();
      return;
    }
    const id = setTimeout(() => setAutoCountdown(c => c - 1), 1000);
    return () => clearTimeout(id);
  }, [modalVisible, modalStage, autoCountdown, handleStartNext]);

  // 흔들기 감지
  useEffect(() => {
    if (!modalVisible || modalStage !== 'alarm' || !routine || routine.endMethod !== 'shake') return;
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
          handleAlarmDismiss();
        }
      }
    });
    accelSubRef.current = sub;
    return () => {
      sub.remove();
      accelSubRef.current = null;
    };
  }, [modalVisible, modalStage, routine, handleAlarmDismiss]);

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
              if (!nextStep) return null;
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
                  <Text style={{ fontSize: 14, color: colors.secondary, marginBottom: 6 }}>{t('routine.run.nextLabel', { defaultValue: '다음' })}</Text>
                  <Text
                    style={{ fontSize: 28, fontWeight: '800', color: colors.onBackground, marginBottom: 16, textAlign: 'center' }}
                    numberOfLines={2}
                  >
                    {nextStep.name}
                  </Text>
                  <Text style={{ fontSize: 14, color: colors.secondary, marginBottom: 20 }}>
                    {t('routine.run.nextQuestion', { defaultValue: '다음 루틴 진행하겠습니까?' })}
                  </Text>
                  <TouchableOpacity
                    onPress={handleStartNextWithCountdown}
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
              );
            })()}

            {modalStage === 'nextCountdown' && (() => {
              const RING_SIZE = 120;
              const RING_RADIUS = 50;
              const RING_C = 2 * Math.PI * RING_RADIUS;
              // depletion: 0 (full) → 1 (empty). dashoffset 으로 stroke 가시 영역 축소.
              const ringDashoffset = nextCountdownAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [0, RING_C],
              });
              return (
                <>
                  <View style={{
                    width: RING_SIZE, height: RING_SIZE,
                    alignItems: 'center', justifyContent: 'center',
                    marginBottom: 24,
                  }}>
                    <Svg width={RING_SIZE} height={RING_SIZE} style={{ position: 'absolute' }}>
                      <SvgCircle
                        cx={RING_SIZE / 2}
                        cy={RING_SIZE / 2}
                        r={RING_RADIUS}
                        fill="none"
                        stroke={colors.outlineVariant}
                        strokeWidth={8}
                        opacity={0.3}
                      />
                      <AnimatedSvgCircle
                        cx={RING_SIZE / 2}
                        cy={RING_SIZE / 2}
                        r={RING_RADIUS}
                        fill="none"
                        stroke={colors.primary}
                        strokeWidth={8}
                        strokeDasharray={RING_C}
                        strokeDashoffset={ringDashoffset}
                        strokeLinecap="round"
                        rotation="-90"
                        origin={`${RING_SIZE / 2}, ${RING_SIZE / 2}`}
                      />
                    </Svg>
                    <Text style={{ fontSize: 40, fontWeight: '800', color: colors.primary }}>
                      {autoCountdown}
                    </Text>
                  </View>
                  <Text style={{
                    fontSize: 16, fontWeight: '700', color: colors.onBackground,
                    marginBottom: 28, textAlign: 'center',
                  }}>
                    {t('routine.run.nextCountdownText', { n: autoCountdown, defaultValue: `${autoCountdown}초 후 다음 루틴이 시작됩니다` })}
                  </Text>
                  <TouchableOpacity onPress={handleCancelCountdown}>
                    <Text style={{ fontSize: 14, fontWeight: '700', color: colors.error }}>
                      {t('routine.run.cancel', { defaultValue: '취소' })}
                    </Text>
                  </TouchableOpacity>
                </>
              );
            })()}

            {/* v1.6 Phase 12 — 'auto' / 'complete' modal UI 제거 (auto 모드 영구 미사용). */}
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
