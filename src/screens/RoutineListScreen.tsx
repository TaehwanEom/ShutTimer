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
  Modal,
  DeviceEventEmitter,
} from 'react-native';
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
  loadActiveRoutine,
  getRoutineMode,
  getRoutineTotalSeconds,
} from '../constants/routines';
import {
  cancelRoutinePrealerts,
  scheduleRoutinePrealerts,
  loadScheduleStatus,
  ScheduleStatus,
} from '../utils/routineScheduler';
import { isAdhocAlarmRoutine } from '../utils/alarmRoutineLink';
import { Logger } from '../utils/logger';
import {
  pauseRoutine,
  resumeRoutine,
} from '../utils/routineController';
import {
  FIXED_CATEGORIES,
  CategoryDef,
  loadCustomCategories,
} from '../constants/categories';
import AdBanner from '../components/AdBanner';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'RoutineList'>;
  route: RouteProp<RootStackParamList, 'RoutineList'>;
};

const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
// 시각 캡 (Move 시 translateX 가 막히는 위치)
const SWIPE_MAX = 96;
const EDIT_SLIDE_WIDTH = 56;
// Release 시 거리 임계값 — 시각 캡의 1/3 정도로 낮춤. velocity 기반 보조 트리거 함께 사용.
const TRASH_DISTANCE_THRESHOLD = 32;  // SWIPE_MAX / 3
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

function formatTimeKr(hhmm: string): string {
  const [hStr, mStr] = hhmm.split(':');
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  if (isNaN(h) || isNaN(m)) return hhmm;
  const ampm = h < 12 ? '오전' : '오후';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${ampm} ${h12}:${String(m).padStart(2, '0')}`;
}

// ─── 단계 시간 포맷: 초 → "Xh Ym Zs" 한국어 ─────────────────

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

// ─── 단계 카드 (펼침 시 stagger 등장 애니메이션) ─────────────

function StepRow({ step, idx, colors, visible, totalSteps }: { step: RoutineStep; idx: number; colors: ThemeColors; visible: boolean; totalSteps: number }) {
  const { isDark } = useTheme();
  const anim = useRef(new Animated.Value(0)).current;
  // 라이트: theme 톤이 배경(#f9f9fe)과 차이 미세 → 명확한 회색 hardcode. 다크: 원본 hierarchy 유지.
  const stepCardBg = isDark ? colors.surfaceContainerLow : '#d1dceaff';
  const durationBadgeBg = isDark ? colors.surfaceContainerLowest : '#d1dceaff';

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
        borderRadius: 14,
        padding: 18,
        marginTop: 10,
        opacity: anim,
        transform: [{ translateY }],
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Text
          style={{ flex: 1, fontSize: 17, fontWeight: '700', color: colors.onBackground }}
          numberOfLines={1}
        >
          {step.name}
        </Text>
        <View
          style={{
            paddingVertical: 6,
            paddingHorizontal: 12,
            borderRadius: 8,
            backgroundColor: durationBadgeBg,
          }}
        >
          <Text style={{ fontSize: 17, fontWeight: '700', color: colors.onBackground }}>
            {formatDurationLabel(step.durationSeconds)}
          </Text>
        </View>
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
  colors: ThemeColors;
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
  /** 카드 외곽 wrapper 의 native ref — 부모가 measureLayout 으로 스크롤 위치 계산 시 사용 */
  wrapperRef?: (node: View | null) => void;
};

function RoutineCard({ routine, categoryLabel, colors, isEditMode, onPlayPress, onToggleActive, onDelete, onEditPencil, activeRunNode, activeRoutine, collapseSignal, isActiveCard, wrapperRef }: CardProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const translateX = useRef(new Animated.Value(0)).current;
  const swipeOffsetRef = useRef(0);
  const editAnim = useRef(new Animated.Value(0)).current;
  const [expanded, setExpanded] = useState(false);
  const [renderSteps, setRenderSteps] = useState(false);
  const collapseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // cold-start 복원 시 활성 카드 자동 펼침 (routineId 단위 1회 — 사용자가 이후 수동 접기 가능)
  const autoExpandedRef = useRef(false);
  const [mainCardHeight, setMainCardHeight] = useState(0);
  // 라이트: theme 톤이 배경(#f9f9fe)과 차이 미세 → 명확한 회색 hardcode. 다크: 원본 hierarchy 유지.
  const mainCardBg = isDark ? colors.surfaceContainerLowest : '#e2e8f1ff';

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

  // 편집 모드 진입/해제 애니메이션 (좌→우 슬라이드로 편집 아이콘 노출)
  // 진행 중 카드는 isEditMode 무시 — 카드 슬라이드/펜슬 opacity 둘 다 0 유지
  useEffect(() => {
    Animated.spring(editAnim, {
      toValue: isEditMode && !isActiveCard ? 1 : 0,
      useNativeDriver: true,
      bounciness: 4,
      speed: 14,
    }).start();
  }, [isEditMode, isActiveCard, editAnim]);

  // swipe 양수 도달 시 편집 펜슬 클릭 가능 (pointerEvents 'auto'). isEditMode 와 OR.
  const [swipeRevealEdit, setSwipeRevealEdit] = useState(false);
  // v1.7 — iOS Mail 패턴: swipe open 상태에서 카드 본체 tap = swipe 닫기 (= 토글 ❌).
  const [swipeRevealTrash, setSwipeRevealTrash] = useState(false);

  // 편집 모드 중엔 스와이프 비활성
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_, g) =>
          !isEditMode && !isActiveCard && Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy),
        // ★ 핵심 — ScrollView 가 vertical scroll 트리거하려고 termination 요청해도 거부.
        //   미설정 시 default true → drag 중 ScrollView 가 responder 회수 → onPanResponderTerminate
        //   → snap-to-0. 사용자가 충분히 끌어도 lock 안 되는 진짜 원인.
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          translateX.stopAnimation();
        },
        onPanResponderMove: (_, g) => {
          // 우→좌 (음수, 휴지통) + 좌→우 (양수, 편집 펜슬) 둘 다 허용
          const next = Math.max(-SWIPE_MAX, Math.min(EDIT_SLIDE_WIDTH, g.dx));
          translateX.setValue(next);
          swipeOffsetRef.current = next;
        },
        onPanResponderRelease: (_, g) => {
          // 거리 OR 속도 중 하나라도 임계 초과하면 잠금 — flick / 짧은 드래그 모두 자연스럽게 잡힘
          const tx = swipeOffsetRef.current; // 시각 위치 (캡 적용된 값)
          const trashByDist = -tx >= TRASH_DISTANCE_THRESHOLD;
          const trashByVel = g.vx <= -VELOCITY_THRESHOLD;
          const editByDist = tx >= EDIT_DISTANCE_THRESHOLD;
          const editByVel = g.vx >= VELOCITY_THRESHOLD;
          if (trashByDist || (tx < 0 && trashByVel)) {
            Animated.spring(translateX, { toValue: -SWIPE_MAX, useNativeDriver: true, bounciness: 0 }).start();
            setSwipeRevealEdit(false);
            setSwipeRevealTrash(true);
          } else if (editByDist || (tx > 0 && editByVel)) {
            Animated.spring(translateX, { toValue: EDIT_SLIDE_WIDTH, useNativeDriver: true, bounciness: 0 }).start();
            setSwipeRevealEdit(true);
            setSwipeRevealTrash(false);
          } else {
            Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
            setSwipeRevealEdit(false);
            setSwipeRevealTrash(false);
          }
        },
        onPanResponderTerminate: () => {
          Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
          setSwipeRevealEdit(false);
          setSwipeRevealTrash(false);
        },
      }),
    [isEditMode, isActiveCard, translateX, t, onDelete]
  );

  const editSlide = editAnim.interpolate({ inputRange: [0, 1], outputRange: [0, EDIT_SLIDE_WIDTH] });
  // swipe 양수 시 편집 펜슬 자동 노출 (isEditMode 와 OR 조합)
  const swipeEditOpacity = translateX.interpolate({
    inputRange: [0, EDIT_SLIDE_WIDTH],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });
  const editIconOpacity = Animated.add(editAnim, swipeEditOpacity);

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
  useEffect(() => {
    if (isActiveCard) {
      translateX.setValue(0);
      swipeOffsetRef.current = 0;
      setSwipeRevealEdit(false);
      setSwipeRevealTrash(false);
    }
  }, [isActiveCard, translateX]);

  // progress / isPaused 계산 — active 카드 + activeRoutine 있을 때만
  let progress: number | undefined;
  let isPaused: boolean | undefined;
  if (isActiveCard && activeRoutine) {
    isPaused = !!activeRoutine.pausedAt;
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
  const timeStr = routine.schedule?.startTime ? formatTimeKr(routine.schedule.startTime) : '--:--';
  const label = daysLabel(routine.schedule?.days ?? [], t);
  const totalDurationLabel = t('routine.totalDurationFmt', {
    duration: formatDurationLabel(getRoutineTotalSeconds(routine)),
    count: routine.steps.length,
    defaultValue: `${formatDurationLabel(getRoutineTotalSeconds(routine))} · ${routine.steps.length}단계`,
  });
  const stepSummary = (() => {
    const names = routine.steps.map(s => s.name).filter(Boolean);
    if (names.length === 0) return '';
    if (names.length === 1) return names[0];
    if (names.length === 2) return `${names[0]} · ${names[1]}`;
    return `${names[0]} 외 ${names.length - 1}개`;
  })();

  return (
    <View
      ref={wrapperRef}
      style={{ position: 'relative', marginHorizontal: 16, marginBottom: 12 }}
    >
      {/* 휴지통 (뒤에 깔림, 스와이프 후 탭하면 삭제 확인 팝업) — touch area = reveal 영역 풀 / 시각 = 원형 56×56.
          진행 중 카드는 disabled 로 클릭 차단 (편집/삭제 양방향 차단). */}
      <TouchableOpacity
        activeOpacity={0.85}
        disabled={isActiveCard}
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
        }}
        style={{
          position: 'absolute',
          right: 0,
          top: 0,
          height: mainCardHeight,
          width: SWIPE_MAX,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <View
          style={{
            width: 56,
            height: 56,
            borderRadius: 28,
            backgroundColor: colors.primary,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <MaterialIcons name="delete" size={24} color={colors.onPrimary} />
        </View>
      </TouchableOpacity>

      {/* 편집 연필 카드 (왼쪽, 메인 카드와 동일 높이) — 진행 중 카드는 강제 비노출 */}
      <Animated.View
        pointerEvents={(isEditMode || swipeRevealEdit) && !isActiveCard ? 'auto' : 'none'}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          height: mainCardHeight,
          width: EDIT_SLIDE_WIDTH,
          paddingRight: 6,
          opacity: editIconOpacity,
        }}
      >
        <TouchableOpacity
          onPress={() => {
            // 편집 화면 진입 전 swipe 상태 리셋 — 복귀 시 펜슬 노출 상태 잔존 방지
            Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
            setSwipeRevealEdit(false);
            onEditPencil();
          }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={{
            flex: 1,
            borderRadius: 14,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: mainCardBg,
            shadowColor: '#000',
            shadowOpacity: 0.08,
            shadowRadius: 8,
            shadowOffset: { width: 0, height: 2 },
            elevation: 3,
          }}
        >
          <MaterialIcons name="edit" size={22} color={colors.primary} />
        </TouchableOpacity>
      </Animated.View>

      {/* 카드 본체 (스와이프 + 편집 슬라이드) */}
      <Animated.View
        {...panResponder.panHandlers}
        style={{
          transform: [{ translateX: Animated.add(translateX, editSlide) }],
          alignSelf: 'stretch',
        }}
      >
        {/* 칸반 카드 — 카드 본체 누르면 펼침 토글 (즉시 실행은 ▶ 버튼). v1.7 — swipe open 시 = 닫기 우선. */}
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => {
            if (swipeRevealTrash || swipeRevealEdit) {
              Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
              setSwipeRevealTrash(false);
              setSwipeRevealEdit(false);
              return;
            }
            toggleExpanded();
          }}
          onLayout={e => setMainCardHeight(e.nativeEvent.layout.height)}
          style={{
            alignSelf: 'stretch',
            backgroundColor: mainCardBg,
            borderRadius: 14,
            padding: 16,
            paddingBottom: 28, // chevron absolute 공간 확보
            justifyContent: 'center', // 컨텐츠 (시간행) 카드 본체 수직 가운데
            position: 'relative',
            shadowColor: '#000',
            shadowOpacity: 0.08,
            shadowRadius: 8,
            shadowOffset: { width: 0, height: 2 },
            elevation: 3,
          }}
        >
          {/* 루틴 명 라벨 (예약 only — 일반은 시간행 좌측 텍스트로 표시) */}
          {mode === 'scheduled' && !!routine.name && (
            <View
              style={{
                alignSelf: 'flex-start',
                backgroundColor: colors.primary,
                paddingHorizontal: 8,
                paddingVertical: 3,
                borderRadius: 6,
                marginBottom: 10,
              }}
            >
              <Text style={{ fontSize: 9, fontWeight: '700', color: colors.onPrimary }} numberOfLines={1}>
                {routine.name}
              </Text>
            </View>
          )}

          {/* 예약: 시간(좌) ▶(가운데) 토글(우)  /  일반: name+duration column(좌, 수직 가운데) ▶(우 끝, 수직 가운데) */}
          <View style={{ position: 'relative', minHeight: 60, justifyContent: 'center' }}>
            {mode === 'scheduled' ? (
              <Text style={{ fontSize: 27, fontWeight: '800', color: colors.onBackground }}>{timeStr}</Text>
            ) : (
              <View style={{ flexDirection: 'column', maxWidth: '70%' }}>
                <Text
                  style={{ fontSize: 28, fontWeight: '800', color: colors.onBackground }}
                  numberOfLines={1}
                >
                  {routine.name || categoryLabel}
                </Text>
                <Text
                  style={{
                    marginTop: 4,
                    fontSize: 8,
                    fontWeight: '700',
                    color: colors.onBackground,
                    opacity: 0.75,
                    lineHeight: 12,
                  }}
                  numberOfLines={2}
                >
                  {totalDurationLabel}
                </Text>
              </View>
            )}

            {/* ▶ 재생 — 예약: 시간행 가운데 / 일반: 시간행 우측 끝.
                pointerEvents 'box-none' 제거 — 카드 본체 onPress 가 toggleExpanded 라 ▶ 가 자기 onPress 받아야 함. */}
            <View
              pointerEvents="box-none"
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                top: 0,
                bottom: 0,
                alignItems: mode === 'manual' ? 'flex-end' : 'center',
                justifyContent: 'center',
              }}
            >
              <TouchableOpacity
                onPress={playButtonHandler}
                activeOpacity={0.7}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                {playButtonVisual}
              </TouchableOpacity>
            </View>

            {/* 토글 — 절대 우측 (예약 only) */}
            {mode === 'scheduled' && (
              <View
                style={{
                  position: 'absolute',
                  right: 0,
                  top: 0,
                  bottom: 0,
                  justifyContent: 'center',
                }}
              >
                <Switch
                  value={routine.active}
                  onValueChange={onToggleActive}
                  trackColor={{ false: colors.outlineVariant, true: colors.primary }}
                  thumbColor={colors.onPrimary}
                  style={{ transform: [{ scale: 0.8 }] }}
                />
              </View>
            )}
          </View>

          {/* 요일 (예약 only) — 일반 duration 은 시간행 안 wrapper 로 통합됨 */}
          {mode === 'scheduled' && (
            <View style={{ marginTop: 10 }}>
              <DaysRow label={label} colors={colors} />
            </View>
          )}

          {/* v자 펼침/접힘 토글 — absolute bottom. v1.7 — swipe open 시 = 닫기 우선. */}
          <TouchableOpacity
            onPress={() => {
              if (swipeRevealTrash || swipeRevealEdit) {
                Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
                setSwipeRevealTrash(false);
                setSwipeRevealEdit(false);
                return;
              }
              toggleExpanded();
            }}
            hitSlop={{ top: 8, bottom: 8, left: 16, right: 16 }}
            style={{
              position: 'absolute',
              bottom: 4,
              left: 0,
              right: 0,
              alignItems: 'center',
              paddingVertical: 2,
            }}
          >
            <MaterialIcons
              name={expanded ? 'expand-less' : 'expand-more'}
              size={22}
              color={colors.secondary}
            />
          </TouchableOpacity>

        </TouchableOpacity>

        {/* 펼침 영역 — 진행 중 일반 루틴이면 ActiveRoutineSection 표시, 아니면 단계 카드 stagger.
            진행 중에는 expanded 토글로 display:none/flex 변경 — unmount 안 해서 timer/sound/모달 진행 상태 유지. */}
        {activeRunNode ? (
          <View style={{ marginTop: 8, display: expanded ? 'flex' : 'none' }}>
            {activeRunNode}
          </View>
        ) : (
          renderSteps && routine.steps.map((step, idx) => (
            <StepRow key={step.id} step={step} idx={idx} colors={colors} visible={expanded} totalSteps={routine.steps.length} />
          ))
        )}
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

export default function RoutineListScreen({ navigation, route }: Props) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = makeStyles(colors);
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [scheduleStatus, setScheduleStatus] = useState<ScheduleStatus | null>(null);
  const [activeRoutine, setActiveRoutine] = useState<ActiveRoutine | null>(null);
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
      setActiveRoutine(null);
    });
    return () => sub.remove();
  }, []);

  // 진행 중 루틴이 있을 때 자동으로 해당 카드로 스크롤 — routineId 단위 1회 (유저가 이후 자유 스크롤 가능)
  const scrollViewRef = useRef<ScrollView | null>(null);
  const scrollContainerRef = useRef<View | null>(null); // ScrollView 감싸는 View — viewport pageY 측정용
  const cardRefs = useRef<Record<string, View | null>>({});
  const autoFocusedRef = useRef<string | null>(null);
  const scrollOffsetYRef = useRef(0); // ScrollView 현재 contentOffset.y — onScroll 로 갱신

  // RoutineEdit 저장 후 navigate 로 전달된 initialTab → activeTab 동기화 후 params clear
  useEffect(() => {
    const initialTab = route.params?.initialTab;
    if (initialTab) {
      setActiveTab(initialTab);
      navigation.setParams({ initialTab: undefined });
    }
  }, [route.params?.initialTab, navigation]);

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
    const ar = await loadActiveRoutine();
    setActiveRoutine(ar);
    const custom = await loadCustomCategories();
    setCustomCategories(custom);
  }, []);

  useFocusEffect(
    useCallback(() => {
      refreshAll();
    }, [refreshAll])
  );

  // ActiveRoutine 폴링 — activeRoutine 또는 activeManualRoutineId 있으면 1초 주기.
  // 참조 안정화 — UI 영향 필드 (routineId/currentStepIndex/stepEndAt/pausedAt/awaitingConfirm) 동일 시 setState 호출 X
  // → 부모 무한 리렌더 차단 (timer tick / auto countdown useEffect cleanup race 방지)
  useEffect(() => {
    if (!activeRoutine && !activeManualRoutineId) return;
    const tick = async () => {
      const ar = await loadActiveRoutine();
      setActiveRoutine(prev => {
        if (!ar && !prev) return prev;
        if (!ar || !prev) return ar;
        if (
          prev.routineId === ar.routineId &&
          prev.currentStepIndex === ar.currentStepIndex &&
          prev.stepEndAt === ar.stepEndAt &&
          prev.pausedAt === ar.pausedAt &&
          prev.awaitingConfirm === ar.awaitingConfirm
        ) {
          return prev; // 동일 — 리렌더 회피
        }
        return ar;
      });
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [activeRoutine?.routineId, activeManualRoutineId]);

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

  // v1.7 Phase 2-A — ad-hoc 알람 routine (= prefix 'aa_') 측 = 루틴 탭 비노출. UI 격리.
  const filteredRoutines = useMemo(
    () => routines.filter(r => !isAdhocAlarmRoutine(r.id) && getRoutineMode(r) === activeTab),
    [routines, activeTab],
  );
  const grouped = useMemo(() => groupByCategory(filteredRoutines, t), [filteredRoutines, t]);

  // 통일된 ▶ 핸들러 — 예약/일반 모두 inline ActiveRoutineSection 마운트.
  // 분기/needs_override/needs_timer_override 는 ActiveRoutineSection 의 init 에서 askUser 로 처리.
  // 진행 시작 시 다른 펼친 카드들 자동 접기 (collapseSignal trigger)
  const handlePlay = (routine: Routine) => {
    setActiveManualRoutineId(routine.id);
    setCollapseSignal(Date.now());
  };

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

  const toggleSectionEdit = (category: string) => {
    setEditingCategory(prev => (prev === category ? null : category));
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <MaterialIcons name="repeat" size={24} color={colors.onBackground} />
          <Text style={styles.headerTitle}>{t('routine.listTitle')}</Text>
        </View>
        <TouchableOpacity
          style={styles.iconBtn}
          onPress={() => navigation.navigate('RoutineEdit', { mode: 'manual' })}
        >
          <MaterialIcons name="add" size={28} color={colors.onBackground} />
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
            <Text style={styles.emptyHint}>{t('routine.emptyHint')}</Text>
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
              {items.map(r => {
                // activeManualRoutineId 포함 — ▶ trigger 직후 polling 전이라도 자기 카드 isActive 인식
                const isActiveCard = (!!activeRoutine && activeRoutine.routineId === r.id) || activeManualRoutineId === r.id;
                return (
                  <RoutineCard
                    key={r.id}
                    routine={r}
                    categoryLabel={formatCategoryLabel(r.category)}
                    colors={colors}
                    isEditMode={editingCategory === category}
                    onPlayPress={async () => {
                      // 진행 중 카드 → pause/resume 토글. 그 외 → start.
                      if (isActiveCard && activeRoutine) {
                        const next = activeRoutine.pausedAt
                          ? await resumeRoutine()
                          : await pauseRoutine();
                        if (next) setActiveRoutine(next);
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
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.outlineVariant,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '600',
    color: colors.onBackground,
  },
  iconBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
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
    fontSize: 18,
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
