// v1.6: 루틴 추가/편집 화면.
// 신규 생성: route.params.routineId 없음 → 빈 초기값.
// 편집: route.params.routineId 있음 → 해당 루틴 로드.

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
  Modal,
  Image,
  Platform,
  Linking,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as IntentLauncher from 'expo-intent-launcher';
import { MaterialIcons } from '@expo/vector-icons';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { RootStackParamList } from '../../App';
import { useTheme } from '../context/ThemeContext';
import { ThemeColors } from '../constants/theme';
import {
  Routine,
  RoutineMission,
  loadRoutines,
  upsertRoutine,
  createRoutineId,
} from '../constants/routines';
import { scheduleRoutinePrealerts, cancelRoutinePrealerts } from '../utils/routineScheduler';
import { MISSION_POOL, MISSION_EMOJI, MISSION_LABEL } from '../constants/missionIcons';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'RoutineEdit'>;
  route: RouteProp<RootStackParamList, 'RoutineEdit'>;
};

const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DEFAULT_MISSION_MINUTES = 5;
const REST_MISSION_KEY = 'rest';

export default function RoutineEditScreen({ navigation, route }: Props) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = makeStyles(colors);
  const editingId = route.params?.routineId ?? null;

  const [name, setName] = useState('');
  const [missions, setMissions] = useState<RoutineMission[]>([]);
  const [loopCount, setLoopCount] = useState(1);
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [days, setDays] = useState<number[]>([]);
  const [timeHour, setTimeHour] = useState(7);
  const [timeMinute, setTimeMinute] = useState(0);
  const [autoAdvance, setAutoAdvance] = useState(true);
  const [dismissMethod, setDismissMethod] = useState<'tap' | 'shake'>('tap');
  const [missionPickerOpen, setMissionPickerOpen] = useState(false);
  const [editingMissionIndex, setEditingMissionIndex] = useState<number | null>(null);
  // 편집 모드에서 기존 createdAt 유지용
  const originalCreatedAtRef = useRef<number | null>(null);

  // 편집 모드: 기존 루틴 로드
  useEffect(() => {
    if (!editingId) return;
    loadRoutines().then(list => {
      const target = list.find(r => r.id === editingId);
      if (!target) return;
      originalCreatedAtRef.current = target.createdAt;
      setName(target.name);
      setMissions(target.missions);
      setLoopCount(target.loopCount);
      setAutoAdvance(target.autoAdvance);
      setDismissMethod(target.dismissMethod);
      if (target.schedule) {
        setScheduleEnabled(true);
        setDays(target.schedule.days);
        const [h, m] = target.schedule.time.split(':');
        setTimeHour(parseInt(h, 10) || 0);
        setTimeMinute(parseInt(m, 10) || 0);
      }
    });
  }, [editingId]);

  const toggleDay = (d: number) => {
    setDays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d].sort());
  };

  const addMission = () => {
    setEditingMissionIndex(missions.length);
    setMissionPickerOpen(true);
  };

  const pickMission = (missionKey: string) => {
    const next = [...missions];
    if (editingMissionIndex !== null && editingMissionIndex < missions.length) {
      next[editingMissionIndex] = { ...next[editingMissionIndex], missionKey };
    } else {
      next.push({ missionKey, durationMinutes: DEFAULT_MISSION_MINUTES });
    }
    setMissions(next);
    setMissionPickerOpen(false);
    setEditingMissionIndex(null);
  };

  const adjustDuration = (idx: number, delta: number) => {
    setMissions(prev => prev.map((m, i) =>
      i === idx ? { ...m, durationMinutes: Math.max(1, m.durationMinutes + delta) } : m
    ));
  };

  const removeMission = (idx: number) => {
    setMissions(prev => prev.filter((_, i) => i !== idx));
  };

  const adjustLoop = (delta: number) => {
    setLoopCount(prev => Math.max(1, Math.min(99, prev + delta)));
  };

  const adjustHour = (delta: number) => {
    setTimeHour(prev => (prev + delta + 24) % 24);
  };
  const adjustMinute = (delta: number) => {
    setTimeMinute(prev => (prev + delta + 60) % 60);
  };

  const handleSave = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      Alert.alert(t('routine.validationNameEmpty', { defaultValue: '루틴 이름을 입력하세요' }));
      return;
    }
    if (missions.length === 0) {
      Alert.alert(t('routine.validationMissionsEmpty', { defaultValue: '최소 1개 이상의 미션을 추가하세요' }));
      return;
    }

    const routine: Routine = {
      id: editingId ?? createRoutineId(),
      name: trimmed,
      missions,
      loopCount,
      schedule: scheduleEnabled
        ? {
            days,
            time: `${String(timeHour).padStart(2, '0')}:${String(timeMinute).padStart(2, '0')}`,
          }
        : undefined,
      autoAdvance,
      dismissMethod,
      createdAt: editingId && originalCreatedAtRef.current !== null
        ? originalCreatedAtRef.current
        : Date.now(),
    };

    await upsertRoutine(routine);

    // 예약 갱신
    if (editingId) {
      await cancelRoutinePrealerts(editingId);
    }
    if (routine.schedule) {
      await scheduleRoutinePrealerts(routine);
      // Android 12+: 정확한 알림 권한 안내 (1회만). 사용자가 설정에서 허용해야 정시 발화 보장.
      if (Platform.OS === 'android') {
        await maybeShowExactAlarmNotice();
      }
    }

    navigation.goBack();
  }, [editingId, name, missions, loopCount, scheduleEnabled, days, timeHour, timeMinute, autoAdvance, dismissMethod, navigation, t]);

  // Phase 2 C: Android 12+ SCHEDULE_EXACT_ALARM 설정 화면 직접 호출.
  // Android 13+ USE_EXACT_ALARM 자동 부여라 대부분의 기기는 여기 올 필요 없음.
  const openExactAlarmSettings = async () => {
    if (Platform.OS !== 'android') {
      Linking.openSettings().catch(() => {});
      return;
    }
    try {
      await IntentLauncher.startActivityAsync(
        'android.settings.REQUEST_SCHEDULE_EXACT_ALARM_PERMISSION',
        { data: 'package:com.shuttimer.app' }
      );
    } catch {
      // intent 실패 시 앱 설정 화면 fallback
      Linking.openSettings().catch(() => {});
    }
  };

  const maybeShowExactAlarmNotice = async () => {
    try {
      const shown = await AsyncStorage.getItem('routine_exact_alarm_notice_shown');
      if (shown === 'true') return;
      await AsyncStorage.setItem('routine_exact_alarm_notice_shown', 'true');
      Alert.alert(
        t('routine.exactAlarmTitle', { defaultValue: '정확한 알림 권한' }),
        t('routine.exactAlarmBody', { defaultValue: '정시에 알림을 받으려면 시스템 설정에서 "알람 및 리마인더" 권한을 허용해주세요. 권한이 없으면 알림이 최대 15분 지연될 수 있습니다.' }),
        [
          { text: t('routine.exactAlarmLater', { defaultValue: '나중에' }), style: 'cancel' },
          {
            text: t('routine.exactAlarmOpenSettings', { defaultValue: '설정 열기' }),
            onPress: () => openExactAlarmSettings(),
          },
        ]
      );
    } catch {
      // flag 저장/조회 실패 무시
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.iconBtn} onPress={() => navigation.goBack()}>
          <MaterialIcons name="close" size={28} color={colors.onBackground} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          {editingId
            ? t('routine.editTitle', { defaultValue: '루틴 편집' })
            : t('routine.newTitle', { defaultValue: '새 루틴' })}
        </Text>
        <TouchableOpacity style={styles.iconBtn} onPress={handleSave}>
          <MaterialIcons name="check" size={28} color={colors.primary} />
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
        {/* 이름 */}
        <Text style={styles.sectionLabel}>{t('routine.fieldName', { defaultValue: '루틴 이름' })}</Text>
        <TextInput
          style={styles.textInput}
          value={name}
          onChangeText={setName}
          placeholder={t('routine.namePlaceholder', { defaultValue: '예: 아침 루틴' })}
          placeholderTextColor={colors.secondary}
          maxLength={40}
        />

        {/* 미션 목록 */}
        <Text style={styles.sectionLabel}>{t('routine.fieldMissions', { defaultValue: '미션' })}</Text>
        {missions.map((m, idx) => {
          const icon = m.missionKey === REST_MISSION_KEY ? null : MISSION_EMOJI[m.missionKey];
          const label = m.missionKey === REST_MISSION_KEY
            ? t('routine.restLabel', { defaultValue: '휴식' })
            : MISSION_LABEL[m.missionKey] ?? m.missionKey;
          return (
            <View key={idx} style={styles.missionRow}>
              <View style={styles.missionIconWrap}>
                {icon ? (
                  <Image source={icon} style={styles.missionEmoji} resizeMode="contain" />
                ) : (
                  <MaterialIcons name="bedtime" size={24} color={colors.secondary} />
                )}
              </View>
              <Text style={styles.missionLabel} numberOfLines={1}>{label}</Text>
              <View style={styles.durationControl}>
                <TouchableOpacity onPress={() => adjustDuration(idx, -1)}>
                  <MaterialIcons name="remove" size={20} color={colors.onBackground} />
                </TouchableOpacity>
                <Text style={styles.durationText}>{m.durationMinutes}</Text>
                <TouchableOpacity onPress={() => adjustDuration(idx, 1)}>
                  <MaterialIcons name="add" size={20} color={colors.onBackground} />
                </TouchableOpacity>
              </View>
              <TouchableOpacity onPress={() => removeMission(idx)}>
                <MaterialIcons name="delete-outline" size={22} color={colors.error} />
              </TouchableOpacity>
            </View>
          );
        })}
        <TouchableOpacity style={styles.addBtn} onPress={addMission}>
          <MaterialIcons name="add" size={20} color={colors.primary} />
          <Text style={styles.addBtnText}>{t('routine.addMission', { defaultValue: '미션 추가' })}</Text>
        </TouchableOpacity>

        {/* 루프 */}
        <Text style={styles.sectionLabel}>{t('routine.fieldLoop', { defaultValue: '반복 세트' })}</Text>
        <View style={styles.inlineRow}>
          <TouchableOpacity style={styles.adjustBtn} onPress={() => adjustLoop(-1)}>
            <MaterialIcons name="remove" size={22} color={colors.onBackground} />
          </TouchableOpacity>
          <Text style={styles.loopText}>{loopCount}</Text>
          <TouchableOpacity style={styles.adjustBtn} onPress={() => adjustLoop(1)}>
            <MaterialIcons name="add" size={22} color={colors.onBackground} />
          </TouchableOpacity>
          <Text style={styles.loopHint}>
            {t('routine.loopUnit', { defaultValue: '세트' })}
          </Text>
        </View>

        {/* 예약 */}
        <View style={styles.switchRow}>
          <Text style={styles.sectionLabel}>{t('routine.fieldSchedule', { defaultValue: '예약' })}</Text>
          <Switch value={scheduleEnabled} onValueChange={setScheduleEnabled} />
        </View>
        {scheduleEnabled && (
          <>
            {/* 요일 */}
            <View style={styles.daysRow}>
              {WEEKDAY_KEYS.map((key, d) => {
                const on = days.includes(d);
                return (
                  <TouchableOpacity
                    key={key}
                    style={[styles.dayChip, on && { backgroundColor: colors.primary }]}
                    onPress={() => toggleDay(d)}
                  >
                    <Text style={[styles.dayChipText, on && { color: colors.onPrimary }]}>
                      {t(`routine.weekday.${key}`, { defaultValue: key })}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            {/* 시간 */}
            <View style={styles.timeRow}>
              <TouchableOpacity onPress={() => adjustHour(-1)}><MaterialIcons name="keyboard-arrow-up" size={28} color={colors.onBackground} /></TouchableOpacity>
              <Text style={styles.timeText}>{String(timeHour).padStart(2, '0')}</Text>
              <TouchableOpacity onPress={() => adjustHour(1)}><MaterialIcons name="keyboard-arrow-down" size={28} color={colors.onBackground} /></TouchableOpacity>
              <Text style={styles.timeColon}>:</Text>
              <TouchableOpacity onPress={() => adjustMinute(-5)}><MaterialIcons name="keyboard-arrow-up" size={28} color={colors.onBackground} /></TouchableOpacity>
              <Text style={styles.timeText}>{String(timeMinute).padStart(2, '0')}</Text>
              <TouchableOpacity onPress={() => adjustMinute(5)}><MaterialIcons name="keyboard-arrow-down" size={28} color={colors.onBackground} /></TouchableOpacity>
            </View>
          </>
        )}

        {/* 진행 방식 */}
        <View style={styles.switchRow}>
          <Text style={styles.sectionLabel}>
            {autoAdvance
              ? t('routine.fieldAutoAdvanceOn', { defaultValue: '자동 진행' })
              : t('routine.fieldAutoAdvanceOff', { defaultValue: '확인 후 진행' })}
          </Text>
          <Switch value={autoAdvance} onValueChange={setAutoAdvance} />
        </View>

        {/* 알람 종료 방식 */}
        <Text style={styles.sectionLabel}>{t('routine.fieldDismiss', { defaultValue: '알람 종료 방식' })}</Text>
        <View style={styles.inlineRow}>
          <TouchableOpacity
            style={[styles.methodChip, dismissMethod === 'tap' && { backgroundColor: colors.primary }]}
            onPress={() => setDismissMethod('tap')}
          >
            <Text style={[styles.methodChipText, dismissMethod === 'tap' && { color: colors.onPrimary }]}>
              {t('routine.dismissTap', { defaultValue: '탭' })}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.methodChip, dismissMethod === 'shake' && { backgroundColor: colors.primary }]}
            onPress={() => setDismissMethod('shake')}
          >
            <Text style={[styles.methodChipText, dismissMethod === 'shake' && { color: colors.onPrimary }]}>
              {t('routine.dismissShake', { defaultValue: '흔들기' })}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={{ height: 60 }} />
      </ScrollView>

      {/* 미션 선택 모달 */}
      <Modal
        visible={missionPickerOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setMissionPickerOpen(false)}
      >
        <TouchableOpacity
          style={styles.modalBackdrop}
          activeOpacity={1}
          onPress={() => setMissionPickerOpen(false)}
        >
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>
              {t('routine.pickMission', { defaultValue: '미션 선택' })}
            </Text>
            <ScrollView style={{ maxHeight: 400 }}>
              {/* 휴식 */}
              <TouchableOpacity style={styles.pickerRow} onPress={() => pickMission(REST_MISSION_KEY)}>
                <MaterialIcons name="bedtime" size={24} color={colors.secondary} />
                <Text style={styles.pickerRowText}>
                  {t('routine.restLabel', { defaultValue: '휴식' })}
                </Text>
              </TouchableOpacity>
              {/* 미션 풀 */}
              {MISSION_POOL.map((key) => (
                <TouchableOpacity key={key} style={styles.pickerRow} onPress={() => pickMission(key)}>
                  <Image source={MISSION_EMOJI[key]} style={styles.pickerRowEmoji} resizeMode="contain" />
                  <Text style={styles.pickerRowText}>{MISSION_LABEL[key] ?? key}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
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
  },
  iconBtn: {
    padding: 8,
    borderRadius: 50,
    width: 44,
    alignItems: 'center',
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.secondary,
    letterSpacing: 0.8,
    marginHorizontal: 16,
    marginTop: 20,
    marginBottom: 10,
  },
  textInput: {
    marginHorizontal: 16,
    padding: 12,
    borderRadius: 10,
    backgroundColor: colors.surfaceContainerLow,
    color: colors.onBackground,
    fontSize: 15,
  },
  missionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginBottom: 8,
    padding: 12,
    borderRadius: 10,
    backgroundColor: colors.surfaceContainerLow,
    gap: 10,
  },
  missionIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceContainerLowest,
  },
  missionEmoji: {
    width: 28,
    height: 28,
  },
  pickerRowEmoji: {
    width: 28,
    height: 28,
  },
  missionLabel: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
    color: colors.onBackground,
  },
  durationControl: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: colors.surfaceContainerLowest,
  },
  durationText: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.onBackground,
    minWidth: 24,
    textAlign: 'center',
  },
  addBtn: {
    marginHorizontal: 16,
    marginTop: 4,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.primary,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 4,
  },
  addBtnText: {
    color: colors.primary,
    fontWeight: '700',
    fontSize: 14,
  },
  inlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
  },
  adjustBtn: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceContainerLow,
  },
  loopText: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.onBackground,
    minWidth: 40,
    textAlign: 'center',
  },
  loopHint: {
    fontSize: 13,
    color: colors.secondary,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingRight: 16,
  },
  daysRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginHorizontal: 16,
    marginBottom: 12,
  },
  dayChip: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceContainerLow,
  },
  dayChipText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.onBackground,
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginHorizontal: 16,
    marginBottom: 8,
  },
  timeText: {
    fontSize: 26,
    fontWeight: '800',
    color: colors.onBackground,
    minWidth: 40,
    textAlign: 'center',
  },
  timeColon: {
    fontSize: 26,
    fontWeight: '800',
    color: colors.onBackground,
    marginHorizontal: 4,
  },
  methodChip: {
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 10,
    backgroundColor: colors.surfaceContainerLow,
  },
  methodChipText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.onBackground,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 32,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.onBackground,
    marginBottom: 12,
    textAlign: 'center',
  },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 8,
    gap: 12,
    borderRadius: 8,
  },
  pickerRowText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.onBackground,
  },
});
