// v1.6+ 알람 리스트 화면.
// AlarmKit 단독 (iOS 26+). iOS 25 이하 / Android = 안내 + 등록 UI 차단 (= 결정 7-A + 9-A).
// v1.7 Phase 1.5 — RoutineCard 패턴 채택 (= 카드형 + 양방향 swipe + tap-toggle-expand + StepRow stagger).

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Switch,
  Alert,
  Platform,
  I18nManager,
  Animated,
  PanResponder,
  DeviceEventEmitter,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { RootStackParamList } from '../../App';
import { useTheme } from '../context/ThemeContext';
import { ThemeColors } from '../constants/theme';
import {
  Alarm,
  loadAlarms,
  upsertAlarm,
  deleteAlarm,
} from '../constants/alarms';
import { RoutineStep, ActiveRoutine, loadActiveRoutine } from '../constants/routines';
import { dispatchEnableAlarm, dispatchDisableAlarm } from '../state/ActionDispatcher';
import {
  scheduleAlarmMain,
  cancelAlarmsForEntity,
} from '../utils/alarmScheduler';
import {
  createAlarmAdhocRoutineId,
  isAdhocAlarmRoutine,
} from '../utils/alarmRoutineLink';
import ActiveRoutineSection from '../components/ActiveRoutineSection';

// v1.8 — AlarmList Stack.Screen 제거. MainTabsNavigator AlarmTab Tab.Screen만 사용.
type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList>;
};

const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

// v1.7 hotfix #G7 Phase 2-B — main app target 26.0 강제 정합 → iOS 측 = AlarmKit 항상 사용 가능.
// Phase 3-4 (2026-05-26): Android 도 알람 엔진 활성화 (= alarmkit-bridge Android Module 측 setAlarmClock 정합).
function isAlarmKitSupported(): boolean {
  return Platform.OS === 'ios' || Platform.OS === 'android';
}

/** "HH:MM" → "오전/오후 H:MM" */
function formatTimeKr(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return '--:--';
  const h = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  const ampm = h < 12 ? '오전' : '오후';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${ampm} ${h12}:${String(mm).padStart(2, '0')}`;
}

function formatRepeat(alarm: Alarm, t: (k: string, opts?: any) => string): string {
  if (alarm.repeat === 'once') return t('alarm.repeat.once', { defaultValue: '한 번만' });
  if (alarm.repeat === 'daily') return t('alarm.repeat.daily', { defaultValue: '매일' });
  // weekly
  if (alarm.days.length === 0) return t('alarm.repeat.weekly', { defaultValue: '요일 선택' });
  const sorted = [...alarm.days].sort();
  return sorted
    .map(d => t(`routine.weekday.${WEEKDAY_KEYS[d]}`, { defaultValue: WEEKDAY_KEYS[d] }))
    .join(' ');
}


/** step duration 표시용 (RoutineListScreen 패턴). i18n 영영. */
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

// v1.7 Phase 1.5 — swipe 상수 (= RoutineCard 동일).
const SWIPE_MAX = 96;
const EDIT_SLIDE_WIDTH = 56;
const TRASH_DISTANCE_THRESHOLD = 32;
const EDIT_DISTANCE_THRESHOLD = 18;
const VELOCITY_THRESHOLD = 0.25;

// ─── AlarmStepRow (= RoutineListScreen StepRow 패턴 모방) ──────────

type AlarmStepRowProps = {
  step: RoutineStep;
  idx: number;
  colors: ThemeColors;
  visible: boolean;
  totalSteps: number;
  isDark: boolean;
};

function AlarmStepRow({ step, idx, colors, visible, totalSteps, isDark }: AlarmStepRowProps) {
  const { t } = useTranslation();
  const anim = useRef(new Animated.Value(0)).current;
  const stepCardBg = isDark ? colors.surfaceContainerLow : '#d1dceaff';
  const durationBadgeBg = isDark ? colors.surfaceContainerLowest : '#d1dceaff';

  useEffect(() => {
    // 펼치기: 위→아래 (idx 0 부터). 접기: 아래→위 (마지막 idx 부터, 등장 역순).
    const delay = visible ? idx * 60 : (totalSteps - 1 - idx) * 50;
    Animated.timing(anim, {
      toValue: visible ? 1 : 0,
      duration: visible ? 240 : 200,
      delay,
      useNativeDriver: true,
    }).start();
  }, [visible, anim, idx, totalSteps]);

  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [-12, 0] });
  const numStr = String(idx + 1).padStart(2, '0');
  const placeholderName = t('alarm.routineSection.stepName', {
    n: numStr,
    defaultValue: `루틴 ${numStr}`,
  });

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
          {step.name || placeholderName}
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
            {formatDurationLabel(step.durationSeconds, t)}
          </Text>
        </View>
      </View>
    </Animated.View>
  );
}

// ─── AlarmRow (= RoutineCard 패턴 모방) ─────────────────────────────

type AlarmRowProps = {
  item: Alarm;
  styles: ReturnType<typeof makeStyles>;
  colors: ThemeColors;
  isDark: boolean;
  onEdit: () => void;
  onToggle: (v: boolean) => void;
  onDelete: () => void;
  t: (k: string, opts?: any) => string;
  /** v1.7 Phase 2-B — 본 알람 측 ad-hoc routine 진행 중 = ActiveRoutineSection 인스턴스 전달. 펼침 영역 안 마운트. */
  activeRunNode?: React.ReactNode;
  /** v1.7 Phase 2-B — 본 알람 측 진행 중 = swipe 차단 + 자동 펼침 */
  isActive?: boolean;
  /** 2026-05-27 fix — 루틴/ad-hoc routine 진행 중 측 = 모든 알람 토글 disable (= 진행 중 routine 측 영향 차단). */
  toggleDisabled?: boolean;
};

function AlarmRow({ item, styles, colors, isDark, onEdit, onToggle, onDelete, t, activeRunNode, isActive, toggleDisabled }: AlarmRowProps) {
  const translateX = useRef(new Animated.Value(0)).current;
  const swipeOffsetRef = useRef(0);
  const [expanded, setExpanded] = useState(false);
  const [renderSteps, setRenderSteps] = useState(false);
  const collapseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [mainCardHeight, setMainCardHeight] = useState(0);
  const [swipeRevealEdit, setSwipeRevealEdit] = useState(false);
  // v1.7 — iOS Mail 패턴: swipe open 상태에서 카드 본체 tap = swipe 닫기 (= 토글 ❌).
  const [swipeRevealTrash, setSwipeRevealTrash] = useState(false);
  // v1.7 Phase 2-B — 진행 시작 시 자동 펼침 (= cold-start / 알람 dismiss 후 진입). routineId 단위 1회.
  const autoExpandedRef = useRef(false);

  const mainCardBg = isDark ? colors.surfaceContainerLowest : '#e2e8f1ff';
  const hasSteps = !!item.steps && item.steps.length > 0;

  // 펼침/접기 토글 — 접기 시 reverse stagger 끝난 뒤 unmount.
  const toggleExpanded = useCallback(() => {
    if (!hasSteps) return; // step 없으면 펼침 의미 ❌.
    if (collapseTimerRef.current) {
      clearTimeout(collapseTimerRef.current);
      collapseTimerRef.current = null;
    }
    if (expanded) {
      setExpanded(false);
      const lastIdx = Math.max(0, (item.steps?.length ?? 0) - 1);
      const totalMs = lastIdx * 50 + 200 + 50;
      collapseTimerRef.current = setTimeout(() => setRenderSteps(false), totalMs);
    } else {
      setRenderSteps(true);
      setExpanded(true);
    }
  }, [expanded, hasSteps, item.steps]);

  useEffect(() => {
    return () => {
      if (collapseTimerRef.current) clearTimeout(collapseTimerRef.current);
    };
  }, []);

  // v1.7 Phase 2-B — 진행 시작 시 자동 펼침 (= activeRunNode 첫 도착 시 1회).
  // 사용자가 이후 수동 접어도 같은 routine 안에서 재펼침 ❌. activeRunNode 사라지면 (= 종료) ref 리셋.
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

  // v1.7 Phase 2-B — 진행 중 알람 카드 = swipe state 강제 리셋 (= 진입 시 swipe 잔존 방지).
  useEffect(() => {
    if (isActive) {
      translateX.setValue(0);
      swipeOffsetRef.current = 0;
      setSwipeRevealEdit(false);
      setSwipeRevealTrash(false);
    }
  }, [isActive, translateX]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        // v1.7 Phase 2-B — 진행 중 알람 측 swipe 차단 (= 실수로 편집/삭제 진입 방지).
        onMoveShouldSetPanResponder: (_, g) =>
          !isActive && Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy),
        // ScrollView termination 거부 — drag 중 vertical scroll 가 responder 회수해 snap-to-0 되는 문제 차단.
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          translateX.stopAnimation();
        },
        onPanResponderMove: (_, g) => {
          // 양방향 — 우→좌 (음수, 휴지통) + 좌→우 (양수, 편집 펜슬) 둘 다 허용.
          const next = Math.max(-SWIPE_MAX, Math.min(EDIT_SLIDE_WIDTH, g.dx));
          translateX.setValue(next);
          swipeOffsetRef.current = next;
        },
        onPanResponderRelease: (_, g) => {
          const tx = swipeOffsetRef.current;
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
    [translateX, isActive],
  );

  const swipeEditOpacity = translateX.interpolate({
    inputRange: [0, EDIT_SLIDE_WIDTH],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });

  return (
    <View style={{ position: 'relative', marginHorizontal: 16, marginBottom: 12 }}>
      {/* 휴지통 — 우측 absolute. touch area = reveal 영역 풀 (= forgiving) / 시각 = 원형 56×56. */}
      <TouchableOpacity
        activeOpacity={0.85}
        disabled={isActive}
        onPress={() => {
          Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
          setSwipeRevealEdit(false);
          onDelete();
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

      {/* 편집 펜슬 — 좌측 absolute. v1.7 Phase 2-B — 진행 중 알람 = pointerEvents none. */}
      <Animated.View
        pointerEvents={swipeRevealEdit && !isActive ? 'auto' : 'none'}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          height: mainCardHeight,
          width: EDIT_SLIDE_WIDTH,
          paddingRight: 6,
          opacity: swipeEditOpacity,
        }}
      >
        <TouchableOpacity
          onPress={() => {
            Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
            setSwipeRevealEdit(false);
            onEdit();
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

      {/* 카드 본체 — translateX 스와이프 */}
      <Animated.View
        {...panResponder.panHandlers}
        style={{
          transform: [{ translateX }],
          alignSelf: 'stretch',
        }}
      >
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => {
            // v1.7 — iOS Mail 패턴: swipe open 상태 측 = 닫기 우선. 그 외 = 펼침 토글.
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
            paddingBottom: hasSteps ? 28 : 16,
            position: 'relative',
            shadowColor: '#000',
            shadowOpacity: 0.08,
            shadowRadius: 8,
            shadowOffset: { width: 0, height: 2 },
            elevation: 3,
          }}
        >
          {/* 시간 + 라벨 + meta + Switch */}
          <View style={{ position: 'relative', minHeight: 60, justifyContent: 'center' }}>
            <View style={{ paddingRight: 60 }}>
              <Text style={[styles.itemTime, !item.enabled && styles.itemDisabled]}>
                {formatTimeKr(item.time)}
              </Text>
              {item.label.length > 0 && (
                <Text style={[styles.itemLabel, !item.enabled && styles.itemDisabled]} numberOfLines={1}>
                  {item.label}
                </Text>
              )}
              <View style={styles.itemMetaRow}>
                <Text style={[styles.itemMeta, !item.enabled && styles.itemDisabled]}>
                  {formatRepeat(item, t)}
                </Text>
                {/* alarm.steps[] 보유 시 배지 노출 */}
                {hasSteps && (
                  <View
                    style={[
                      styles.stepBadge,
                      !item.enabled && { opacity: 0.4 },
                    ]}
                  >
                    <MaterialIcons name="playlist-play" size={12} color={colors.onPrimary} />
                    <Text style={styles.stepBadgeText}>
                      {t('alarm.stepBadge', {
                        defaultValue: `${item.steps!.length}단계`,
                        count: item.steps!.length,
                      })}
                    </Text>
                  </View>
                )}
              </View>
            </View>

            {/* Switch — 절대 우측 */}
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
                value={item.enabled}
                onValueChange={onToggle}
                disabled={!!toggleDisabled}
                trackColor={{ false: colors.outlineVariant, true: colors.primary }}
                style={toggleDisabled ? { opacity: 0.4 } : undefined}
              />
            </View>
          </View>

          {/* v자 펼침/접힘 토글 — alarm.steps 보유 시만 노출 */}
          {hasSteps && (
            <TouchableOpacity
              onPress={toggleExpanded}
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
          )}
        </TouchableOpacity>

        {/* 펼침 영역.
            v1.7 Phase 2-B — 진행 중 (= activeRunNode 있음) → ActiveRoutineSection 마운트 (= 카운트다운 + 컨트롤).
            그 외 → 정적 StepRow stagger.
            진행 중 expanded 토글 = display:none/flex (= unmount ❌. timer/sound/모달 진행 상태 보존). */}
        {activeRunNode ? (
          <View style={{ marginTop: 8, display: expanded ? 'flex' : 'none' }}>
            {activeRunNode}
          </View>
        ) : (
          renderSteps && item.steps?.map((step, idx) => (
            <AlarmStepRow
              key={step.id}
              step={step}
              idx={idx}
              colors={colors}
              visible={expanded}
              totalSteps={item.steps?.length ?? 0}
              isDark={isDark}
            />
          ))
        )}
      </Animated.View>
    </View>
  );
}

// ─── 메인 스크린 ─────────────────────────────────────────────────

export default function AlarmListScreen({ navigation }: Props) {
  const { colors, isDark } = useTheme();
  const { t } = useTranslation();
  const styles = makeStyles(colors);
  const [alarms, setAlarms] = useState<Alarm[]>([]);
  // v1.7 Phase 2-B — activeRoutine 측 ad-hoc 알람 routine 인 경우 = 본 화면 측 펼침 영역 안 ActiveRoutineSection 마운트.
  const [activeRoutine, setActiveRoutine] = useState<ActiveRoutine | null>(null);
  const supported = isAlarmKitSupported();

  const reload = useCallback(async () => {
    const list = await loadAlarms();
    setAlarms(list);
    const ar = await loadActiveRoutine();
    setActiveRoutine(ar);
  }, []);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload])
  );

  // v1.7 Phase 2-B — 외부 stop / cleared 신호 (= 위젯 ✕ stop / LA dismiss / 종료 cleanup) 처리.
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('routineClearedExternally', () => {
      setActiveRoutine(null);
    });
    return () => sub.remove();
  }, []);

  // v1.7 Phase 2-B — 진행 중 ad-hoc routine 있으면 1초 polling. 동일 필드 시 setState skip → 부모 리렌더 회피.
  useEffect(() => {
    const isAdhocActive = !!activeRoutine && isAdhocAlarmRoutine(activeRoutine.routineId);
    if (!isAdhocActive) return;
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
          return prev;
        }
        return ar;
      });
    };
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [activeRoutine?.routineId]);

  // v1.7 Phase 2-B — ActiveRoutineSection onClose — useCallback stable. 부모 리렌더마다 새 inline arrow 회피.
  const handleActiveRoutineClose = useCallback(() => {
    setActiveRoutine(null);
    reload();
  }, [reload]);

  const handleAdd = () => {
    if (!supported) return;
    navigation.navigate('AlarmEdit');
  };

  const handleEdit = (alarm: Alarm) => {
    navigation.navigate('AlarmEdit', { alarmId: alarm.id });
  };

  const handleToggle = async (alarm: Alarm, enabled: boolean) => {
    // v2.0 P3.7 — Session dispatch 흡수. effectRunner 가 cancelAlarmsForEntity / scheduleAlarmMain 호출.
    //   dispatchDisableAlarm 은 현 active session 이 같은 entity 면 session 도 stop (= 자연스러운 부수효과).
    const updated: Alarm = { ...alarm, enabled };
    await upsertAlarm(updated);
    if (enabled) {
      await dispatchEnableAlarm(updated.id);
    } else {
      await dispatchDisableAlarm(updated.id);
    }
    reload();
  };

  const handleDelete = (alarm: Alarm) => {
    Alert.alert(
      t('alarm.delete.title', { defaultValue: '알람 삭제' }),
      t('alarm.delete.body', { defaultValue: '이 알람을 삭제하시겠습니까?' }),
      [
        { text: t('common.cancel', { defaultValue: '취소' }), style: 'cancel' },
        {
          text: t('alarm.delete.confirm', { defaultValue: '삭제' }),
          style: 'destructive',
          onPress: async () => {
            // v2.0 P3.7 — chain cancel 은 dispatch 통해 일관 처리 후 alarm DB 삭제.
            await dispatchDisableAlarm(alarm.id);
            await deleteAlarm(alarm.id);
            reload();
          },
        },
      ]
    );
  };

  // ─── 미지원 (iOS 25 이하 / Android) ──────────────

  if (!supported) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>
            {t('alarm.title', { defaultValue: '알람' })}
          </Text>
        </View>
        <View style={styles.unsupportedWrap}>
          <MaterialIcons name="info-outline" size={48} color={colors.secondary} />
          <Text style={styles.unsupportedText}>
            {t('alarm.unsupported', {
              defaultValue: '알람 기능은 iOS 26 이상에서 지원됩니다.',
            })}
          </Text>
        </View>
        {/* v1.9 #AdBannerConsolidate — AdBanner 측 = MainTabsNavigator tabBar prop 통합 측 이동. */}
      </SafeAreaView>
    );
  }

  // ─── 정상 진입 ─────────────────────────────────

  // 2026-05-27 fix — 루틴 / ad-hoc routine 진행 중 측 = 모든 알람 토글 disabled (= 진행 중 routine 영향 차단).
  //   activeRoutine 측 = SessionController kind=routine 또는 ad_hoc_routine 측 active 상태 측 mirror.
  const anyRoutineRunning = !!activeRoutine;
  const renderItem = ({ item }: { item: Alarm }) => {
    // v1.7 Phase 2-B — 본 알람 측 ad-hoc routine 진행 중 = ActiveRoutineSection 마운트.
    const isActive = !!activeRoutine && activeRoutine.routineId === createAlarmAdhocRoutineId(item.id);
    return (
      <AlarmRow
        item={item}
        styles={styles}
        colors={colors}
        isDark={isDark}
        t={t}
        onEdit={() => handleEdit(item)}
        onToggle={(v) => handleToggle(item, v)}
        onDelete={() => handleDelete(item)}
        isActive={isActive}
        toggleDisabled={anyRoutineRunning}
        activeRunNode={
          isActive ? (
            <ActiveRoutineSection
              routineId={createAlarmAdhocRoutineId(item.id)}
              onClose={handleActiveRoutineClose}
            />
          ) : undefined
        }
      />
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <MaterialIcons name="alarm" size={24} color={colors.onBackground} />
          <Text style={styles.headerTitle}>
            {t('alarm.title', { defaultValue: '알람' })}
          </Text>
        </View>
        <TouchableOpacity style={styles.addBtn} onPress={handleAdd}>
          <MaterialIcons name="add" size={28} color={colors.onBackground} />
        </TouchableOpacity>
      </View>

      <FlatList
        data={alarms}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <MaterialIcons name="alarm-off" size={48} color={colors.secondary} />
            <Text style={styles.emptyText}>
              {t('alarm.empty', { defaultValue: '등록된 알람이 없습니다' })}
            </Text>
            <TouchableOpacity style={styles.emptyBtn} onPress={handleAdd}>
              <MaterialIcons name="add" size={20} color={colors.onPrimary} />
              <Text style={styles.emptyBtnText}>
                {t('alarm.add', { defaultValue: '알람 추가' })}
              </Text>
            </TouchableOpacity>
          </View>
        }
        contentContainerStyle={alarms.length === 0 ? styles.emptyContent : styles.content}
      />

      {/* v1.9 #AdBannerConsolidate — AdBanner 측 = MainTabsNavigator tabBar prop 통합 측 이동. */}
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => {
  // RTL 분기 — flexDirection 측 = RN 자동 mirror ❌, 명시 영영.
  const flexRow: 'row' | 'row-reverse' = I18nManager.isRTL ? 'row-reverse' : 'row';
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    header: {
      flexDirection: flexRow,
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
    addBtn: {
      width: 40,
      height: 40,
      alignItems: 'center',
      justifyContent: 'center',
    },
    content: {
      paddingTop: 16,
      paddingBottom: 8,
    },
    emptyContent: {
      paddingTop: 80,
      alignItems: 'center',
    },
    itemTime: {
      fontSize: 28,
      fontWeight: '800',
      color: colors.onBackground,
    },
    itemLabel: {
      fontSize: 14,
      color: colors.onBackground,
      marginTop: 2,
    },
    itemMetaRow: {
      flexDirection: flexRow,
      alignItems: 'center',
      marginTop: 4,
      flexWrap: 'wrap',
    },
    itemMeta: {
      fontSize: 12,
      color: colors.secondary,
    },
    itemDisabled: {
      opacity: 0.4,
    },
    // v1.7 Phase 1 — alarm.steps[] 보유 시 배지.
    stepBadge: {
      flexDirection: flexRow,
      alignItems: 'center',
      marginStart: 8,
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: 10,
      backgroundColor: colors.primary,
      gap: 3,
    },
    stepBadgeText: {
      fontSize: 11,
      fontWeight: '600',
      color: colors.onPrimary,
    },
    emptyWrap: {
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
      flexDirection: flexRow,
      alignItems: 'center',
      backgroundColor: colors.primary,
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderRadius: 8,
    },
    emptyBtnText: {
      color: colors.onPrimary,
      fontSize: 14,
      fontWeight: '500',
      marginStart: 6,
    },
    unsupportedWrap: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 24,
    },
    unsupportedText: {
      fontSize: 15,
      color: colors.secondary,
      marginTop: 12,
      textAlign: 'center',
      lineHeight: 22,
    },
  });
};
