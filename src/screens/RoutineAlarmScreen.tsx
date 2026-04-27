// v1.6 Phase 6: 신 데이터 모델 + endMethod 4분기 적용. 상태 전환은 routineController 위임.
// 사운드/진동 + endMethod별 dismiss UI + "다음 step 시작" 버튼.
// 배경 알림으로 직접 진입한 경우 controller.completeCurrentMission()으로 세션 기록 등 자동 처리.
// camera 모드: 랜덤 MISSION_POOL 1개 노출 + 탭 dismiss (v1.5 AlarmCameraMode 통합은 Phase 6.5에서 별도).

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
  Image,
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
  getRoutineMode,
} from '../constants/routines';
import {
  completeCurrentMission,
  confirmAndAdvance,
  stopRoutine,
} from '../utils/routineController';
import { ALARM_SOUNDS, DEFAULT_SOUND_ID } from '../constants/sounds';
import { MISSION_POOL, MISSION_EMOJI, MISSION_LABEL } from '../constants/missionIcons';
import { SETTINGS_KEY } from '../constants/settings';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'RoutineAlarm'>;
  route: RouteProp<RootStackParamList, 'RoutineAlarm'>;
};

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
  // camera 모드: 랜덤 MISSION_POOL 1개 — mount 시 한 번 픽
  const [cameraMission, setCameraMission] = useState<string | null>(null);
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

      // 이중 가드 — endMethod !== 'camera' 면 RoutineList 로 redirect (inline 진행).
      // (App.tsx 알림 핸들러/콜드 스타트가 이미 분기하지만, 예측 못한 경로 fallback)
      if (target.endMethod !== 'camera') {
        navigation.replace('RoutineList');
        return;
      }

      // 배경 알림으로 직접 진입한 경로면 awaitingConfirm=false 상태.
      // controller.completeCurrentMission()이 세션 기록 + awaitingConfirm=true 저장.
      if (!existing.awaitingConfirm) {
        const res = await completeCurrentMission();
        if (res && res.kind === 'end') {
          // 마지막 step 완료 → 루틴이 속한 탭 (예약/일반) 으로 RoutineList 복귀
          const tab = getRoutineMode(target);
          navigation.reset({ index: 1, routes: [{ name: 'Home' }, { name: 'RoutineList', params: { initialTab: tab } }] });
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

      // camera 모드면 랜덤 미션 픽 (1회)
      if (target.endMethod === 'camera' && MISSION_POOL.length > 0) {
        const pick = MISSION_POOL[Math.floor(Math.random() * MISSION_POOL.length)];
        setCameraMission(pick);
      }

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
        navigation.reset({ index: 1, routes: [{ name: 'Home' }, { name: 'RoutineList', params: tab ? { initialTab: tab } : undefined }] });
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
    const tab = routine ? getRoutineMode(routine) : undefined;
    const params = tab ? { initialTab: tab } : undefined;
    if (!res) {
      // fallback — 루틴이 속한 탭으로 RoutineList 복귀
      navigation.reset({ index: 1, routes: [{ name: 'Home' }, { name: 'RoutineList', params }] });
      return;
    }
    if (res.kind === 'end') {
      // 마지막 step 완료 → 루틴이 속한 탭으로 RoutineList 복귀
      navigation.reset({ index: 1, routes: [{ name: 'Home' }, { name: 'RoutineList', params }] });
      return;
    }
    // advance_auto — 다음 step 부터는 RoutineList 의 inline 진행 영역에서 처리
    navigation.reset({
      index: 1,
      routes: [
        { name: 'Home' },
        { name: 'RoutineList', params },
      ],
    });
  }, [navigation, routine]);

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
    const tab = routine ? getRoutineMode(routine) : undefined;
    const params = tab ? { initialTab: tab } : undefined;
    navigation.reset({ index: 1, routes: [{ name: 'Home' }, { name: 'RoutineList', params }] });
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
        <TouchableOpacity style={styles.dismissArea} activeOpacity={0.9} onPress={handleDismiss}>
          <MaterialIcons name="alarm" size={96} color={colors.primary} />
          <Text style={styles.completeText}>{t('routine.missionComplete', { defaultValue: '미션 완료' })}</Text>
          <Text style={styles.dismissHint}>{t('routine.tapToDismiss', { defaultValue: '화면을 탭하여 계속' })}</Text>
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
    if (routine.endMethod === 'camera' && cameraMission) {
      // TODO Phase 6.5: AlarmCameraMode 통합으로 실제 사진 인식 dismiss로 교체.
      // 현재는 랜덤 미션 표시 + 탭 dismiss (임시).
      const emoji = MISSION_EMOJI[cameraMission];
      const label = MISSION_LABEL[cameraMission] ?? cameraMission;
      return (
        <TouchableOpacity style={styles.dismissArea} activeOpacity={0.9} onPress={handleDismiss}>
          {emoji && <Image source={emoji} style={styles.cameraEmoji} resizeMode="contain" />}
          <Text style={styles.completeText}>{label}</Text>
          <Text style={styles.dismissHint}>
            {t('routine.cameraScanHint', { defaultValue: '대상을 찾아 사진 촬영 (임시: 탭하여 계속)' })}
          </Text>
        </TouchableOpacity>
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

  return (
    <SafeAreaView style={styles.container}>
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
