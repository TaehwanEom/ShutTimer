import React, { useState, useCallback, useMemo } from 'react';
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
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTranslation } from 'react-i18next';
import { RootStackParamList } from '../../App';
import { useTheme } from '../context/ThemeContext';
import { ThemeColors } from '../constants/theme';
import { SESSIONS_STORAGE_KEY, SessionRecord } from '../constants/sessions';
import AdBanner from '../components/AdBanner';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'History'>;
};

// ─── 헬퍼 ──────────────────────────────────────────────────────
function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}
function getFirstDayOfWeek(year: number, month: number) {
  return new Date(year, month, 1).getDay();
}
function toKey(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// ─── 스타일 ────────────────────────────────────────────────────
const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  headerTitle: {
    fontSize: 18, fontWeight: '800',
    color: colors.onBackground, letterSpacing: -0.5,
  },
  backBtn: { padding: 8, borderRadius: 50, width: 40 },
  monthNav: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'center', gap: 20,
    paddingVertical: 8, marginBottom: 8,
  },
  monthText: {
    fontSize: 17, fontWeight: '800',
    color: colors.onBackground, minWidth: 120, textAlign: 'center',
  },
  calGrid: { paddingHorizontal: 12 },
  weekdayRow: { flexDirection: 'row', marginBottom: 4 },
  weekdayCell: { flex: 1, alignItems: 'center', paddingVertical: 4 },
  weekdayText: { fontSize: 12, fontWeight: '700', color: colors.secondary, opacity: 0.7 },
  weekRow: { flexDirection: 'row', marginBottom: 4 },
  dayCell: {
    flex: 1, aspectRatio: 1,
    alignItems: 'center', justifyContent: 'center',
    borderRadius: 12,
  },
  dayCellSelected: { backgroundColor: colors.primary },
  dayCellToday: { borderWidth: 1.5, borderColor: colors.primary },
  dayText: { fontSize: 14, fontWeight: '600', color: colors.onBackground },
  dayTextSelected: { color: colors.onPrimary },
  dayTextOtherMonth: { opacity: 0.25 },
  dayDot: {
    width: 4, height: 4, borderRadius: 2,
    backgroundColor: colors.primary, marginTop: 2,
  },
  dayDotSelected: { backgroundColor: colors.onPrimary },
  divider: {
    height: 1, backgroundColor: colors.outlineVariant,
    marginHorizontal: 16, marginVertical: 16, opacity: 0.5,
  },
  sectionLabel: {
    fontSize: 13, fontWeight: '800', color: colors.secondary,
    letterSpacing: 0.8, marginHorizontal: 16, marginBottom: 10,
  },
  sessionCard: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: 16, marginBottom: 8,
    padding: 14, borderRadius: 14,
    backgroundColor: colors.surfaceContainerLow,
    gap: 12,
  },
  sessionIconWrap: {
    width: 40, height: 40, borderRadius: 11,
    backgroundColor: colors.surfaceContainerLowest,
    alignItems: 'center', justifyContent: 'center',
  },
  sessionLabel: { fontSize: 15, fontWeight: '700', color: colors.onBackground, flex: 1 },
  sessionMinutes: { fontSize: 14, fontWeight: '700', color: colors.primary },
  noSession: {
    textAlign: 'center', color: colors.secondary,
    fontSize: 14, marginTop: 16, opacity: 0.6,
  },
  statsRow: { flexDirection: 'row', marginHorizontal: 16, marginTop: 8, gap: 10 },
  statCard: {
    flex: 1, padding: 16, borderRadius: 14,
    backgroundColor: colors.surfaceContainerLow,
    alignItems: 'center', gap: 4,
  },
  statValue: { fontSize: 22, fontWeight: '800', color: colors.primary },
  statLabel: { fontSize: 11, fontWeight: '600', color: colors.secondary, opacity: 0.8 },
});

// ─── 컴포넌트 ──────────────────────────────────────────────────
export default function HistoryScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const { t, i18n } = useTranslation();
  const styles = makeStyles(colors);

  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [selectedDay, setSelectedDay] = useState(today.getDate());
  const [sessionsByDate, setSessionsByDate] = useState<Record<string, SessionRecord[]>>({});

  // 요일 (일~토) — locale 자동
  const weekdays = useMemo(() =>
    Array.from({ length: 7 }, (_, i) =>
      new Date(2024, 0, i).toLocaleDateString(i18n.language, { weekday: 'short' })
    ), [i18n.language]);

  // 월 헤더 — locale 자동
  const monthHeader = useMemo(() =>
    new Date(year, month).toLocaleDateString(i18n.language, { year: 'numeric', month: 'long' }),
    [year, month, i18n.language]);

  // 월 이름 (통계 섹션용)
  const monthName = useMemo(() =>
    new Date(year, month).toLocaleDateString(i18n.language, { month: 'long' }),
    [year, month, i18n.language]);

  // 선택된 날짜 라벨
  const dateLabel = useMemo(() =>
    new Date(year, month, selectedDay).toLocaleDateString(i18n.language, { month: 'long', day: 'numeric' }),
    [year, month, selectedDay, i18n.language]);

  useFocusEffect(
    useCallback(() => {
      AsyncStorage.getItem(SESSIONS_STORAGE_KEY).then(raw => {
        const list: SessionRecord[] = raw ? JSON.parse(raw) : [];
        const grouped: Record<string, SessionRecord[]> = {};
        for (const s of list) {
          if (!grouped[s.date]) grouped[s.date] = [];
          grouped[s.date].push(s);
        }
        setSessionsByDate(grouped);
      });
    }, [])
  );

  // 캘린더 셀 생성
  const daysInMonth = getDaysInMonth(year, month);
  const firstDow = getFirstDayOfWeek(year, month);
  const prevYear = month === 0 ? year - 1 : year;
  const prevMon = month === 0 ? 11 : month - 1;
  const prevMonthDays = getDaysInMonth(prevYear, prevMon);

  const cells: { day: number; thisMonth: boolean }[] = [];
  for (let i = firstDow - 1; i >= 0; i--) {
    cells.push({ day: prevMonthDays - i, thisMonth: false });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ day: d, thisMonth: true });
  }
  while (cells.length % 7 !== 0) {
    cells.push({ day: cells.length - daysInMonth - firstDow + 1, thisMonth: false });
  }
  const weeks: typeof cells[] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  // 선택된 날 세션
  const selectedKey = toKey(year, month, selectedDay);
  const sessions = sessionsByDate[selectedKey] ?? [];

  // 이번 달 통계
  const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}`;
  const monthEntries = Object.entries(sessionsByDate).filter(([k]) => k.startsWith(monthPrefix));
  const totalMinutes = monthEntries.reduce((acc, [, v]) => acc + v.reduce((s, x) => s + x.minutes, 0), 0);
  const activeDays = monthEntries.length;

  const goPrevMonth = () => {
    if (month === 0) { setYear(y => y - 1); setMonth(11); }
    else setMonth(m => m - 1);
    setSelectedDay(1);
  };
  const goNextMonth = () => {
    if (month === 11) { setYear(y => y + 1); setMonth(0); }
    else setMonth(m => m + 1);
    setSelectedDay(1);
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <MaterialIcons name="arrow-back" size={24} color={colors.onBackground} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('history.title')}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
        {/* 월 네비게이터 */}
        <View style={styles.monthNav}>
          <TouchableOpacity onPress={goPrevMonth}>
            <MaterialIcons name="chevron-left" size={28} color={colors.onBackground} />
          </TouchableOpacity>
          <Text style={styles.monthText}>{monthHeader}</Text>
          <TouchableOpacity onPress={goNextMonth}>
            <MaterialIcons name="chevron-right" size={28} color={colors.onBackground} />
          </TouchableOpacity>
        </View>

        {/* 캘린더 그리드 */}
        <View style={styles.calGrid}>
          <View style={styles.weekdayRow}>
            {weekdays.map((d, i) => (
              <View key={i} style={styles.weekdayCell}>
                <Text style={[styles.weekdayText, i === 0 && { color: colors.error }]}>{d}</Text>
              </View>
            ))}
          </View>

          {weeks.map((week, wi) => (
            <View key={wi} style={styles.weekRow}>
              {week.map((cell, ci) => {
                const key = cell.thisMonth ? toKey(year, month, cell.day) : '';
                const hasSession = !!sessionsByDate[key];
                const isSelected = cell.thisMonth && cell.day === selectedDay;
                const isToday = cell.thisMonth &&
                  cell.day === today.getDate() &&
                  month === today.getMonth() &&
                  year === today.getFullYear();

                return (
                  <TouchableOpacity
                    key={ci}
                    style={[
                      styles.dayCell,
                      isSelected && styles.dayCellSelected,
                      isToday && !isSelected && styles.dayCellToday,
                    ]}
                    onPress={() => cell.thisMonth && setSelectedDay(cell.day)}
                    activeOpacity={cell.thisMonth ? 0.7 : 1}
                  >
                    <Text style={[
                      styles.dayText,
                      isSelected && styles.dayTextSelected,
                      !cell.thisMonth && styles.dayTextOtherMonth,
                      ci === 0 && !isSelected && { color: colors.error, opacity: cell.thisMonth ? 1 : 0.25 },
                    ]}>
                      {cell.day}
                    </Text>
                    {hasSession && (
                      <View style={[styles.dayDot, isSelected && styles.dayDotSelected]} />
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          ))}
        </View>

        <View style={styles.divider} />

        {/* 선택된 날 세션 */}
        <Text style={styles.sectionLabel}>{dateLabel}</Text>
        {sessions.length === 0 ? (
          <Text style={styles.noSession}>{t('history.noSessions')}</Text>
        ) : (
          sessions.map((s) => (
            <View key={s.id} style={styles.sessionCard}>
              <View style={styles.sessionIconWrap}>
                <MaterialIcons name={s.icon as any} size={20} color={colors.primary} />
              </View>
              <Text style={styles.sessionLabel}>
                {s.icon === 'timer' ? t('history.timer') : t(`icons.${s.icon}`)}
              </Text>
              <Text style={styles.sessionMinutes}>{t('history.minutesFmt', { min: s.minutes })}</Text>
            </View>
          ))
        )}

        {/* 이번 달 통계 */}
        <View style={styles.divider} />
        <Text style={styles.sectionLabel}>{t('history.monthStats', { month: monthName })}</Text>
        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>
              {totalMinutes >= 60
                ? `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m`
                : `${totalMinutes}m`}
            </Text>
            <Text style={styles.statLabel}>{t('history.totalTime')}</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{t('history.daysFmt', { days: activeDays })}</Text>
            <Text style={styles.statLabel}>{t('history.activeDays')}</Text>
          </View>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
      <AdBanner />
    </SafeAreaView>
  );
}
