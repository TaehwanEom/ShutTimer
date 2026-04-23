// v1.6 리팩토링: 상태 전환은 routineController 위임.
// 이 스크린은 사운드/진동 + tap/shake dismiss UI + 사용자 "다음 미션" 버튼만 담당.
// 배경 알림으로 직접 진입한 경우 controller.completeCurrentMission()으로 세션 기록 등 자동 처리.

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  Vibration,
  AppState,
  BackHandler,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { Audio, InterruptionModeIOS } from 'expo-av';
import { Accelerometer } from 'expo-sensors';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTranslation } from 'react-i18next';
import { RootStackParamList } from '../../App';
import { useTheme } from '../context/ThemeContext';
import { ThemeColors } from '../constants/theme';
import {
  Routine,
  ActiveRoutine,
  loadRoutines,
  loadActiveRoutine,
} from '../constants/routines';
import {
  completeCurrentMission,
  confirmAndAdvance,
  stopRoutine,
} from '../utils/routineController';
import { ALARM_SOUNDS, DEFAULT_SOUND_ID } from '../constants/sounds';
import { MISSION_LABEL } from '../constants/missionIcons';
import { SETTINGS_KEY } from '../constants/settings';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'RoutineAlarm'>;
  route: RouteProp<RootStackParamList, 'RoutineAlarm'>;
};

const REST_KEY = 'rest';
const SHAKE_THRESHOLD = 2.5;
const SHAKE_COOLDOWN_MS = 400;
const SHAKE_COUNT_REQUIRED = 2;

export default function RoutineAlarmScreen({ navigation, route }: Props) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = makeStyles(colors);

  const [routine, setRoutine] = useState<Routine | null>(null);
  const [ar, setAr] = useState<ActiveRoutine | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const soundRef = useRef<Audio.Sound | null>(null);
  const vibrationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const shakeCountRef = useRef(0);
  const lastShakeTimeRef = useRef(0);
  const accelSubRef = useRef<{ remove: () => void } | null>(null);

  // ─── 마운트: 배경 경로 여부 감지하여 세션 기록 보완 ────
  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      const list = await loadRoutines();
      const target = list.find(r => r.id === route.params.routineId);
      let existing = await loadActiveRoutine();
      if (!target || !existing || cancelled) {
        navigation.goBack();
        return;
      }

      // 배경 알림으로 직접 진입한 경로면 awaitingConfirm=false 상태.
      // controller.completeCurrentMission()이 세션 기록 + awaitingConfirm=true 저장.
      if (!existing.awaitingConfirm) {
        const res = await completeCurrentMission();
        if (res && res.kind === 'end') {
          // 이론상 autoAdvance=false + 모든 미션 종료 → confirmAndAdvance에서 end 처리하지만
          // 안전장치로 여기서도 Home 복귀
          navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
          return;
        }
        existing = await loadActiveRoutine();
        if (!existing) {
          navigation.goBack();
          return;
        }
      }

      setRoutine(target);
      setAr(existing);

      // 사운드/진동 시작
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
        Audio.setAudioModeAsync({
          playsInSilentModeIOS: true,
          staysActiveInBackground: true,
          interruptionModeIOS: InterruptionModeIOS.DoNotMix,
        })
          .then(() => Audio.Sound.createAsync(item.source, { isLooping: true }))
          .then(({ sound }) => {
            if (cancelled) {
              sound.unloadAsync().catch(() => {});
              return;
            }
            soundRef.current = sound;
            sound.playAsync().catch(() => {});
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

  // ─── 흔들기 감지 ─────────────────────────────────────────
  useEffect(() => {
    if (!routine || dismissed || routine.dismissMethod !== 'shake') return;
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
        navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
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

      // Audio 재시작
      const s = soundRef.current;
      if (s) {
        s.getStatusAsync().then((status: any) => {
          if (status?.isLoaded && !status.isPlaying) {
            Audio.setAudioModeAsync({
              playsInSilentModeIOS: true,
              staysActiveInBackground: true,
              interruptionModeIOS: InterruptionModeIOS.DoNotMix,
            })
              .then(() => s.playAsync())
              .catch(() => {});
          }
        }).catch(() => {});
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

  // ─── "다음 미션 시작" → controller.confirmAndAdvance ──
  const handleStartNext = useCallback(async () => {
    const res = await confirmAndAdvance();
    if (!res) {
      navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
      return;
    }
    if (res.kind === 'end') {
      navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
      return;
    }
    // advance_auto (확인 후 진행도 다음 미션 준비는 auto와 동일한 구조)
    navigation.reset({
      index: 1,
      routes: [
        { name: 'Home' },
        { name: 'RoutineRun', params: { routineId: res.routine.id } },
      ],
    });
  }, [navigation]);

  // ─── 정리 헬퍼 ───────────────────────────────────────────
  const stopAudio = () => {
    const s = soundRef.current;
    soundRef.current = null;
    if (s) {
      s.stopAsync().catch(() => {});
      s.unloadAsync().catch(() => {});
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
    stopAudio();
    stopVibe();
    await stopRoutine();
    navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
  }, [navigation]);

  if (!routine || !ar) {
    return <SafeAreaView style={styles.container} />;
  }

  const nextIdx = (ar.currentStepIndex + 1) % routine.missions.length;
  const wouldAdvanceLoop = ar.currentStepIndex + 1 >= routine.missions.length;
  const isLastLoop = ar.currentLoop >= routine.loopCount;
  const willEnd = wouldAdvanceLoop && isLastLoop;
  const nextStep = willEnd ? null : routine.missions[nextIdx];
  const nextLabel = nextStep
    ? (nextStep.missionKey === REST_KEY
        ? t('routine.restLabel', { defaultValue: '휴식' })
        : MISSION_LABEL[nextStep.missionKey] ?? nextStep.missionKey)
    : '';

  return (
    <SafeAreaView style={styles.container}>
      {!dismissed ? (
        <TouchableOpacity
          style={styles.dismissArea}
          activeOpacity={0.9}
          onPress={routine.dismissMethod === 'tap' ? handleDismiss : undefined}
        >
          <MaterialIcons name="alarm" size={96} color={colors.primary} />
          <Text style={styles.completeText}>
            {t('routine.missionComplete', { defaultValue: '미션 완료' })}
          </Text>
          <Text style={styles.dismissHint}>
            {routine.dismissMethod === 'tap'
              ? t('routine.tapToDismiss', { defaultValue: '화면을 탭하여 계속' })
              : t('routine.shakeToDismiss', { defaultValue: '흔들어서 계속' })}
          </Text>
        </TouchableOpacity>
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
                {nextStep?.durationMinutes ?? 0} {t('routine.minutesUnit', { defaultValue: '분' })}
              </Text>
              <TouchableOpacity style={styles.primaryBtn} onPress={handleStartNext}>
                <Text style={styles.primaryBtnText}>
                  {t('routine.startNext', { defaultValue: '다음 미션 시작' })}
                </Text>
              </TouchableOpacity>
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
