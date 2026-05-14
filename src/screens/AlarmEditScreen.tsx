// v1.6+ 알람 편집 화면.
// 신규/편집 모드 통합. AlarmKit 단독 (iOS 26+).

import React, { useEffect, useRef, useState } from 'react';
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
  I18nManager,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { RootStackParamList } from '../../App';
import { useTheme } from '../context/ThemeContext';
import { ThemeColors } from '../constants/theme';
import TimeWheelPicker from '../components/TimeWheelPicker';
import {
  Alarm,
  AlarmRepeat,
  loadAlarms,
  upsertAlarm,
  deleteAlarm,
  createAlarmId,
} from '../constants/alarms';
import {
  Routine,
  RoutineStep,
  loadRoutines,
  createStepId,
} from '../constants/routines';
import { isAdhocAlarmRoutine } from '../utils/alarmRoutineLink';
import DurationWheelPicker from '../components/DurationWheelPicker';
import {
  scheduleAlarmMain,
  cancelAlarmsForEntity,
} from '../utils/alarmScheduler';
import {
  requestAlarmKitAuthorizationIfNeeded,
  isAlertShownThisCycle,
  markAlertShown,
} from '../utils/routineScheduler';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'AlarmEdit'>;
  route: RouteProp<RootStackParamList, 'AlarmEdit'>;
};

const LABEL_MAX = 30;
const STEP_NAME_MAX = 20;
const MAX_STEPS = 3;
const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** step duration 표시용 formatter. 0 = fallback ("시간 설정") 표시. i18n 영영. */
function formatStepDuration(sec: number, fallback: string, t: (k: string, opts?: any) => string): string {
  if (sec <= 0) return fallback;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const parts: string[] = [];
  if (h > 0) parts.push(`${h}${t('routine.duration.hour', { defaultValue: '시간' })}`);
  if (m > 0) parts.push(`${m}${t('routine.duration.minute', { defaultValue: '분' })}`);
  if (s > 0) parts.push(`${s}${t('routine.duration.second', { defaultValue: '초' })}`);
  return parts.join(' ');
}

/** 신규 알람 측 default 시각 = 현재 시각 (HH:MM). 사용자 측 휠 측 즉시 변경 가능. */
function getCurrentTimeHHMM(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function parseHHMM(s: string): { h: number; m: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return null;
  return { h: parseInt(m[1], 10), m: parseInt(m[2], 10) };
}

export default function AlarmEditScreen({ navigation, route }: Props) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = makeStyles(colors);
  const editingId = route.params?.alarmId ?? null;
  const isEditMode = editingId !== null;

  const [time, setTime] = useState<string>(() => getCurrentTimeHHMM());
  const [repeat, setRepeat] = useState<AlarmRepeat>('once');
  const [days, setDays] = useState<number[]>([]);
  const [label, setLabel] = useState('');
  // v1.7 Phase 1 — 알람+루틴 통합. steps[] 직접 보유. 0개 = 단독 알람 / 1개 이상 = 통합.
  const [steps, setSteps] = useState<RoutineStep[]>([]);
  const [durationPickerVisible, setDurationPickerVisible] = useState(false);
  const [durationPickerStepIndex, setDurationPickerStepIndex] = useState<number | null>(null);
  // 기존 루틴 불러오기 (= 복사 방식. 선택 시 steps[] 덮어쓰기 = replace).
  const [importPickerVisible, setImportPickerVisible] = useState(false);
  const [availableRoutines, setAvailableRoutines] = useState<Routine[]>([]);

  const originalCreatedAtRef = useRef<number | null>(null);
  const loadedRef = useRef(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // v1.7 Phase 1 — 불러오기 모달용 사용자 routine 로드.
  // v1.7 Phase 2-A — ad-hoc 알람 routine (= prefix 'aa_') 필터.
  useEffect(() => {
    loadRoutines()
      .then(rs => {
        if (!isMountedRef.current) return;
        setAvailableRoutines(rs.filter(r => !isAdhocAlarmRoutine(r.id)));
      })
      .catch(() => {});
  }, []);

  // 편집 모드: 기존 알람 로드
  useEffect(() => {
    if (loadedRef.current || !editingId) {
      loadedRef.current = true;
      return;
    }
    loadAlarms().then(list => {
      const target = list.find(a => a.id === editingId);
      if (!target) {
        loadedRef.current = true;
        return;
      }
      originalCreatedAtRef.current = target.createdAt;
      setTime(target.time);
      setRepeat(target.repeat);
      setDays(target.days);
      setLabel(target.label);
      setSteps(target.steps ?? []);
      loadedRef.current = true;
    });
  }, [editingId]);

  const handleTimeConfirm = (hour: number, minute: number) => {
    setTime(`${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`);
  };

  // v1.7 Phase 1 — step 편집 handlers.
  const handleStepNameChange = (idx: number, text: string) => {
    setSteps(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], name: text };
      return next;
    });
  };
  const handleStepDurationTap = (idx: number) => {
    setDurationPickerStepIndex(idx);
    setDurationPickerVisible(true);
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
    setDurationPickerVisible(false);
    setDurationPickerStepIndex(null);
  };
  const handleDurationCancel = () => {
    setDurationPickerVisible(false);
    setDurationPickerStepIndex(null);
  };
  const handleAddStep = () => {
    if (steps.length >= MAX_STEPS) return;
    setSteps(prev => [...prev, { id: createStepId(), name: '', durationSeconds: 0 }]);
  };
  const handleDeleteStep = (idx: number) => {
    setSteps(prev => prev.filter((_, i) => i !== idx));
  };
  // 기존 루틴 불러오기 (= 복사. step.id = 새로 발급).
  const handleImportFromRoutine = () => {
    if (availableRoutines.length === 0) {
      Alert.alert(
        t('alarm.import.empty.title', { defaultValue: '루틴 없음' }),
        t('alarm.import.empty.body', {
          defaultValue: '먼저 루틴 탭에서 루틴을 만들어주세요.',
        })
      );
      return;
    }
    setImportPickerVisible(true);
  };
  const handleSelectRoutineToImport = (routine: Routine) => {
    const copied = routine.steps.map(s => ({
      id: createStepId(),
      name: s.name,
      durationSeconds: s.durationSeconds,
      ...(s.icon ? { icon: s.icon } : {}),
    }));
    setSteps(copied);
    setImportPickerVisible(false);
  };

  const toggleDay = (d: number) => {
    setDays(prev => {
      const next = prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d].sort();
      // 요일 토글 측 = repeat 자동 detect (= 빈/전체/일반 weekly).
      if (next.length === 0) setRepeat('once');
      else if (next.length === 7) setRepeat('daily');
      else setRepeat('weekly');
      return next;
    });
  };

  // 4개 버튼 (= 안 함 / 매일 / 주중 / 주말) 측 = 누름 시 days 자동 fill + repeat 동기화.
  type DisplayMode = 'once' | 'daily' | 'weekday' | 'weekend';

  const setMode = (mode: DisplayMode) => {
    if (mode === 'once') {
      setRepeat('once');
      setDays([]);
    } else if (mode === 'daily') {
      setRepeat('daily');
      setDays([0, 1, 2, 3, 4, 5, 6]);
    } else if (mode === 'weekday') {
      setRepeat('weekly');
      setDays([1, 2, 3, 4, 5]);
    } else {
      // weekend
      setRepeat('weekly');
      setDays([0, 6]);
    }
  };

  // 현재 (repeat + days) → display mode derive. 매칭 ❌ = null (= 4개 버튼 모두 unselected).
  const getDisplayMode = (): DisplayMode | null => {
    if (repeat === 'once') return 'once';
    if (repeat === 'daily') return 'daily';
    // weekly
    if (days.length === 5 && [1, 2, 3, 4, 5].every(d => days.includes(d))) return 'weekday';
    if (days.length === 2 && [0, 6].every(d => days.includes(d))) return 'weekend';
    return null;
  };

  const currentMode = getDisplayMode();

  const validate = (): { ok: boolean; error?: string } => {
    if (parseHHMM(time) === null) {
      return { ok: false, error: t('alarm.validate.time', { defaultValue: '시각이 올바르지 않습니다' }) };
    }
    if (repeat === 'weekly' && days.length === 0) {
      return {
        ok: false,
        error: t('alarm.validate.daysEmpty', { defaultValue: '요일을 선택해주세요' }),
      };
    }
    // v1.8 회귀 정정 — step 측 추가 시 라벨 + 각 step 측 이름 + duration 측 필수.
    const populatedSteps = steps.filter(
      s => s.name.trim().length > 0 || s.durationSeconds > 0
    );
    if (populatedSteps.length > 0) {
      if (label.trim().length === 0) {
        return {
          ok: false,
          error: t('alarm.validate.labelEmpty', { defaultValue: '알람 라벨을 입력해주세요' }),
        };
      }
      for (const step of populatedSteps) {
        if (step.name.trim().length === 0) {
          return {
            ok: false,
            error: t('alarm.validate.stepNameEmpty', { defaultValue: '루틴 단계 이름을 입력해주세요' }),
          };
        }
        if (step.durationSeconds <= 0) {
          return {
            ok: false,
            error: t('alarm.validate.stepDurationEmpty', { defaultValue: '루틴 단계 시간을 설정해주세요' }),
          };
        }
      }
    }
    return { ok: true };
  };

  const handleSave = async () => {
    const v = validate();
    if (!v.ok) {
      Alert.alert(
        t('alarm.validate.title', { defaultValue: '확인 필요' }),
        v.error ?? ''
      );
      return;
    }

    // v1.7 Phase 1 — steps[] 측 빈 이름 + duration 0 모두 trim. trim 후 0개 = 단독 알람.
    const trimmedSteps = steps
      .map(s => ({ ...s, name: s.name.trim() }))
      .filter(s => s.name.length > 0 || s.durationSeconds > 0);

    const alarm: Alarm = {
      id: editingId ?? createAlarmId(),
      time,
      repeat,
      days: repeat === 'weekly' ? days : [],
      label: label.trim(),
      enabled: true,
      createdAt: originalCreatedAtRef.current ?? Date.now(),
      ...(trimmedSteps.length > 0 ? { steps: trimmedSteps } : {}),
    };

    // AlarmKit 권한 요청 (iOS 26+ 만)
    const authState = await requestAlarmKitAuthorizationIfNeeded();
    if (!isMountedRef.current) return;
    if (authState === 'denied' && !isAlertShownThisCycle()) {
      markAlertShown();
      Alert.alert(
        t('routine.alarmKit.permissionRequiredTitle', {
          defaultValue: 'AlarmKit 권한 필요',
        }),
        t('routine.alarmKit.permissionRequiredBody', {
          defaultValue: '설정 측 알림 권한 활성화 부탁드립니다.',
        }),
        [
          {
            text: t('routine.alarmKit.openSettings', { defaultValue: '설정 열기' }),
            onPress: () => {
              Linking.openURL('app-settings:').catch(() => {});
            },
          },
          { text: t('common.confirm', { defaultValue: '확인' }), style: 'default' },
        ]
      );
    }

    // 기존 등록 cancel + 신규 schedule
    await cancelAlarmsForEntity(alarm.id).catch(() => {});
    await upsertAlarm(alarm);
    await scheduleAlarmMain(alarm).catch(() => {});

    if (!isMountedRef.current) return;
    navigation.goBack();
  };

  const handleDelete = () => {
    if (!editingId) return;
    Alert.alert(
      t('alarm.delete.title', { defaultValue: '알람 삭제' }),
      t('alarm.delete.body', { defaultValue: '이 알람을 삭제하시겠습니까?' }),
      [
        { text: t('common.cancel', { defaultValue: '취소' }), style: 'cancel' },
        {
          text: t('alarm.delete.confirm', { defaultValue: '삭제' }),
          style: 'destructive',
          onPress: async () => {
            await cancelAlarmsForEntity(editingId).catch(() => {});
            await deleteAlarm(editingId);
            if (isMountedRef.current) navigation.goBack();
          },
        },
      ]
    );
  };

  const handleClose = () => navigation.goBack();

  const initialTime = parseHHMM(time) ?? { h: 7, m: 0 };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.iconBtn} onPress={handleClose}>
          <MaterialIcons name="close" size={28} color={colors.onBackground} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          {isEditMode
            ? t('alarm.edit.editTitle', { defaultValue: '알람 편집' })
            : t('alarm.edit.newTitle', { defaultValue: '알람 추가' })}
        </Text>
        <TouchableOpacity style={styles.iconBtn} onPress={handleSave}>
          <Text style={styles.headerSave}>
            {t('common.save', { defaultValue: '저장' })}
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        automaticallyAdjustKeyboardInsets={true}
        nestedScrollEnabled={true}
      >
        {/* v1.7 — 시각 휠 + 콘텐츠 통합 ScrollView (= 사용자 명시). 휠 자체는 자체 wheel scroll, 부모 vertical scroll. */}
        <TimeWheelPicker
          isVisible={true}
          inline
          initialHour={initialTime.h}
          initialMinute={initialTime.m}
          onConfirm={handleTimeConfirm}
          onCancel={() => {}}
          amLabel={t('common.am', { defaultValue: '오전' })}
          pmLabel={t('common.pm', { defaultValue: '오후' })}
          hourUnitLabel={t('common.hour', { defaultValue: '시' })}
          minuteUnitLabel={t('common.minute', { defaultValue: '분' })}
          confirmLabel={t('common.confirm', { defaultValue: '확인' })}
          cancelLabel={t('common.cancel', { defaultValue: '취소' })}
          textColor={colors.onBackground}
          dimColor={colors.outlineVariant}
          bgColor={colors.surfaceContainerLowest}
          accentColor={colors.primary}
        />

        {/* v1.7 — 시각 휠 ↔ 반복 섹션 구분 라인 (주황 = 브랜드) */}
        <View style={styles.brandSeparator} />

        {/* 반복 */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>
            {t('alarm.repeat.title', { defaultValue: '반복' })}
          </Text>
          <View style={styles.repeatRow}>
            {(['once', 'daily', 'weekday', 'weekend'] as DisplayMode[]).map(m => (
              <TouchableOpacity
                key={m}
                style={[styles.repeatBtn, currentMode === m && styles.repeatBtnActive]}
                onPress={() => setMode(m)}
              >
                <Text
                  style={[
                    styles.repeatBtnText,
                    currentMode === m && styles.repeatBtnTextActive,
                  ]}
                >
                  {m === 'once'
                    ? t('alarm.repeat.once', { defaultValue: '안 함' })
                    : m === 'daily'
                      ? t('alarm.repeat.daily', { defaultValue: '매일' })
                      : m === 'weekday'
                        ? t('alarm.repeat.weekday', { defaultValue: '주중' })
                        : t('alarm.repeat.weekend', { defaultValue: '주말' })}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* 요일 row — 항상 노출. repeat='weekly' 시만 사용자 입력 의미 (= once/daily 시 = days 무시). */}
          <View style={styles.daysRow}>
            {WEEKDAY_KEYS.map((wk, idx) => (
              <TouchableOpacity
                key={wk}
                style={[styles.dayBtn, days.includes(idx) && styles.dayBtnActive]}
                onPress={() => toggleDay(idx)}
              >
                <Text
                  style={[
                    styles.dayBtnText,
                    days.includes(idx) && styles.dayBtnTextActive,
                  ]}
                >
                  {t(`routine.weekday.${wk}`, { defaultValue: wk })}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* 라벨 */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>
            {t('alarm.label.title', { defaultValue: '라벨' })}
          </Text>
          <TextInput
            style={styles.labelInput}
            placeholder={t('alarm.label.placeholder', { defaultValue: '예: 기상' })}
            placeholderTextColor={colors.outlineVariant}
            value={label}
            onChangeText={setLabel}
            maxLength={LABEL_MAX}
          />
        </View>

        {/* 해제 방식 */}
        {/* v1.7 hotfix #DismissMethodPurge — 알람별 해제 방식 영역 폐기 (= 전역 SettingsScreen 측 DISMISS_METHOD 정합). 사용자분 측 = "헷갈림" 사인 + 본 cycle #SoundMismatch 정합 영역. */}

        {/* v1.7 Phase 1 — 루틴 추가 (= alarm.steps[] 직접 편집) */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>
            {t('alarm.routineSection.title', { defaultValue: '루틴 추가' })}
          </Text>
          {steps.map((step, idx) => (
            <View key={step.id} style={styles.stepRow}>
              <TextInput
                style={styles.stepNameInput}
                value={step.name}
                onChangeText={text => handleStepNameChange(idx, text)}
                placeholder={t('alarm.routineSection.stepName', {
                  defaultValue: `루틴 ${String(idx + 1).padStart(2, '0')}`,
                  n: String(idx + 1).padStart(2, '0'),
                })}
                placeholderTextColor={colors.outlineVariant}
                maxLength={STEP_NAME_MAX}
              />
              <TouchableOpacity
                style={styles.stepDurationBtn}
                onPress={() => handleStepDurationTap(idx)}
              >
                <Text
                  style={[
                    styles.stepDurationText,
                    step.durationSeconds <= 0 && styles.stepDurationEmpty,
                  ]}
                >
                  {formatStepDuration(
                    step.durationSeconds,
                    t('alarm.routineSection.setDuration', { defaultValue: '시간 설정' }),
                    t
                  )}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => handleDeleteStep(idx)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <MaterialIcons name="remove-circle-outline" size={20} color={colors.secondary} />
              </TouchableOpacity>
            </View>
          ))}
          {steps.length < MAX_STEPS && (
            <TouchableOpacity style={styles.addStepBtn} onPress={handleAddStep}>
              <MaterialIcons name="add" size={20} color={colors.primary} />
              <Text style={styles.addStepText}>
                {t('alarm.routineSection.add', { defaultValue: '추가' })}
              </Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.importBtn} onPress={handleImportFromRoutine}>
            <MaterialIcons name="file-download" size={18} color={colors.primary} />
            <Text style={styles.importBtnText}>
              {t('alarm.routineSection.importFromRoutine', {
                defaultValue: '기존 루틴 불러오기',
              })}
            </Text>
          </TouchableOpacity>
        </View>

        {/* 삭제 (편집 모드만) */}
        {isEditMode && (
          <TouchableOpacity style={styles.deleteBtn} onPress={handleDelete}>
            <MaterialIcons name="delete-outline" size={20} color="#c62828" />
            <Text style={styles.deleteBtnText}>
              {t('alarm.delete.confirm', { defaultValue: '삭제' })}
            </Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      {/* v1.7 Phase 1 — Duration picker 모달 */}
      <DurationWheelPicker
        isVisible={durationPickerVisible}
        initialSeconds={
          durationPickerStepIndex !== null
            ? steps[durationPickerStepIndex]?.durationSeconds ?? 0
            : 0
        }
        onConfirm={handleDurationConfirm}
        onCancel={handleDurationCancel}
        hourLabel={t('common.hour', { defaultValue: '시간' })}
        minuteLabel={t('common.minute', { defaultValue: '분' })}
        secondLabel={t('common.second', { defaultValue: '초' })}
        confirmLabel={t('common.confirm', { defaultValue: '확인' })}
        cancelLabel={t('common.cancel', { defaultValue: '취소' })}
        textColor={colors.onBackground}
        dimColor={colors.outlineVariant}
        bgColor={colors.surfaceContainerLowest}
        accentColor={colors.primary}
      />

      {/* v1.7 Phase 1 — 루틴 불러오기 모달 */}
      {importPickerVisible && (
        <View style={styles.importModalOverlay}>
          <View style={styles.importModalCard}>
            <Text style={styles.importModalTitle}>
              {t('alarm.import.title', { defaultValue: '불러올 루틴 선택' })}
            </Text>
            <ScrollView style={styles.importModalList}>
              {availableRoutines.map(r => (
                <TouchableOpacity
                  key={r.id}
                  style={styles.importModalItem}
                  onPress={() => handleSelectRoutineToImport(r)}
                >
                  <Text style={styles.importModalItemText}>
                    {r.name || r.category}
                  </Text>
                  <Text style={styles.importModalItemMeta}>
                    {t('alarm.import.stepCount', {
                      defaultValue: `${r.steps.length}단계`,
                      count: r.steps.length,
                    })}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity
              style={styles.importModalCancel}
              onPress={() => setImportPickerVisible(false)}
            >
              <Text style={styles.importModalCancelText}>
                {t('common.cancel', { defaultValue: '취소' })}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

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
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: 0.5,
      borderBottomColor: colors.outlineVariant,
    },
    headerTitle: {
      fontSize: 17,
      fontWeight: '600',
      color: colors.onBackground,
    },
    iconBtn: {
      width: 60,
      alignItems: 'center',
    },
    headerSave: {
      fontSize: 16,
      color: colors.primary,
      fontWeight: '600',
    },
    content: {
      paddingTop: 8,
      paddingBottom: 200,
    },
    row: {
      flexDirection: flexRow,
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 20,
      paddingVertical: 16,
      backgroundColor: colors.surfaceContainerLowest,
      borderBottomWidth: 0.5,
      borderBottomColor: colors.outlineVariant,
    },
    rowLabel: {
      fontSize: 16,
      color: colors.onBackground,
    },
    rowValue: {
      fontSize: 16,
      color: colors.secondary,
    },
    section: {
      paddingHorizontal: 20,
      paddingVertical: 16,
      backgroundColor: colors.surfaceContainerLowest,
      borderBottomWidth: 0.5,
      borderBottomColor: colors.outlineVariant,
    },
    sectionLabel: {
      fontSize: 14,
      color: colors.secondary,
      marginBottom: 12,
    },
    repeatRow: {
      flexDirection: flexRow,
      gap: 8,
    },
    repeatBtn: {
      flex: 1,
      paddingVertical: 10,
      borderRadius: 8,
      backgroundColor: colors.surfaceContainerLow,
      alignItems: 'center',
    },
    repeatBtnActive: {
      backgroundColor: colors.primary,
    },
    repeatBtnText: {
      fontSize: 14,
      color: colors.onBackground,
    },
    repeatBtnTextActive: {
      color: colors.onPrimary,
      fontWeight: '600',
    },
    daysRow: {
      flexDirection: flexRow,
      justifyContent: 'space-between',
      marginTop: 12,
    },
    dayBtn: {
      width: 38,
      height: 38,
      borderRadius: 19,
      backgroundColor: colors.surfaceContainerLow,
      alignItems: 'center',
      justifyContent: 'center',
    },
    dayBtnActive: {
      backgroundColor: colors.primary,
    },
    dayBtnText: {
      fontSize: 13,
      color: colors.onBackground,
    },
    dayBtnTextActive: {
      color: colors.onPrimary,
      fontWeight: '600',
    },
    labelInput: {
      fontSize: 16,
      color: colors.onBackground,
      paddingVertical: 8,
      borderBottomWidth: 1,
      borderBottomColor: colors.outlineVariant,
    },
    dismissRow: {
      flexDirection: flexRow,
      gap: 8,
    },
    dismissBtn: {
      flex: 1,
      flexDirection: flexRow,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 12,
      borderRadius: 8,
      backgroundColor: colors.surfaceContainerLow,
      gap: 6,
    },
    dismissBtnActive: {
      backgroundColor: colors.primary,
    },
    dismissBtnText: {
      fontSize: 14,
      color: colors.onBackground,
    },
    dismissBtnTextActive: {
      color: colors.onPrimary,
      fontWeight: '600',
    },
    deleteBtn: {
      flexDirection: flexRow,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 14,
      marginTop: 24,
      marginHorizontal: 20,
      borderRadius: 8,
      backgroundColor: colors.surfaceContainerLowest,
      gap: 8,
    },
    deleteBtnText: {
      fontSize: 15,
      color: '#c62828',
      fontWeight: '500',
    },
    // v1.7 — 시각 휠 ↔ 반복 섹션 구분 라인 (= 브랜드 색).
    brandSeparator: {
      height: 0.5,
      backgroundColor: colors.primary,
    },
    // v1.7 Phase 1 — 루틴 추가 영역 styles.
    stepRow: {
      flexDirection: flexRow,
      alignItems: 'center',
      gap: 8,
      paddingVertical: 8,
      borderBottomWidth: 0.5,
      borderBottomColor: colors.outlineVariant,
    },
    stepNameInput: {
      flex: 1,
      fontSize: 15,
      color: colors.onBackground,
      paddingVertical: 6,
    },
    stepDurationBtn: {
      paddingHorizontal: 10,
      paddingVertical: 6,
      backgroundColor: colors.surfaceContainerLow,
      borderRadius: 6,
    },
    stepDurationText: {
      fontSize: 13,
      color: colors.onBackground,
      fontWeight: '500',
    },
    stepDurationEmpty: {
      color: colors.secondary,
      fontWeight: '400',
    },
    addStepBtn: {
      flexDirection: flexRow,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 10,
      marginTop: 8,
      borderWidth: 1,
      borderColor: colors.primary,
      borderStyle: 'dashed',
      borderRadius: 8,
      gap: 6,
    },
    addStepText: {
      fontSize: 14,
      color: colors.primary,
      fontWeight: '500',
    },
    importBtn: {
      flexDirection: flexRow,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 10,
      marginTop: 8,
      gap: 6,
    },
    importBtnText: {
      fontSize: 13,
      color: colors.primary,
      fontWeight: '500',
    },
    importModalOverlay: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.4)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 20,
    },
    importModalCard: {
      width: '100%',
      maxWidth: 400,
      maxHeight: '70%',
      backgroundColor: colors.background,
      borderRadius: 12,
      paddingTop: 16,
      paddingBottom: 8,
    },
    importModalTitle: {
      fontSize: 16,
      fontWeight: '600',
      color: colors.onBackground,
      paddingHorizontal: 20,
      paddingBottom: 12,
    },
    importModalList: {
      maxHeight: 360,
    },
    importModalItem: {
      paddingHorizontal: 20,
      paddingVertical: 12,
      borderTopWidth: 0.5,
      borderTopColor: colors.outlineVariant,
    },
    importModalItemText: {
      fontSize: 15,
      color: colors.onBackground,
      fontWeight: '500',
    },
    importModalItemMeta: {
      fontSize: 12,
      color: colors.secondary,
      marginTop: 2,
    },
    importModalCancel: {
      paddingVertical: 14,
      alignItems: 'center',
      borderTopWidth: 0.5,
      borderTopColor: colors.outlineVariant,
    },
    importModalCancelText: {
      fontSize: 15,
      color: colors.primary,
      fontWeight: '500',
    },
  });
};
