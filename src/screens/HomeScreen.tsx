import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  AppState,
  Animated,
  PanResponder,
} from 'react-native';
import Svg, { Circle as SvgCircle, Path as SvgPath, Defs, ClipPath, Rect as SvgRect } from 'react-native-svg';

const AnimatedSvgCircle = Animated.createAnimatedComponent(SvgCircle);
import { MaterialIcons } from '@expo/vector-icons';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ScreenOrientation from 'expo-screen-orientation';
import * as Notifications from 'expo-notifications';
import { RootStackParamList } from '../../App';
import { ThemeColors } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import { MISSIONS, MISSIONS_STORAGE_KEY, Mission } from '../constants/missions';
import TimerDial from '../components/TimerDial';
import TimerDigital from '../components/TimerDigital';
import AdBanner from '../components/AdBanner';
import { SETTINGS_KEY, DialType } from '../constants/settings';
import { SESSIONS_STORAGE_KEY, SessionRecord } from '../constants/sessions';
import { ALARM_SOUNDS, DEFAULT_SOUND_ID } from '../constants/sounds';
import { preloadAlarmSound, clearPreloadedSound } from '../utils/alarmSoundPreload';
import { useTranslation } from 'react-i18next';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Home'>;
};

// 진행 중인 타이머 영속화 (cold start 복원용)
// v1.5: endAt/pausedAt 추가 (timestamp 기반 카운트다운). 구버전 호환: endAt 없으면 startedAt+totalSeconds로 계산.
type ActiveTimer = {
  startedAt: number;
  totalSeconds: number;
  endAt?: number;           // ms 기준 종료 시점 (신규)
  pausedAt?: number | null; // pause 진입 시점, 없으면 running (신규)
  missionId: string | null;
  missionIcon: string | null;
};
const ACTIVE_TIMER_KEY = 'activeTimer';

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
  dialSection: {
    marginTop: 12,
    marginBottom: 16,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  missionSection: {
    width: '100%',
    marginBottom: 4,
  },
  missionTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.onBackground,
    letterSpacing: 1,
    textAlign: 'center',
    marginBottom: 10,
  },
  missionList: {
    paddingHorizontal: 8,
    gap: 24,
  },
  missionItem: {
    alignItems: 'center',
    gap: 8,
    width: 64,
  },
  missionIcon: {
    width: 60,
    height: 60,
    borderRadius: 16,
    backgroundColor: colors.surfaceContainerLow,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  missionIconSelected: {
    borderColor: colors.primary,
  },
  missionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.secondary,
  },
  missionLabelSelected: {
    color: colors.primary,
  },
  addTimerBtn: {
    width: 60,
    height: 60,
    borderRadius: 16,
    backgroundColor: colors.surfaceContainerLow,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: colors.secondary,
    opacity: 0.7,
  },
  playButton: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

function MissionItem({ mission, isSelected, onPress, onLongPress, t }: {
  mission: Mission;
  isSelected: boolean;
  onPress: () => void;
  onLongPress: () => void;
  t: (key: string) => string;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  const ICON = 60;
  const cx = ICON / 2, cy = ICON / 2;

  const [sectorProgress, setSectorProgress] = useState(0);
  const gaugeAnim = useRef(new Animated.Value(0)).current;
  const firedRef = useRef(false);

  useEffect(() => {
    const id = gaugeAnim.addListener(({ value }) => setSectorProgress(value));
    return () => gaugeAnim.removeListener(id);
  }, []);

  const handlePressIn = () => {
    firedRef.current = false;
    gaugeAnim.setValue(0);
    Animated.timing(gaugeAnim, { toValue: 1, duration: 500, useNativeDriver: false }).start();
  };

  const handlePressOut = () => {
    if (!firedRef.current) {
      gaugeAnim.stopAnimation();
      Animated.timing(gaugeAnim, { toValue: 0, duration: 150, useNativeDriver: false }).start();
    }
  };

  const handleLongPress = () => {
    firedRef.current = true;
    gaugeAnim.setValue(0);
    onLongPress();
  };

  // 반지름을 대각선보다 크게 잡아 사각 전체를 덮음 → clipPath로 사각 모양에 맞게 자름
  const R_BIG = 55;
  const getSectorPath = (progress: number) => {
    if (progress <= 0) return '';
    if (progress >= 0.999) return `M ${cx} ${cy} m 0 ${-R_BIG} a ${R_BIG} ${R_BIG} 0 1 1 0.001 0 Z`;
    const endAngle = progress * 360;
    const rad = (endAngle - 90) * (Math.PI / 180);
    const endX = cx + R_BIG * Math.cos(rad);
    const endY = cy + R_BIG * Math.sin(rad);
    const largeArc = endAngle > 180 ? 1 : 0;
    return `M ${cx} ${cy} L ${cx} ${cy - R_BIG} A ${R_BIG} ${R_BIG} 0 ${largeArc} 1 ${endX} ${endY} Z`;
  };

  return (
    <TouchableOpacity
      style={styles.missionItem}
      onPress={onPress}
      onLongPress={handleLongPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      delayLongPress={500}
    >
      <View style={[styles.missionIcon, isSelected && styles.missionIconSelected]}>
        {sectorProgress > 0 && (
          <Svg width={ICON} height={ICON} style={StyleSheet.absoluteFill}>
            <Defs>
              <ClipPath id={`clip-${mission.id}`}>
                <SvgRect x="0" y="0" width={ICON} height={ICON} rx="16" ry="16" />
              </ClipPath>
            </Defs>
            <SvgPath
              d={getSectorPath(sectorProgress)}
              fill={colors.primary}
              fillOpacity={0.9}
              clipPath={`url(#clip-${mission.id})`}
            />
          </Svg>
        )}
        <MaterialIcons
          name={mission.icon as React.ComponentProps<typeof MaterialIcons>['name']}
          size={28}
          color={sectorProgress > 0 ? colors.onPrimary : (isSelected ? colors.primary : colors.secondary)}
        />
      </View>
      <Text style={[styles.missionLabel, isSelected && styles.missionLabelSelected]}>
        {t(`icons.${mission.icon}`)}
      </Text>
    </TouchableOpacity>
  );
}

export default function HomeScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = makeStyles(colors);

  // 알림 상태
  const NOTICES_URL = 'https://taehwaneom.github.io/shuttimer-config/notices.json';
  const NOTICES_READ_KEY = 'shuttimer_notices_read';
  const [notices, setNotices] = useState<{ id: string; date: string; title: string; message: string }[]>([]);
  const [hasUnread, setHasUnread] = useState(false);

  useFocusEffect(
    useCallback(() => {
      Promise.all([
        fetch(NOTICES_URL).then(r => r.json()).catch(() => ({ notices: [] })),
        AsyncStorage.getItem(NOTICES_READ_KEY),
      ]).then(([data, readJson]) => {
        const list = data.notices ?? [];
        setNotices(list);
        const readIds: string[] = readJson ? JSON.parse(readJson) : [];
        setHasUnread(list.some((n: { id: string }) => !readIds.includes(n.id)));
      });
    }, [])
  );

  const openNotices = () => {
    navigation.navigate('Notice');
    const ids = notices.map(n => n.id);
    AsyncStorage.setItem(NOTICES_READ_KEY, JSON.stringify(ids));
    setHasUnread(false);
  };

  const [missionList, setMissionList] = useState<Mission[]>(MISSIONS);
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);
  const [selectedMinutes, setSelectedMinutes] = useState(0);
  const [selectedSeconds, setSelectedSeconds] = useState(0);
  const DIAL_TYPES: DialType[] = ['classic', 'digital'];
  const [dialType, setDialType] = useState<DialType>('classic');
  const dialSlide = useRef(new Animated.Value(0)).current;
  const DIAL_SIZE = 350;

  const switchDial = (direction: 'left' | 'right') => {
    const idx = DIAL_TYPES.indexOf(dialType);
    const next = direction === 'left'
      ? DIAL_TYPES[(idx + 1) % DIAL_TYPES.length]
      : DIAL_TYPES[(idx - 1 + DIAL_TYPES.length) % DIAL_TYPES.length];
    const outTo = direction === 'left' ? -DIAL_SIZE : DIAL_SIZE;
    const inFrom = direction === 'left' ? DIAL_SIZE : -DIAL_SIZE;
    Animated.timing(dialSlide, { toValue: outTo, duration: 180, useNativeDriver: true }).start(() => {
      setDialType(next);
      AsyncStorage.setItem(SETTINGS_KEY.DIAL_TYPE, next);
      dialSlide.setValue(inFrom);
      Animated.timing(dialSlide, { toValue: 0, duration: 220, useNativeDriver: true }).start();
    });
  };

  const switchDialRef = useRef(switchDial);
  switchDialRef.current = switchDial;

  const swipeResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 20 && Math.abs(g.dy) < 40,
      onPanResponderRelease: (_, g) => {
        if (g.dx > 50) switchDialRef.current('right');
        else if (g.dx < -50) switchDialRef.current('left');
      },
    })
  ).current;

  // --- Running state ---
  const [isRunning, setIsRunning] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const remainingSecondsRef = useRef(0);
  const totalSecondsRef = useRef(0);
  const [isPaused, setIsPaused] = useState(false);
  const isPausedRef = useRef(false);
  const notificationIdsRef = useRef<string[]>([]);
  // v1.5: timestamp 기반 카운트다운용 (pause/play 연타 race 방지)
  const endAtRef = useRef<number>(0);
  const pausedAtRef = useRef<number | null>(null);

  useFocusEffect(
    useCallback(() => {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
      AsyncStorage.getItem(SETTINGS_KEY.DIAL_TYPE).then(v => {
        if (v === 'classic' || v === 'digital') setDialType(v);
      });
      AsyncStorage.getItem(MISSIONS_STORAGE_KEY).then(value => {
        const list: Mission[] = value ? JSON.parse(value) : MISSIONS;
        setMissionList(list);
        // 선택된 favorite의 defaultMinutes가 편집됐으면 다이얼 표시 값도 갱신
        setSelectedIndex(prev => {
          const newIdx = prev >= list.length ? -1 : prev;
          if (newIdx >= 0) {
            const m = list[newIdx];
            if (m?.defaultMinutes != null) {
              setSelectedMinutes(m.defaultMinutes);
              setSelectedSeconds(0);
            }
          }
          return newIdx;
        });
      });
    }, [])
  );

  const scheduleAlarm = async (seconds: number) => {
    // 기존 예약 모두 취소
    for (const oldId of notificationIdsRef.current) {
      await Notifications.cancelScheduledNotificationAsync(oldId);
    }
    notificationIdsRef.current = [];

    // 타이머 활성 플래그 (foreground 이중 재생 방지 — App.tsx NotifHandler 경로)
    AsyncStorage.setItem('isTimerActive', 'true').catch(() => {});

    // 사운드 + 사용자 설정
    const soundId = await AsyncStorage.getItem(SETTINGS_KEY.ALARM_SOUND) ?? DEFAULT_SOUND_ID;
    const soundItem = ALARM_SOUNDS.find(s => s.id === soundId) ?? ALARM_SOUNDS[0];
    const alarmEnabledRaw = await AsyncStorage.getItem(SETTINGS_KEY.ALARM_ENABLED);
    const vibrationEnabledRaw = await AsyncStorage.getItem(SETTINGS_KEY.VIBRATION_ENABLED);
    const alarmEnabled = alarmEnabledRaw !== 'false';
    const vibrationEnabled = vibrationEnabledRaw !== 'false';

    // iOS 푸시는 사운드 없으면 진동도 안 옴. 알람 OFF + 진동 ON 케이스에서 무음 WAV로 진동만 유도.
    // (iOS가 "사운드 있음"으로 인지하여 기본 햅틱 트리거 — 단 무음 모드에선 iOS 설정에 따라 동작 불확실)
    const sound: string | false = alarmEnabled
      ? soundItem.pushSound
      : (vibrationEnabled ? 'notification_silent_vibe.wav' : false);

    // v1.5: 알람 사운드 Pre-load (AlarmScreen 마운트 시 playAsync 즉시 호출 가능 → 딜레이 단축)
    // alarmEnabled=false이면 스킵. 기존 preload는 모듈 내부에서 clear 후 재생성.
    if (alarmEnabled) {
      preloadAlarmSound(soundItem.source).catch(() => {});
    }

    // 종료 방식별 첫 본문
    const method = await AsyncStorage.getItem(SETTINGS_KEY.DISMISS_METHOD) ?? 'camera';
    const firstBodyKey =
      method === 'tap' ? 'running.notifBodyTap'
      : method === 'shake' ? 'running.notifBodyShake'
      : 'running.notifBodyCamera';

    // 3단계 알람 (첫 번째만 사운드, 2/3번째는 배너만 — v1.5: 미션 종료 후에도 iOS 시스템 사운드가
    // 이미 발화된 상태면 dismissAllNotificationsAsync로 중단 불가하므로 애초에 2/3번째는 sound:false)
    const stages: { offset: number; bodyKey: string; withSound: boolean }[] = [
      { offset: 0,   bodyKey: firstBodyKey,                  withSound: true },
      { offset: 60,  bodyKey: 'running.notifBodyReminder2',  withSound: false },
      { offset: 120, bodyKey: 'running.notifBodyReminder3',  withSound: false },
    ];

    const ids: string[] = [];
    for (const { offset, bodyKey, withSound } of stages) {
      const id = await Notifications.scheduleNotificationAsync({
        content: {
          title: t('running.notifTitle'),
          body: t(bodyKey),
          sound: withSound ? sound : false,
          interruptionLevel: 'active',
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
          seconds: seconds + offset,
        },
      });
      ids.push(id);
    }
    notificationIdsRef.current = ids;
  };

  const cancelAlarms = async (opts?: { keepPreload?: boolean }) => {
    // 메모리 배열 + 시스템 예약 양쪽 모두 정리 (cold start 복원 후 메모리 배열이 비어있어도 안전)
    await Notifications.cancelAllScheduledNotificationsAsync();
    notificationIdsRef.current = [];
    // 타이머 플래그 해제 (pair with scheduleAlarm)
    AsyncStorage.removeItem('isTimerActive').catch(() => {});
    // v1.5: preload된 사운드 메모리 해제 (메모리 누수 방지).
    //       단 타이머 자연 종료 → AlarmScreen 진입 경로는 preload 유지 필요 (keepPreload: true).
    if (!opts?.keepPreload) {
      clearPreloadedSound().catch(() => {});
    }
  };

  // --- 타이머 시작 ---
  const handleStart = () => {
    const total = selectedMinutes * 60 + selectedSeconds;
    if (total <= 0) return;
    const mission = missionList[selectedIndex] ?? null;
    const now = Date.now();
    totalSecondsRef.current = total;
    remainingSecondsRef.current = total;
    endAtRef.current = now + total * 1000;
    pausedAtRef.current = null;
    setRemainingSeconds(total);
    setIsRunning(true);
    setIsPaused(false);
    isPausedRef.current = false;
    // @v1.5 — 알림 권한은 Onboarding이 처리. 미응답 사용자 대비 fallback (이미 응답 시 no-op)
    Notifications.requestPermissionsAsync();
    scheduleAlarm(total);
    // 영속화 (cold start 복원용)
    AsyncStorage.setItem(ACTIVE_TIMER_KEY, JSON.stringify({
      startedAt: now,
      totalSeconds: total,
      endAt: endAtRef.current,
      pausedAt: null,
      missionId: mission?.id ?? null,
      missionIcon: mission?.icon ?? null,
    } satisfies ActiveTimer)).catch(() => {});
  };

  // --- interval (v1.5 timestamp 기반) ---
  // endAtRef 기준으로 남은 시간 계산. pause/play 연타해도 실시간 정확히 반영.
  useEffect(() => {
    if (!isRunning || isPaused) return;

    const tick = () => {
      const remainingMs = endAtRef.current - Date.now();
      const next = Math.max(0, Math.ceil(remainingMs / 1000));
      remainingSecondsRef.current = next;
      setRemainingSeconds(next);
    };
    tick(); // 즉시 1회 갱신 (pause/resume 직후 UI 즉각 반영)
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [isRunning, isPaused]);

  // --- 세션 저장 ---
  const saveSession = async (totalSecs: number, icon: string) => {
    const now = new Date();
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const record: SessionRecord = {
      id: Date.now().toString(),
      date,
      icon,
      minutes: Math.max(1, Math.round(totalSecs / 60)),
    };
    const raw = await AsyncStorage.getItem(SESSIONS_STORAGE_KEY);
    const list: SessionRecord[] = raw ? JSON.parse(raw) : [];
    list.push(record);

    // 6개월 이전 제거
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - 6);
    const cutoffStr = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}-${String(cutoff.getDate()).padStart(2, '0')}`;
    const trimmed = list.filter(s => s.date >= cutoffStr);

    await AsyncStorage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify(trimmed));
  };

  // --- 0 감지 ---
  useEffect(() => {
    if (isRunning && remainingSeconds === 0) {
      setIsRunning(false);
      const mission = missionList[selectedIndex] ?? null;
      const icon = mission?.icon ?? 'timer';
      saveSession(totalSecondsRef.current, icon);
      AsyncStorage.removeItem(ACTIVE_TIMER_KEY).catch(() => {});
      // v1.5: 타이머 자연 종료 → AlarmScreen 진입. preload된 사운드를 AlarmScreen이 consume하도록 유지.
      cancelAlarms({ keepPreload: true }).then(() => {
        navigation.navigate('Alarm', { missionId: mission?.id ?? undefined, missionIcon: mission?.icon ?? undefined });
      });
    }
  }, [remainingSeconds, isRunning]);

  // --- Cold start 타이머 복원 (mount 1회) ---
  useEffect(() => {
    AsyncStorage.getItem(ACTIVE_TIMER_KEY).then(raw => {
      if (!raw) return;
      let t: ActiveTimer;
      try {
        t = JSON.parse(raw);
      } catch {
        AsyncStorage.removeItem(ACTIVE_TIMER_KEY).catch(() => {});
        return;
      }
      // v1.5 timestamp 기반 복원. endAt 없으면 구버전 스키마 → fallback 변환.
      const endAt = t.endAt ?? (t.startedAt + t.totalSeconds * 1000);
      const pausedAt = t.pausedAt ?? null;
      const now = Date.now();
      totalSecondsRef.current = t.totalSeconds;
      endAtRef.current = endAt;
      pausedAtRef.current = pausedAt;

      if (pausedAt !== null) {
        // Pause 상태 복원 — 알람 재예약 X (이미 cancelAlarms됨)
        const remaining = Math.max(0, Math.ceil((endAt - pausedAt) / 1000));
        remainingSecondsRef.current = remaining;
        setRemainingSeconds(remaining);
        setIsRunning(true);
        setIsPaused(true);
        isPausedRef.current = true;
        AsyncStorage.setItem('isTimerActive', 'true').catch(() => {});
        return;
      }

      const remaining = Math.ceil((endAt - now) / 1000);
      if (remaining > 0) {
        // 타이머 진행 중 → UI 복원
        remainingSecondsRef.current = remaining;
        setRemainingSeconds(remaining);
        setIsRunning(true);
        // 예약 알림은 이미 iOS 네이티브 레이어에 남아있음. 플래그만 재설정 (foreground suppress)
        AsyncStorage.setItem('isTimerActive', 'true').catch(() => {});
      } else {
        // 알람 시간 지났음 → 세션 기록 + AlarmScreen
        saveSession(t.totalSeconds, t.missionIcon ?? 'timer');
        AsyncStorage.removeItem(ACTIVE_TIMER_KEY).catch(() => {});
        navigation.navigate('Alarm', {
          missionId: t.missionId ?? undefined,
          missionIcon: t.missionIcon ?? undefined,
        });
      }
    }).catch(() => {});
  }, []);

  // --- AppState (v1.5 — endAt 기반이라 수동 차감 불필요) ---
  // background→active 복귀 시 tick이 자동으로 endAt 기준 remaining 재계산함.
  // 즉시 UI 갱신 위해 resume 직후 1회 강제 tick만 수행.
  useEffect(() => {
    if (!isRunning) return;
    const subscription = AppState.addEventListener('change', nextState => {
      if (nextState === 'active' && !isPausedRef.current) {
        const remainingMs = endAtRef.current - Date.now();
        const next = Math.max(0, Math.ceil(remainingMs / 1000));
        remainingSecondsRef.current = next;
        setRemainingSeconds(next);
      }
    });
    return () => subscription.remove();
  }, [isRunning]);

  // --- 일시정지/재개 (v1.5 timestamp 기반) ---
  const handlePauseResume = () => {
    const next = !isPausedRef.current;
    isPausedRef.current = next;
    setIsPaused(next);
    const now = Date.now();
    if (next) {
      // pause: pause 시점 저장 + 알람 취소
      pausedAtRef.current = now;
      cancelAlarms();
    } else {
      // resume: pause 동안 흐른 시간만큼 endAt 연장 → 실제 남은 시간 정확 유지
      const pauseDuration = now - (pausedAtRef.current ?? now);
      endAtRef.current += pauseDuration;
      pausedAtRef.current = null;
      const remainingSecs = Math.max(0, Math.ceil((endAtRef.current - now) / 1000));
      scheduleAlarm(remainingSecs);
    }
    // AsyncStorage 업데이트 (cold start 복원용)
    AsyncStorage.getItem(ACTIVE_TIMER_KEY).then((raw) => {
      if (!raw) return;
      try {
        const t: ActiveTimer = JSON.parse(raw);
        const updated: ActiveTimer = {
          ...t,
          endAt: endAtRef.current,
          pausedAt: pausedAtRef.current,
        };
        AsyncStorage.setItem(ACTIVE_TIMER_KEY, JSON.stringify(updated)).catch(() => {});
      } catch {}
    }).catch(() => {});
  };

  // --- 취소 ---
  const handleCancel = () => {
    cancelAlarms();
    AsyncStorage.removeItem(ACTIVE_TIMER_KEY).catch(() => {});
    setIsRunning(false);
    setIsPaused(false);
    isPausedRef.current = false;
    endAtRef.current = 0;
    pausedAtRef.current = null;
  };

  // --- 길게 누르기 게이지 ---
  const longPressAnim = useRef(new Animated.Value(0)).current;
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const LONG_PRESS_DURATION = 1000;
  const BTN_SIZE = 64;
  const BTN_RADIUS = 38;
  const BTN_CIRCUMFERENCE = 2 * Math.PI * BTN_RADIUS;

  const longPressFired = useRef(false);

  const handlePressIn = () => {
    longPressFired.current = false;
    if (!isRunning) return;
    // 300ms 후 게이지 시작 (탭과 구분)
    longPressTimer.current = setTimeout(() => {
      longPressAnim.setValue(0);
      Animated.timing(longPressAnim, {
        toValue: 1,
        duration: LONG_PRESS_DURATION,
        useNativeDriver: false,
      }).start();
      longPressTimer.current = setTimeout(() => {
        longPressFired.current = true;
        handleCancel();
        longPressAnim.setValue(0);
      }, LONG_PRESS_DURATION);
    }, 300);
  };

  const handlePressOut = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    longPressAnim.setValue(0);
  };

  const longPressDashoffset = longPressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [BTN_CIRCUMFERENCE, 0],
  });

  // 다이얼: 항상 60분 기준 (1분 타이머 → 게이지 1/60)
  const dialProgress = isRunning
    ? remainingSeconds / (60 * 60)
    : (selectedMinutes * 60 + selectedSeconds) / (60 * 60);

  // 디지털: 설정 시간 기준 (1분 타이머 → 게이지 100% → 0%)
  const digitalProgress = isRunning
    ? remainingSeconds / totalSecondsRef.current
    : (selectedMinutes * 60 + selectedSeconds) / (60 * 60);

  const timeText = isRunning
    ? formatTime(remainingSeconds)
    : formatTime(selectedMinutes * 60 + selectedSeconds);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={{ flexGrow: 1 }} showsVerticalScrollIndicator={false} bounces={false}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <MaterialIcons name="timer" size={24} color={colors.primary} />
          <Text style={styles.headerTitle}>ShutTimer</Text>
        </View>
        <View style={styles.headerRight}>
          <TouchableOpacity onPress={openNotices}>
            <View>
              <MaterialIcons name="notifications" size={24} color={hasUnread ? colors.primary : colors.secondary} style={{ opacity: hasUnread ? 1 : 0.4 }} />
              {hasUnread && (
                <View style={{ position: 'absolute', top: -2, right: -2, width: 8, height: 8, borderRadius: 4, backgroundColor: colors.error }} />
              )}
            </View>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigation.navigate('History')}>
            <View>
              <MaterialIcons name="calendar-today" size={24} color={colors.onBackground} style={{ opacity: 0.6 }} />
              <View style={{ position: 'absolute', top: 9, left: 5, right: 5, gap: 2 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <View style={{ width: 2.5, height: 2.5, borderRadius: 1.25, backgroundColor: colors.onBackground, opacity: 0.35 }} />
                  <View style={{ width: 2.5, height: 2.5, borderRadius: 1.25, backgroundColor: colors.onBackground, opacity: 0.35 }} />
                  <View style={{ width: 2.5, height: 2.5, borderRadius: 1.25, backgroundColor: colors.onBackground, opacity: 0.35 }} />
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <View style={{ width: 2.5, height: 2.5, borderRadius: 1.25, backgroundColor: colors.onBackground, opacity: 0.35 }} />
                  <View style={{ width: 2.5, height: 2.5, borderRadius: 1.25, backgroundColor: colors.onBackground, opacity: 0.35 }} />
                  <View style={{ width: 2.5, height: 2.5, borderRadius: 1.25, backgroundColor: colors.onBackground, opacity: 0.35 }} />
                </View>
              </View>
            </View>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigation.navigate('RoutineList')}>
            <MaterialIcons name="repeat" size={24} color={colors.onBackground} style={{ opacity: 0.6 }} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigation.navigate('Settings')}>
            <MaterialIcons name="settings" size={24} color={colors.onBackground} style={{ opacity: 0.6 }} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Timer Dial */}
      <View style={styles.dialSection}>
        <Animated.View style={{ transform: [{ translateX: dialSlide }], overflow: 'visible' }}>
        {dialType === 'classic' && (
          <TimerDial
            progress={dialProgress}
            timeText={timeText}
            subText={isRunning ? t('running.minutesLeft') : t('home.minutes')}
            onSeek={isRunning ? undefined : (m) => { setSelectedMinutes(m); setSelectedSeconds(0); setSelectedIndex(-1); }}
            onSeekStart={() => {}}
            onSeekEnd={() => {}}
            isWarning={isRunning && remainingSeconds <= 60}
          />
        )}
        {dialType === 'digital' && (
          <TimerDigital
            progress={digitalProgress}
            timeText={timeText}
            subText={isRunning ? t('running.minutesLeft') : t('home.minutes')}
            onSeek={isRunning ? undefined : (m: number, s?: number) => { setSelectedMinutes(m); setSelectedSeconds(s ?? 0); setSelectedIndex(-1); }}
            onSeekStart={() => {}}
            onSeekEnd={() => {}}
            isWarning={isRunning && remainingSeconds <= 60}
            isRunning={isRunning}
            isPaused={isPaused}
          />
        )}
        </Animated.View>

        {/* 다이얼 전환 버튼 */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 12 }}>
          <TouchableOpacity onPress={() => switchDial('right')} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <MaterialIcons name="chevron-left" size={32} color={colors.secondary} />
          </TouchableOpacity>
          <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
            {DIAL_TYPES.map(dt => (
              <View key={dt} style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: dialType === dt ? colors.primary : colors.outlineVariant }} />
            ))}
          </View>
          <TouchableOpacity onPress={() => switchDial('left')} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <MaterialIcons name="chevron-right" size={32} color={colors.secondary} />
          </TouchableOpacity>
        </View>
      </View>

      {/* 하단 버튼 영역 + 60:00 */}
      <View {...swipeResponder.panHandlers} style={{ alignItems: 'center', justifyContent: 'center', marginBottom: 6, gap: 8 }}>
        {/* 60:00 표시 */}
        <View style={{ borderWidth: 2, borderColor: colors.outlineVariant, borderRadius: 50, paddingHorizontal: 24, paddingVertical: 6 }}>
          <Text style={{ fontSize: 14, fontWeight: '800', color: colors.onBackground, letterSpacing: 1 }}>
            {timeText.replace(':', ' : ')}
          </Text>
        </View>
        <View style={{ width: BTN_SIZE + 16, height: BTN_SIZE + 16, alignItems: 'center', justifyContent: 'center' }}>
          {isRunning && (
            <Svg width={BTN_SIZE + 16} height={BTN_SIZE + 16} style={{ position: 'absolute' }}>
              <SvgCircle
                cx={(BTN_SIZE + 16) / 2}
                cy={(BTN_SIZE + 16) / 2}
                r={BTN_RADIUS}
                fill="none"
                stroke={colors.outlineVariant}
                strokeWidth={3}
                opacity={0.3}
              />
              <AnimatedSvgCircle
                cx={(BTN_SIZE + 16) / 2}
                cy={(BTN_SIZE + 16) / 2}
                r={BTN_RADIUS}
                fill="none"
                stroke={colors.primary}
                strokeWidth={3}
                strokeDasharray={BTN_CIRCUMFERENCE}
                strokeDashoffset={longPressDashoffset}
                strokeLinecap="round"
                rotation="-90"
                origin={`${(BTN_SIZE + 16) / 2}, ${(BTN_SIZE + 16) / 2}`}
              />
            </Svg>
          )}
          <TouchableOpacity
            style={styles.playButton}
            onPress={() => { if (longPressFired.current) return; isRunning ? handlePauseResume() : handleStart(); }}
            onPressIn={handlePressIn}
            onPressOut={handlePressOut}
            activeOpacity={0.85}
          >
            <MaterialIcons
              name={isRunning ? (isPaused ? 'play-arrow' : 'pause') : 'play-arrow'}
              size={40}
              color={colors.onPrimary}
            />
          </TouchableOpacity>
        </View>
      </View>

      {/* Mission Selection — 하단 고정 */}
      <View style={[styles.missionSection, isRunning && { opacity: 0.3 }]} pointerEvents={isRunning ? 'none' : 'auto'}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10, width: '100%' }}>
            <View style={{ flex: 1, height: 1, backgroundColor: colors.outlineVariant }} />
            <Text style={[styles.missionTitle, { marginBottom: 0, marginHorizontal: 12 }]}>{t('home.favorites')}</Text>
            <View style={{ flex: 1, height: 1, backgroundColor: colors.outlineVariant }} />
          </View>
          {missionList.length === 0 ? (
            <View style={{ alignItems: 'center' }}>
              <TouchableOpacity style={styles.missionItem} onPress={() => navigation.navigate('EditMissions')}>
                <View style={styles.addTimerBtn}>
                  <MaterialIcons name="add" size={26} color={colors.secondary} />
                </View>
                <Text style={styles.missionLabel}>{t('home.add')}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.missionList}>
              <TouchableOpacity style={styles.missionItem} onPress={() => navigation.navigate('EditMissions')}>
                <View style={styles.addTimerBtn}>
                  <MaterialIcons name="add" size={26} color={colors.secondary} />
                </View>
                <Text style={styles.missionLabel}>{t('home.add')}</Text>
              </TouchableOpacity>
              {missionList.map((mission, index) => (
                <MissionItem
                  key={`${mission.id}-${index}`}
                  mission={mission}
                  isSelected={selectedIndex === index}
                  onPress={() => {
                    if (selectedIndex === index) {
                      setSelectedIndex(-1);
                    } else {
                      setSelectedIndex(index);
                      setSelectedMinutes(mission.defaultMinutes ?? 60);
                      setSelectedSeconds(0);
                    }
                  }}
                  onLongPress={() => navigation.navigate('AddTimer', { editId: mission.id, editIcon: mission.icon, editMinutes: mission.defaultMinutes ?? 60, dialType })}
                  t={t}
                />
              ))}
            </ScrollView>
          )}
        </View>
      <AdBanner />
      </ScrollView>
    </SafeAreaView>
  );
}
