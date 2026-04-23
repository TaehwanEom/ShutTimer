// v1.6 리팩토링: 상태 전환은 routineController 위임.
// 이 스크린은 UI + tick 카운트다운 + 사용자 액션 → controller 호출 만 담당.

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  Alert,
  AppState,
  BackHandler,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { RootStackParamList } from '../../App';
import { useTheme } from '../context/ThemeContext';
import { ThemeColors } from '../constants/theme';
import { Routine, ActiveRoutine } from '../constants/routines';
import {
  startRoutine,
  completeCurrentMission,
  pauseRoutine,
  resumeRoutine,
  stopRoutine,
} from '../utils/routineController';
import { MISSION_LABEL } from '../constants/missionIcons';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'RoutineRun'>;
  route: RouteProp<RootStackParamList, 'RoutineRun'>;
};

const REST_KEY = 'rest';

export default function RoutineRunScreen({ navigation, route }: Props) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = makeStyles(colors);

  const [routine, setRoutine] = useState<Routine | null>(null);
  const [ar, setAr] = useState<ActiveRoutine | null>(null);
  const [remainingSec, setRemainingSec] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // 미션 종료 중복 진입 가드
  const completingRef = useRef(false);

  // ─── 마운트: controller.startRoutine ─────────────────────
  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      const res = await startRoutine(route.params.routineId);
      if (cancelled) return;

      if (res.kind === 'not_found') {
        Alert.alert(t('routine.notFound', { defaultValue: '루틴을 찾을 수 없습니다' }));
        navigation.goBack();
        return;
      }
      if (res.kind === 'needs_timer_override') {
        const proceed = await askUser(
          t('routine.timerConflictTitle', { defaultValue: '진행 중인 타이머' }),
          t('routine.timerConflictBody', { defaultValue: '진행 중인 단일 타이머가 있습니다. 취소하고 루틴을 시작하시겠어요?' }),
          t('routine.timerConflictProceed', { defaultValue: '루틴 시작' }),
          t
        );
        if (!proceed) { navigation.goBack(); return; }
        const retry = await startRoutine(route.params.routineId, { overrideTimer: true });
        applyStart(retry);
        return;
      }
      if (res.kind === 'needs_override') {
        const proceed = await askUser(
          t('routine.routineConflictTitle', { defaultValue: '진행 중인 루틴' }),
          t('routine.routineConflictBody', { defaultValue: '다른 루틴이 진행 중입니다. 중단하고 이 루틴을 시작하시겠어요?' }),
          t('routine.routineConflictProceed', { defaultValue: '새 루틴 시작' }),
          t
        );
        if (!proceed) { navigation.goBack(); return; }
        const retry = await startRoutine(route.params.routineId, { overrideActive: true });
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
        // 확인 후 진행 대기 상태에서 복귀했다면 즉시 RoutineAlarm 이동
        if (r.ar.awaitingConfirm) {
          navigation.navigate('RoutineAlarm', { routineId: r.routine.id });
        }
      }
    };
    init();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.params.routineId]);

  // ─── 카운트다운 tick ──────────────────────────────────────
  useEffect(() => {
    if (!routine || !ar || isPaused || ar.awaitingConfirm) {
      if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
      return;
    }
    const update = () => {
      const remainMs = ar.stepEndAt - Date.now();
      setRemainingSec(Math.max(0, Math.ceil(remainMs / 1000)));
      if (remainMs <= 0) handleMissionEnd();
    };
    update();
    tickRef.current = setInterval(update, 500);
    return () => {
      if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routine, ar, isPaused]);

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

  // ─── 뒤로가기 차단 ───────────────────────────────────────
  useEffect(() => {
    const handler = () => { handleStop(); return true; };
    const sub = BackHandler.addEventListener('hardwareBackPress', handler);
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── 미션 종료 처리 ──────────────────────────────────────
  const handleMissionEnd = useCallback(async () => {
    if (completingRef.current) return;
    completingRef.current = true;
    try {
      const res = await completeCurrentMission();
      if (!res) return;
      if (res.kind === 'end') {
        navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
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
        navigation.navigate('RoutineAlarm', { routineId: res.routine.id });
        return;
      }
    } finally {
      completingRef.current = false;
    }
  }, [navigation]);

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

  // ─── 정지 ─────────────────────────────────────────────────
  const handleStop = useCallback(() => {
    Alert.alert(
      t('routine.stopConfirmTitle', { defaultValue: '루틴 중단' }),
      t('routine.stopConfirmBody', { defaultValue: '루틴을 중단하시겠어요?' }),
      [
        { text: t('common.cancel', { defaultValue: '취소' }), style: 'cancel' },
        {
          text: t('routine.stopConfirm', { defaultValue: '중단' }),
          style: 'destructive',
          onPress: async () => {
            await stopRoutine();
            navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
          },
        },
      ]
    );
  }, [navigation, t]);

  // ─── 건너뛰기 ─────────────────────────────────────────────
  const handleSkip = useCallback(() => {
    handleMissionEnd();
  }, [handleMissionEnd]);

  // ─── UI ──────────────────────────────────────────────────
  if (!routine || !ar) {
    return <SafeAreaView style={styles.container} />;
  }

  const step = routine.missions[ar.currentStepIndex];
  const missionLabel = step?.missionKey === REST_KEY
    ? t('routine.restLabel', { defaultValue: '휴식' })
    : MISSION_LABEL[step?.missionKey ?? ''] ?? step?.missionKey ?? '';
  const m = Math.floor(remainingSec / 60);
  const s = remainingSec % 60;
  const hasNext = ar.currentStepIndex + 1 < routine.missions.length;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.iconBtn} onPress={handleStop}>
          <MaterialIcons name="close" size={28} color={colors.onBackground} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{routine.name}</Text>
        <View style={styles.iconBtn} />
      </View>

      {routine.loopCount > 1 && (
        <Text style={styles.loopBadge}>
          {ar.currentLoop} / {routine.loopCount} {t('routine.loopUnit', { defaultValue: '세트' })}
        </Text>
      )}

      <View style={styles.missionBox}>
        <Text style={styles.missionStepIdx}>
          {ar.currentStepIndex + 1} / {routine.missions.length}
        </Text>
        <Text style={styles.missionName} numberOfLines={2}>{missionLabel}</Text>
      </View>

      <Text style={styles.timerText}>
        {String(m).padStart(2, '0')}:{String(s).padStart(2, '0')}
      </Text>

      <View style={styles.controls}>
        <TouchableOpacity style={styles.ctrlBtn} onPress={handleSkip}>
          <MaterialIcons name="skip-next" size={28} color={colors.onBackground} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.primaryBtn} onPress={handlePauseResume}>
          <MaterialIcons
            name={isPaused ? 'play-arrow' : 'pause'}
            size={40}
            color={colors.onPrimary}
          />
        </TouchableOpacity>
        <TouchableOpacity style={styles.ctrlBtn} onPress={handleStop}>
          <MaterialIcons name="stop" size={28} color={colors.error} />
        </TouchableOpacity>
      </View>

      {hasNext && (
        <View style={styles.nextBox}>
          <Text style={styles.nextLabel}>{t('routine.nextMission', { defaultValue: '다음' })}</Text>
          <Text style={styles.nextName} numberOfLines={1}>
            {routine.missions[ar.currentStepIndex + 1].missionKey === REST_KEY
              ? t('routine.restLabel', { defaultValue: '휴식' })
              : MISSION_LABEL[routine.missions[ar.currentStepIndex + 1].missionKey] ?? routine.missions[ar.currentStepIndex + 1].missionKey}
          </Text>
        </View>
      )}
    </SafeAreaView>
  );
}

async function askUser(
  title: string,
  body: string,
  proceedLabel: string,
  t: ReturnType<typeof useTranslation>['t']
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    Alert.alert(
      title,
      body,
      [
        { text: t('common.cancel', { defaultValue: '취소' }), style: 'cancel', onPress: () => resolve(false) },
        { text: proceedLabel, style: 'destructive', onPress: () => resolve(true) },
      ],
      { cancelable: false }
    );
  });
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '800',
    color: colors.onBackground,
    textAlign: 'center',
    marginHorizontal: 8,
  },
  iconBtn: { padding: 8, width: 44, alignItems: 'center' },
  loopBadge: {
    alignSelf: 'center',
    marginTop: 8,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: colors.primary,
    color: colors.onPrimary,
    fontWeight: '800',
    fontSize: 13,
    overflow: 'hidden',
  },
  missionBox: { alignItems: 'center', marginTop: 40, gap: 8 },
  missionStepIdx: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.secondary,
    letterSpacing: 1,
  },
  missionName: {
    fontSize: 28,
    fontWeight: '800',
    color: colors.onBackground,
    textAlign: 'center',
    paddingHorizontal: 32,
  },
  timerText: {
    fontSize: 88,
    fontWeight: '800',
    color: colors.primary,
    textAlign: 'center',
    marginTop: 40,
    letterSpacing: -2,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 24,
    marginTop: 40,
  },
  ctrlBtn: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceContainerLow,
  },
  primaryBtn: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  nextBox: {
    marginTop: 48,
    marginHorizontal: 16,
    padding: 16,
    borderRadius: 14,
    backgroundColor: colors.surfaceContainerLow,
  },
  nextLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.secondary,
    letterSpacing: 0.8,
  },
  nextName: {
    marginTop: 4,
    fontSize: 16,
    fontWeight: '700',
    color: colors.onBackground,
  },
});
