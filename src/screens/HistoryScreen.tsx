import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTranslation } from 'react-i18next';
import { RootStackParamList } from '../../App';
import { useTheme } from '../context/ThemeContext';
import { ThemeColors } from '../constants/theme';
import { SESSIONS_STORAGE_KEY, SessionRecord } from '../constants/sessions';

// v1.8 — History Stack.Screen 제거. MainTabsNavigator CalendarTab Tab.Screen만 사용.
type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList>;
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
  container: { flex: 1, backgroundColor: colors.surfaceContainerLowest },
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
  headerSpacer: {
    width: 40,
    height: 40,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '600',
    color: colors.onBackground,
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
    borderRadius: 999,
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
    backgroundColor: colors.surfaceContainerLowest,
    gap: 12,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  sessionIconWrap: {
    width: 40, height: 40, borderRadius: 11,
    backgroundColor: colors.surfaceContainerLowest,
    alignItems: 'center', justifyContent: 'center',
  },
  sessionLabel: { fontSize: 15, fontWeight: '700', color: colors.onBackground, flex: 1 },
  sessionMinutes: { fontSize: 14, fontWeight: '700', color: colors.primary },
  // v1.8 #CalendarCategory — 카테고리 접기 header. fontSize 측만 키움.
  catHeader: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: 16, marginBottom: 6, marginTop: 4,
    gap: 6,
  },
  catTitle: {
    fontSize: 20, fontWeight: '800', color: colors.secondary, flex: 1,
    letterSpacing: 0.4,
  },
  catCount: {
    fontSize: 13, fontWeight: '700', color: colors.primary,
  },
  noSession: {
    textAlign: 'center', color: colors.secondary,
    fontSize: 14, marginTop: 16, opacity: 0.6,
  },
  statsRow: { flexDirection: 'row', marginHorizontal: 16, marginTop: 8, gap: 10 },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: 16,
    marginTop: 8,
    gap: 10,
  },
  statCard: {
    flexBasis: '48%',
    flexGrow: 1,
    padding: 16, borderRadius: 14,
    backgroundColor: colors.surfaceContainerLowest,
    alignItems: 'center', gap: 4,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
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

  // 이번 달 통계 (4개 카드: 총 시간 / 최다 미션 / 연속일 / 활동 일수)
  const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}`;
  const monthEntries = Object.entries(sessionsByDate).filter(([k]) => k.startsWith(monthPrefix));
  const totalMinutes = monthEntries.reduce((acc, [, v]) => acc + v.reduce((s, x) => s + x.minutes, 0), 0);
  const activeDays = monthEntries.length;

  // 선택된 날 사용 시간 합계
  const selectedDayMinutes = sessions.reduce((acc, s) => acc + s.minutes, 0);

  // 연속 사용일 (오늘 기준 전체, 캘린더 월 무관)
  // - 오늘 세션 있음: 오늘부터 역순
  // - 오늘 세션 없고 어제 있음: 어제부터 역순 (grace day, 동기부여 UX)
  // - 둘 다 없음: 0
  const streakDays = useMemo(() => {
    const todayDate = new Date();
    const todayKey = toKey(todayDate.getFullYear(), todayDate.getMonth(), todayDate.getDate());
    let cursor = new Date(todayDate);
    if (!sessionsByDate[todayKey]) {
      cursor.setDate(cursor.getDate() - 1);
      const yesterdayKey = toKey(cursor.getFullYear(), cursor.getMonth(), cursor.getDate());
      if (!sessionsByDate[yesterdayKey]) return 0;
    }
    let count = 0;
    while (true) {
      const key = toKey(cursor.getFullYear(), cursor.getMonth(), cursor.getDate());
      if (sessionsByDate[key]) {
        count++;
        cursor.setDate(cursor.getDate() - 1);
      } else {
        break;
      }
    }
    return count;
  }, [sessionsByDate]);

  // 시간 포맷 헬퍼 (60분 이상이면 시:분, 미만이면 분만)
  const formatTime = useCallback((minutes: number) => {
    if (minutes >= 60) {
      return t('history.hoursMinutes', {
        hours: Math.floor(minutes / 60),
        minutes: minutes % 60,
        defaultValue: `${Math.floor(minutes / 60)}시간 ${minutes % 60}분`,
      });
    }
    return t('history.minutesOnly', { minutes, defaultValue: `${minutes}분` });
  }, [t]);

  // v1.8 #CalendarCategory — 초 단위 정확 표시 헬퍼. <60초 = "N초", 분 + 초 mix = "N분 M초".
  const formatDuration = useCallback((totalSeconds: number) => {
    const s = Math.max(0, Math.round(totalSeconds));
    if (s < 60) return t('history.secondsOnly', { seconds: s, defaultValue: `${s}초` });
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) {
      return t('history.hoursMinutes', { hours: h, minutes: m, defaultValue: `${h}시간 ${m}분` });
    }
    if (sec === 0) {
      return t('history.minutesOnly', { minutes: m, defaultValue: `${m}분` });
    }
    return t('history.minutesSeconds', { minutes: m, seconds: sec, defaultValue: `${m}분 ${sec}초` });
  }, [t]);

  // v1.8 #CalendarCategory — type 추정 (= migration fallback. 옛 record 측 type/totalSeconds ❌).
  const inferType = useCallback((s: SessionRecord): 'timer' | 'routine' | 'alarm' | 'alarmRoutine' => {
    if (s.type) return s.type;
    if (s.icon === 'timer') return 'timer';
    if (s.icon === 'alarm') return 'alarm';
    return 'routine'; // 옛 step record fallback
  }, []);

  // v1.8 #CalendarCategory — 카테고리 + executionId/label 측 2단 접기 expand state.
  const [catExpanded, setCatExpanded] = useState<{ [key: string]: boolean }>({
    timer: true, routine: true, alarm: true,
  });
  const [groupExpanded, setGroupExpanded] = useState<{ [key: string]: boolean }>({});

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
        <View style={styles.headerLeft}>
          <MaterialIcons name="calendar-today" size={24} color={colors.onBackground} />
          <Text style={styles.headerTitle}>{t('history.title')}</Text>
        </View>
        <View style={styles.headerSpacer} />
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

        {/* 이번 달 통계 — 4개 카드 (2x2 그리드) */}
        <Text style={styles.sectionLabel}>{t('history.monthStats', { month: monthName })}</Text>
        <View style={styles.statsGrid}>
          <View style={styles.statCard}>
            <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit>
              {selectedDayMinutes > 0 ? formatTime(selectedDayMinutes) : t('history.empty', { defaultValue: '-' })}
            </Text>
            <Text style={styles.statLabel}>{t('history.statsDailyUsage', { defaultValue: '일일 사용시간' })}</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit>
              {totalMinutes > 0 ? formatTime(totalMinutes) : t('history.empty', { defaultValue: '-' })}
            </Text>
            <Text style={styles.statLabel}>{t('history.statsTotalTime', { defaultValue: '총 사용 시간' })}</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit>
              {streakDays > 0
                ? t('history.streakDays', { days: streakDays, defaultValue: `${streakDays}일 연속` })
                : t('history.empty', { defaultValue: '-' })}
            </Text>
            <Text style={styles.statLabel}>{t('history.statsStreak', { defaultValue: '연속 사용일' })}</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit>
              {t('history.daysFmt', { days: activeDays })}
            </Text>
            <Text style={styles.statLabel}>{t('history.activeDays')}</Text>
          </View>
        </View>

        <View style={styles.divider} />

        {/* 선택된 날 세션 — v1.8 #CalendarCategory: 타이머/루틴/알람 측 카테고리 + 라벨 2단 접기 */}
        <Text style={styles.sectionLabel}>{dateLabel}</Text>
        {sessions.length === 0 ? (
          <Text style={styles.noSession}>{t('history.noSessions')}</Text>
        ) : (() => {
          // 카테고리별 분류 (= alarm 측 = 일반 알람 + 알람 루틴 통합 표시).
          const timerList: SessionRecord[] = [];
          const routineList: SessionRecord[] = [];
          const alarmList: SessionRecord[] = []; // 일반 알람 (= step ❌)
          const alarmRoutineList: SessionRecord[] = []; // 알람 루틴 (= step ✅)
          for (const s of sessions) {
            const tp = inferType(s);
            if (tp === 'timer') timerList.push(s);
            else if (tp === 'routine') routineList.push(s);
            else if (tp === 'alarm') alarmList.push(s);
            else alarmRoutineList.push(s);
          }
          // executionId (= routineId_startedAt) 측 = 같은 실행 측 step grouping. fallback = routineId.
          const groupRoutine = (records: SessionRecord[]): Record<string, SessionRecord[]> => {
            const map: Record<string, SessionRecord[]> = {};
            for (const r of records) {
              const key = r.executionId || r.routineId || r.id;
              if (!map[key]) map[key] = [];
              map[key].push(r);
            }
            return map;
          };
          const routineGroups = groupRoutine(routineList);
          const alarmRoutineGroups = groupRoutine(alarmRoutineList);

          // v1.8 #CalendarCategory — 카테고리 측 메뉴바 (= BottomTabBar) 측 동일 아이콘 정합.
          const catIcon = (k: 'timer' | 'routine' | 'alarm'): React.ComponentProps<typeof MaterialIcons>['name'] =>
            k === 'timer' ? 'timer' : k === 'routine' ? 'repeat' : 'alarm';

          // v1.8 #CalendarCategoryTotalTime — 갯수 대신 카테고리별 총 사용 시간 (분/초) 표시.
          // 통계 카드에 카테고리별 시간 통계가 따로 없어서 캘린더 헤더에서 확인하도록 정합.
          const renderCategory = (
            catKey: 'timer' | 'routine' | 'alarm',
            title: string,
            totalSecondsSum: number,
            children: React.ReactNode
          ) => {
            const expanded = catExpanded[catKey] ?? true;
            return (
              <View key={catKey} style={{ marginTop: 8 }}>
                <TouchableOpacity
                  style={styles.catHeader}
                  onPress={() => setCatExpanded(s => ({ ...s, [catKey]: !expanded }))}
                  activeOpacity={0.7}
                >
                  <MaterialIcons name={catIcon(catKey)} size={20} color={colors.primary} />
                  <Text style={styles.catTitle}>{title}</Text>
                  <Text style={styles.catCount}>{formatDuration(totalSecondsSum)}</Text>
                  <MaterialIcons name={expanded ? 'expand-less' : 'expand-more'} size={22} color={colors.secondary} />
                </TouchableOpacity>
                {expanded && children}
              </View>
            );
          };

          // v1.8 #CalendarCategoryTotalTime — 자식 항목 측 chevron icon 제거 (= 사용자 부탁).
          // 측 = 측 = 카테고리 헤더 측 펼치기 chevron 만 유지. 자식 row 는 단순 탭으로 손자 열기.
          // v1.8 #CalendarGroupChevron — 루틴 + 알람 루틴 그룹 헤더 측 우측 끝 chevron 추가.
          const renderGroup = (key: string, entries: SessionRecord[]) => {
            const first = entries[0];
            const expanded = !!groupExpanded[key];
            const label = first.label || t('icons.' + first.icon, { defaultValue: first.icon });
            const totalSecs = entries.reduce((acc, e) => acc + (e.totalSeconds ?? e.minutes * 60), 0);
            return (
              <View key={key}>
                <TouchableOpacity
                  style={styles.sessionCard}
                  onPress={() => setGroupExpanded(s => ({ ...s, [key]: !expanded }))}
                  activeOpacity={0.7}
                >
                  <Text style={styles.sessionLabel}>{label}</Text>
                  {totalSecs > 0 && (
                    <Text style={styles.sessionMinutes}>{formatDuration(totalSecs)}</Text>
                  )}
                  <MaterialIcons
                    name={expanded ? 'expand-less' : 'expand-more'}
                    size={22}
                    color={colors.secondary}
                  />
                </TouchableOpacity>
                {expanded && entries.map((e) => (
                  <View key={e.id} style={[styles.sessionCard, { marginLeft: 32, opacity: 0.85 }]}>
                    <Text style={styles.sessionLabel}>{e.stepName || e.icon}</Text>
                    <Text style={styles.sessionMinutes}>{formatDuration(e.totalSeconds ?? e.minutes * 60)}</Text>
                  </View>
                ))}
              </View>
            );
          };

          return (
            <>
              {timerList.length > 0 && renderCategory('timer', t('history.categoryTimer', { defaultValue: '타이머' }), timerList.reduce((acc, s) => acc + (s.totalSeconds ?? s.minutes * 60), 0), (
                <>
                  {timerList.map((s) => (
                    <View key={s.id} style={styles.sessionCard}>
                      <Text style={styles.sessionLabel}>
                        {s.icon === 'timer' ? t('history.timer') : t(`icons.${s.icon}`, { defaultValue: s.icon })}
                      </Text>
                      <Text style={styles.sessionMinutes}>
                        {formatDuration(s.totalSeconds ?? s.minutes * 60)}
                      </Text>
                    </View>
                  ))}
                </>
              ))}
              {routineList.length > 0 && renderCategory('routine', t('history.categoryRoutine', { defaultValue: '루틴' }), routineList.reduce((acc, e) => acc + (e.totalSeconds ?? e.minutes * 60), 0), (
                <>
                  {Object.entries(routineGroups).map(([key, entries]) => renderGroup(key, entries))}
                </>
              ))}
              {(alarmList.length > 0 || alarmRoutineList.length > 0) && renderCategory('alarm', t('history.categoryAlarm', { defaultValue: '알람' }), [...alarmList, ...alarmRoutineList].reduce((acc, e) => acc + (e.totalSeconds ?? e.minutes * 60), 0), (
                <>
                  {alarmList.map((s) => (
                    <View key={s.id} style={styles.sessionCard}>
                      <Text style={styles.sessionLabel}>
                        {s.label || t('history.alarmDefaultLabel', { defaultValue: '알람' })}
                      </Text>
                    </View>
                  ))}
                  {Object.entries(alarmRoutineGroups).map(([key, entries]) => renderGroup(key, entries))}
                </>
              ))}
            </>
          );
        })()}

        <View style={{ height: 40 }} />
      </ScrollView>
      {/* v1.9 #AdBannerConsolidate — AdBanner 측 = MainTabsNavigator tabBar prop 통합 측 이동. */}
    </SafeAreaView>
  );
}
