// v1.6 신 모델: 루틴 편집 화면.
// 데이터: 카테고리 + 시작시간 (schedule.startTime) + 시퀀셜 step (이름 + duration 초 단위).
// Routine.name 제거, RoutineStep.startTime/endTime 제거 → durationSeconds 만.
// 첫 step 표시 시각 = schedule.startTime, 이후 step 은 누적 자동 (UI 표시).

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  ScrollView,
  TextInput,
  Alert,
  Linking,
  Switch,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp, useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTranslation } from 'react-i18next';
import { RootStackParamList } from '../../App';
import { useTheme } from '../context/ThemeContext';
import DurationWheelPicker from '../components/DurationWheelPicker';
import TimeWheelPicker from '../components/TimeWheelPicker';
import { ThemeColors } from '../constants/theme';
import {
  Routine,
  RoutineStep,
  loadRoutines,
  upsertRoutine,
  deleteRoutine,
  createRoutineId,
  createStepId,
  parseHHMM,
} from '../constants/routines';
import {
  scheduleRoutinePrealerts,
  cancelRoutinePrealerts,
  requestAlarmKitAuthorizationIfNeeded,
  isAlertShownThisCycle,
  markAlertShown,
} from '../utils/routineScheduler';
import {
  FIXED_CATEGORIES,
  CategoryDef,
  loadCustomCategories,
} from '../constants/categories';
import { Logger } from '../utils/logger';
import { getCachedDismissMethod } from '../utils/settingsCache';
import { DEFAULT_SETTINGS } from '../constants/settings';
import AdBanner from '../components/AdBanner';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'RoutineEdit'>;
  route: RouteProp<RootStackParamList, 'RoutineEdit'>;
};

type LocalStep = {
  id: string;
  name: string;
  /** 초 단위. 0이면 미설정 */
  durationSeconds: number;
};

const STEP_NAME_MAX = 20;
const MAX_STEPS = 3;
const DEFAULT_START_TIME = '07:00';
const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

// ─── 시간 헬퍼 ────────────────────────────────────────────

function hhmmToDate(hhmm: string): Date {
  const d = new Date();
  if (!hhmm || !/^\d{1,2}:\d{2}$/.test(hhmm)) {
    d.setHours(7, 0, 0, 0);
    return d;
  }
  const [hStr, mStr] = hhmm.split(':');
  d.setHours(parseInt(hStr, 10) || 0, parseInt(mStr, 10) || 0, 0, 0);
  return d;
}

function dateToHhmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** "HH:MM" 시각 표시 → "오전/오후 H:MM" */
function formatTimeKr(hhmm: string): string {
  if (!hhmm) return '--:--';
  const m = parseHHMM(hhmm);
  if (m === null) return '--:--';
  const h = Math.floor(m / 60);
  const mm = m % 60;
  const ampm = h < 12 ? '오전' : '오후';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${ampm} ${h12}:${String(mm).padStart(2, '0')}`;
}

/** 초 단위 → 사람이 읽는 "Xh Ym Zs" / "Ym Zs" / "Zs". 0 이면 placeholder. */
function formatDuration(sec: number, emptyLabel: string): string {
  if (sec <= 0) return emptyLabel;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const parts: string[] = [];
  if (h > 0) parts.push(`${h}시간`);
  if (m > 0) parts.push(`${m}분`);
  if (s > 0 || parts.length === 0) parts.push(`${s}초`);
  return parts.join(' ');
}

// ─── 카테고리/요일 라벨 ──────────────────────────────────

function formatDaysLabel(days: number[], t: (k: string) => string): string {
  if (days.length === 0) return t('routine.edit.unselected');
  if (days.length === 7) return t('routine.daysEveryday');
  const sorted = [...days].sort();
  const isWeekday = sorted.length === 5 && sorted.every((v, i) => v === [1, 2, 3, 4, 5][i]);
  const isWeekend = sorted.length === 2 && sorted[0] === 0 && sorted[1] === 6;
  if (isWeekday) return t('routine.daysWeekday');
  if (isWeekend) return t('routine.daysWeekend');
  return sorted.map(d => t(`routine.weekday.${WEEKDAY_KEYS[d]}`)).join(' ');
}

// ─── 컴포넌트 ────────────────────────────────────────────

export default function RoutineEditScreen({ navigation, route }: Props) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = makeStyles(colors);
  const editingId = route.params?.routineId ?? null;
  const isEditMode = editingId !== null;
  // 모드: 신규 → params.mode (default 'manual' — v1.6 hotfix 예약 비활성), 편집 → 기존 routine 의 schedule 유무로 마운트 시 보정
  // @preserve scheduled-routine — 예약 패러다임 결정 후 default 'scheduled' 복원 검토
  const [mode, setMode] = useState<'scheduled' | 'manual'>(
    () => route.params?.mode ?? 'manual',
  );

  const [category, setCategory] = useState('');
  const [routineName, setRoutineName] = useState('');
  const [startTime, setStartTime] = useState<string>(DEFAULT_START_TIME);
  const [days, setDays] = useState<number[]>([]);
  // v1.8 #DismissMethodPurge-Routine — endMethod 상태 영역 폐기. 저장 시 = 전역 설정 read.
  const [steps, setSteps] = useState<LocalStep[]>(() => [
    { id: createStepId(), name: '', durationSeconds: 0 },
  ]);
  const [dirty, setDirty] = useState(false);

  // startTime picker (오전/오후 + 시 + 분) — 자체 wheel
  const [timePickerVisible, setTimePickerVisible] = useState(false);

  // step duration picker (시:분:초) — 자체 wheel
  const [durationPickerVisible, setDurationPickerVisible] = useState(false);
  const [durationPickerStepIndex, setDurationPickerStepIndex] = useState<number | null>(null);

  const [categoryCache, setCategoryCache] = useState<CategoryDef[]>([...FIXED_CATEGORIES]);

  const originalCreatedAtRef = useRef<number | null>(null);
  const originalActiveRef = useRef<boolean>(true);
  const loadedRef = useRef(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // [DEBUG] mount/unmount 추적 — state reset 원인 확인용
  useEffect(() => {
    Logger.warn('RoutineEdit', `MOUNTED editingId=${editingId} params=${JSON.stringify(route.params)}`);
    return () => Logger.warn('RoutineEdit', 'UNMOUNTED');
  }, []);
  useEffect(() => {
    Logger.warn('RoutineEdit', `params change ${JSON.stringify(route.params)}`);
  }, [route.params]);

  const markDirty = () => setDirty(true);

  // ─── 마운트: 편집 모드면 기존 루틴 로드 ─────────────

  useEffect(() => {
    if (loadedRef.current) return;
    if (!editingId) {
      loadedRef.current = true;
      return;
    }
    loadRoutines().then(list => {
      const target = list.find(r => r.id === editingId);
      if (!target) {
        loadedRef.current = true;
        return;
      }
      originalCreatedAtRef.current = target.createdAt;
      originalActiveRef.current = target.active;
      setMode(target.schedule ? 'scheduled' : 'manual');
      setCategory(target.category);
      setRoutineName(target.name ?? '');
      setStartTime(target.schedule?.startTime ?? DEFAULT_START_TIME);
      setDays(target.schedule?.days ?? []);
      // v1.8 #DismissMethodPurge-Routine — endMethod load 영역 폐기.
      setSteps(
        target.steps.map(s => ({
          id: s.id,
          name: s.name,
          durationSeconds: s.durationSeconds,
        }))
      );
      loadedRef.current = true;
    });
  }, [editingId]);

  // ─── 카테고리 캐시 (커스텀 추가 후 복귀 시 갱신) ────

  useFocusEffect(
    useCallback(() => {
      loadCustomCategories().then(custom => {
        setCategoryCache([...FIXED_CATEGORIES, ...custom]);
      });
    }, [])
  );

  // ─── 하위 화면 반환 흡수 (merge:true 패턴) ──────────

  useEffect(() => {
    const sel = route.params?.selectedCategory;
    if (sel !== undefined) {
      setCategory(sel);
      markDirty();
      navigation.setParams({ selectedCategory: undefined } as any);
    }
  }, [route.params?.selectedCategory, navigation]);

  useEffect(() => {
    const sel = route.params?.selectedDays;
    if (sel !== undefined) {
      setDays(sel);
      markDirty();
      navigation.setParams({ selectedDays: undefined } as any);
    }
  }, [route.params?.selectedDays, navigation]);

  // ─── 슬롯 핸들러 ────────────────────────────────────

  const handleAddStep = () => {
    if (steps.length >= MAX_STEPS) return;
    setSteps(prev => [
      ...prev,
      { id: createStepId(), name: '', durationSeconds: 0 },
    ]);
    markDirty();
  };

  const handleStepNameChange = (idx: number, text: string) => {
    setSteps(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], name: text };
      return next;
    });
    markDirty();
  };

  const handleStepDurationTap = (idx: number) => {
    setDurationPickerStepIndex(idx);
    setDurationPickerVisible(true);
  };

  const handleStartTimeTap = () => {
    setTimePickerVisible(true);
  };

  const handleTimePickerConfirm = (hour: number, minute: number) => {
    const hh = String(hour).padStart(2, '0');
    const mm = String(minute).padStart(2, '0');
    setStartTime(`${hh}:${mm}`);
    markDirty();
    setTimePickerVisible(false);
  };

  const handleTimePickerCancel = () => {
    setTimePickerVisible(false);
  };

  const handleDurationConfirm = (seconds: number) => {
    if (durationPickerStepIndex === null) {
      setDurationPickerVisible(false);
      return;
    }
    const idx = durationPickerStepIndex;
    setSteps(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], durationSeconds: seconds };
      return next;
    });
    markDirty();
    setDurationPickerVisible(false);
    setDurationPickerStepIndex(null);
  };

  const handleDurationCancel = () => {
    setDurationPickerVisible(false);
    setDurationPickerStepIndex(null);
  };

  const handleDeleteStep = (idx: number) => {
    if (steps.length <= 1) return;
    setSteps(prev => prev.filter((_, i) => i !== idx));
    markDirty();
  };

  // ─── 헤더 액션 ──────────────────────────────────────

  const handleClose = () => {
    if (!dirty) {
      navigation.goBack();
      return;
    }
    Alert.alert(
      t('routine.edit.dirtyConfirmTitle'),
      t('routine.edit.dirtyConfirmBody'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('routine.edit.dirtyConfirmExit'),
          style: 'destructive',
          onPress: () => navigation.goBack(),
        },
      ]
    );
  };

  const validate = (): { ok: boolean; error?: string } => {
    if (!category) return { ok: false, error: t('routine.edit.validationCategoryEmpty') };
    if (!routineName.trim()) return { ok: false, error: t('routine.edit.validationNameEmpty') };
    // 예약 모드만 시작 시간 / 요일 필수. 일반 모드는 면제.
    if (mode === 'scheduled') {
      if (parseHHMM(startTime) === null) return { ok: false, error: t('routine.edit.validationStartTime') };
      if (days.length === 0) return { ok: false, error: t('routine.edit.validationDaysEmpty') };
    }
    if (steps.length === 0) return { ok: false, error: t('routine.edit.validationStepsEmpty') };
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      if (!s.name.trim() || s.durationSeconds <= 0) {
        return { ok: false, error: t('routine.edit.validationStepIncomplete', { n: i + 1 }) };
      }
    }
    return { ok: true };
  };

  const handleHeaderSave = async () => {
    const v = validate();
    if (!v.ok) {
      Alert.alert(t('routine.edit.validationFailTitle'), v.error ?? '');
      return;
    }
    const finalSteps: RoutineStep[] = steps.map(s => ({
      id: s.id,
      name: s.name.trim(),
      durationSeconds: Math.max(0, s.durationSeconds),
    }));
    const routine: Routine = {
      id: editingId ?? createRoutineId(),
      category,
      name: routineName.trim() || undefined,
      steps: finalSteps,
      // manual 모드는 schedule 자체 미생성 (scheduler 자동 skip)
      schedule: mode === 'scheduled' ? { startTime, days } : undefined,
      active: isEditMode ? originalActiveRef.current : true,
      // v1.8 #DismissMethodPurge-Routine — endMethod = 전역 SettingsScreen 측 값 (= 알람 정합).
      endMethod: getCachedDismissMethod() ?? DEFAULT_SETTINGS.dismissMethod,
      createdAt: originalCreatedAtRef.current ?? Date.now(),
    };
    await upsertRoutine(routine);

    if (routine.active && routine.schedule) {
      // iOS 26+ 에서만 AlarmKit 권한 요청. 미지원 / Android / iOS 25 이하는 'unavailable' silent.
      const authState = await requestAlarmKitAuthorizationIfNeeded();
      if (!isMountedRef.current) return;
      if (authState === 'denied' && !isAlertShownThisCycle()) {
        markAlertShown();
        Alert.alert(
          t('routine.alarmKit.permissionRequiredTitle'),
          t('routine.alarmKit.permissionRequiredBody'),
          [
            {
              text: t('routine.alarmKit.openSettings'),
              onPress: () => { Linking.openURL('app-settings:').catch(() => {}); },
            },
            { text: t('common.confirm'), style: 'default' },
          ],
        );
      }
      await scheduleRoutinePrealerts(routine);
    } else {
      await cancelRoutinePrealerts(routine.id);
    }
    if (!isMountedRef.current) return;
    // v1.8 — RoutineList Stack.Screen 제거 후 popTo → goBack + AsyncStorage 측 탭 정보 임시 전달.
    // RoutineListScreen mount/focus 시 키 읽음 + 탭 선택 + 즉시 삭제.
    try {
      await AsyncStorage.setItem('pendingRoutineInitialTab', mode);
    } catch {}
    navigation.goBack();
  };

  const handleDelete = () => {
    if (!editingId) return;
    Alert.alert(
      t('routine.deleteConfirmTitle'),
      t('routine.deleteConfirmBody'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('routine.actionDelete'),
          style: 'destructive',
          onPress: async () => {
            await cancelRoutinePrealerts(editingId);
            await deleteRoutine(editingId);
            navigation.goBack();
          },
        },
      ]
    );
  };

  // ─── 네비게이션 핸들러 ─────────────────────────────

  const handleNavCategory = () => {
    navigation.navigate('RoutineCategory', { current: category });
  };

  const handleNavDays = () => {
    navigation.navigate('RoutineDays', { current: days });
  };

  // ─── 표시용 라벨 ────────────────────────────────────

  const categoryLabel = (() => {
    if (!category) return t('routine.edit.unselected');
    const def = categoryCache.find(c => c.id === category);
    if (!def) return t('routine.edit.unselected');
    return def.labelKey ? t(def.labelKey) : def.label ?? category;
  })();
  const daysLabel = formatDaysLabel(days, t);
  const startTimeLabel = formatTimeKr(startTime);

  // ─── 렌더 ───────────────────────────────────────────

  const startMin = parseHHMM(startTime) ?? 7 * 60;
  const initialStartHour = Math.floor(startMin / 60);
  const initialStartMinute = startMin % 60;

  const initialDurationSeconds =
    durationPickerStepIndex !== null ? steps[durationPickerStepIndex]?.durationSeconds ?? 0 : 0;

  return (
    <SafeAreaView style={styles.container}>
      {/* 헤더 */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.iconBtn} onPress={handleClose}>
          <MaterialIcons name="close" size={28} color={colors.onBackground} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          {isEditMode ? t('routine.edit.editTitle') : t('routine.edit.newTitle')}
        </Text>
        <TouchableOpacity style={styles.iconBtn} onPress={handleHeaderSave}>
          <Text style={styles.headerSave}>{t('routine.edit.save')}</Text>
        </TouchableOpacity>
      </View>

      {/* v1.6 후속 — 헤더와 카테고리 사이 AdBanner */}
      <AdBanner />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* 카테고리 — 최상단 */}
        <TouchableOpacity style={styles.topCard} onPress={handleNavCategory} activeOpacity={0.85}>
          <View style={styles.topCardLabelRow}>
            <MaterialIcons name="folder" size={18} color={colors.primary} />
            <Text style={styles.topCardLabel}>{t('routine.edit.fieldCategory')}</Text>
          </View>
          <View style={styles.topCardValueRow}>
            <Text style={[styles.topCardValue, !category && styles.topCardValueUnset]}>{categoryLabel}</Text>
            <MaterialIcons name="chevron-right" size={22} color={colors.secondary} />
          </View>
        </TouchableOpacity>

        {/* 루틴 이름 (부제) */}
        <View style={styles.topCard}>
          <View style={styles.topCardLabelRow}>
            <MaterialIcons name="label-outline" size={18} color={colors.primary} />
            <Text style={styles.topCardLabel}>{t('routine.edit.fieldRoutineName')}</Text>
          </View>
          <TextInput
            value={routineName}
            onChangeText={text => { setRoutineName(text); markDirty(); }}
            placeholder={t('routine.edit.routineNamePlaceholder')}
            placeholderTextColor={colors.secondary}
            maxLength={20}
            style={styles.routineNameInput}
          />
        </View>

        {/* 시작 시간 (예약 모드 only) */}
        {mode === 'scheduled' && (
          <TouchableOpacity style={styles.topCard} onPress={handleStartTimeTap} activeOpacity={0.85}>
            <View style={styles.topCardLabelRow}>
              <MaterialIcons name="schedule" size={18} color={colors.primary} />
              <Text style={styles.topCardLabel}>{t('routine.edit.fieldStartTime')}</Text>
            </View>
            <View style={styles.topCardValueRow}>
              <Text style={styles.topCardValue}>{startTimeLabel}</Text>
              <MaterialIcons name="chevron-right" size={22} color={colors.secondary} />
            </View>
          </TouchableOpacity>
        )}

        {/* 단계 */}
        <Text style={[styles.sectionTitle, { marginTop: 24 }]}>{t('routine.edit.stepsSection')}</Text>
        {steps.map((step, idx) => {
          return (
            <View key={step.id} style={styles.slotCard}>
              <View style={styles.slotRow}>
                <TextInput
                  value={step.name}
                  onChangeText={text => handleStepNameChange(idx, text)}
                  placeholder={t('routine.edit.stepNamePlaceholder', { n: String(idx + 1).padStart(2, '0') })}
                  placeholderTextColor={colors.secondary}
                  maxLength={STEP_NAME_MAX}
                  style={styles.slotNameInput}
                />
                <TouchableOpacity onPress={() => handleStepDurationTap(idx)} style={styles.slotDurationBtn}>
                  <Text style={[styles.slotDurationText, step.durationSeconds <= 0 && styles.slotDurationEmpty]}>
                    {formatDuration(step.durationSeconds, t('routine.edit.tapToSetDuration'))}
                  </Text>
                </TouchableOpacity>
                {steps.length > 1 && (
                  <TouchableOpacity
                    onPress={() => handleDeleteStep(idx)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <MaterialIcons name="remove-circle-outline" size={20} color={colors.secondary} />
                  </TouchableOpacity>
                )}
              </View>
            </View>
          );
        })}

        {steps.length < MAX_STEPS && (
          <TouchableOpacity style={styles.addStepBtn} onPress={handleAddStep}>
            <MaterialIcons name="add" size={20} color={colors.primary} />
            <Text style={styles.addStepText}>{t('routine.edit.addStep')}</Text>
          </TouchableOpacity>
        )}

        {/* 설정 (= 예약 모드에서만 표시, 종료 방식은 v1.8 #DismissMethodPurge-Routine 측 전역 설정 통일) */}
        {mode === 'scheduled' && (
          <>
            <Text style={[styles.sectionTitle, { marginTop: 24 }]}>{t('routine.edit.settingsSection')}</Text>
            <TouchableOpacity style={styles.settingRow} onPress={handleNavDays}>
              <View style={styles.autoLabelRow}>
                <Text style={styles.settingLabel}>{t('routine.edit.fieldDays')}</Text>
                <TouchableOpacity
                  onPress={() => Alert.alert(t('routine.edit.daysHelpTitle'), t('routine.edit.daysHelpBody'))}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  style={styles.autoHelpBtn}
                >
                  <MaterialIcons name="help-outline" size={14} color={colors.secondary} />
                </TouchableOpacity>
              </View>
              <View style={styles.settingValueRow}>
                <Text style={[styles.settingValue, days.length === 0 && styles.settingValueUnset]}>{daysLabel}</Text>
                <MaterialIcons name="chevron-right" size={20} color={colors.secondary} />
              </View>
            </TouchableOpacity>
          </>
        )}

        {/* 삭제 (편집 모드만) */}
        {isEditMode && (
          <TouchableOpacity style={styles.deleteBtn} onPress={handleDelete}>
            <MaterialIcons name="delete-outline" size={20} color={colors.error} />
            <Text style={styles.deleteBtnText}>{t('routine.edit.deleteRoutine')}</Text>
          </TouchableOpacity>
        )}

        <View style={{ height: 32 }} />
      </ScrollView>

      <TimeWheelPicker
        isVisible={timePickerVisible}
        initialHour={initialStartHour}
        initialMinute={initialStartMinute}
        onConfirm={handleTimePickerConfirm}
        onCancel={handleTimePickerCancel}
        amLabel={t('routine.time.am')}
        pmLabel={t('routine.time.pm')}
        hourUnitLabel={t('routine.time.hourUnit')}
        minuteUnitLabel={t('routine.time.minuteUnit')}
        confirmLabel={t('common.confirm')}
        cancelLabel={t('common.cancel')}
        textColor={colors.onBackground}
        dimColor={colors.secondary}
        bgColor={colors.surfaceContainerLowest}
        accentColor={colors.primary}
      />

      <DurationWheelPicker
        isVisible={durationPickerVisible}
        initialSeconds={initialDurationSeconds}
        onConfirm={handleDurationConfirm}
        onCancel={handleDurationCancel}
        hourLabel={t('routine.duration.hour')}
        minuteLabel={t('routine.duration.minute')}
        secondLabel={t('routine.duration.second')}
        confirmLabel={t('common.confirm')}
        cancelLabel={t('common.cancel')}
        textColor={colors.onBackground}
        dimColor={colors.secondary}
        bgColor={colors.surfaceContainerLowest}
        accentColor={colors.primary}
      />
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
  iconBtn: { padding: 8, borderRadius: 50, minWidth: 44, alignItems: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '800', color: colors.onBackground, letterSpacing: -0.5 },
  headerSave: { fontSize: 15, fontWeight: '800', color: colors.primary },
  content: { paddingHorizontal: 16, paddingBottom: 48 },
  topCard: {
    marginTop: 12,
    paddingVertical: 16,
    paddingHorizontal: 18,
    borderRadius: 14,
    backgroundColor: colors.surfaceContainerLowest,
    borderWidth: 1.5,
    borderColor: colors.primary,
  },
  topCardLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  topCardLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.primary,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  topCardValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  topCardValue: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.onBackground,
    letterSpacing: -0.5,
  },
  topCardValueUnset: {
    color: colors.secondary,
    opacity: 0.7,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.secondary,
    letterSpacing: 1.5,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  routineNameInput: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.onBackground,
    paddingVertical: 4,
    paddingTop: 8,
  },
  slotCard: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: 14,
    padding: 18,
    marginBottom: 10,
  },
  slotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  slotNumber: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surfaceContainerLowest,
    alignItems: 'center',
    justifyContent: 'center',
  },
  slotNumberText: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.onBackground,
  },
  slotNameInput: {
    flex: 1,
    fontSize: 17,
    fontWeight: '700',
    color: colors.onBackground,
    paddingVertical: 6,
  },
  slotMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    paddingLeft: 38,
  },
  slotMetaText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.secondary,
  },
  slotDurationBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: colors.surfaceContainerLowest,
  },
  slotDurationText: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.onBackground,
  },
  slotDurationEmpty: {
    color: colors.secondary,
    opacity: 0.6,
  },
  addStepBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.primary,
    borderStyle: 'dashed',
    marginTop: 4,
  },
  addStepText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.primary,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: colors.surfaceContainerLow,
    marginBottom: 8,
  },
  settingLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.onBackground,
  },
  settingValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  settingValue: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.onBackground,
  },
  settingValueUnset: {
    color: colors.secondary,
    opacity: 0.7,
  },
  autoLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 1,
  },
  autoHelpBtn: {
    padding: 0,
    marginTop: 3,
  },
  deleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 24,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: colors.surfaceContainerLow,
  },
  deleteBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.error,
  },
});
