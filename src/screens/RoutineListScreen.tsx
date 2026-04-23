// v1.6: 루틴 목록 화면.
// 카드 탭 → 즉시 실행 (RoutineRun). 길게 탭 → 편집/삭제 액션시트.
// 우측 상단 + 버튼 → 신규 추가 (RoutineEdit).

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  ScrollView,
  Alert,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { RootStackParamList } from '../../App';
import { useTheme } from '../context/ThemeContext';
import { ThemeColors } from '../constants/theme';
import {
  Routine,
  loadRoutines,
  deleteRoutine,
  totalRoutineMinutes,
} from '../constants/routines';
import { cancelRoutinePrealerts } from '../utils/routineScheduler';
import AdBanner from '../components/AdBanner';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'RoutineList'>;
};

const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export default function RoutineListScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = makeStyles(colors);
  const [routines, setRoutines] = useState<Routine[]>([]);

  useFocusEffect(
    useCallback(() => {
      loadRoutines().then(setRoutines);
    }, [])
  );

  const handleRun = (routine: Routine) => {
    navigation.navigate('RoutineRun', { routineId: routine.id });
  };

  const handleLongPress = (routine: Routine) => {
    Alert.alert(
      routine.name,
      '',
      [
        {
          text: t('routine.actionEdit', { defaultValue: '편집' }),
          onPress: () => navigation.navigate('RoutineEdit', { routineId: routine.id }),
        },
        {
          text: t('routine.actionDelete', { defaultValue: '삭제' }),
          style: 'destructive',
          onPress: () => confirmDelete(routine),
        },
        { text: t('common.cancel', { defaultValue: '취소' }), style: 'cancel' },
      ],
      { cancelable: true }
    );
  };

  const confirmDelete = (routine: Routine) => {
    Alert.alert(
      t('routine.deleteConfirmTitle', { defaultValue: '루틴 삭제' }),
      t('routine.deleteConfirmBody', { defaultValue: '이 루틴을 삭제하시겠어요?' }),
      [
        { text: t('common.cancel', { defaultValue: '취소' }), style: 'cancel' },
        {
          text: t('routine.actionDelete', { defaultValue: '삭제' }),
          style: 'destructive',
          onPress: async () => {
            await cancelRoutinePrealerts(routine.id);
            const next = await deleteRoutine(routine.id);
            setRoutines(next);
          },
        },
      ]
    );
  };

  const formatDays = (days: number[]): string => {
    if (days.length === 0 || days.length === 7) {
      return t('routine.daysEveryday', { defaultValue: '매일' });
    }
    return days.map(d => t(`routine.weekday.${WEEKDAY_KEYS[d]}`, { defaultValue: WEEKDAY_KEYS[d] })).join(', ');
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.iconBtn} onPress={() => navigation.goBack()}>
          <MaterialIcons name="chevron-left" size={32} color={colors.onBackground} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('routine.listTitle', { defaultValue: '루틴' })}</Text>
        <TouchableOpacity
          style={styles.iconBtn}
          onPress={() => navigation.navigate('RoutineEdit', {})}
        >
          <MaterialIcons name="add" size={28} color={colors.onBackground} />
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
        {routines.length === 0 ? (
          <View style={styles.emptyBox}>
            <MaterialIcons name="playlist-add" size={48} color={colors.secondary} />
            <Text style={styles.emptyText}>
              {t('routine.emptyTitle', { defaultValue: '등록된 루틴이 없습니다' })}
            </Text>
            <Text style={styles.emptyHint}>
              {t('routine.emptyHint', { defaultValue: '우측 상단 + 버튼으로 추가하세요' })}
            </Text>
          </View>
        ) : (
          routines.map((r) => (
            <TouchableOpacity
              key={r.id}
              style={styles.card}
              onPress={() => handleRun(r)}
              onLongPress={() => handleLongPress(r)}
              activeOpacity={0.7}
            >
              <View style={styles.cardHead}>
                <Text style={styles.cardName} numberOfLines={1}>{r.name}</Text>
                {r.loopCount > 1 && (
                  <View style={styles.loopBadge}>
                    <MaterialIcons name="loop" size={14} color={colors.onPrimary} />
                    <Text style={styles.loopBadgeText}>{r.loopCount}</Text>
                  </View>
                )}
              </View>
              <Text style={styles.cardMeta}>
                {r.missions.length} {t('routine.missionsUnit', { defaultValue: '미션' })} · {totalRoutineMinutes(r)} {t('routine.minutesUnit', { defaultValue: '분' })}
              </Text>
              {r.schedule && (
                <Text style={styles.cardSchedule}>
                  {r.schedule.time} · {formatDays(r.schedule.days)}
                </Text>
              )}
            </TouchableOpacity>
          ))
        )}
        <View style={{ height: 24 }} />
      </ScrollView>
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
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.onBackground,
    letterSpacing: -0.5,
  },
  iconBtn: {
    padding: 8,
    borderRadius: 50,
    width: 44,
    alignItems: 'center',
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
  card: {
    marginHorizontal: 16,
    marginBottom: 10,
    padding: 16,
    borderRadius: 14,
    backgroundColor: colors.surfaceContainerLow,
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cardName: {
    flex: 1,
    fontSize: 16,
    fontWeight: '800',
    color: colors.onBackground,
  },
  loopBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    backgroundColor: colors.primary,
  },
  loopBadgeText: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.onPrimary,
  },
  cardMeta: {
    marginTop: 6,
    fontSize: 13,
    color: colors.secondary,
  },
  cardSchedule: {
    marginTop: 4,
    fontSize: 13,
    color: colors.primary,
    fontWeight: '700',
  },
});
