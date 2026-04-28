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
  DeviceEventEmitter,
  Alert,
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
import { Platform } from 'react-native';
import AlarmkitBridge from '../../modules/alarmkit-bridge';
import LiveActivityBridge from '../../modules/live-activity-bridge';
import { saveAlarmMetadata, deleteAlarmMetadata } from '../utils/alarmkitMappingTable';
import { writeChainAlarms, clearChainAlarms, type LAControlSignal } from '../utils/appGroupSync';
import { requestAlarmKitAuthorizationIfNeeded } from '../utils/routineScheduler';

// v1.6 Phase 9 — 일반 타이머 AlarmKit 가용성 (file-local — 분리 정책 정공)
async function shouldUseAlarmKitInTimer(): Promise<boolean> {
  if (Platform.OS !== 'ios') return false;
  const ver = parseInt(String(Platform.Version), 10);
  if (isNaN(ver) || ver < 26) return false;
  if (!AlarmkitBridge.isAvailable()) return false;
  try {
    const state = await AlarmkitBridge.getAuthorizationState();
    return state === 'authorized';
  } catch {
    return false;
  }
}

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
  // v1.6 Phase 9 — AlarmKit alarm id (timer_main type) + LiveActivity id
  const alarmkitIdRef = useRef<string | null>(null);
  const activeLiveActivityIdRef = useRef<string | null>(null);
  const timerRoutineIdRef = useRef<string | null>(null);

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
    // v1.6 hotfix — AlarmKit 권한 미결정 시 명시 요청.
    // 권한 grant 시 AlarmKit alerting fire = silent/Focus 우회 자동.
    // 미요청 상태로 expo 폴백만 등록되면 silent mode 시 kill 상태 무음.
    const akAuth = await requestAlarmKitAuthorizationIfNeeded();
    console.warn('[timer] AlarmKit auth:', akAuth);

    // Phase E 진단 — 등록 전 system 측 alarm 상태
    try {
      const before = await AlarmkitBridge.listAlarms();
      console.warn('[timer] alarms before:', before.length, JSON.stringify(before));
    } catch (e) {
      console.warn('[timer] listAlarms before fail:', String(e));
    }

    // v1.6 hotfix — 사용자 설정 사운드 사전 로드 (AlarmKit + expo 양쪽 사용).
    const soundId = await AsyncStorage.getItem(SETTINGS_KEY.ALARM_SOUND) ?? DEFAULT_SOUND_ID;
    const soundItem = ALARM_SOUNDS.find(s => s.id === soundId) ?? ALARM_SOUNDS[0];
    const alarmEnabledRaw = await AsyncStorage.getItem(SETTINGS_KEY.ALARM_ENABLED);
    const alarmEnabled = alarmEnabledRaw !== 'false';

    // 기존 예약 모두 취소
    for (const oldId of notificationIdsRef.current) {
      await Notifications.cancelScheduledNotificationAsync(oldId);
    }
    notificationIdsRef.current = [];

    // 타이머 활성 플래그 (foreground 이중 재생 방지 — App.tsx NotifHandler 경로)
    AsyncStorage.setItem('isTimerActive', 'true').catch(() => {});

    // v1.6 Phase 9 — AlarmKit 분기 (iOS 26+ + 권한 + 알람 ON). 성공 시 expo-notifications 경로 skip.
    // alarmEnabled=false 시 AlarmKit 미사용 (사용자 무음 의도 ↔ AlarmKit silent 우회 강제 충돌).
    const useAlarmKit = alarmEnabled && (await shouldUseAlarmKitInTimer());
    if (useAlarmKit) {
      // 기존 AlarmKit alarm cleanup
      if (alarmkitIdRef.current) {
        await AlarmkitBridge.cancelAlarm(alarmkitIdRef.current).catch(() => {});
        await deleteAlarmMetadata(alarmkitIdRef.current).catch(() => {});
        alarmkitIdRef.current = null;
      }
      const fireAt = Date.now() + seconds * 1000;
      const routineId = timerRoutineIdRef.current ?? `main_timer_${Date.now()}`;
      timerRoutineIdRef.current = routineId;
      try {
        const id = await AlarmkitBridge.scheduleAlarm({
          routineId,
          title: t('home.timerCompleteTitle', { defaultValue: '타이머 완료' }),
          fireAt,
          stopLabel: t('home.timerStop', { defaultValue: '확인' }),
          type: 'timer_main',
          soundName: soundItem.pushSound, // v1.6 hotfix — 사용자 설정 사운드 풀스크린 발화
        });
        console.warn('[timer] scheduled id:', id);
        // Phase E 진단 — 등록 직후 system 측 alarm 상태
        try {
          const after = await AlarmkitBridge.listAlarms();
          console.warn('[timer] alarms after:', after.length, JSON.stringify(after));
        } catch (e) {
          console.warn('[timer] listAlarms after fail:', String(e));
        }
        if (id) {
          await saveAlarmMetadata({ alarmId: id, type: 'timer_main', routineId });
          alarmkitIdRef.current = id;
          // v1.6 Phase 10-A — LA Intent 가 read 해 AlarmKit pause/resume/cancel 호출
          writeChainAlarms(routineId, [id]);
          return; // expo-notifications 경로 skip
        }
      } catch (e) {
        // Phase E 진단 — catch 빈 블록 → throw 표면화
        console.warn('[timer] schedule throw:', String(e));
      }
    }

    // 사운드 + 사용자 설정 (expo 폴백)
    const vibrationEnabledRaw = await AsyncStorage.getItem(SETTINGS_KEY.VIBRATION_ENABLED);
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

  const cancelAlarms = async (opts?: { keepPreload?: boolean; keepAlarmKit?: boolean }) => {
    // v1.6 Phase 9 — AlarmKit alarm cancel
    // v1.6 hotfix — keepAlarmKit=true (timer 자연 종료 path) 시 JS preemptive cancel skip.
    // AlarmKit alerting UI 가 사용자 stop 까지 지속 (시계앱 동일 동작). cleanup 책임은
    // AlarmScreen.stopAudioAndVibration 의 listAllAlarmMetadata loop (timer_main filter).
    if (alarmkitIdRef.current) {
      if (!opts?.keepAlarmKit) {
        await AlarmkitBridge.cancelAlarm(alarmkitIdRef.current).catch(() => {});
        await deleteAlarmMetadata(alarmkitIdRef.current).catch(() => {});
      }
      alarmkitIdRef.current = null;
    }
    // v1.6 Phase 10-A — App Group cleanup
    if (timerRoutineIdRef.current) {
      clearChainAlarms(timerRoutineIdRef.current);
    }
    timerRoutineIdRef.current = null;
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
  const handleStart = async () => {
    const total = selectedMinutes * 60 + selectedSeconds;
    if (total <= 0) return;
    // 루틴 진행 중이면 단일 타이머 시작 차단 — 두 시스템 동시 진행 방지
    const isRoutineActive = await AsyncStorage.getItem('isRoutineActive');
    if (isRoutineActive === 'true') {
      Alert.alert(
        t('home.timerBlocked.title', { defaultValue: '루틴 진행 중' }),
        t('home.timerBlocked.body', { defaultValue: '루틴을 먼저 정지해야 단일 타이머를 시작할 수 있습니다.' }),
        [{
          text: t('common.confirm', { defaultValue: '확인' }),
          onPress: () => navigation.navigate('RoutineList'),
        }],
      );
      return;
    }
    const mission = missionList[selectedIndex] ?? null;
    const now = Date.now();
    totalSecondsRef.current = total;
    remainingSecondsRef.current = total;
    endAtRef.current = now + total * 1000;
    pausedAtRef.current = null;
    // v1.6 Phase 9 — routineId 선할당 (scheduleAlarm await 없이 호출되므로
    //                LA start 와 AlarmKit alarm 의 routineId 일치 보장)
    timerRoutineIdRef.current = `main_timer_${now}`;
    setRemainingSeconds(total);
    setIsRunning(true);
    setIsPaused(false);
    isPausedRef.current = false;
    // @v1.5 — 알림 권한은 Onboarding이 처리. 미응답 사용자 대비 fallback (이미 응답 시 no-op)
    Notifications.requestPermissionsAsync();
    scheduleAlarm(total);
    // v1.6 Phase 9 — LiveActivity 시작 (iOS 16.2+ 권한 활성 시. 그 외 silent skip)
    try {
      if (LiveActivityBridge.areActivitiesEnabled()) {
        const routineId = timerRoutineIdRef.current;
        const stepName = t('home.timerName', { defaultValue: '타이머' });
        const id = await LiveActivityBridge.start({
          routineId,
          routineName: stepName,
          stepName,
          stepEndAt: endAtRef.current,
          progress: 0,
        });
        activeLiveActivityIdRef.current = id || null;
      }
    } catch {
      // 권한 / 시스템 한도 — silent skip
    }
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
      // v1.6 Phase 9 — LiveActivity 종료
      if (activeLiveActivityIdRef.current) {
        LiveActivityBridge.end({
          activityId: activeLiveActivityIdRef.current,
          dismissalPolicy: 'immediate',
        }).catch(() => {});
        activeLiveActivityIdRef.current = null;
      }
      // v1.5: 타이머 자연 종료 → AlarmScreen 진입. preload된 사운드를 AlarmScreen이 consume하도록 유지.
      // v1.6 hotfix — keepAlarmKit:true. JS countdown=0 시 AlarmKit cancel 호출 시 alerting UI 즉시 dismiss
      // (= "잠깐 비췄다 꺼짐" #2) + system 측 ghost 잔존 가능 (#3 후보) 동시 차단.
      cancelAlarms({ keepPreload: true, keepAlarmKit: true }).then(() => {
        navigation.navigate('Alarm', { missionId: mission?.id ?? undefined, missionIcon: mission?.icon ?? undefined });
      });
    }
  }, [remainingSeconds, isRunning]);

  // v1.6 Phase 10-E — LA Intent (timer 측) → state 동기화
  // LA Intent 가 이미 AlarmKit pause/resume/cancel + Activity update/end 처리.
  // RN = state + AsyncStorage 갱신만 (chain alarm 재조작 X).
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('laControlTimer', (signal: LAControlSignal) => {
      if (signal.action === 'pause' && !isPausedRef.current && isRunning) {
        // 위험 #X 정정: signal.timestamp = LA Intent perform 시점 (실제 누름 시각).
        pausedAtRef.current = signal.timestamp;
        isPausedRef.current = true;
        setIsPaused(true);
        AsyncStorage.getItem(ACTIVE_TIMER_KEY).then(raw => {
          if (!raw) return;
          try {
            const t: ActiveTimer = JSON.parse(raw);
            AsyncStorage.setItem(ACTIVE_TIMER_KEY, JSON.stringify({ ...t, pausedAt: signal.timestamp })).catch(() => {});
          } catch {}
        });
      } else if (signal.action === 'resume' && isPausedRef.current && isRunning) {
        // 위험 #X 정정: pauseDuration = resume signal.timestamp - 실제 pausedAt
        const pauseDuration = Math.max(0, signal.timestamp - (pausedAtRef.current ?? signal.timestamp));
        endAtRef.current += pauseDuration;
        pausedAtRef.current = null;
        isPausedRef.current = false;
        setIsPaused(false);
        AsyncStorage.getItem(ACTIVE_TIMER_KEY).then(raw => {
          if (!raw) return;
          try {
            const t: ActiveTimer = JSON.parse(raw);
            AsyncStorage.setItem(ACTIVE_TIMER_KEY, JSON.stringify({ ...t, endAt: endAtRef.current, pausedAt: null })).catch(() => {});
          } catch {}
        });
      } else if (signal.action === 'stop') {
        // LA Intent 가 이미 AlarmKit cancel + Activity end 처리. handleCancel = state 정리 (cancelAlarms / endLiveActivity 가 noop 호환).
        handleCancel();
      }
    });
    return () => sub.remove();
  }, [isRunning]);

  // --- 루틴이 단일 타이머 override 시 외부에서 발화하는 emit 수신 ---
  // routineController.startRoutine(overrideTimer:true) 가 ACTIVE_TIMER_KEY 제거 + 타이머 알림 선택적 cancel
  // + clearPreloadedSound 까지 처리한 직후 emit. 본 listener 는 HomeScreen 의 React state 만 리셋.
  // ★ cancelAlarms() 호출 금지 — cancelAllScheduledNotificationsAsync 가 routine 알림까지 wipe 하는 race 차단.
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('timerCancelledExternally', () => {
      notificationIdsRef.current = [];
      setIsRunning(false);
      setIsPaused(false);
      isPausedRef.current = false;
      endAtRef.current = 0;
      pausedAtRef.current = null;
      remainingSecondsRef.current = 0;
      setRemainingSeconds(0);
      // dial 표시값도 리셋 — isRunning=false 일 때 dial 은 selectedMinutes/Seconds 표시.
      // 리셋 안 하면 사용자의 마지막 선택값 (예: 5분) 이 그대로 남아 "이전 기록" 으로 보임.
      setSelectedMinutes(0);
      setSelectedSeconds(0);
      setSelectedIndex(-1);
    });
    return () => sub.remove();
  }, []);

  // --- Cold start 타이머 복원 (mount 1회) ---
  // ★ 루틴 진행 중이면 단일 타이머 stale state 자동 정리 + 복원 skip
  //   (이전 세션에서 두 시스템 storage 가 동시에 남아있는 경우 양쪽 동시 부활 방지)
  useEffect(() => {
    Promise.all([
      AsyncStorage.getItem(ACTIVE_TIMER_KEY),
      AsyncStorage.getItem('isRoutineActive'),
    ]).then(async ([raw, isRoutineActive]) => {
      if (isRoutineActive === 'true') {
        // 루틴 active — 단일 타이머 stale storage 정리 후 복원 skip.
        // LA cleanup = routine 측 restoreRoutineState 가 자동 처리 (HomeScreen 영역 외).
        if (raw) AsyncStorage.removeItem(ACTIVE_TIMER_KEY).catch(() => {});
        AsyncStorage.removeItem('isTimerActive').catch(() => {});
        return;
      }
      if (!raw) {
        // ActiveTimer 없음 + routine 도 없음 → stale LA 가능 (이전 세션 잔존)
        try {
          if (LiveActivityBridge.areActivitiesEnabled()) {
            await LiveActivityBridge.endAll().catch(() => {});
          }
        } catch {}
        return;
      }
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

      // v1.6 Phase 9 — 복원 시 stale LA 일괄 종료 (timer 만 영향 — routine 동시 active 차단됨).
      // 진행 중 분기에서 신규 LA 재등록.
      try {
        if (LiveActivityBridge.areActivitiesEnabled()) {
          await LiveActivityBridge.endAll().catch(() => {});
        }
      } catch {}

      if (pausedAt !== null) {
        // Pause 상태 복원 — 알람 재예약 X (이미 cancelAlarms됨). LA 재등록도 skip (pause = 시간 정지 표시 의미 약함).
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
        // v1.6 Phase 9 — LA 재등록 (진행 중 복원 시 잠금화면 가시화 복구)
        try {
          if (LiveActivityBridge.areActivitiesEnabled()) {
            const total = t.totalSeconds * 1000;
            const elapsed = Math.max(0, total - (endAt - now));
            const progress = total > 0 ? Math.min(1, elapsed / total) : 0;
            const newRoutineId = `main_timer_${now}`;
            timerRoutineIdRef.current = newRoutineId;
            // T4 일괄 (정책 #1) — 복원 useEffect 안 't' 변수 = ActiveTimer 와 충돌해 useTranslation 의 t 사용 X. ko 하드코딩.
            const stepName = '타이머';
            const id = await LiveActivityBridge.start({
              routineId: newRoutineId,
              routineName: stepName,
              stepName,
              stepEndAt: endAt,
              progress,
            });
            activeLiveActivityIdRef.current = id || null;
          }
        } catch {
          // 권한 / 시스템 한도 — silent skip
        }
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
      // v1.6 발견 #E — pause 시 LA 종료 (ContentState paused 미지원 — 카운트다운 진행처럼 보임 ↔ 실제 알람 X 혼란 차단)
      if (activeLiveActivityIdRef.current) {
        LiveActivityBridge.end({
          activityId: activeLiveActivityIdRef.current,
          dismissalPolicy: 'immediate',
        }).catch(() => {});
        activeLiveActivityIdRef.current = null;
      }
    } else {
      // resume: pause 동안 흐른 시간만큼 endAt 연장 → 실제 남은 시간 정확 유지
      const pauseDuration = now - (pausedAtRef.current ?? now);
      endAtRef.current += pauseDuration;
      pausedAtRef.current = null;
      const remainingSecs = Math.max(0, Math.ceil((endAtRef.current - now) / 1000));
      scheduleAlarm(remainingSecs);
      // v1.6 발견 #E — resume 시 LA 신규 start (pause 시 end 한 LA 재개)
      try {
        if (LiveActivityBridge.areActivitiesEnabled()) {
          const total = Math.max(1, totalSecondsRef.current * 1000);
          const elapsed = Math.max(0, total - (endAtRef.current - now));
          const progress = Math.min(1, elapsed / total);
          const stepName = t('home.timerName', { defaultValue: '타이머' });
          const routineId = timerRoutineIdRef.current ?? `main_timer_${now}`;
          timerRoutineIdRef.current = routineId;
          LiveActivityBridge.start({
            routineId,
            routineName: stepName,
            stepName,
            stepEndAt: endAtRef.current,
            progress,
          }).then(id => {
            activeLiveActivityIdRef.current = id || null;
          }).catch(() => {});
        }
      } catch {}
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
    // v1.6 Phase 9 — LiveActivity 즉시 종료
    if (activeLiveActivityIdRef.current) {
      LiveActivityBridge.end({
        activityId: activeLiveActivityIdRef.current,
        dismissalPolicy: 'immediate',
      }).catch(() => {});
      activeLiveActivityIdRef.current = null;
    }
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
