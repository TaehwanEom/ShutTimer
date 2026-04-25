// v1.6 Phase 5: 루틴 추가/편집 화면 전면 재작성.
// 신규: route.params.routineId 없음 → 빈 초기값 + 슬롯 1개 자동 추가.
// 편집: route.params.routineId 있음 → 해당 루틴 로드, 모든 슬롯 saved=true.
// 하위 화면(Category/Days/Sound)는 navigation.navigate(merge:true) + useEffect 흡수 패턴.

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  ScrollView,
  TextInput,
  Switch,
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
  loadRoutines,
  upsertRoutine,
  deleteRoutine,
  createRoutineId,
  createStepId,
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
  startTime: string; // "" or "HH:MM"
  endTime: string;
  saved: boolean;
};

const STEP_NAME_MAX = 20;
const ROUTINE_NAME_MAX = 30;
const MAX_STEPS = 5;
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

function formatTimeKr(hhmm: string): string {
  if (!hhmm) return '--:--';
  const [hStr, mStr] = hhmm.split(':');
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  if (isNaN(h) || isNaN(m)) return '--:--';
  const ampm = h < 12 ? '오전' : '오후';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${ampm} ${h12}:${String(m).padStart(2, '0')}`;
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

  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [days, setDays] = useState<number[]>([]);
  const [soundKey, setSoundKey] = useState<string>(DEFAULT_SOUND_ID);
  const [autoAdvance, setAutoAdvance] = useState(true);
  const [steps, setSteps] = useState<LocalStep[]>(() => [
    { id: createStepId(), name: '', startTime: '', endTime: '', saved: false },
  ]);
  const [dirty, setDirty] = useState(false);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [pickerTarget, setPickerTarget] = useState<{ stepIndex: number; field: 'startTime' | 'endTime' } | null>(null);
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
      setName(target.name);
      setCategory(target.category);
      setDays(target.schedule?.days ?? []);
      setSoundKey(target.soundKey || DEFAULT_SOUND_ID);
      setAutoAdvance(target.autoAdvance);
      setSteps(
        target.steps.map(s => ({
          id: s.id,
          name: s.name,
          startTime: s.startTime,
          endTime: s.endTime,
          saved: true,
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
      { id: createStepId(), name: '', startTime: '', endTime: '', saved: false },
    ]);
    markDirty();
  };

  const updateStep = (idx: number, patch: Partial<LocalStep>) => {
    setSteps(prev => {
      const next = [...prev];
      // 사용자가 필드 수정 시 saved=false로 되돌림 (재저장 유도)
      next[idx] = { ...next[idx], ...patch, saved: patch.saved ?? false };
      return next;
    });
    markDirty();
  };

  const handleStepNameChange = (idx: number, text: string) => {
    updateStep(idx, { name: text });
  };

  const handleStepTimeTap = (idx: number, field: 'startTime' | 'endTime') => {
    setPickerTarget({ stepIndex: idx, field });
    setPickerVisible(true);
  };

  const handlePickerConfirm = (date: Date) => {
    if (!pickerTarget) {
      setPickerVisible(false);
      return;
    }
    const hhmm = dateToHhmm(date);
    setSteps(prev => {
      const next = [...prev];
      const target = { ...next[pickerTarget.stepIndex] };
      target[pickerTarget.field] = hhmm;
      target.saved = false;
      next[pickerTarget.stepIndex] = target;
      return next;
    });
    markDirty();
    setPickerVisible(false);
    setPickerTarget(null);
  };

  const handlePickerCancel = () => {
    setPickerVisible(false);
    setPickerTarget(null);
  };

  const handleSlotSave = (idx: number) => {
    const step = steps[idx];
    if (!step.name.trim() || !step.startTime || !step.endTime) {
      Alert.alert(
        t('routine.edit.validationFailTitle'),
        t('routine.edit.validationStepIncomplete', { n: idx + 1 })
      );
      return;
    }
    setSteps(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], saved: true };
      // 다음 슬롯 startTime 자동 복사 (비어 있을 때만)
      if (idx + 1 < next.length && !next[idx + 1].startTime) {
        next[idx + 1] = { ...next[idx + 1], startTime: step.endTime };
      }
      return next;
    });
    markDirty();
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
    if (!name.trim()) return { ok: false, error: t('routine.edit.validationNameEmpty') };
    if (!category) return { ok: false, error: t('routine.edit.validationCategoryEmpty') };
    if (days.length === 0) return { ok: false, error: t('routine.edit.validationDaysEmpty') };
    if (steps.length === 0) return { ok: false, error: t('routine.edit.validationStepsEmpty') };
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      if (!s.name.trim() || !s.startTime || !s.endTime) {
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
      startTime: s.startTime,
      endTime: s.endTime,
    }));
    const routine: Routine = {
      id: editingId ?? createRoutineId(),
      name: name.trim(),
      category,
      steps: finalSteps,
      schedule: { days },
      soundKey,
      active: isEditMode ? originalActiveRef.current : true,
      autoAdvance,
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

  // ─── 렌더 ───────────────────────────────────────────

  const initialPickerDate = (() => {
    if (!pickerTarget) return new Date();
    const step = steps[pickerTarget.stepIndex];
    return hhmmToDate(step?.[pickerTarget.field] ?? '');
  })();

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
        {/* 루틴 이름 */}
        <Text style={styles.fieldLabel}>{t('routine.fieldName')}</Text>
        <TextInput
          value={name}
          onChangeText={text => {
            setName(text);
            markDirty();
          }}
          placeholder={t('routine.namePlaceholder')}
          placeholderTextColor={colors.secondary}
          maxLength={ROUTINE_NAME_MAX}
          style={styles.nameInput}
        />

        {/* 세부 루틴 */}
        <Text style={[styles.sectionTitle, { marginTop: 24 }]}>{t('routine.edit.stepsSection')}</Text>
        {steps.map((step, idx) => {
          const canSave = !!(step.name.trim() && step.startTime && step.endTime);
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
                <TouchableOpacity
                  style={[
                    styles.slotSaveBtn,
                    step.saved && styles.slotSaveBtnDone,
                    !canSave && !step.saved && styles.slotSaveBtnDisabled,
                  ]}
                  onPress={() => handleSlotSave(idx)}
                  disabled={!canSave}
                >
                  <Text
                    style={[
                      styles.slotSaveBtnText,
                      step.saved && { color: colors.onPrimary },
                      !canSave && !step.saved && { color: colors.secondary },
                    ]}
                  >
                    {step.saved ? t('routine.edit.stepSlotSaved') : t('routine.edit.stepSlotSave')}
                  </Text>
                </TouchableOpacity>
              </View>
              <View style={styles.slotTimeRow}>
                <TouchableOpacity onPress={() => handleStepTimeTap(idx, 'startTime')} style={styles.slotTimeBtn}>
                  <Text style={[styles.slotTimeText, !step.startTime && styles.slotTimeEmpty]}>
                    {formatTimeKr(step.startTime)}
                  </Text>
                </TouchableOpacity>
                <Text style={styles.slotTimeSep}>~</Text>
                <TouchableOpacity onPress={() => handleStepTimeTap(idx, 'endTime')} style={styles.slotTimeBtn}>
                  <Text style={[styles.slotTimeText, !step.endTime && styles.slotTimeEmpty]}>
                    {formatTimeKr(step.endTime)}
                  </Text>
                </TouchableOpacity>
                {steps.length > 1 && (
                  <TouchableOpacity
                    onPress={() => handleDeleteStep(idx)}
                    style={styles.slotDelBtn}
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

        {/* 설정 */}
        <Text style={[styles.sectionTitle, { marginTop: 24 }]}>{t('routine.edit.settingsSection')}</Text>

        <TouchableOpacity style={styles.settingRow} onPress={handleNavCategory}>
          <Text style={styles.settingLabel}>{t('routine.edit.fieldCategory')}</Text>
          <View style={styles.settingValueRow}>
            <Text style={[styles.settingValue, !category && styles.settingValueUnset]}>{categoryLabel}</Text>
            <MaterialIcons name="chevron-right" size={20} color={colors.secondary} />
          </View>
        </TouchableOpacity>

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

        <View style={styles.settingRow}>
          <Text style={styles.settingLabel}>{t('routine.edit.fieldAutoAdvance')}</Text>
          <Switch
            value={autoAdvance}
            onValueChange={value => {
              setAutoAdvance(value);
              markDirty();
            }}
            trackColor={{ false: colors.outlineVariant, true: colors.primary }}
            thumbColor={colors.onPrimary}
            style={{ transform: [{ scale: 0.85 }] }}
          />
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
        mode="time"
        display="spinner"
        date={initialPickerDate}
        onConfirm={handlePickerConfirm}
        onCancel={handlePickerCancel}
        minuteInterval={1}
        is24Hour={false}
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
  fieldLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.secondary,
    letterSpacing: 1.5,
    marginTop: 12,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  nameInput: {
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    fontSize: 15,
    color: colors.onBackground,
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
  slotSaveBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  slotSaveBtnDone: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  slotSaveBtnDisabled: {
    borderColor: colors.outlineVariant,
  },
  slotSaveBtnText: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.primary,
  },
  slotTimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
    paddingLeft: 38,
  },
  slotTimeBtn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: colors.surfaceContainerLowest,
    minWidth: 90,
    alignItems: 'center',
  },
  slotTimeText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.onBackground,
  },
  slotTimeEmpty: {
    color: colors.secondary,
    opacity: 0.6,
  },
  slotTimeSep: {
    fontSize: 14,
    color: colors.secondary,
  },
  slotDelBtn: {
    marginLeft: 'auto',
    padding: 4,
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
