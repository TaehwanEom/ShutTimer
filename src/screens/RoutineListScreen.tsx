// v1.6 Phase 3: 루틴 목록 화면 재작성.
// 카테고리별 섹션 그룹핑 + 카드 UI + 진행 중 배너 + PanResponder 스와이프 삭제 + 섹션별 편집 모드.

import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  ScrollView,
  Alert,
  Switch,
  Animated,
  PanResponder,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { RootStackParamList } from '../../App';
import { useTheme } from '../context/ThemeContext';
import { ThemeColors } from '../constants/theme';
import {
  Routine,
  ActiveRoutine,
  loadRoutines,
  deleteRoutine,
  upsertRoutine,
  loadActiveRoutine,
} from '../constants/routines';
import {
  cancelRoutinePrealerts,
  scheduleRoutinePrealerts,
  loadScheduleStatus,
  ScheduleStatus,
} from '../utils/routineScheduler';
import {
  startRoutine,
  pauseRoutine,
  resumeRoutine,
  stopRoutine,
} from '../utils/routineController';
import AdBanner from '../components/AdBanner';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'RoutineList'>;
};

const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const SWIPE_THRESHOLD = 80;
const SWIPE_MAX = 96;
const EDIT_SLIDE_WIDTH = 56;

// ─── 요일 압축 표시 ──────────────────────────────────────────

function daysLabel(days: number[], t: (k: string, o?: any) => string): 'weekday' | 'weekend' | 'everyday' | number[] {
  if (days.length === 0 || days.length === 7) return 'everyday';
  const sorted = [...days].sort();
  const weekday = [1, 2, 3, 4, 5];
  const weekend = [0, 6];
  const eq = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => v === b[i]);
  if (eq(sorted, weekday)) return 'weekday';
  if (eq(sorted, weekend)) return 'weekend';
  return sorted;
}

// ─── 시간 포맷: 24h → "오전/오후 H:MM" ──────────────────────

function formatTimeKr(hhmm: string): string {
  const [hStr, mStr] = hhmm.split(':');
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  if (isNaN(h) || isNaN(m)) return hhmm;
  const ampm = h < 12 ? '오전' : '오후';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${ampm} ${h12}:${String(m).padStart(2, '0')}`;
}

// ─── 카테고리 그룹핑 + 정렬 ─────────────────────────────────

function groupByCategory(routines: Routine[], t: (k: string) => string): Array<{ category: string; items: Routine[] }> {
  const map = new Map<string, Routine[]>();
  for (const r of routines) {
    const key = r.category || t('routine.uncategorized');
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(r);
  }
  const collator = new Intl.Collator(undefined, { sensitivity: 'base' });
  return Array.from(map.entries())
    .sort((a, b) => collator.compare(a[0], b[0]))
    .map(([category, items]) => ({ category, items }));
}

// ─── 진행 중 배너 ────────────────────────────────────────────

type BannerProps = {
  routine: Routine;
  ar: ActiveRoutine;
  colors: ThemeColors;
  onPress: () => void;
  onToggle: () => void;
  onStop: () => void;
};

function ProgressBanner({ routine, ar, colors, onPress, onToggle, onStop }: BannerProps) {
  const { t } = useTranslation();
  const step = routine.steps[ar.currentStepIndex];
  const [remainingSec, setRemainingSec] = useState(() => Math.max(0, Math.floor((ar.stepEndAt - Date.now()) / 1000)));

  useEffect(() => {
    if (ar.pausedAt !== null) {
      setRemainingSec(Math.max(0, Math.floor((ar.stepEndAt - ar.pausedAt) / 1000)));
      return;
    }
    const tick = () => setRemainingSec(Math.max(0, Math.floor((ar.stepEndAt - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [ar.stepEndAt, ar.pausedAt]);

  const mm = Math.floor(remainingSec / 60);
  const ss = remainingSec % 60;
  const isPaused = ar.pausedAt !== null;

  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={onPress}
      style={{
        marginHorizontal: 16,
        marginTop: 8,
        marginBottom: 12,
        padding: 14,
        borderRadius: 14,
        backgroundColor: colors.primary,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 12, fontWeight: '700', color: colors.onPrimary, opacity: 0.85 }}>
            {t('routine.bannerInProgress')}
          </Text>
          <Text style={{ marginTop: 4, fontSize: 14, fontWeight: '800', color: colors.onPrimary }} numberOfLines={1}>
            {step?.name ?? ''} ({ar.currentStepIndex + 1}/{routine.steps.length}) · {t('routine.bannerRemaining')} {String(mm).padStart(2, '0')}:{String(ss).padStart(2, '0')}
          </Text>
        </View>
        <TouchableOpacity
          onPress={onToggle}
          onLongPress={onStop}
          delayLongPress={500}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            backgroundColor: colors.onPrimary,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <MaterialIcons
            name={isPaused ? 'play-arrow' : 'pause'}
            size={22}
            color={colors.primary}
          />
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
}

// ─── 루틴 카드 (PanResponder 스와이프 삭제 + 편집 모드 슬라이드) ─

type CardProps = {
  routine: Routine;
  colors: ThemeColors;
  isEditMode: boolean;
  onPlayTap: () => void;
  onPlayLongPress: () => void;
  onToggleActive: (value: boolean) => void;
  onDelete: () => void;
  onEditPencil: () => void;
};

function RoutineCard({ routine, colors, isEditMode, onPlayTap, onPlayLongPress, onToggleActive, onDelete, onEditPencil }: CardProps) {
  const { t } = useTranslation();
  const translateX = useRef(new Animated.Value(0)).current;
  const swipeOffsetRef = useRef(0);
  const editAnim = useRef(new Animated.Value(0)).current;

  // 편집 모드 진입/해제 애니메이션 (좌→우 슬라이드로 편집 아이콘 노출)
  useEffect(() => {
    Animated.spring(editAnim, {
      toValue: isEditMode ? 1 : 0,
      useNativeDriver: true,
      bounciness: 4,
      speed: 14,
    }).start();
  }, [isEditMode, editAnim]);

  // 편집 모드 중엔 스와이프 비활성
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_, g) =>
          !isEditMode && Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy),
        onPanResponderGrant: () => {
          translateX.stopAnimation();
        },
        onPanResponderMove: (_, g) => {
          // 우→좌 스와이프만 허용 (음수). 상한 -SWIPE_MAX
          const next = Math.max(-SWIPE_MAX, Math.min(0, g.dx));
          translateX.setValue(next);
          swipeOffsetRef.current = next;
        },
        onPanResponderRelease: (_, g) => {
          if (-g.dx >= SWIPE_THRESHOLD) {
            // 삭제 확인
            Animated.spring(translateX, { toValue: -SWIPE_MAX, useNativeDriver: true, bounciness: 0 }).start();
            Alert.alert(
              t('routine.deleteConfirmTitle'),
              t('routine.deleteConfirmBody'),
              [
                {
                  text: t('common.cancel'),
                  style: 'cancel',
                  onPress: () => {
                    Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
                  },
                },
                {
                  text: t('routine.actionDelete'),
                  style: 'destructive',
                  onPress: () => {
                    Animated.timing(translateX, { toValue: -500, duration: 220, useNativeDriver: true }).start(onDelete);
                  },
                },
              ],
              { cancelable: true, onDismiss: () => Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start() }
            );
          } else {
            Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
          }
        },
        onPanResponderTerminate: () => {
          Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
        },
      }),
    [isEditMode, translateX, t, onDelete]
  );

  const editSlide = editAnim.interpolate({ inputRange: [0, 1], outputRange: [0, EDIT_SLIDE_WIDTH] });
  const editIconOpacity = editAnim;

  const timeStr = routine.schedule?.startTime ? formatTimeKr(routine.schedule.startTime) : '--:--';
  const label = daysLabel(routine.schedule?.days ?? [], t);
  const stepSummary = (() => {
    const names = routine.steps.map(s => s.name).filter(Boolean);
    if (names.length === 0) return '';
    if (names.length === 1) return names[0];
    if (names.length === 2) return `${names[0]} · ${names[1]}`;
    return `${names[0]} 외 ${names.length - 1}개`;
  })();

  return (
    <View style={{ position: 'relative', marginHorizontal: 16, marginBottom: 10 }}>
      {/* 삭제 아이콘 (뒤에 깔림, 스와이프 시 노출) */}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          right: 0,
          top: 0,
          bottom: 0,
          width: SWIPE_MAX,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.error,
          borderRadius: 14,
        }}
      >
        <MaterialIcons name="delete" size={24} color={colors.onPrimary} />
      </View>

      {/* 편집 연필 아이콘 (왼쪽, 편집 모드 진입 시 노출) */}
      <Animated.View
        pointerEvents={isEditMode ? 'auto' : 'none'}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: EDIT_SLIDE_WIDTH,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: editIconOpacity,
        }}
      >
        <TouchableOpacity onPress={onEditPencil} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <MaterialIcons name="edit" size={22} color={colors.primary} />
        </TouchableOpacity>
      </Animated.View>

      {/* 카드 본체 (스와이프 + 편집 슬라이드) */}
      <Animated.View
        {...panResponder.panHandlers}
        style={{
          transform: [{ translateX: Animated.add(translateX, editSlide) }],
          backgroundColor: colors.surfaceContainerLow,
          borderRadius: 14,
          padding: 14,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Text style={{ flex: 1, fontSize: 17, fontWeight: '800', color: colors.onBackground }}>{timeStr}</Text>

          {/* 플레이 버튼: 탭=실행, 길게=정지 */}
          <TouchableOpacity
            onPress={onPlayTap}
            onLongPress={onPlayLongPress}
            delayLongPress={500}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={{
              width: 36,
              height: 36,
              borderRadius: 18,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: colors.surfaceContainerLowest,
            }}
          >
            <MaterialIcons name="play-arrow" size={22} color={colors.onBackground} />
          </TouchableOpacity>

          <Switch
            value={routine.active}
            onValueChange={onToggleActive}
            trackColor={{ false: colors.outlineVariant, true: colors.primary }}
            thumbColor={colors.onPrimary}
            style={{ transform: [{ scale: 0.8 }] }}
          />
        </View>

        <View style={{ marginTop: 8, flexDirection: 'row', alignItems: 'center' }}>
          {!!stepSummary && (
            <>
              <Text style={{ fontSize: 13, color: colors.onBackground, fontWeight: '700' }} numberOfLines={1}>{stepSummary}</Text>
              <View style={{ width: 8 }} />
            </>
          )}
          <DaysRow label={label} colors={colors} />
        </View>
      </Animated.View>
    </View>
  );
}

function DaysRow({ label, colors }: { label: ReturnType<typeof daysLabel>; colors: ThemeColors }) {
  const { t } = useTranslation();
  if (label === 'everyday') {
    return <Text style={{ fontSize: 12, color: colors.secondary }}>{t('routine.daysEveryday')}</Text>;
  }
  if (label === 'weekday') {
    return <Text style={{ fontSize: 12, color: colors.secondary }}>{t('routine.daysWeekday')}</Text>;
  }
  if (label === 'weekend') {
    return <Text style={{ fontSize: 12, color: colors.secondary }}>{t('routine.daysWeekend')}</Text>;
  }
  // 개별 요일 나열
  return (
    <View style={{ flexDirection: 'row', gap: 4, flex: 1, flexWrap: 'wrap' }}>
      {[0, 1, 2, 3, 4, 5, 6].map(d => {
        const active = label.includes(d);
        return (
          <Text
            key={d}
            style={{
              fontSize: 12,
              fontWeight: active ? '700' : '500',
              color: active ? colors.onBackground : colors.secondary,
              opacity: active ? 1 : 0.5,
            }}
          >
            {t(`routine.weekday.${WEEKDAY_KEYS[d]}`)}
          </Text>
        );
      })}
    </View>
  );
}

// ─── 메인 스크린 ─────────────────────────────────────────────

export default function RoutineListScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = makeStyles(colors);
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [scheduleStatus, setScheduleStatus] = useState<ScheduleStatus | null>(null);
  const [activeRoutine, setActiveRoutine] = useState<ActiveRoutine | null>(null);
  const [activeRoutineObj, setActiveRoutineObj] = useState<Routine | null>(null);
  const [editingCategory, setEditingCategory] = useState<string | null>(null);

  const refreshAll = useCallback(async () => {
    const list = await loadRoutines();
    setRoutines(list);
    const status = await loadScheduleStatus();
    setScheduleStatus(status);
    const ar = await loadActiveRoutine();
    setActiveRoutine(ar);
    if (ar) {
      setActiveRoutineObj(list.find(r => r.id === ar.routineId) ?? null);
    } else {
      setActiveRoutineObj(null);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      refreshAll();
    }, [refreshAll])
  );

  // 진행 중 배너 표시 상태일 때만 1초 폴링 (ActiveRoutine 변동 감지)
  useEffect(() => {
    if (!activeRoutine) return;
    const id = setInterval(async () => {
      const ar = await loadActiveRoutine();
      setActiveRoutine(ar);
      if (!ar) setActiveRoutineObj(null);
    }, 1000);
    return () => clearInterval(id);
  }, [activeRoutine?.routineId]);

  const grouped = useMemo(() => groupByCategory(routines, t), [routines, t]);

  const handlePlay = async (routine: Routine) => {
    const result = await startRoutine(routine.id);
    if (result.kind === 'not_found') return;
    if (result.kind === 'needs_timer_override') {
      Alert.alert(
        t('routine.timerConflictTitle'),
        t('routine.timerConflictBody'),
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('routine.timerConflictProceed'),
            onPress: async () => {
              await startRoutine(routine.id, { overrideTimer: true });
              await refreshAll();
              navigation.navigate('RoutineRun', { routineId: routine.id });
            },
          },
        ]
      );
      return;
    }
    if (result.kind === 'needs_override') {
      Alert.alert(
        t('routine.stopConfirmTitle'),
        t('routine.stopConfirmBody'),
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('routine.stopConfirm'),
            style: 'destructive',
            onPress: async () => {
              await startRoutine(routine.id, { overrideActive: true });
              await refreshAll();
              navigation.navigate('RoutineRun', { routineId: routine.id });
            },
          },
        ]
      );
      return;
    }
    await refreshAll();
    navigation.navigate('RoutineRun', { routineId: routine.id });
  };

  const handleStop = () => {
    Alert.alert(
      t('routine.stopConfirmTitle'),
      t('routine.stopConfirmBody'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('routine.stopConfirm'),
          style: 'destructive',
          onPress: async () => {
            await stopRoutine();
            await refreshAll();
          },
        },
      ]
    );
  };

  const handleBannerToggle = async () => {
    if (!activeRoutine) return;
    if (activeRoutine.pausedAt !== null) {
      await resumeRoutine();
    } else {
      await pauseRoutine();
    }
    await refreshAll();
  };

  const handleBannerPress = () => {
    if (!activeRoutine) return;
    navigation.navigate('RoutineRun', { routineId: activeRoutine.routineId });
  };

  const handleToggleActive = async (routine: Routine, value: boolean) => {
    const updated: Routine = { ...routine, active: value };
    await upsertRoutine(updated);
    if (value && updated.schedule) {
      await scheduleRoutinePrealerts(updated);
    } else {
      await cancelRoutinePrealerts(routine.id);
    }
    await refreshAll();
  };

  const handleDelete = async (routine: Routine) => {
    await cancelRoutinePrealerts(routine.id);
    await deleteRoutine(routine.id);
    await refreshAll();
  };

  const handleEditPencil = (routine: Routine) => {
    setEditingCategory(null);
    navigation.navigate('RoutineEdit', { routineId: routine.id });
  };

  const toggleSectionEdit = (category: string) => {
    setEditingCategory(prev => (prev === category ? null : category));
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.iconBtn} onPress={() => navigation.goBack()}>
          <MaterialIcons name="chevron-left" size={32} color={colors.onBackground} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('routine.listTitle')}</Text>
        <TouchableOpacity
          style={styles.iconBtn}
          onPress={() => navigation.navigate('RoutineEdit', {})}
        >
          <MaterialIcons name="add" size={28} color={colors.onBackground} />
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
        {/* 진행 중 배너 */}
        {activeRoutine && activeRoutineObj && (
          <ProgressBanner
            routine={activeRoutineObj}
            ar={activeRoutine}
            colors={colors}
            onPress={handleBannerPress}
            onToggle={handleBannerToggle}
            onStop={handleStop}
          />
        )}

        {/* 한계 초과 배너 */}
        {scheduleStatus?.overflow && (
          <View style={styles.warningBanner}>
            <MaterialIcons name="warning-amber" size={20} color={colors.error} />
            <View style={{ flex: 1 }}>
              <Text style={styles.warningTitle}>
                {t('routine.scheduleOverflowTitle')}
              </Text>
              <Text style={styles.warningBody}>
                {t('routine.scheduleOverflowBody', { count: scheduleStatus.skippedRoutineIds.length })}
              </Text>
            </View>
          </View>
        )}

        {routines.length === 0 ? (
          <View style={styles.emptyBox}>
            <MaterialIcons name="playlist-add" size={48} color={colors.secondary} />
            <Text style={styles.emptyText}>{t('routine.emptyTitle')}</Text>
            <Text style={styles.emptyHint}>{t('routine.emptyHint')}</Text>
          </View>
        ) : (
          grouped.map(({ category, items }) => (
            <View key={category} style={{ marginTop: 16 }}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>{category}</Text>
                <TouchableOpacity
                  onPress={() => toggleSectionEdit(category)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text style={styles.sectionEditBtn}>
                    {editingCategory === category ? t('routine.sectionDone') : t('routine.actionEdit')}
                  </Text>
                </TouchableOpacity>
              </View>
              {items.map(r => (
                <RoutineCard
                  key={r.id}
                  routine={r}
                  colors={colors}
                  isEditMode={editingCategory === category}
                  onPlayTap={() => handlePlay(r)}
                  onPlayLongPress={handleStop}
                  onToggleActive={value => handleToggleActive(r, value)}
                  onDelete={() => handleDelete(r)}
                  onEditPencil={() => handleEditPencil(r)}
                />
              ))}
            </View>
          ))
        )}
        <View style={{ height: 24 }} />
      </ScrollView>
      <AdBanner />
    </SafeAreaView>
  );
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
    fontSize: 18,
    fontWeight: '800',
    color: colors.onBackground,
    letterSpacing: -0.5,
  },
  iconBtn: {
    padding: 8,
    borderRadius: 50,
    width: 44,
    alignItems: 'center',
  },
  emptyBox: {
    marginTop: 80,
    alignItems: 'center',
    paddingHorizontal: 24,
    gap: 8,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.onBackground,
    marginTop: 12,
  },
  emptyHint: {
    fontSize: 13,
    color: colors.secondary,
    opacity: 0.8,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.onBackground,
    letterSpacing: -0.3,
  },
  sectionEditBtn: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.primary,
  },
  warningBanner: {
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: colors.surfaceContainerLow,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  warningTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.error,
  },
  warningBody: {
    marginTop: 2,
    fontSize: 12,
    color: colors.onBackground,
    lineHeight: 17,
  },
});
