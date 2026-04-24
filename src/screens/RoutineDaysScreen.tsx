// v1.6 Phase 4: 반복 요일 선택 화면.
// 빠른 선택 3개 (매일/주중/주말) + 7일 체크박스.
// 확인 시 RoutineEdit 으로 merge 복귀.

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  ScrollView,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { RootStackParamList } from '../../App';
import { useTheme } from '../context/ThemeContext';
import { ThemeColors } from '../constants/theme';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'RoutineDays'>;
  route: RouteProp<RootStackParamList, 'RoutineDays'>;
};

const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const WEEKDAYS = [1, 2, 3, 4, 5];
const WEEKENDS = [0, 6];
const EVERYDAY = [0, 1, 2, 3, 4, 5, 6];

function arraysEqual(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}

export default function RoutineDaysScreen({ navigation, route }: Props) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = makeStyles(colors);
  const initial = route.params?.current ?? [];

  const [days, setDays] = useState<number[]>(initial);

  const toggleDay = (d: number) => {
    setDays(prev => (prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d].sort()));
  };

  const applyPreset = (preset: number[]) => {
    setDays(preset);
  };

  const handleDone = () => {
    navigation.navigate({
      name: 'RoutineEdit',
      params: { selectedDays: days },
      merge: true,
    });
  };

  const isEveryday = arraysEqual(days, EVERYDAY);
  const isWeekday = arraysEqual(days, WEEKDAYS);
  const isWeekend = arraysEqual(days, WEEKENDS);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.iconBtn} onPress={() => navigation.goBack()}>
          <MaterialIcons name="chevron-left" size={32} color={colors.onBackground} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('routine.days.title')}</Text>
        <TouchableOpacity style={styles.iconBtn} onPress={handleDone}>
          <Text style={styles.doneBtn}>{t('routine.days.done')}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* 빠른 선택 */}
        <View style={styles.presetRow}>
          <TouchableOpacity
            style={[styles.presetBtn, isEveryday && styles.presetBtnActive]}
            onPress={() => applyPreset(EVERYDAY)}
          >
            <Text style={[styles.presetText, isEveryday && styles.presetTextActive]}>
              {t('routine.days.quickEveryday')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.presetBtn, isWeekday && styles.presetBtnActive]}
            onPress={() => applyPreset(WEEKDAYS)}
          >
            <Text style={[styles.presetText, isWeekday && styles.presetTextActive]}>
              {t('routine.days.quickWeekday')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.presetBtn, isWeekend && styles.presetBtnActive]}
            onPress={() => applyPreset(WEEKENDS)}
          >
            <Text style={[styles.presetText, isWeekend && styles.presetTextActive]}>
              {t('routine.days.quickWeekend')}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.divider} />

        {/* 7일 체크박스 */}
        {[0, 1, 2, 3, 4, 5, 6].map(d => {
          const checked = days.includes(d);
          return (
            <TouchableOpacity
              key={d}
              style={[styles.dayRow, checked && styles.dayRowChecked]}
              onPress={() => toggleDay(d)}
              activeOpacity={0.7}
            >
              <MaterialIcons
                name={checked ? 'check-box' : 'check-box-outline-blank'}
                size={22}
                color={checked ? colors.primary : colors.secondary}
              />
              <Text style={[styles.dayLabel, checked && { color: colors.primary }]}>
                {t(`routine.weekday.${WEEKDAY_KEYS[d]}`)}요일
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
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
  doneBtn: { fontSize: 15, fontWeight: '800', color: colors.primary },
  content: { paddingHorizontal: 16, paddingBottom: 48 },
  presetRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  presetBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: colors.surfaceContainerLow,
    alignItems: 'center',
  },
  presetBtnActive: {
    backgroundColor: colors.primary,
  },
  presetText: { fontSize: 14, fontWeight: '700', color: colors.onBackground },
  presetTextActive: { color: colors.onPrimary },
  divider: {
    height: 1,
    backgroundColor: colors.outlineVariant,
    marginVertical: 20,
  },
  dayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: colors.surfaceContainerLow,
    marginBottom: 8,
  },
  dayRowChecked: {
    backgroundColor: colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  dayLabel: { fontSize: 15, fontWeight: '700', color: colors.onBackground },
});
