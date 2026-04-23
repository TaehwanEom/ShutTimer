// v1.6: 루틴 실행 화면.
// - Bug 5 endAt/pausedAt 패턴 재활용 (현재 미션만 카운트다운)
// - 자동 진행 모드: 미션 종료 → 다음 미션 즉시 시작 (+ 백그라운드 체인 알림 예약)
// - 확인 후 진행 모드: 미션 종료 → RoutineAlarmScreen 이동
// - 24시간 데드라인 안전망 (I-1 "계속" 무응답 자동 중단)
// - ACTIVE_ROUTINE_KEY 저장/복원. ACTIVE_TIMER_KEY와 상호 배타.

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
  saveActiveRoutine,
  clearActiveRoutine,
  ROUTINE_DEADLINE_MS,
} from '../constants/routines';
import { scheduleRoutineChain, cancelRoutineChain } from '../utils/routineScheduler';
import { MISSION_LABEL } from '../constants/missionIcons';
import { SESSIONS_STORAGE_KEY, SessionRecord } from '../constants/sessions';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'RoutineRun'>;
  route: RouteProp<RootStackParamList, 'RoutineRun'>;
};

const REST_KEY = 'rest';
const IS_ROUTINE_ACTIVE_KEY = 'isRoutineActive';

export default function RoutineRunScreen({ navigation, route }: Props) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = makeStyles(colors);

  const [routine, setRoutine] = useState<Routine | null>(null);
  const [ar, setAr] = useState<ActiveRoutine | null>(null);
  const [remainingSec, setRemainingSec] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const chainNotifIdRef = useRef<string | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // v1.6: handleMissionEnd 중복 진입 가드 (setInterval tick + AppState 'active' 콜백이 동시에 호출 가능)
  const missionEndingRef = useRef(false);

  // ─── 마운트: 루틴 + ActiveRoutine 로드 또는 신규 시작 ────
  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      const list = await loadRoutines();
      const target = list.find(r => r.id === route.params.routineId);
      if (!target) {
        Alert.alert(t('routine.notFound', { defaultValue: '루틴을 찾을 수 없습니다' }));
        navigation.goBack();
        return;
      }
      if (cancelled) return;

      // 기존 단일 타이머(activeTimer)와 상호 배타 — 진행 중이면 사용자 확인 후 정리
      const activeTimerRaw = await AsyncStorage.getItem('activeTimer');
      if (activeTimerRaw) {
        const proceed = await new Promise<boolean>((resolve) => {
          Alert.alert(
            t('routine.timerConflictTitle', { defaultValue: '진행 중인 타이머' }),
            t('routine.timerConflictBody', { defaultValue: '진행 중인 단일 타이머가 있습니다. 취소하고 루틴을 시작하시겠어요?' }),
            [
              { text: t('common.cancel', { defaultValue: '취소' }), style: 'cancel', onPress: () => resolve(false) },
              { text: t('routine.timerConflictProceed', { defaultValue: '루틴 시작' }), style: 'destructive', onPress: () => resolve(true) },
            ],
            { cancelable: false }
          );
        });
        if (!proceed) {
          navigation.goBack();
          return;
        }
        await AsyncStorage.removeItem('activeTimer').catch(() => {});
        await AsyncStorage.removeItem('isTimerActive').catch(() => {});
      }

      setRoutine(target);

      // 복원 or 신규
      const existing = await loadActiveRoutine();
      let nextAr: ActiveRoutine;
      if (existing && existing.routineId === target.id) {
        // 24시간 데드라인 초과 체크
        if (Date.now() > existing.deadlineAt) {
          await clearActiveRoutine();
          await AsyncStorage.removeItem(IS_ROUTINE_ACTIVE_KEY).catch(() => {});
          // 만료 → 신규 시작
          nextAr = createFreshAr(target);
        } else {
          nextAr = existing;
        }
      } else {
        nextAr = createFreshAr(target);
      }

      setAr(nextAr);
      await saveActiveRoutine(nextAr);
      await AsyncStorage.setItem(IS_ROUTINE_ACTIVE_KEY, 'true').catch(() => {});

      // pause 복원
      setIsPaused(nextAr.pausedAt !== null);

      // 자동 진행 + 현재 미션 진행 중이면 체인 예약
      if (target.autoAdvance && nextAr.pausedAt === null && !nextAr.awaitingConfirm) {
        await maybeScheduleChain(target, nextAr);
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
      const next = Math.max(0, Math.ceil(remainMs / 1000));
      setRemainingSec(next);
      if (remainMs <= 0) {
        handleMissionEnd();
      }
    };
    update();
    tickRef.current = setInterval(update, 500);
    return () => {
      if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routine, ar, isPaused]);

  // ─── AppState 복귀 시 endAt 기준 재계산 (Bug 5 패턴) ────
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

  // ─── 뒤로가기 차단 (루틴 중 실수 방지) ────────────────────
  useEffect(() => {
    const handler = () => {
      handleStop();
      return true;
    };
    const sub = BackHandler.addEventListener('hardwareBackPress', handler);
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── 미션 종료 처리 ──────────────────────────────────────
  const handleMissionEnd = useCallback(async () => {
    if (!routine || !ar) return;
    // race 가드 — tick + AppState 콜백 동시 호출 방지
    if (missionEndingRef.current) return;
    missionEndingRef.current = true;
    try {
      // 세션 기록 (미션 단위)
      await saveSession(routine, ar.currentStepIndex);

      // 체인 알림 정리
      if (chainNotifIdRef.current) {
        await cancelRoutineChain(chainNotifIdRef.current);
        chainNotifIdRef.current = null;
      }

      const nextIdx = ar.currentStepIndex + 1;
      const hasNextInLoop = nextIdx < routine.missions.length;
      const hasNextLoop = ar.currentLoop < routine.loopCount;

      // 전체 루틴 종료
      if (!hasNextInLoop && !hasNextLoop) {
        await clearActiveRoutine();
        await AsyncStorage.removeItem(IS_ROUTINE_ACTIVE_KEY).catch(() => {});
        navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
        return;
      }

      // 자동 진행 vs 확인 후 진행
      if (routine.autoAdvance) {
        await advanceToNext(routine, ar);
      } else {
        // 확인 후 진행 → RoutineAlarmScreen
        const pendingAr: ActiveRoutine = { ...ar, awaitingConfirm: true };
        await saveActiveRoutine(pendingAr);
        setAr(pendingAr);
        navigation.navigate('RoutineAlarm', { routineId: routine.id });
      }
    } finally {
      missionEndingRef.current = false;
    }
  }, [routine, ar, navigation]);

  // ─── 다음 미션 자동 진행 ──────────────────────────────────
  const advanceToNext = useCallback(async (r: Routine, prev: ActiveRoutine) => {
    let nextIdx = prev.currentStepIndex + 1;
    let nextLoop = prev.currentLoop;
    if (nextIdx >= r.missions.length) {
      nextLoop += 1;
      nextIdx = 0;
    }
    const step = r.missions[nextIdx];
    const now = Date.now();
    const nextAr: ActiveRoutine = {
      ...prev,
      currentStepIndex: nextIdx,
      currentLoop: nextLoop,
      stepEndAt: now + step.durationMinutes * 60 * 1000,
      pausedAt: null,
      awaitingConfirm: false,
    };
    setAr(nextAr);
    await saveActiveRoutine(nextAr);

    if (r.autoAdvance) {
      await maybeScheduleChain(r, nextAr);
    }
  }, []);

  // ─── 백그라운드 체인 알림 예약 ────────────────────────────
  const maybeScheduleChain = async (r: Routine, a: ActiveRoutine) => {
    if (!r.autoAdvance) return;
    const fireAt = new Date(a.stepEndAt);
    let nextIdx = a.currentStepIndex + 1;
    let nextLoop = a.currentLoop;
    if (nextIdx >= r.missions.length) { nextLoop += 1; nextIdx = 0; }
    if (nextLoop > r.loopCount) return; // 마지막 미션이면 체인 없음
    const id = await scheduleRoutineChain(r.id, nextLoop, nextIdx, fireAt);
    chainNotifIdRef.current = id;
  };

  // ─── 일시정지 / 재개 ─────────────────────────────────────
  const handlePauseResume = useCallback(async () => {
    if (!routine || !ar) return;
    const now = Date.now();
    if (isPaused) {
      // 재개
      const pauseDuration = now - (ar.pausedAt ?? now);
      const nextAr: ActiveRoutine = {
        ...ar,
        stepEndAt: ar.stepEndAt + pauseDuration,
        pausedAt: null,
      };
      setAr(nextAr);
      setIsPaused(false);
      await saveActiveRoutine(nextAr);
      if (routine.autoAdvance) {
        await maybeScheduleChain(routine, nextAr);
      }
    } else {
      // 일시정지
      const nextAr: ActiveRoutine = { ...ar, pausedAt: now };
      setAr(nextAr);
      setIsPaused(true);
      await saveActiveRoutine(nextAr);
      if (chainNotifIdRef.current) {
        await cancelRoutineChain(chainNotifIdRef.current);
        chainNotifIdRef.current = null;
      }
    }
  }, [routine, ar, isPaused]);

  // ─── 정지 (전체 루틴 취소) ───────────────────────────────
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
            if (chainNotifIdRef.current) {
              await cancelRoutineChain(chainNotifIdRef.current);
              chainNotifIdRef.current = null;
            }
            await clearActiveRoutine();
            await AsyncStorage.removeItem(IS_ROUTINE_ACTIVE_KEY).catch(() => {});
            navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
          },
        },
      ]
    );
  }, [navigation, t]);

  // ─── 건너뛰기 (현재 미션 즉시 종료) ──────────────────────
  const handleSkip = useCallback(() => {
    handleMissionEnd();
  }, [handleMissionEnd]);

  // ─── 세션 기록 ───────────────────────────────────────────
  const saveSession = async (r: Routine, stepIdx: number) => {
    const step = r.missions[stepIdx];
    if (!step || step.missionKey === REST_KEY) return; // 휴식은 기록 제외
    try {
      const raw = await AsyncStorage.getItem(SESSIONS_STORAGE_KEY);
      const list: SessionRecord[] = raw ? JSON.parse(raw) : [];
      const d = new Date();
      const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      list.push({
        id: `s_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        date,
        icon: step.missionKey,
        minutes: step.durationMinutes,
      });
      await AsyncStorage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify(list));
    } catch {
      // 세션 저장 실패 무시
    }
  };

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

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.iconBtn} onPress={handleStop}>
          <MaterialIcons name="close" size={28} color={colors.onBackground} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{routine.name}</Text>
        <View style={styles.iconBtn} />
      </View>

      {/* 루프 진행 */}
      {routine.loopCount > 1 && (
        <Text style={styles.loopBadge}>
          {ar.currentLoop} / {routine.loopCount} {t('routine.loopUnit', { defaultValue: '세트' })}
        </Text>
      )}

      {/* 현재 미션 */}
      <View style={styles.missionBox}>
        <Text style={styles.missionStepIdx}>
          {ar.currentStepIndex + 1} / {routine.missions.length}
        </Text>
        <Text style={styles.missionName} numberOfLines={2}>{missionLabel}</Text>
      </View>

      {/* 타이머 */}
      <Text style={styles.timerText}>
        {String(m).padStart(2, '0')}:{String(s).padStart(2, '0')}
      </Text>

      {/* 컨트롤 */}
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

      {/* 다음 미션 */}
      {ar.currentStepIndex + 1 < routine.missions.length && (
        <View style={styles.nextBox}>
          <Text style={styles.nextLabel}>{t('routine.nextMission', { defaultValue: '다음' })}</Text>
          <Text style={styles.nextName} numberOfLines={1}>
            {MISSION_LABEL[routine.missions[ar.currentStepIndex + 1].missionKey] ??
              (routine.missions[ar.currentStepIndex + 1].missionKey === REST_KEY
                ? t('routine.restLabel', { defaultValue: '휴식' })
                : routine.missions[ar.currentStepIndex + 1].missionKey)}
          </Text>
        </View>
      )}
    </SafeAreaView>
  );
}

function createFreshAr(r: Routine): ActiveRoutine {
  const now = Date.now();
  const firstStep = r.missions[0];
  return {
    routineId: r.id,
    currentLoop: 1,
    currentStepIndex: 0,
    stepEndAt: now + (firstStep?.durationMinutes ?? 1) * 60 * 1000,
    pausedAt: null,
    startedAt: now,
    deadlineAt: now + ROUTINE_DEADLINE_MS,
    awaitingConfirm: false,
  };
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
  missionBox: {
    alignItems: 'center',
    marginTop: 40,
    gap: 8,
  },
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
