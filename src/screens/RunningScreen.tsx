import React, { useState, useRef, useEffect } from 'react';
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
import { useTranslation } from 'react-i18next';

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
  settingsBtn: {
    padding: 8,
    borderRadius: 50,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingBottom: 48,
  },
  dialSection: {
    marginTop: 32,
    marginBottom: 48,
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
    backgroundColor: colors.surfaceContainerLowest,
    shadowColor: '#1a1c1f',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
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
});

export default function RunningScreen({ navigation, route }: Props) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = makeStyles(colors);

  const { mission, minutes } = route.params;
  const TOTAL_SECONDS = minutes * 60;

  const [remainingSeconds, setRemainingSeconds] = useState(TOTAL_SECONDS);
  const remainingSecondsRef = useRef(TOTAL_SECONDS);

  const [isPaused, setIsPaused] = useState(false);
  const isPausedRef = useRef(false);

  const backgroundedAt = useRef<number | null>(null);
  const notificationIdRef = useRef<string | null>(null);

  const scheduleAlarm = async (seconds: number) => {
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: t('running.notifTitle'),
        body: t('running.notifBody'),
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: seconds,
      },
    });
    notificationIdRef.current = id;
  };

  const cancelAlarm = async (id: string | null) => {
    if (id !== null) {
      await Notifications.cancelScheduledNotificationAsync(id);
      notificationIdRef.current = null;
    }
  };

  // 마운트 1회: 권한 요청 + 알람 예약
  useEffect(() => {
    Notifications.requestPermissionsAsync();
    scheduleAlarm(TOTAL_SECONDS);
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
      cancelAlarm(notificationIdRef.current).then(() => {
        navigation.navigate('Alarm');
      });
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
          cancelAlarm(notificationIdRef.current).then(() => {
            navigation.navigate('Alarm');
          });
        }
      }
    });

    return () => subscription.remove();
  }, []);

  const progress = remainingSeconds / TOTAL_SECONDS;
  const timeText = formatTime(remainingSeconds);

  const handlePauseResume = () => {
    const next = !isPausedRef.current;
    isPausedRef.current = next;
    setIsPaused(next);
    if (next) {
      cancelAlarm(notificationIdRef.current);
    } else {
      scheduleAlarm(remainingSecondsRef.current);
    }
  };

  const handleCancel = () => {
    cancelAlarm(notificationIdRef.current).then(() => {
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
        <TouchableOpacity style={styles.settingsBtn} onPress={() => navigation.navigate('Settings')}>
          <MaterialIcons name="settings" size={24} color={colors.onBackground} style={{ opacity: 0.6 }} />
        </TouchableOpacity>
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

          <TouchableOpacity style={styles.controlBtn} onPress={() => navigation.navigate('Alarm')}>
            <View style={[styles.controlIconWrapper, { borderColor: '#F59E0B' }]}>
              <MaterialIcons name="alarm" size={24} color="#F59E0B" />
            </View>
            <Text style={[styles.controlLabel, { color: '#F59E0B' }]}>DEV</Text>
          </TouchableOpacity>
        </View>

      </View>
      <AdBanner />
    </SafeAreaView>
  );
}
