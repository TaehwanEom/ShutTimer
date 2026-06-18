// v1.6 Phase 3: 루틴 목록 화면 재작성.
// 카테고리별 섹션 그룹핑 + 카드 UI + 진행 중 배너 + PanResponder 스와이프 삭제 + 섹션별 편집 모드.

import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
// v2.0 C-3-4 — useActiveRoutineAr hook
import { useActiveRoutineAr } from '../state/useSession';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  Switch,
  Animated,
  PanResponder,
  DeviceEventEmitter,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import Svg, { Circle as SvgCircle } from 'react-native-svg';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useFocusEffect, RouteProp } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { RootStackParamList } from '../../App';
import ActiveRoutineSection from '../components/ActiveRoutineSection';
import { useTheme } from '../context/ThemeContext';
import { ThemeColors } from '../constants/theme';
import {
  Routine,
  RoutineStep,
  ActiveRoutine,
  RoutineMode,
  loadRoutines,
  deleteRoutine,
  upsertRoutine,
  getRoutineMode,
  getRoutineTotalSeconds,
  PENDING_DISABLED_ALARMS_KEY,
} from '../constants/routines';
import {
  cancelRoutinePrealerts,
  scheduleRoutinePrealerts,
  loadScheduleStatus,
  ScheduleStatus,
} from '../utils/routineScheduler';
import { isAdhocAlarmRoutine } from '../utils/alarmRoutineLink';
import { loadAlarms, nextAlarmOccurrenceTime, upsertAlarm } from '../constants/alarms';
import { cancelAlarmsForEntity } from '../utils/alarmScheduler';
import AlarmkitBridge from '../../modules/alarmkit-bridge';
import { listAllAlarmMetadata } from '../utils/alarmkitMappingTable';
import { Logger } from '../utils/logger';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  pauseRoutine,
  resumeRoutine,
} from '../utils/routineController';
import {
  FIXED_CATEGORIES,
  CategoryDef,
  loadCustomCategories,
} from '../constants/categories';

// v1.8 — RoutineList Stack.Screen 제거. MainTabsNavigator RoutineTab 측만 사용.
type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList>;
  route: RouteProp<RootStackParamList, 'RoutineEdit'> | { params?: undefined };
};

const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
// 우측 스와이프로 노출되는 삭제 슬라이드 폭 (= 펜슬 자리).
const EDIT_SLIDE_WIDTH = 56;
// Release 시 거리 임계값 — 슬라이드 폭의 1/3. velocity 기반 보조 트리거 함께 사용.
const EDIT_DISTANCE_THRESHOLD = 18;   // EDIT_SLIDE_WIDTH / 3
// Release 시 속도 (px/ms) 임계값 — 짧게 flick 해도 잡힘
const VELOCITY_THRESHOLD = 0.25;

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

function formatTimeKr(hhmm: string, t: (k: string, opts?: any) => string): string {
  const [hStr, mStr] = hhmm.split(':');
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  if (isNaN(h) || isNaN(m)) return hhmm;
  const ampm = h < 12 ? t('common.am', { defaultValue: '오전' }) : t('common.pm', { defaultValue: '오후' });
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${ampm} ${h12}:${String(m).padStart(2, '0')}`;
}

// ─── 단계 시간 포맷: 초 → "Xh Ym Zs" 한국어 ─────────────────

function formatDurationLabel(sec: number, t: (k: string, opts?: any) => string): string {
  const minLabel = t('routine.duration.minute', { defaultValue: '분' });
  if (sec <= 0) return `0${minLabel}`;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const parts: string[] = [];
  if (h > 0) parts.push(`${h}${t('routine.duration.hour', { defaultValue: '시간' })}`);
  if (m > 0) parts.push(`${m}${minLabel}`);
  if (s > 0) parts.push(`${s}${t('routine.duration.second', { defaultValue: '초' })}`);
  if (parts.length === 0) parts.push(`0${minLabel}`);
  return parts.join(' ');
}

// ─── 단계 카드 (펼침 시 stagger 등장 애니메이션) ─────────────

function StepRow({ step, idx, colors, visible, totalSteps }: { step: RoutineStep; idx: number; colors: ThemeColors; visible: boolean; totalSteps: number }) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const anim = useRef(new Animated.Value(0)).current;
  const stepCardBg = colors.surfaceContainerLowest;

  useEffect(() => {
    // 펼치기: 위 → 아래 (idx 0 부터). 접기: 아래 → 위 (마지막 idx 부터, 등장 역순).
    const delay = visible ? idx * 60 : (totalSteps - 1 - idx) * 50;
    Animated.timing(anim, {
      toValue: visible ? 1 : 0,
      duration: visible ? 240 : 200,
      delay,
      useNativeDriver: true,
    }).start();
  }, [visible, anim, idx, totalSteps]);

  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [-12, 0] });

  return (
    <Animated.View
      style={{
        backgroundColor: stepCardBg,
        borderRadius: 0,
        paddingVertical: 14,
        paddingHorizontal: 0,
        marginTop: 0,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: isDark ? colors.outlineVariant : '#D1D1D6',
        opacity: anim,
        transform: [{ translateY }],
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View
          style={{
            width: 30,
            height: 30,
            borderRadius: 7,
            backgroundColor: colors.primary,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ fontSize: 14, fontWeight: '800', color: colors.onPrimary }}>
            {idx + 1}
          </Text>
        </View>
        <Text
          style={{ flex: 1, fontSize: 17, fontWeight: '700', color: colors.onBackground }}
          numberOfLines={1}
        >
          {step.name}
        </Text>
        <Text style={{ fontSize: 16, fontWeight: '700', color: colors.onBackground }}>
          {formatDurationLabel(step.durationSeconds, t)}
        </Text>
      </View>
    </Animated.View>
  );
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

// ─── 루틴 카드 (PanResponder 스와이프 삭제 + 편집 모드 슬라이드) ─

type CardProps = {
  routine: Routine;
  categoryLabel: string;
  styles: ReturnType<typeof makeStyles>;
  colors: ThemeColors;
  /** 섹션 "편집" 모드 — true 면 ▶ 대신 펜슬, swipe 차단 */
  isEditMode: boolean;
  onPlayPress: () => void;
  onToggleActive: (value: boolean) => void;
  onDelete: () => void;
  onEditPencil: () => void;
  /** 진행 중인 일반 루틴이면 ActiveRoutineSection 인스턴스 전달. 있으면 펼침 영역에 단계 list 대신 이것을 렌더 */
  activeRunNode?: React.ReactNode;
  /** 진행 중인 routine 전체 — 본 카드가 active 일 때만 사용 (자체 250ms tick 으로 progress 계산) */
  activeRoutine?: ActiveRoutine | null;
  /** 다른 카드 진행 시작 시 변경되는 timestamp. 자기가 active 아니면 자동 접기 트리거 */
  collapseSignal?: number;
  /** 진행 중인 본인 카드인지 — collapseSignal 발동 시 active 카드는 접기 X */
  isActiveCard?: boolean;
  /** 다른 루틴 진행 중 = 본 카드도 swipe 편집/삭제 차단 */
  swipeDisabled?: boolean;
  /** 카드 외곽 wrapper 의 native ref — 부모가 measureLayout 으로 스크롤 위치 계산 시 사용 */
  wrapperRef?: (node: View | null) => void;
};

function RoutineCard({ routine, categoryLabel, styles, colors, isEditMode, onPlayPress, onToggleActive, onDelete, onEditPencil, activeRunNode, activeRoutine, collapseSignal, isActiveCard, swipeDisabled, wrapperRef }: CardProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const translateX = useRef(new Animated.Value(0)).current;
  const swipeOffsetRef = useRef(0);
  const [expanded, setExpanded] = useState(false);
  const [renderSteps, setRenderSteps] = useState(false);
  const collapseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // cold-start 복원 시 활성 카드 자동 펼침 (routineId 단위 1회 — 사용자가 이후 수동 접기 가능)
  const autoExpandedRef = useRef(false);
  const [mainCardHeight, setMainCardHeight] = useState(0);

  // 펼침/접기 토글 — 접기 시 reverse stagger 끝난 뒤 unmount.
  const toggleExpanded = () => {
    if (collapseTimerRef.current) {
      clearTimeout(collapseTimerRef.current);
      collapseTimerRef.current = null;
    }
    if (expanded) {
      setExpanded(false);
      const lastIdx = Math.max(0, routine.steps.length - 1);
      const totalMs = lastIdx * 50 + 200 + 50;
      collapseTimerRef.current = setTimeout(() => setRenderSteps(false), totalMs);
    } else {
      setRenderSteps(true);
      setExpanded(true);
    }
  };

  useEffect(() => {
    return () => {
      if (collapseTimerRef.current) clearTimeout(collapseTimerRef.current);
    };
  }, []);

  // 다른 카드 진행 시작 시 자동 접기 — collapseSignal 변경 + 자기가 active 가 아닐 때
  useEffect(() => {
    if (collapseSignal && !isActiveCard && expanded) {
      setExpanded(false);
      const lastIdx = Math.max(0, routine.steps.length - 1);
      const totalMs = lastIdx * 50 + 200 + 50;
      if (collapseTimerRef.current) clearTimeout(collapseTimerRef.current);
      collapseTimerRef.current = setTimeout(() => setRenderSteps(false), totalMs);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collapseSignal]);

  // cold-start 복원 시 활성 카드 자동 펼침 — activeRunNode 첫 도착 시 1회.
  // 사용자가 이후 수동으로 접어도 같은 routine 안에서 재펼침 안 함 (autoExpandedRef guard).
  // activeRunNode 사라지면 (onClose) ref 리셋 → 다음 routine 진행 시 다시 자동 펼침 가능.
  useEffect(() => {
    if (activeRunNode && !autoExpandedRef.current) {
      autoExpandedRef.current = true;
      setRenderSteps(true);
      setExpanded(true);
    }
    if (!activeRunNode) {
      autoExpandedRef.current = false;
    }
  }, [activeRunNode]);

  // 스와이프 양수(우측) 도달 시 왼쪽 삭제 버튼 노출. 편집은 섹션 "편집" 버튼 → 카드 탭 시 편집창 이동.
  const [swipeRevealDelete, setSwipeRevealDelete] = useState(false);

  // 편집 모드 중엔 스와이프 비활성
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        // swipeDisabled = 다른 루틴 진행 중 → 본 카드 swipe 편집/삭제 차단.
        onMoveShouldSetPanResponder: (_, g) =>
          !isEditMode && !isActiveCard && !swipeDisabled && Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy),
        // ★ 핵심 — ScrollView 가 vertical scroll 트리거하려고 termination 요청해도 거부.
        //   미설정 시 default true → drag 중 ScrollView 가 responder 회수 → onPanResponderTerminate
        //   → snap-to-0. 사용자가 충분히 끌어도 lock 안 되는 진짜 원인.
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          translateX.stopAnimation();
        },
        onPanResponderMove: (_, g) => {
          // 우측 스와이프(양수)만 허용 → 왼쪽 삭제 버튼 노출. (편집 펜슬 스와이프 제거)
          const next = Math.max(0, Math.min(EDIT_SLIDE_WIDTH, g.dx));
          translateX.setValue(next);
          swipeOffsetRef.current = next;
        },
        onPanResponderRelease: (_, g) => {
          // 거리 OR 속도 중 하나라도 임계 초과하면 삭제 버튼 노출 — flick / 짧은 드래그 모두 잡힘
          const tx = swipeOffsetRef.current;
          const revealByDist = tx >= EDIT_DISTANCE_THRESHOLD;
          const revealByVel = g.vx >= VELOCITY_THRESHOLD;
          if (revealByDist || revealByVel) {
            Animated.spring(translateX, { toValue: EDIT_SLIDE_WIDTH, useNativeDriver: true, bounciness: 0 }).start();
            setSwipeRevealDelete(true);
          } else {
            Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
            setSwipeRevealDelete(false);
          }
        },
        onPanResponderTerminate: () => {
          Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
          setSwipeRevealDelete(false);
        },
      }),
    [isEditMode, isActiveCard, swipeDisabled, translateX, t, onDelete]
  );
  // 스와이프 양수(우측) → 왼쪽 삭제 버튼 노출 opacity.
  const swipeDeleteOpacity = translateX.interpolate({
    inputRange: [0, EDIT_SLIDE_WIDTH],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });

  const mode = getRoutineMode(routine);

  // 카드 자체 250ms tick (active 일 때만) — 게이지 부드러운 갱신.
  // 부모 (RoutineList) nowMs tick 제거됨 — 부모 리렌더 빈도 ↓.
  const [cardNowMs, setCardNowMs] = useState(Date.now());
  useEffect(() => {
    if (!isActiveCard) return;
    const id = setInterval(() => setCardNowMs(Date.now()), 250);
    return () => clearInterval(id);
  }, [isActiveCard]);

  // isActiveCard 진입 시 swipe lock 강제 리셋 — swipe 후 ▶ 진행 시 휴지통/펜슬 잔존 방지
  //   swipeDisabled (= 다른 루틴 진행 시작) 도 동일 처리 → 열려 있던 swipe 즉시 닫기.
  useEffect(() => {
    if (isActiveCard || swipeDisabled) {
      translateX.setValue(0);
      swipeOffsetRef.current = 0;
      setSwipeRevealDelete(false);
    }
  }, [isActiveCard, swipeDisabled, translateX]);

  // progress 계산 — active 카드 + activeRoutine 있을 때만
  let progress: number | undefined;
  if (isActiveCard && activeRoutine) {
    const stepDurSec = routine.steps[activeRoutine.currentStepIndex]?.durationSeconds ?? 0;
    const totalMs = stepDurSec * 1000;
    if (totalMs > 0) {
      const ref = activeRoutine.pausedAt ?? cardNowMs;
      const remainMs = Math.max(0, activeRoutine.stepEndAt - ref);
      const elapsed = totalMs - remainMs;
      progress = Math.min(1, Math.max(0, elapsed / totalMs));
    }
  }

  // ▶ / 게이지 시각 부분 (mode 별 위치 분리 위해 변수화)
  const playButtonVisual = (
    <View style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
      {typeof progress === 'number' ? (() => {
        const SIZE = 40;
        const R = 10;
        const C = 2 * Math.PI * R;
        const remainFraction = Math.max(0, 1 - progress);
        return (
          <Svg width={SIZE} height={SIZE} style={{ position: 'absolute' }}>
            <SvgCircle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke={colors.outlineVariant} strokeWidth={20} opacity={0.3} />
            <SvgCircle
              cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none"
              stroke={colors.primary} strokeWidth={20}
              strokeDasharray={C} strokeDashoffset={C * (1 - remainFraction)}
              rotation="-90" origin={`${SIZE / 2}, ${SIZE / 2}`}
            />
          </Svg>
        );
      })() : (
        <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }}>
          <MaterialIcons name="play-arrow" size={26} color={colors.onPrimary} />
        </View>
      )}
    </View>
  );
  const playButtonHandler = () => {
    if (!expanded) {
      setRenderSteps(true);
      setExpanded(true);
    }
    onPlayPress();
  };
  const timeStr = routine.schedule?.startTime ? formatTimeKr(routine.schedule.startTime, t) : '--:--';
  const timeTokens = timeStr.split(' ');
  const periodText = timeTokens.length > 1 ? timeTokens[0] : '';
  const timeText = timeTokens.length > 1 ? timeTokens.slice(1).join(' ') : timeStr;
  const label = daysLabel(routine.schedule?.days ?? [], t);
  const totalDurationLabel = t('routine.totalDurationFmt', {
    duration: formatDurationLabel(getRoutineTotalSeconds(routine), t),
    count: routine.steps.length,
    defaultValue: `${formatDurationLabel(getRoutineTotalSeconds(routine), t)} · ${routine.steps.length}단계`,
  });
  const stepSummary = (() => {
    const names = routine.steps.map(s => s.name).filter(Boolean);
    if (names.length === 0) return '';
    if (names.length === 1) return names[0];
    if (names.length === 2) return `${names[0]} · ${names[1]}`;
    return t('routine.moreCount', {
      name: names[0],
      count: names.length - 1,
      defaultValue: `${names[0]} 외 ${names.length - 1}개`,
    });
  })();

  const handleCardPress = () => {
    if (swipeRevealDelete) {
      Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
      setSwipeRevealDelete(false);
      return;
    }
    toggleExpanded();
  };

  return (
    <View ref={wrapperRef} style={{ position: 'relative', marginHorizontal: 16, marginBottom: 0 }}>
      {/* 삭제 — 우측 스와이프로 왼쪽(펜슬 있던 자리)에 노출. */}
      <Animated.View
        pointerEvents={swipeRevealDelete && !isActiveCard ? 'auto' : 'none'}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          height: mainCardHeight,
          width: EDIT_SLIDE_WIDTH,
          paddingRight: 6,
          opacity: swipeDeleteOpacity,
        }}
      >
        <TouchableOpacity
          onPress={() => {
            Alert.alert(
              t('routine.deleteConfirmTitle'),
              t('routine.deleteConfirmBody'),
              [
                {
                  text: t('common.cancel'),
                  style: 'cancel',
                  onPress: () => {
                    Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
                    setSwipeRevealDelete(false);
                  },
                },
                {
                  text: t('routine.actionDelete'),
                  style: 'destructive',
                  onPress: () => {
                    Animated.timing(translateX, { toValue: 500, duration: 220, useNativeDriver: true }).start(onDelete);
                  },
                },
              ],
              { cancelable: true, onDismiss: () => { Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start(); setSwipeRevealDelete(false); } }
            );
          }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <View
            style={{
              width: 48,
              height: 48,
              borderRadius: 24,
              backgroundColor: colors.primary,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <MaterialIcons name="delete" size={24} color={colors.onPrimary} />
          </View>
        </TouchableOpacity>
      </Animated.View>

      <Animated.View
        {...panResponder.panHandlers}
        style={{
          transform: [{ translateX }],
          alignSelf: 'stretch',
        }}
      >
        <TouchableOpacity
          activeOpacity={0.92}
          onPress={handleCardPress}
          onLongPress={onEditPencil}
          style={styles.routineCard}
        >
        <View
          style={styles.routineCardMain}
          onLayout={e => setMainCardHeight(e.nativeEvent.layout.height + 28)}
        >
          <View style={styles.routineCardLeft}>
            {mode === 'scheduled' ? (
              <View style={styles.routineTimeRow}>
                <Text style={styles.routineTimeText}>{timeText}</Text>
                {!!periodText && <Text style={styles.routinePeriodText}>{periodText}</Text>}
              </View>
            ) : (
              <Text
                style={styles.routineTimeText}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.78}
              >
                {routine.name || categoryLabel}
              </Text>
            )}
            <Text style={styles.routineNameText} numberOfLines={1}>
              {mode === 'scheduled' ? (routine.name || categoryLabel) : (stepSummary || categoryLabel)}
            </Text>
            {/* 예약 루틴: 요일을 첫 줄, [N단계]+루틴 시간을 둘째 줄로 분리(한 줄에 몰려 잘리던 문제 해결). */}
            {mode === 'scheduled' ? (
              <>
                <View style={styles.routineMetaRow}>
                  <DaysRow label={label} colors={colors} />
                </View>
                <View style={styles.routineMetaRow}>
                  <View style={styles.routineStepBadge}>
                    <MaterialIcons name="playlist-play" size={12} color={isDark ? colors.onPrimary : colors.primary} />
                    <Text style={styles.routineStepBadgeText}>{t('alarm.stepBadge', { count: routine.steps.length, defaultValue: `${routine.steps.length}단계` })}</Text>
                  </View>
                  <Text style={styles.routineMetaText} numberOfLines={1}>{totalDurationLabel}</Text>
                </View>
              </>
            ) : (
              // manual 루틴: 카테고리는 섹션 제목과 중복이라 제외. [N단계] + 루틴 시간만 한 줄.
              <View style={styles.routineMetaRow}>
                <View style={styles.routineStepBadge}>
                  <MaterialIcons name="playlist-play" size={12} color={isDark ? colors.onPrimary : colors.primary} />
                  <Text style={styles.routineStepBadgeText}>{t('alarm.stepBadge', { count: routine.steps.length, defaultValue: `${routine.steps.length}단계` })}</Text>
                </View>
                <Text style={styles.routineMetaText} numberOfLines={1}>{totalDurationLabel}</Text>
              </View>
            )}
          </View>
          {isActiveCard ? null : isEditMode ? (
            // 편집 모드 — ▶ 대신 펜슬. 누르면 그 루틴 편집창으로.
            <TouchableOpacity
              onPress={onEditPencil}
              activeOpacity={0.7}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <View style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
                <MaterialIcons name="edit" size={26} color={colors.primary} />
              </View>
            </TouchableOpacity>
          ) : mode === 'scheduled' ? (
            <Switch
              value={routine.active}
              onValueChange={onToggleActive}
              trackColor={{ false: '#E5E5EA', true: '#34C759' }}
              thumbColor={colors.onPrimary}
              style={{ transform: [{ scale: 0.78 }] }}
            />
          ) : (
            <TouchableOpacity
              onPress={playButtonHandler}
              activeOpacity={0.7}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              {playButtonVisual}
            </TouchableOpacity>
          )}
        </View>

        {activeRunNode ? (
          <View style={[styles.routineExpanded, { display: expanded ? 'flex' : 'none' }]}>
            {activeRunNode}
          </View>
        ) : (
          renderSteps && (
            <View style={styles.routineExpanded}>
              {routine.steps.map((step, idx) => (
                <StepRow key={step.id} step={step} idx={idx} colors={colors} visible={expanded} totalSteps={routine.steps.length} />
              ))}
            </View>
          )
        )}

        <View style={styles.routineExpandIndicator}>
          <MaterialIcons
            name={expanded ? 'keyboard-arrow-up' : 'keyboard-arrow-down'}
            size={18}
            color="#C7C7CC"
          />
        </View>
        </TouchableOpacity>
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

// 릴리스 빌드 루틴 생성 상한 (디버그 빌드 __DEV__ 는 무제한). 단계 제한 MAX_STEPS=3 과 동일한 비즈니스 의도.
const MAX_ROUTINES = 3;

export default function RoutineListScreen({ navigation, route }: Props) {
  const { colors, isDark } = useTheme();
  const { t } = useTranslation();
  const styles = makeStyles(colors, isDark);
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [scheduleStatus, setScheduleStatus] = useState<ScheduleStatus | null>(null);
  // v2.0 C-3-4 — useState<ActiveRoutine> 측 useActiveRoutineAr() 측 대체. 1초 polling 폐기 + dispatch 자동 갱신.
  //   alias `activeRoutine` 측 caller 측 변경 0.
  const { ar: activeRoutine } = useActiveRoutineAr();
  // 섹션 "편집" 모드 — 해당 카테고리 카드들의 ▶ 를 펜슬로 교체.
  const [editingCategory, setEditingCategory] = useState<string | null>(null);
  const [customCategories, setCustomCategories] = useState<CategoryDef[]>([]);
  // v1.6 hotfix — @preserve scheduled-routine. 예약 루틴 임시 비활성. 'manual' 기본 강제.
  // 향후 알람 패러다임 분리 (예약 = AlarmKit 단발/반복) 결정 후 복원. 'scheduled' 로 되돌리면 됨.
  const [activeTab, setActiveTab] = useState<RoutineMode>('manual');
  const [createPickerVisible, setCreatePickerVisible] = useState(false);
  const [activeManualRoutineId, setActiveManualRoutineId] = useState<string | null>(null);
  const [collapseSignal, setCollapseSignal] = useState(0);

  // v1.6 Phase 12 — 위젯 ✕ stop 시 RoutineListScreen activeManualRoutineId 정리.
  // 외부 stop 경로 (App.tsx handleControlSignal stop 분기) 에서 emit → 즉시 ActiveRoutineSection 언마운트.
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('routineClearedExternally', () => {
      setActiveManualRoutineId(null);
      // v2.0 C-3-4 — setActiveRoutine 폐기. useActiveRoutineAr 측 자동 갱신 (Stop dispatch 측 ar=null).
    });
    return () => sub.remove();
  }, []);

  // 진행 중 루틴이 있을 때 자동으로 해당 카드로 스크롤 — routineId 단위 1회 (유저가 이후 자유 스크롤 가능)
  const scrollViewRef = useRef<ScrollView | null>(null);
  const scrollContainerRef = useRef<View | null>(null); // ScrollView 감싸는 View — viewport pageY 측정용
  const cardRefs = useRef<Record<string, View | null>>({});
  const autoFocusedRef = useRef<string | null>(null);
  const scrollOffsetYRef = useRef(0); // ScrollView 현재 contentOffset.y — onScroll 로 갱신

  // v1.8 — RoutineEdit 저장 후 AsyncStorage 측 pendingRoutineInitialTab 읽기 → activeTab 동기 + 즉시 삭제.
  // 직전 = route.params?.initialTab 측 popTo 패턴 → AsyncStorage 측 전환 (= RoutineList Stack.Screen 제거 정합).
  useFocusEffect(
    useCallback(() => {
      AsyncStorage.getItem('pendingRoutineInitialTab').then((val) => {
        if (val === 'scheduled' || val === 'manual') {
          setActiveTab(val);
          AsyncStorage.removeItem('pendingRoutineInitialTab').catch(() => {});
        }
      }).catch(() => {});
    }, [])
  );

  const formatCategoryLabel = useCallback((id: string): string => {
    const fixed = FIXED_CATEGORIES.find(c => c.id === id);
    if (fixed && fixed.labelKey) return t(fixed.labelKey);
    const custom = customCategories.find(c => c.id === id);
    if (custom?.label) return custom.label;
    return id;
  }, [t, customCategories]);

  const refreshAll = useCallback(async () => {
    const list = await loadRoutines();
    setRoutines(list);
    const status = await loadScheduleStatus();
    setScheduleStatus(status);
    // v2.0 C-3-4 — setActiveRoutine 호출 폐기. useActiveRoutineAr 측 자동 갱신.
    const custom = await loadCustomCategories();
    setCustomCategories(custom);
  }, []);

  useFocusEffect(
    useCallback(() => {
      refreshAll();
    }, [refreshAll])
  );

  // v2.0 C-3-4 — 1초 polling useEffect 폐기. useActiveRoutineAr 측 dispatch subscribe 측 즉시 갱신.
  //   옛 1초 polling = 효율 손해 (1초 delay + 매초 setState 비교 측 부담). 새 path = 0 delay + setState 0 (subscribe).

  // (nowMs 250ms tick 제거 — 부모 리렌더 빈도 감소. 카드 게이지는 RoutineCard 자체 tick 으로 계산)

  // 외부 진입 (알람 응답 등) 으로 활성 routine 이 있으면 inline 진행 자동 마운트.
  // 한 방향 sync 만 — cleared 는 ActiveRoutineSection 의 onClose 에서 처리.
  // (cleared 분기 두면 ▶ trigger 직후 activeRoutine 이 아직 undefined 라 즉시 reset 되는 race 발생)
  // v1.7 Phase 2-A — ad-hoc 알람 routine 측 = 본 화면 비노출 = state 오염 ❌. 가드.
  useEffect(() => {
    if (activeRoutine?.routineId && isAdhocAlarmRoutine(activeRoutine.routineId)) return;
    if (activeRoutine?.routineId && activeManualRoutineId !== activeRoutine.routineId) {
      setActiveManualRoutineId(activeRoutine.routineId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRoutine?.routineId]);

  // 진행 중 루틴 감지 시: 해당 모드의 탭으로 자동 전환 + 카드 위치로 스크롤 (routineId 단위 1회)
  // v1.7 Phase 2-A — ad-hoc 알람 routine 측 = 본 화면 카드 ❌ → 자동 탭 전환 / 스크롤 무의미 + silent fail. 가드.
  useEffect(() => {
    const id = activeRoutine?.routineId;
    if (!id) return;
    if (isAdhocAlarmRoutine(id)) return;
    if (autoFocusedRef.current === id) return;
    if (!routines.length) return;
    const routine = routines.find(r => r.id === id);
    if (!routine) return;
    const mode = getRoutineMode(routine);
    if (activeTab !== mode) {
      setActiveTab(mode);
      return; // 탭 전환 후 다음 렌더에서 카드 마운트 → 다시 진입
    }
    // 카드 mount + onLayout 완료 대기 후 측정.
    // RN 0.81 + Fabric: measureLayout 의 native node 인자 호환성 깨져 사용 불가
    // (ScrollView.getInnerViewNode() 도 Fabric 에선 무효한 ref 반환). public measure API 로 우회 —
    // card.measure 의 pageY (window 좌표) + 컨테이너 pageY 차이로 viewport 내 offset 산출,
    // 현재 scroll offset (scrollOffsetYRef) 더해 절대 scroll 위치 계산.
    const timer = setTimeout(() => {
      const card = cardRefs.current[id];
      const sv = scrollViewRef.current;
      const container = scrollContainerRef.current;
      if (!card || !sv || !container) return;
      container.measure((_cx: number, _cy: number, _cw: number, _ch: number, _cpx: number, containerPageY: number) => {
        card.measure((_x: number, _y: number, _w: number, _h: number, _pageX: number, cardPageY: number) => {
          const offsetInViewport = cardPageY - containerPageY;
          const target = scrollOffsetYRef.current + offsetInViewport - 16;
          sv.scrollTo({ y: Math.max(0, target), animated: true });
          autoFocusedRef.current = id;
        });
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [activeRoutine?.routineId, routines, activeTab]);

  // 2026-06-03 (#FireNavToTab) — 다른 탭→RoutineTab 진입(포커스) 시 진행 중 저장 루틴 카드로 스크롤.
  //   위 effect(routineId당 1회 autoFocusedRef 가드)는 이미 본 루틴으로 재진입 시 스크롤 안 함.
  //   #2(다른 탭→RoutineTab 이동) 후, 저장 루틴이 많아 활성 카드가 화면 밖이면 안 보임 →
  //   포커스 시점에 활성 루틴 카드로 한 번 더 맞춤. (AlarmTab #FireNavToTab 스크롤과 대칭)
  useFocusEffect(
    useCallback(() => {
      const id = activeRoutine?.routineId;
      if (!id || isAdhocAlarmRoutine(id)) return;
      const routine = routines.find(r => r.id === id);
      if (!routine) return;
      if (activeTab !== getRoutineMode(routine)) return; // 탭 다르면 위 effect가 탭 전환 후 스크롤 담당
      const timer = setTimeout(() => {
        const card = cardRefs.current[id];
        const sv = scrollViewRef.current;
        const container = scrollContainerRef.current;
        if (!card || !sv || !container) return;
        container.measure((_cx: number, _cy: number, _cw: number, _ch: number, _cpx: number, containerPageY: number) => {
          card.measure((_x: number, _y: number, _w: number, _h: number, _pageX: number, cardPageY: number) => {
            const offsetInViewport = cardPageY - containerPageY;
            const target = scrollOffsetYRef.current + offsetInViewport - 16;
            sv.scrollTo({ y: Math.max(0, target), animated: true });
          });
        });
      }, 300);
      return () => clearTimeout(timer);
    }, [activeRoutine?.routineId, routines, activeTab])
  );

  // v1.7 Phase 2-A — ad-hoc 알람 routine (= prefix 'aa_') 측 = 루틴 탭 비노출. UI 격리.
  const filteredRoutines = useMemo(
    () => routines.filter(r => !isAdhocAlarmRoutine(r.id) && getRoutineMode(r) === activeTab),
    [routines, activeTab],
  );
  const grouped = useMemo(() => groupByCategory(filteredRoutines, t), [filteredRoutines, t]);

  // 통일된 ▶ 핸들러 — 예약/일반 모두 inline ActiveRoutineSection 마운트.
  // 분기/needs_override/needs_timer_override 는 ActiveRoutineSection 의 init 에서 askUser 로 처리.
  // 진행 시작 시 다른 펼친 카드들 자동 접기 (collapseSignal trigger)
  // v1.8 #AlarmRoutineConflict — 일반 루틴 시작 시 알람 루틴 다음 트리거 시각 검사.
  // 루틴 총 소요 시간 + 5분 버퍼 안에 알람 트리거 있으면 경고 dialog → 사용자 "시작" 누름 시
  // 충돌 알람 임시 disable + AlarmKit cancel + AsyncStorage 측 ID 저장 → fullCleanup 측 측 재활성화.
  const proceedPlay = useCallback(async (routine: Routine, conflictAlarmId?: string) => {
    if (conflictAlarmId) {
      try {
        const alarms = await loadAlarms();
        const target = alarms.find(a => a.id === conflictAlarmId);
        if (target && target.enabled) {
          await upsertAlarm({ ...target, enabled: false });
          await cancelAlarmsForEntity(conflictAlarmId);
          const prevRaw = await AsyncStorage.getItem(PENDING_DISABLED_ALARMS_KEY);
          const prev: string[] = prevRaw ? JSON.parse(prevRaw) : [];
          if (!prev.includes(conflictAlarmId)) prev.push(conflictAlarmId);
          await AsyncStorage.setItem(PENDING_DISABLED_ALARMS_KEY, JSON.stringify(prev));
        }
      } catch (e) {
        Logger.warn('routine', `alarmConflict disable fail err=${String(e)}`);
      }
    }
    setActiveManualRoutineId(routine.id);
    setCollapseSignal(Date.now());
  }, []);

  const handlePlay = useCallback(async (routine: Routine) => {
    // v1.8 #TimerRoutineCoexist — 루틴 시작 시 진행 중 타이머 측 dialog 폐기 (= 본 cycle B-2 측 정정 측 되돌림).
    //   AlarmKit framework 측 = scheduled (= 알람) + countdown (= 타이머/루틴 step) 측 = 동시 활성 가능 측 추정.
    //   동시 진행 ✅ + 64개 측 한계 도달 시 = 다음 cycle 측 별도 처리.
    try {
      const alarms = await loadAlarms();
      const alarmRoutines = alarms.filter(a => a.enabled && a.steps && a.steps.length > 0);
      const now = Date.now();
      const totalSec = getRoutineTotalSeconds(routine);
      const limitMs = now + (totalSec + 300) * 1000; // 5분 버퍼
      let conflict: { time: number; label: string; alarmId: string; isUserAlarm: boolean } | null = null;
      for (const a of alarmRoutines) {
        const next = nextAlarmOccurrenceTime(a, new Date(now));
        if (next !== null && next >= now && next <= limitMs) {
          if (!conflict || next < conflict.time) {
            conflict = { time: next, label: a.label || t('history.alarmDefaultLabel', { defaultValue: '알람' }), alarmId: a.id, isUserAlarm: true };
          }
        }
      }
      // v1.9 #AlarmTimerConflictRoutine — native alarm 측 추가 검사 (= 다른 routine 진행 중 confirm_prompt + 사용자 알람 chain).
      //   직전 = alarmRoutines 측 (= AsyncStorage 알람 루틴) 측만 검사 → 진행 중 routine alarm 측 누락 → dialog 미노출.
      //   정정 = AlarmkitBridge.listAlarms() + mapping table 측 type 측 추가 검사.
      //   isUserAlarm=false 측 (= 다른 routine alarm) "그래도 시작" 측 = cancel ❌ + 동시 진행 (= 다른 routine 종료 X).
      try {
        const nativeAlarms = await AlarmkitBridge.listAlarms();
        const allMeta = await listAllAlarmMetadata();
        const userAlarmIds = new Set(alarmRoutines.map(a => a.id));
        for (const native of nativeAlarms) {
          let nextFire: number | null = null;
          if (native.state === 'countdown' && native.preAlertSeconds != null) {
            nextFire = now + native.preAlertSeconds * 1000;
          } else if (native.state === 'scheduled' && native.fixedFireMs != null) {
            nextFire = native.fixedFireMs;
          }
          if (nextFire === null || nextFire < now || nextFire > limitMs) continue;
          const meta = allMeta.find(m => m.alarmId === native.id);
          if (!meta) continue;
          if (meta.type !== 'confirm_prompt' && meta.type !== 'alarm_main' && meta.type !== 'timer_main') continue;
          if (meta.type === 'alarm_main' && userAlarmIds.has(meta.entityId)) continue;
          const label = meta.type === 'confirm_prompt'
            ? t('routine.routineAlarmLabel', { defaultValue: '루틴 진행 중 알람' })
            : meta.type === 'timer_main'
              ? t('routine.timerAlarmLabel', { defaultValue: '진행 중인 타이머' })
              : t('history.alarmDefaultLabel', { defaultValue: '알람' });
          if (!conflict || nextFire < conflict.time) {
            conflict = { time: nextFire, label, alarmId: meta.entityId, isUserAlarm: false };
          }
        }
      } catch (e) {
        Logger.warn('routine', `alarmConflict native check fail err=${String(e)}`);
      }
      if (conflict) {
        // v1.9 #AlarmConflictDialogSimplify — 시각 표시 제거 (= 잔존 native alarm 측 오류 가능성 회피).
        //   라벨만 유지 → 사용자 측 충돌 종류 인지 + 정확한 시각 측 false positive 방지.
        const c = conflict;
        Alert.alert(
          t('routine.alarmConflictTitle'),
          t('routine.alarmConflictBody', { alarmLabel: c.label }),
          [
            { text: t('routine.alarmConflictCancel'), style: 'cancel' },
            { text: t('routine.alarmConflictProceed'), onPress: () => proceedPlay(routine, c.isUserAlarm ? c.alarmId : undefined) },
          ],
          { cancelable: true }
        );
        return;
      }
    } catch (e) {
      Logger.warn('routine', `alarmConflict check fail err=${String(e)}`);
    }
    proceedPlay(routine);
  }, [t, proceedPlay]);

  // ActiveRoutineSection onClose — useCallback 으로 stable. 매 부모 리렌더마다 새 inline arrow 가
  // 자식 useCallback (handleAutoNow 등) dep cascade 트리거하던 문제 차단 → auto countdown setTimeout 정상 fire.
  // v1.7 hotfix #DBG-StopNav — onClose 호출 진입 디버그 추가. dep 영역 추가 ❌ (= 자식 useCallback dep cascade 회귀 차단).
  const handleActiveRoutineClose = useCallback(() => {
    Logger.warn('StopNav-DBG', 'RoutineListScreen.handleActiveRoutineClose ENTER (= 앱 안 정지 진입 시점)');
    setActiveManualRoutineId(null);
    refreshAll();
  }, [refreshAll]);

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
    // 활성 카드 가드 (defense-in-depth — 1차 차단은 RoutineCard 의 disabled/pointerEvents)
    const isActive = activeRoutine?.routineId === routine.id || activeManualRoutineId === routine.id;
    if (isActive) {
      Alert.alert(t('routine.deleteBlocked.title'), t('routine.deleteBlocked.body'));
      return;
    }
    await cancelRoutinePrealerts(routine.id);
    await deleteRoutine(routine.id);
    await refreshAll();
  };

  const handleEditPencil = (routine: Routine) => {
    // 활성 카드 가드 (defense-in-depth)
    const isActive = activeRoutine?.routineId === routine.id || activeManualRoutineId === routine.id;
    if (isActive) {
      Alert.alert(t('routine.editBlocked.title'), t('routine.editBlocked.body'));
      return;
    }
    setEditingCategory(null);
    navigation.navigate('RoutineEdit', { routineId: routine.id });
  };

  // 섹션 "편집" 토글 — 누른 카테고리 편집모드 on/off.
  const toggleSectionEdit = (category: string) => {
    setEditingCategory(prev => (prev === category ? null : category));
  };

  // 진행 중인 루틴이 하나라도 있으면 모든 카드 swipe 편집/삭제 차단 (= 진행 중 다른 항목 실수 변경 방지).
  const anyRoutineActive = !!activeRoutine?.routineId || activeManualRoutineId !== null;

  // 릴리스 빌드 루틴 개수 상한 도달 여부. 디버그(__DEV__)는 무제한.
  const atRoutineLimit = !__DEV__ && routines.length >= MAX_ROUTINES;
  const handleCreateRoutine = () => {
    // 상한 도달 시 = 안내 팝업으로 차단 (추후 인앱 구매/구독 안내로 교체 가능).
    if (atRoutineLimit) {
      Alert.alert(
        t('routine.limitTitle', { defaultValue: '루틴 개수 제한' }),
        t('routine.limitBody', { defaultValue: '루틴은 최대 3개까지 만들 수 있어요.' })
      );
      return;
    }
    navigation.navigate('RoutineEdit', { mode: 'manual' });
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{t('routine.listTitle')}</Text>
        <TouchableOpacity
          style={styles.iconBtn}
          onPress={handleCreateRoutine}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          {/* 상한 도달 시 회색 — 누르면 안내 팝업 */}
          <MaterialIcons name="add" size={28} color={atRoutineLimit ? colors.secondary : colors.primary} />
        </TouchableOpacity>
      </View>

      {/*
        ═══════════════════════════════════════════════════════════
        @preserve scheduled-routine — v1.6 hotfix 임시 비활성.
        예약 루틴을 알람 패러다임으로 분리할지 결정 전까지 모달/탭 모두 가시화 ❌.
        기존 데이터 (storage / scheduler prealert) 는 보존 — UI 만 차단.
        복원 시: 본 주석 블록 해제 + + 버튼 onPress 를 setCreatePickerVisible(true) 로 되돌림.
        ═══════════════════════════════════════════════════════════

      <Modal
        visible={createPickerVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setCreatePickerVisible(false)}
      >
        <TouchableOpacity
          style={styles.modalBackdrop}
          activeOpacity={1}
          onPress={() => setCreatePickerVisible(false)}
        >
          <TouchableOpacity activeOpacity={1} style={styles.modalSheet} onPress={() => {}}>
            <Text style={styles.modalTitle}>{t('routine.createPickType')}</Text>
            {(['scheduled', 'manual'] as const).map(m => (
              <TouchableOpacity
                key={m}
                style={styles.modalOption}
                activeOpacity={0.7}
                onPress={() => {
                  setCreatePickerVisible(false);
                  navigation.navigate('RoutineEdit', { mode: m });
                }}
              >
                <MaterialIcons
                  name={m === 'scheduled' ? 'alarm' : 'play-circle-outline'}
                  size={24}
                  color={colors.primary}
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.modalOptionTitle}>
                    {t(m === 'scheduled' ? 'routine.createScheduled' : 'routine.createManual')}
                  </Text>
                  <Text style={styles.modalOptionDesc}>
                    {t(m === 'scheduled' ? 'routine.createScheduledDesc' : 'routine.createManualDesc')}
                  </Text>
                </View>
                <MaterialIcons name="chevron-right" size={22} color={colors.secondary} />
              </TouchableOpacity>
            ))}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <View style={styles.tabBar}>
        {(['scheduled', 'manual'] as const).map(tab => {
          const selected = activeTab === tab;
          return (
            <TouchableOpacity
              key={tab}
              style={[styles.tabBtn, selected && styles.tabBtnSelected]}
              onPress={() => setActiveTab(tab)}
              activeOpacity={0.7}
            >
              <Text style={[styles.tabText, selected && styles.tabTextSelected]}>
                {t(tab === 'scheduled' ? 'routine.tabScheduled' : 'routine.tabManual')}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
      */}

      <View ref={scrollContainerRef} style={{ flex: 1 }}>
      <ScrollView
        ref={scrollViewRef}
        showsVerticalScrollIndicator={false}
        onScroll={e => { scrollOffsetYRef.current = e.nativeEvent.contentOffset.y; }}
        scrollEventThrottle={32}
      >
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

        {filteredRoutines.length === 0 ? (
          <View style={styles.emptyBox}>
            <MaterialIcons name="playlist-add" size={48} color={colors.secondary} />
            <Text style={styles.emptyText}>
              {t(activeTab === 'scheduled' ? 'routine.emptyTitleScheduled' : 'routine.emptyTitleManual')}
            </Text>
            <TouchableOpacity
              style={styles.emptyBtn}
              onPress={handleCreateRoutine}
            >
              <MaterialIcons name="add" size={20} color={colors.onPrimary} />
              <Text style={styles.emptyBtnText}>
                {t('routine.add', { defaultValue: 'Add Routine' })}
              </Text>
            </TouchableOpacity>
          </View>
        ) : (
          grouped.map(({ category, items }) => (
            <View key={category} style={{ marginTop: 16 }}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>{formatCategoryLabel(category)}</Text>
                <TouchableOpacity
                  onPress={() => toggleSectionEdit(category)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text style={styles.sectionEditBtn}>
                    {editingCategory === category ? t('routine.sectionDone') : t('routine.actionEdit')}
                  </Text>
                </TouchableOpacity>
              </View>
              {items.map((r) => {
                // activeManualRoutineId 포함 — ▶ trigger 직후 polling 전이라도 자기 카드 isActive 인식
                const isActiveCard = (!!activeRoutine && activeRoutine.routineId === r.id) || activeManualRoutineId === r.id;
                return (
                  <RoutineCard
                    key={r.id}
                    routine={r}
                    categoryLabel={formatCategoryLabel(r.category)}
                    styles={styles}
                    colors={colors}
                    isEditMode={editingCategory === category}
                    onPlayPress={async () => {
                      // 진행 중 카드 → pause/resume 토글. 그 외 → start.
                      if (isActiveCard && activeRoutine) {
                        // v2.0 C-3-4 — setActiveRoutine 폐기. useActiveRoutineAr 측 자동 갱신.
                        if (activeRoutine.pausedAt) {
                          await resumeRoutine();
                        } else {
                          await pauseRoutine();
                        }
                      } else {
                        handlePlay(r);
                      }
                    }}
                    onToggleActive={value => handleToggleActive(r, value)}
                    onDelete={() => handleDelete(r)}
                    onEditPencil={() => handleEditPencil(r)}
                    activeRoutine={isActiveCard ? activeRoutine : undefined}
                    collapseSignal={collapseSignal}
                    isActiveCard={isActiveCard}
                    swipeDisabled={anyRoutineActive}
                    wrapperRef={node => { cardRefs.current[r.id] = node; }}
                    activeRunNode={
                      activeManualRoutineId === r.id ? (
                        <ActiveRoutineSection
                          routineId={r.id}
                          onClose={handleActiveRoutineClose}
                        />
                      ) : undefined
                    }
                  />
                );
              })}
            </View>
          ))
        )}
        <View style={{ height: 24 }} />
      </ScrollView>
      </View>
      {/* v1.9 #AdBannerConsolidate — AdBanner 측 = MainTabsNavigator tabBar prop 통합 측 이동. */}
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors, isDark: boolean) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surfaceContainerLowest },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 2,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: isDark ? colors.outlineVariant : '#D1D1D6',
  },
  headerTitle: {
    fontSize: 32,
    fontWeight: '700',
    color: colors.onBackground,
    letterSpacing: -0.5,
  },
  iconBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  routineCard: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: 0,
    padding: 14,
    position: 'relative',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: isDark ? colors.outlineVariant : '#D1D1D6',
  },
  routineCardMain: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  routineCardLeft: {
    flex: 1,
    paddingEnd: 12,
    gap: 3,
  },
  routineTimeRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
  },
  routineTimeText: {
    fontSize: 34,
    fontWeight: '700',
    color: colors.onBackground,
    letterSpacing: -0.5,
  },
  routinePeriodText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.secondary,
  },
  routineNameText: {
    fontSize: 15,
    fontWeight: '500',
    color: colors.onBackground,
    marginTop: 2,
  },
  routineMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 2,
    flexWrap: 'wrap',
  },
  routineMetaText: {
    fontSize: 13,
    color: colors.secondary,
  },
  routineStepBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: isDark ? colors.primary : '#FFEBE9',
  },
  routineStepBadgeText: {
    fontSize: 12,
    fontWeight: '500',
    color: isDark ? colors.onPrimary : colors.primary,
  },
  routineExpanded: {
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: isDark ? colors.outlineVariant : '#D1D1D6',
    backgroundColor: colors.surfaceContainerLowest,
  },
  routineExpandIndicator: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    minHeight: 10,
  },
  tabBar: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginBottom: 8,
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: 10,
    padding: 3,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  tabBtnSelected: {
    backgroundColor: '#ffb88c',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  tabText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.secondary,
  },
  tabTextSelected: {
    color: '#ffffff',
    fontWeight: '700',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingTop: 20,
    paddingBottom: 36,
    paddingHorizontal: 16,
    gap: 8,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.onBackground,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  modalOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: colors.surfaceContainerLow,
  },
  modalOptionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.onBackground,
  },
  modalOptionDesc: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.secondary,
    marginTop: 2,
  },
  emptyBox: {
    marginTop: 80,
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  emptyText: {
    fontSize: 15,
    color: colors.secondary,
    marginTop: 12,
    marginBottom: 20,
    textAlign: 'center',
  },
  emptyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },
  emptyBtnText: {
    color: colors.onPrimary,
    fontSize: 14,
    fontWeight: '600',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 16,
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
