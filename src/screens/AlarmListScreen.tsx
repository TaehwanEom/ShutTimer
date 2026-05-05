// v1.6+ 알람 리스트 화면.
// AlarmKit 단독 (iOS 26+). iOS 25 이하 / Android = 안내 + 등록 UI 차단 (= 결정 7-A + 9-A).

import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  FlatList,
  Switch,
  Alert,
  Platform,
  I18nManager,
} from 'react-native';
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
import {
  scheduleAlarmMain,
  cancelAlarmsForEntity,
} from '../utils/alarmScheduler';
import AdBanner from '../components/AdBanner';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'AlarmList'>;
};

const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function isAlarmKitSupported(): boolean {
  if (Platform.OS !== 'ios') return false;
  const ver = parseInt(String(Platform.Version), 10);
  return !isNaN(ver) && ver >= 26;
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

function dismissMethodIcon(method: Alarm['dismissMethod']): string {
  if (method === 'tap') return 'touch-app';
  if (method === 'shake') return 'vibration';
  return 'photo-camera';
}

export default function AlarmListScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = makeStyles(colors);
  const [alarms, setAlarms] = useState<Alarm[]>([]);
  const supported = isAlarmKitSupported();

  const reload = useCallback(async () => {
    const list = await loadAlarms();
    setAlarms(list);
  }, []);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload])
  );

  const handleAdd = () => {
    if (!supported) return;
    navigation.navigate('AlarmEdit');
  };

  const handleEdit = (alarm: Alarm) => {
    navigation.navigate('AlarmEdit', { alarmId: alarm.id });
  };

  const handleToggle = async (alarm: Alarm, enabled: boolean) => {
    const updated: Alarm = { ...alarm, enabled };
    await upsertAlarm(updated);
    if (enabled) {
      await scheduleAlarmMain(updated).catch(() => {});
    } else {
      await cancelAlarmsForEntity(updated.id).catch(() => {});
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
            await cancelAlarmsForEntity(alarm.id).catch(() => {});
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
        <AdBanner />
      </SafeAreaView>
    );
  }

  // ─── 정상 진입 ─────────────────────────────────

  const renderItem = ({ item }: { item: Alarm }) => (
    <TouchableOpacity
      style={styles.itemRow}
      onPress={() => handleEdit(item)}
      onLongPress={() => handleDelete(item)}
      activeOpacity={0.7}
    >
      <View style={styles.itemLeft}>
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
          <MaterialIcons
            name={dismissMethodIcon(item.dismissMethod) as any}
            size={14}
            color={item.enabled ? colors.secondary : colors.outlineVariant}
            style={{ marginStart: 8 }}
          />
        </View>
      </View>
      <Switch
        value={item.enabled}
        onValueChange={(v) => handleToggle(item, v)}
        trackColor={{ false: colors.outlineVariant, true: colors.primary }}
      />
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>
          {t('alarm.title', { defaultValue: '알람' })}
        </Text>
        <TouchableOpacity style={styles.addBtn} onPress={handleAdd}>
          <MaterialIcons name="add" size={28} color={colors.onBackground} />
        </TouchableOpacity>
      </View>

      <FlatList
        data={alarms}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
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

      <AdBanner />
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
      paddingVertical: 8,
    },
    emptyContent: {
      flexGrow: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
    itemRow: {
      flexDirection: flexRow,
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 20,
      paddingVertical: 14,
      backgroundColor: colors.surfaceContainerLowest,
    },
    itemLeft: {
      flex: 1,
      marginEnd: 12,
    },
    itemTime: {
      fontSize: 24,
      fontWeight: '500',
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
    },
    itemMeta: {
      fontSize: 12,
      color: colors.secondary,
    },
    itemDisabled: {
      opacity: 0.4,
    },
    separator: {
      height: 0.5,
      backgroundColor: colors.outlineVariant,
      marginHorizontal: 20,
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
