// v1.6 신 모델: 루틴 편집 화면.
// 데이터: 카테고리 + 시작시간 (schedule.startTime) + 시퀀셜 step (이름 + duration).
// Routine.name 제거, RoutineStep.startTime/endTime 제거 → durationMinutes 만.
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
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp, useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import DateTimePickerModal from 'react-native-modal-datetime-picker';
import { RootStackParamList } from '../../App';
import { useTheme } from '../context/ThemeContext';
import { ThemeColors } from '../constants/theme';
import {
  Routine,
  RoutineStep,
  RoutineEndMethod,
  loadRoutines,
  upsertRoutine,
  deleteRoutine,
  createRoutineId,
  createStepId,
  parseHHMM,
  formatHHMM,
} from '../constants/routines';
import {
  scheduleRoutinePrealerts,
  cancelRoutinePrealerts,
} from '../utils/routineScheduler';
import {
  FIXED_CATEGORIES,
  CategoryDef,
  loadCustomCategories,
} from '../constants/categories';
import { ALARM_SOUNDS, DEFAULT_SOUND_ID } from '../constants/sounds';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'RoutineEdit'>;
  route: RouteProp<RootStackParamList, 'RoutineEdit'>;
};

type LocalStep = {
  id: string;
  name: string;
  /** 분 단위. 0이면 미설정 */
  durationMinutes: number;
};

const STEP_NAME_MAX = 20;
const MAX_STEPS = 5;
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

/** Date 객체 → 분 단위 (00:00 부터 합산). duration 입력용. */
function dateToDurationMinutes(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

/** 분 단위 → Date (오늘 + 분). duration 입력 picker 초기값용. */
function durationMinutesToDate(min: number): Date {
  const d = new Date();
  const safe = Math.max(0, Math.min(23 * 60 + 59, min));
  d.setHours(Math.floor(safe / 60), safe % 60, 0, 0);
  return d;
}

/** 분 단위 → 사람이 읽는 "Xh Ym" 또는 "Y분" */
function formatDuration(min: number): string {
  if (min <= 0) return '--';
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}분`;
  if (m === 0) return `${h}시간`;
  return `${h}시간 ${m}분`;
}

// ─── 카테고리/요일/사운드 라벨 ───────────────────────────

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

function formatSoundLabel(soundKey: string, t: (k: string) => string): string {
  const item = ALARM_SOUNDS.find(s => s.id === soundKey);
  if (!item) return t('routine.edit.unselected');
  const num = item.id.split('_')[1] ?? '';
  return item.id.startsWith('alarm_')
    ? `${t('routine.sound.alarm')} ${num}`
    : `${t('routine.sound.ringtone')} ${num}`;
}

// ─── 컴포넌트 ────────────────────────────────────────────

export default function RoutineEditScreen({ navigation, route }: Props) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = makeStyles(colors);
  const editingId = route.params?.routineId ?? null;
  const isEditMode = editingId !== null;

  const [category, setCategory] = useState('');
  const [startTime, setStartTime] = useState<string>(DEFAULT_START_TIME);
  const [days, setDays] = useState<number[]>([]);
  const [soundKey, setSoundKey] = useState<string>(DEFAULT_SOUND_ID);
  const [endMethod, setEndMethod] = useState<RoutineEndMethod>('tap');
  const [steps, setSteps] = useState<LocalStep[]>(() => [
    { id: createStepId(), name: '', durationMinutes: 0 },
  ]);
  const [dirty, setDirty] = useState(false);

  // picker: 'startTime' (절대 시각) 또는 step duration 입력 (인덱스)
  const [pickerVisible, setPickerVisible] = useState(false);
  const [pickerTarget, setPickerTarget] = useState<
    | { kind: 'startTime' }
    | { kind: 'duration'; stepIndex: number }
    | null
  >(null);

  const [categoryCache, setCategoryCache] = useState<CategoryDef[]>([...FIXED_CATEGORIES]);

  const originalCreatedAtRef = useRef<number | null>(null);
  const originalActiveRef = useRef<boolean>(true);
  const loadedRef = useRef(false);

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
      setCategory(target.category);
      setStartTime(target.schedule?.startTime ?? DEFAULT_START_TIME);
      setDays(target.schedule?.days ?? []);
      setSoundKey(target.soundKey || DEFAULT_SOUND_ID);
      setEndMethod(target.endMethod);
      setSteps(
        target.steps.map(s => ({
          id: s.id,
          name: s.name,
          durationMinutes: s.durationMinutes,
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

  useEffect(() => {
    const sel = route.params?.selectedSound;
    if (sel !== undefined) {
      setSoundKey(sel);
      markDirty();
      navigation.setParams({ selectedSound: undefined } as any);
    }
  }, [route.params?.selectedSound, navigation]);

  // ─── 슬롯 핸들러 ────────────────────────────────────

  const handleAddStep = () => {
    if (steps.length >= MAX_STEPS) return;
    setSteps(prev => [
      ...prev,
      { id: createStepId(), name: '', durationMinutes: 0 },
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
    setPickerTarget({ kind: 'duration', stepIndex: idx });
    setPickerVisible(true);
  };

  const handleStartTimeTap = () => {
    setPickerTarget({ kind: 'startTime' });
    setPickerVisible(true);
  };

  const handlePickerConfirm = (date: Date) => {
    if (!pickerTarget) {
      setPickerVisible(false);
      return;
    }
    if (pickerTarget.kind === 'startTime') {
      setStartTime(dateToHhmm(date));
    } else {
      const idx = pickerTarget.stepIndex;
      const minutes = dateToDurationMinutes(date);
      setSteps(prev => {
        const next = [...prev];
        next[idx] = { ...next[idx], durationMinutes: minutes };
        return next;
      });
    }
    markDirty();
    setPickerVisible(false);
    setPickerTarget(null);
  };

  const handlePickerCancel = () => {
    setPickerVisible(false);
    setPickerTarget(null);
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
    if (parseHHMM(startTime) === null) return { ok: false, error: t('routine.edit.validationStartTime') };
    if (days.length === 0) return { ok: false, error: t('routine.edit.validationDaysEmpty') };
    if (steps.length === 0) return { ok: false, error: t('routine.edit.validationStepsEmpty') };
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      if (!s.name.trim() || s.durationMinutes <= 0) {
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
      durationMinutes: Math.max(0, s.durationMinutes),
    }));
    const routine: Routine = {
      id: editingId ?? createRoutineId(),
      category,
      steps: finalSteps,
      schedule: { startTime, days },
      soundKey,
      active: isEditMode ? originalActiveRef.current : true,
      endMethod,
      createdAt: originalCreatedAtRef.current ?? Date.now(),
    };
    await upsertRoutine(routine);
    if (routine.active && routine.schedule) {
      await scheduleRoutinePrealerts(routine);
    } else {
      await cancelRoutinePrealerts(routine.id);
    }
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

  const handleNavSound = () => {
    navigation.navigate('RoutineSound', { current: soundKey });
  };

  // ─── 표시용 라벨 ────────────────────────────────────

  const categoryLabel = (() => {
    if (!category) return t('routine.edit.unselected');
    const def = categoryCache.find(c => c.id === category);
    if (!def) return t('routine.edit.unselected');
    return def.labelKey ? t(def.labelKey) : def.label ?? category;
  })();
  const daysLabel = formatDaysLabel(days, t);
  const soundLabel = formatSoundLabel(soundKey, t);
  const startTimeLabel = formatTimeKr(startTime);

  // 각 step 표시용 시작 시각 (절대) — schedule.startTime + 누적 duration
  const baseMin = parseHHMM(startTime) ?? 0;
  let acc = baseMin;
  const stepStartLabels = steps.map(s => {
    const label = formatHHMM(acc);
    acc += Math.max(0, s.durationMinutes);
    return label;
  });

  // ─── 렌더 ───────────────────────────────────────────

  const initialPickerDate = (() => {
    if (!pickerTarget) return new Date();
    if (pickerTarget.kind === 'startTime') return hhmmToDate(startTime);
    const step = steps[pickerTarget.stepIndex];
    return durationMinutesToDate(step?.durationMinutes ?? 0);
  })();

  const pickerMode = pickerTarget?.kind === 'duration' ? 'time' : 'time';
  const pickerIs24Hour = pickerTarget?.kind === 'duration';

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

        {/* 시작 시간 (예약) */}
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

        {/* 단계 */}
        <Text style={[styles.sectionTitle, { marginTop: 24 }]}>{t('routine.edit.stepsSection')}</Text>
        {steps.map((step, idx) => {
          return (
            <View key={step.id} style={styles.slotCard}>
              <View style={styles.slotRow}>
                <View style={styles.slotNumber}>
                  <Text style={styles.slotNumberText}>{idx + 1}</Text>
                </View>
                <TextInput
                  value={step.name}
                  onChangeText={text => handleStepNameChange(idx, text)}
                  placeholder={t('routine.edit.stepNamePlaceholder')}
                  placeholderTextColor={colors.secondary}
                  maxLength={STEP_NAME_MAX}
                  style={styles.slotNameInput}
                />
                {steps.length > 1 && (
                  <TouchableOpacity
                    onPress={() => handleDeleteStep(idx)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <MaterialIcons name="remove-circle-outline" size={20} color={colors.secondary} />
                  </TouchableOpacity>
                )}
              </View>
              <View style={styles.slotMetaRow}>
                <Text style={styles.slotMetaText}>
                  {formatTimeKr(stepStartLabels[idx])} ·
                </Text>
                <TouchableOpacity onPress={() => handleStepDurationTap(idx)} style={styles.slotDurationBtn}>
                  <Text style={[styles.slotDurationText, step.durationMinutes <= 0 && styles.slotDurationEmpty]}>
                    {formatDuration(step.durationMinutes)}
                  </Text>
                </TouchableOpacity>
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

        {/* 설정 */}
        <Text style={[styles.sectionTitle, { marginTop: 24 }]}>{t('routine.edit.settingsSection')}</Text>

        <TouchableOpacity style={styles.settingRow} onPress={handleNavDays}>
          <Text style={styles.settingLabel}>{t('routine.edit.fieldDays')}</Text>
          <View style={styles.settingValueRow}>
            <Text style={[styles.settingValue, days.length === 0 && styles.settingValueUnset]}>{daysLabel}</Text>
            <MaterialIcons name="chevron-right" size={20} color={colors.secondary} />
          </View>
        </TouchableOpacity>

        <TouchableOpacity style={styles.settingRow} onPress={handleNavSound}>
          <Text style={styles.settingLabel}>{t('routine.edit.fieldSound')}</Text>
          <View style={styles.settingValueRow}>
            <Text style={styles.settingValue}>{soundLabel}</Text>
            <MaterialIcons name="chevron-right" size={20} color={colors.secondary} />
          </View>
        </TouchableOpacity>

        <View style={styles.endMethodSection}>
          <Text style={styles.settingLabel}>{t('routine.edit.fieldEndMethod')}</Text>
          <View style={styles.endMethodSegment}>
            {(['tap', 'shake', 'camera', 'auto'] as const).map(opt => {
              const selected = endMethod === opt;
              return (
                <TouchableOpacity
                  key={opt}
                  style={[styles.endMethodBtn, selected && styles.endMethodBtnSelected]}
                  onPress={() => {
                    setEndMethod(opt);
                    markDirty();
                  }}
                >
                  <Text
                    style={[
                      styles.endMethodBtnText,
                      selected && styles.endMethodBtnTextSelected,
                    ]}
                  >
                    {t(`routine.endMethod.${opt}`)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* 삭제 (편집 모드만) */}
        {isEditMode && (
          <TouchableOpacity style={styles.deleteBtn} onPress={handleDelete}>
            <MaterialIcons name="delete-outline" size={20} color={colors.error} />
            <Text style={styles.deleteBtnText}>{t('routine.edit.deleteRoutine')}</Text>
          </TouchableOpacity>
        )}

        <View style={{ height: 32 }} />
      </ScrollView>

      <DateTimePickerModal
        isVisible={pickerVisible}
        mode={pickerMode}
        display="spinner"
        date={initialPickerDate}
        onConfirm={handlePickerConfirm}
        onCancel={handlePickerCancel}
        minuteInterval={1}
        is24Hour={pickerIs24Hour}
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
  slotCard: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  slotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  slotNumber: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.surfaceContainerLowest,
    alignItems: 'center',
    justifyContent: 'center',
  },
  slotNumberText: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.onBackground,
  },
  slotNameInput: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    color: colors.onBackground,
    paddingVertical: 4,
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
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 6,
    backgroundColor: colors.surfaceContainerLowest,
  },
  slotDurationText: {
    fontSize: 13,
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
  endMethodSection: {
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: colors.surfaceContainerLow,
    marginBottom: 8,
    gap: 10,
  },
  endMethodSegment: {
    flexDirection: 'row',
    gap: 6,
  },
  endMethodBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: colors.surfaceContainerLowest,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  endMethodBtnSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  endMethodBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.onBackground,
  },
  endMethodBtnTextSelected: {
    color: colors.onPrimary,
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
