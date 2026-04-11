import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  AppState,
} from 'react-native';
import * as Notifications from 'expo-notifications';
import { MaterialIcons } from '@expo/vector-icons';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { RootStackParamList } from '../../App';
import { ThemeColors } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import TimerDial from '../components/TimerDial';
import AdBanner from '../components/AdBanner';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useTranslation } from 'react-i18next';
import { SETTINGS_KEY } from '../constants/settings';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Running'>;
  route: RouteProp<RootStackParamList, 'Running'>;
};

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 16,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.onBackground,
    letterSpacing: -0.5,
  },
  headerRight: {
    flexDirection: 'row',
    gap: 16,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingBottom: 48,
  },
  dialSection: {
    marginTop: 12,
    marginBottom: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  controls: {
    flexDirection: 'row',
    gap: 16,
    width: '100%',
  },
  controlBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 24,
    borderRadius: 12,
    backgroundColor: colors.background,
  },
  controlIconWrapper: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.primary,
    letterSpacing: 0.5,
  },
  missionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: colors.surfaceContainerLow,
  },
  missionBadgeText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.primary,
  },
  endTimeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    width: '100%',
    marginTop: 16,
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderRadius: 14,
    backgroundColor: colors.surfaceContainerLow,
  },
  endTimeIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(220,53,53,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  endTimeLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.onBackground,
  },
  endTimeSub: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.secondary,
    marginTop: 2,
  },
});

export default function RunningScreen({ navigation, route }: Props) {
  const { colors } = useTheme();
  const { t, i18n } = useTranslation();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const { mission, minutes } = route.params;
  const TOTAL_SECONDS = minutes * 60;

  const [remainingSeconds, setRemainingSeconds] = useState(TOTAL_SECONDS);
  const remainingSecondsRef = useRef(TOTAL_SECONDS);

  const [isPaused, setIsPaused] = useState(false);
  const isPausedRef = useRef(false);

  const backgroundedAt = useRef<number | null>(null);

  const getNotifBody = async (): Promise<string> => {
    const method = await AsyncStorage.getItem(SETTINGS_KEY.DISMISS_METHOD) ?? 'camera';
    if (method === 'tap') return t('running.notifBodyTap');
    if (method === 'shake') return t('running.notifBodyShake');
    return t('running.notifBodyCamera');
  };

  const scheduleAlarms = async (seconds: number) => {
    await Notifications.cancelAllScheduledNotificationsAsync();
    const body = await getNotifBody();
    await Notifications.scheduleNotificationAsync({
      content: {
        title: t('running.notifTitle'),
        body,
        sound: 'notification_alarm.wav',
        interruptionLevel: 'timeSensitive',
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds,
      },
    });
  };

  // 마운트 1회: 권한 요청 + 알람 예약 + portrait 잠금
  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
    Notifications.requestPermissionsAsync();
    scheduleAlarms(TOTAL_SECONDS);
    return () => {};
  }, []);

  // interval — isPaused 변화 시 재등록
  useEffect(() => {
    if (isPaused) return;

    const id = setInterval(() => {
      setRemainingSeconds(prev => {
        const next = prev - 1;
        remainingSecondsRef.current = next;
        return next;
      });
    }, 1000);

    return () => clearInterval(id);
  }, [isPaused]);

  // 0 감지 — interval과 분리
  useEffect(() => {
    if (remainingSeconds === 0) {
      if (AppState.currentState === 'active') {
        Notifications.cancelAllScheduledNotificationsAsync();
      }
      navigation.navigate('Alarm', { missionId: mission?.id ?? undefined, missionIcon: mission?.icon ?? undefined });
    }
  }, [remainingSeconds]);

  // AppState — 마운트 1회
  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextState => {
      if (nextState === 'background' || nextState === 'inactive') {
        backgroundedAt.current = Date.now();
      } else if (nextState === 'active') {
        if (isPausedRef.current || backgroundedAt.current === null) return;
        const elapsed = Math.floor((Date.now() - backgroundedAt.current) / 1000);
        backgroundedAt.current = null;
        const newVal = Math.max(0, remainingSecondsRef.current - elapsed);
        remainingSecondsRef.current = newVal;
        setRemainingSeconds(newVal);
        if (newVal === 0) {
          navigation.navigate('Alarm', { missionId: mission?.id ?? undefined, missionIcon: mission?.icon ?? undefined });
        }
      }
    });

    return () => subscription.remove();
  }, [mission?.id]);

  const progress = remainingSeconds / TOTAL_SECONDS;
  const timeText = formatTime(remainingSeconds);

  const estimatedEnd = new Date(Date.now() + remainingSeconds * 1000);
  const estimatedEndTime = estimatedEnd.toLocaleDateString(i18n.language, { year: 'numeric', month: 'long', day: 'numeric' }) + ' ' + estimatedEnd.toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' });

  const handlePauseResume = () => {
    const next = !isPausedRef.current;
    isPausedRef.current = next;
    setIsPaused(next);
    if (next) {
      Notifications.cancelAllScheduledNotificationsAsync();
    } else {
      scheduleAlarms(remainingSecondsRef.current);
    }
  };

  const handleCancel = () => {
    Notifications.cancelAllScheduledNotificationsAsync().then(() => {
      navigation.navigate('Home');
    });
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <MaterialIcons name="timer" size={24} color={colors.primary} />
          <Text style={styles.headerTitle}>ShutTimer</Text>
        </View>
        <View style={styles.headerRight}>
          <MaterialIcons name="notifications" size={24} color={colors.secondary} style={{ opacity: 0.4 }} />
          <TouchableOpacity onPress={() => navigation.navigate('Settings')}>
            <MaterialIcons name="settings" size={24} color={colors.onBackground} style={{ opacity: 0.6 }} />
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.content}>
        <View style={styles.dialSection}>
          <TimerDial
            progress={progress}
            timeText={timeText}
            subText={t('running.minutesLeft')}
            isWarning={remainingSeconds <= 60}
          />
        </View>

        {/* Pause/Resume + Cancel */}
        <View style={styles.controls}>
          <TouchableOpacity style={styles.controlBtn} onPress={handlePauseResume}>
            <View style={styles.controlIconWrapper}>
              <MaterialIcons
                name={isPaused ? 'play-arrow' : 'pause'}
                size={24}
                color={colors.primary}
              />
            </View>
            <Text style={styles.controlLabel}>{isPaused ? t('running.resume') : t('running.pause')}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.controlBtn} onPress={handleCancel}>
            <View style={[styles.controlIconWrapper, { borderColor: colors.secondary }]}>
              <MaterialIcons name="close" size={24} color={colors.secondary} />
            </View>
            <Text style={[styles.controlLabel, { color: colors.secondary }]}>{t('running.cancel')}</Text>
          </TouchableOpacity>
        </View>

        {/* End Time Card */}
        <View style={styles.endTimeCard}>
          <View style={styles.endTimeIconCircle}>
            <MaterialIcons name="notifications" size={22} color="#dc3535" />
          </View>
          <View>
            <Text style={styles.endTimeLabel}>{t('running.endTime')}</Text>
            <Text style={styles.endTimeSub}>{t('running.estimatedAt', { time: estimatedEndTime })}</Text>
          </View>
        </View>

      </View>
      <AdBanner />
    </SafeAreaView>
  );
}
