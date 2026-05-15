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
import { useFocusEffect, RouteProp } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ScreenOrientation from 'expo-screen-orientation';
import { RootStackParamList } from '../../App';
import { ThemeColors } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import { MISSIONS, MISSIONS_STORAGE_KEY, Mission } from '../constants/missions';
import TimerDial from '../components/TimerDial';
import TimerDigital from '../components/TimerDigital';
import AdBanner from '../components/AdBanner';
import BugReportModal from '../components/BugReportModal';
import { SETTINGS_KEY, DialType } from '../constants/settings';
import { SESSIONS_STORAGE_KEY, SessionRecord } from '../constants/sessions';
import { ALARM_SOUNDS, DEFAULT_SOUND_ID } from '../constants/sounds';
import { preloadAlarmSound, clearPreloadedSound } from '../utils/alarmSoundPreload';
import { useTranslation } from 'react-i18next';
import { Platform } from 'react-native';
import AlarmkitBridge from '../../modules/alarmkit-bridge';
import { Logger } from '../utils/logger';
import { saveAlarmMetadata, deleteAlarmMetadata } from '../utils/alarmkitMappingTable';
import { writeChainAlarms, clearChainAlarms, type LAControlSignal } from '../utils/appGroupSync';
import { requestAlarmKitAuthorizationIfNeeded } from '../utils/routineScheduler';
import { stopRoutine } from '../utils/routineController';
import { loadActiveRoutine, PENDING_DISABLED_ALARMS_KEY } from '../constants/routines';
import { isAdhocAlarmRoutine } from '../utils/alarmRoutineLink';
import { loadAlarms, nextAlarmOccurrenceTime, upsertAlarm } from '../constants/alarms';
import { cancelAlarmsForEntity } from '../utils/alarmScheduler';

// v1.7 hotfix #G7 Phase 2-B — main app target 26.0 강제 정합 → iOS 측 = AlarmKit 항상 사용 가능. Android 측만 분기 잔존.
async function shouldUseAlarmKitInTimer(): Promise<boolean> {
  if (Platform.OS !== 'ios') return false;
  try {
    const state = await AlarmkitBridge.getAuthorizationState();
    return state === 'authorized';
  } catch {
    return false;
  }
}

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Home'>;
  route?: RouteProp<RootStackParamList, 'Home'>;
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

export default function HomeScreen({ navigation, route }: Props) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = makeStyles(colors);

  // 알림 상태
  const NOTICES_URL = 'https://taehwaneom.github.io/shuttimer-config/notices.json';
  const NOTICES_READ_KEY = 'shuttimer_notices_read';
  const [notices, setNotices] = useState<{ id: string; date: string; title: string; message: string }[]>([]);
  const [hasUnread, setHasUnread] = useState(false);
  // v1.7 — 버그 제보 모달.
  const [bugReportVisible, setBugReportVisible] = useState(false);

  useFocusEffect(
    useCallback(() => {
      // v1.8 #TimerEndGlitch — HomeScreen 재진입 시 hasJustEnded reset (= AlarmScreen unmount 후 복귀).
      setHasJustEnded(false);
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
  // v1.8 #TimerEndGlitch — 타이머 0 도달 ~ AlarmScreen mount 사이 frame race 차단용.
  // setIsRunning(false) 후 timeText 계산이 selectedMinutes/selectedSeconds (= 초기값) 으로 평가돼 한 프레임 깜빡임 발생.
  // hasJustEnded=true 동안은 timeText = formatTime(remainingSeconds=0) 유지 → AlarmScreen mount 후 HomeScreen focus 복귀 시 reset.
  const [hasJustEnded, setHasJustEnded] = useState(false);
  const isPausedRef = useRef(false);
  // v1.5: timestamp 기반 카운트다운용 (pause/play 연타 race 방지)
  const endAtRef = useRef<number>(0);
  const pausedAtRef = useRef<number | null>(null);
  // v1.8 #PausedDialEdit — 일시정지 측 dial 회전 측 변경 여부 추적용. pause 진입 시점 endAtRef 저장.
  const pausedOriginalEndAtRef = useRef<number | null>(null);
  // v1.6 Phase 9 — AlarmKit alarm id (timer_main type)
  // v1.7 hotfix #LAUnify Phase 10-G1 — activeLiveActivityIdRef 제거 (LiveActivityBridge 폐기 영역).
  const alarmkitIdRef = useRef<string | null>(null);
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
        // v1.6 후속 — FavoritesListScreen 측 selectedFavoriteId 수신 시 selectedIndex + selectedMinutes 적용 (자동 시작 ❌).
        const favoriteId = route?.params?.selectedFavoriteId;
        if (favoriteId) {
          const idx = list.findIndex(m => m.id === favoriteId);
          if (idx >= 0) {
            setSelectedIndex(idx);
            setSelectedMinutes(list[idx].defaultMinutes ?? 60);
            setSelectedSeconds(0);
            // route.params 소비 후 정리 (재진입 시 동일 favorite 재적용 회피)
            navigation.setParams({ selectedFavoriteId: undefined });
            return;
          }
        }
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
    }, [route?.params?.selectedFavoriteId])
  );

  const scheduleAlarm = async (seconds: number) => {
    // v1.6 hotfix — AlarmKit 권한 미결정 시 명시 요청.
    // 권한 grant 시 AlarmKit alerting fire = silent/Focus 우회 자동.
    // 미요청 상태로 expo 폴백만 등록되면 silent mode 시 kill 상태 무음.
    const akAuth = await requestAlarmKitAuthorizationIfNeeded();
    Logger.warn('timer', `AlarmKit auth: ${akAuth}`);

    // Phase E 진단 — 등록 전 system 측 alarm 상태
    try {
      const before = await AlarmkitBridge.listAlarms();
      Logger.warn('timer', `alarms before: ${before.length} ${JSON.stringify(before)}`);
    } catch (e) {
      Logger.warn('timer', `listAlarms before fail: ${String(e)}`);
    }

    // v1.6 hotfix — 사용자 설정 사운드 사전 로드 (AlarmKit + expo 양쪽 사용).
    const soundId = await AsyncStorage.getItem(SETTINGS_KEY.ALARM_SOUND) ?? DEFAULT_SOUND_ID;
    const soundItem = ALARM_SOUNDS.find(s => s.id === soundId) ?? ALARM_SOUNDS[0];
    // v1.7 hotfix #DBG-Sound (C2) — timer_main 측 사운드 매핑 출력 (= storedId → matchedId → pushSound).
    // mismatch 시 = ALARM_SOUNDS[0] fallback → matchedId 영역 측 storedId 와 다름 (= root cause 식별).
    Logger.warn('timer-DBG', `sound storedId=${soundId} → matchedId=${soundItem.id} pushSound=${soundItem.pushSound}`);
    const alarmEnabledRaw = await AsyncStorage.getItem(SETTINGS_KEY.ALARM_ENABLED);
    const alarmEnabled = alarmEnabledRaw !== 'false';

    // 타이머 활성 플래그 (foreground 이중 재생 방지 — App.tsx NotifHandler 경로)
    AsyncStorage.setItem('isTimerActive', 'true').catch(() => {});

    // v1.7 hotfix Phase 13 G4-C — AlarmKit 측만 사용 (= iOS 26+ + 권한 + 알람 ON).
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
      // v1.8 — 잠금화면 알람 제목 = dismissMethod 6가지 분기. random = 안내 빼고 "타이머 완료"만.
      const dismissMethodForTitle = await AsyncStorage.getItem(SETTINGS_KEY.DISMISS_METHOD) ?? 'camera';
      const alarmTitle =
        dismissMethodForTitle === 'tap'
          ? t('home.alarmTitleTap', { defaultValue: '타이머 완료\n탭하여 종료' })
          : dismissMethodForTitle === 'shake'
            ? t('home.alarmTitleShake', { defaultValue: '타이머 완료\n흔들어서 종료' })
            : dismissMethodForTitle === 'math'
              ? t('home.alarmTitleMath', { defaultValue: '타이머 완료\n산수 문제 종료' })
              : dismissMethodForTitle === 'typing'
                ? t('home.alarmTitleTyping', { defaultValue: '타이머 완료\n받아쓰기 종료' })
                : dismissMethodForTitle === 'random'
                  ? t('home.alarmTitleRandom', { defaultValue: '타이머 완료' })
                  : t('home.alarmTitleCamera', { defaultValue: '타이머 완료\n사물 스캔 종료' });
      try {
        const id = await AlarmkitBridge.scheduleAlarm({
          entityId: routineId,
          title: alarmTitle,
          fireAt,
          stopLabel: t('home.timerStop', { defaultValue: '확인' }),
          type: 'timer_main',
          soundName: soundItem.pushSound, // v1.6 hotfix — 사용자 설정 사운드 풀스크린 발화
          // v1.7 hotfix #LAUnify Phase 5 — AlarmKit framework LA Activity metadata 측 step 데이터.
          //   단일 타이머 = totalSteps=1, stepIndex=0, stepName="타이머".
          laStepName: t('home.timerName', { defaultValue: '타이머' }),
          laStepIndex: 0,
          laTotalSteps: 1,
          laStage: 'step',
          laRoutineId: routineId,
          laRoutineName: t('home.timerName', { defaultValue: '타이머' }),
        });
        Logger.warn('timer', `scheduled id: ${id}`);
        // Phase E 진단 — 등록 직후 system 측 alarm 상태
        try {
          const after = await AlarmkitBridge.listAlarms();
          Logger.warn('timer', `alarms after: ${after.length} ${JSON.stringify(after)}`);
        } catch (e) {
          Logger.warn('timer', `listAlarms after fail: ${String(e)}`);
        }
        if (id) {
          await saveAlarmMetadata({ alarmId: id, type: 'timer_main', entityId: routineId });
          alarmkitIdRef.current = id;
          // v1.6 Phase 10-A — LA Intent 가 read 해 AlarmKit pause/resume/cancel 호출
          writeChainAlarms(routineId, [id]);
          return;
        }
      } catch (e) {
        // Phase E 진단 — catch 빈 블록 → throw 표면화
        Logger.warn('timer', `schedule throw: ${String(e)}`);
      }
    }

    // v1.7 hotfix Phase 13 G4-C — expo-notifications 폴백 폐기 (= AlarmKit only).
    // alarmEnabled 시 = AlarmScreen 측 즉시 play 측 = sound preload 측 잔존.
    if (alarmEnabled) {
      preloadAlarmSound(soundItem.source).catch(() => {});
    }
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
    // v1.7 hotfix #15 — 루틴 진행 중 + 단일 타이머 시작 시 = 사용자 측 선택권 부여 (= "취소" / "루틴 종료 후 시작").
    // 직전: "확인" 1개 button + RoutineList stack push (= ad-hoc 측 비노출 + tab bar ❌).
    // 본 fix: 2 button + isAdhoc 분기 (= AlarmTab / RoutineTab nested) + 종료 후 자동 시작.
    const isRoutineActive = await AsyncStorage.getItem('isRoutineActive');
    if (isRoutineActive === 'true') {
      const ar = await loadActiveRoutine();
      const isAdhoc = ar ? isAdhocAlarmRoutine(ar.routineId) : false;
      Alert.alert(
        t('home.timerBlocked.title', { defaultValue: '루틴 진행 중' }),
        t('home.timerBlocked.body2', { defaultValue: '진행 중인 루틴을 종료하고 단일 타이머를 시작하시겠습니까?' }),
        [
          {
            text: t('common.cancel', { defaultValue: '취소' }),
            style: 'cancel',
            onPress: () => {
              // 사용자 = routine 유지. 진행 중 페이지 navigate (= ad-hoc → AlarmTab / 일반 → RoutineTab).
              // v1.7 hotfix — dial 초기화 (= 루틴 탭 진입 후 다시 HomeScreen 진입 시 dial 잔존 영역 회피).
              setSelectedMinutes(0);
              setSelectedSeconds(0);
              if (isAdhoc) {
                (navigation as any).navigate('Home', { screen: 'AlarmTab' });
              } else {
                (navigation as any).navigate('Home', { screen: 'RoutineTab' });
              }
            },
          },
          {
            text: t('home.timerBlocked.stopAndStart', { defaultValue: '루틴 종료 후 시작' }),
            style: 'destructive',
            onPress: async () => {
              const clearedRoutineId = ar?.routineId;
              await stopRoutine().catch(() => {});
              // stopRoutine → fullCleanup → AsyncStorage.removeItem('isRoutineActive').
              // v1.7 hotfix — RoutineListScreen 측 activeManualRoutineId 정리 트리거 (= 다시 루틴 탭 진입 시 잔존 ActiveRoutineSection 영역 회피).
              DeviceEventEmitter.emit('routineClearedExternally', { routineId: clearedRoutineId });
              // handleStart 재호출 → isRoutineActive 'false' / null → 정상 진입 → timer 시작.
              await handleStart();
            },
          },
        ],
      );
      return;
    }
    const nowMs = Date.now();
    // v1.8 #AlarmTimerConflict — 단일 타이머 시작 시 알람 다음 트리거 시각 검사.
    // 타이머 종료 + 5분 버퍼 안에 알람 트리거 있으면 경고 dialog → 사용자 선택 후 시작.
    // "시작" 누름 시 = 충돌 알람 임시 disable + AlarmKit cancel + AsyncStorage 측 ID 저장 → AlarmScreen goHome 측 측 복원.
    try {
      const alarms = await loadAlarms();
      const enabledAlarms = alarms.filter(a => a.enabled);
      const limitMs = nowMs + (total + 300) * 1000;
      let conflict: { time: number; label: string; alarmId: string } | null = null;
      for (const a of enabledAlarms) {
        const next = nextAlarmOccurrenceTime(a, new Date(nowMs));
        if (next !== null && next >= nowMs && next <= limitMs) {
          if (!conflict || next < conflict.time) {
            conflict = { time: next, label: a.label || t('history.alarmDefaultLabel', { defaultValue: '알람' }), alarmId: a.id };
          }
        }
      }
      if (conflict) {
        const d = new Date(conflict.time);
        const h = d.getHours();
        const m = d.getMinutes();
        const ampm = h < 12 ? t('common.am', { defaultValue: '오전' }) : t('common.pm', { defaultValue: '오후' });
        const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
        const timeText = `${ampm} ${h12}:${String(m).padStart(2, '0')}`;
        const c = conflict;
        await new Promise<void>((resolve) => {
          Alert.alert(
            t('routine.alarmConflictTitle'),
            t('routine.alarmConflictBody', { time: timeText, alarmLabel: c.label }),
            [
              { text: t('routine.alarmConflictCancel'), style: 'cancel', onPress: () => resolve() },
              {
                text: t('routine.alarmConflictProceed'),
                onPress: async () => {
                  try {
                    const target = enabledAlarms.find(x => x.id === c.alarmId);
                    if (target) {
                      await upsertAlarm({ ...target, enabled: false });
                      await cancelAlarmsForEntity(c.alarmId);
                      const prevRaw = await AsyncStorage.getItem(PENDING_DISABLED_ALARMS_KEY);
                      const prev: string[] = prevRaw ? JSON.parse(prevRaw) : [];
                      if (!prev.includes(c.alarmId)) prev.push(c.alarmId);
                      await AsyncStorage.setItem(PENDING_DISABLED_ALARMS_KEY, JSON.stringify(prev));
                    }
                  } catch (e) {
                    Logger.warn('timer', `alarmConflict disable fail err=${String(e)}`);
                  }
                  await proceedTimerStart();
                  resolve();
                },
              },
            ],
            { cancelable: true, onDismiss: () => resolve() }
          );
        });
        return;
      }
    } catch (e) {
      Logger.warn('timer', `alarmConflict check fail err=${String(e)}`);
    }
    await proceedTimerStart();

    async function proceedTimerStart() {
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
    scheduleAlarm(total);
    // v1.7 hotfix #LAUnify Phase 10-G1 — LiveActivityBridge.start 호출 제거.
    // AlarmKit framework가 .timer factory로 schedule된 alarm에 대해 LA Activity 자동 시작 (= AlarmKitLiveActivity widget render).
    // 영속화 (cold start 복원용)
    AsyncStorage.setItem(ACTIVE_TIMER_KEY, JSON.stringify({
      startedAt: now,
      totalSeconds: total,
      endAt: endAtRef.current,
      pausedAt: null,
      missionId: mission?.id ?? null,
      missionIcon: mission?.icon ?? null,
    } satisfies ActiveTimer)).catch(() => {});
    }
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
      // v1.8 #CalendarCategory — 타이머 카테고리 + 초 단위 정확 저장.
      type: 'timer',
      totalSeconds: Math.max(0, Math.round(totalSecs)),
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
      // v1.8 #TimerEndGlitch — isRunning=false 전환 직후 frame 측 timeText 가 초기값 (= 사용자 세팅 5초) 으로 평가되어 깜빡임 발생.
      // hasJustEnded=true 동안은 timeText = formatTime(0) 유지.
      setHasJustEnded(true);
      const mission = missionList[selectedIndex] ?? null;
      const icon = mission?.icon ?? 'timer';
      saveSession(totalSecondsRef.current, icon);
      AsyncStorage.removeItem(ACTIVE_TIMER_KEY).catch(() => {});
      // v1.7 hotfix #LAUnify Phase 10-G1 — LiveActivityBridge.end 호출 제거.
      // AlarmKit framework가 alarm cancel/alerting 시 LA Activity 자동 종료.
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
        // v1.7 hotfix #WidgetAppPausedAlign — pause 시점 remaining 강제 update (= setInterval stale value 회피).
        // 직전 = setInterval polling cycle 측 마지막 update 시점 측 stale value 잔존 → 위젯 측 (= AlarmKit framework ceil) vs 앱 측 = 1초 차이.
        const remaining = Math.max(0, Math.ceil((endAtRef.current - signal.timestamp) / 1000));
        remainingSecondsRef.current = remaining;
        setRemainingSeconds(remaining);
        AsyncStorage.getItem(ACTIVE_TIMER_KEY).then(raw => {
          if (!raw) return;
          try {
            const t: ActiveTimer = JSON.parse(raw);
            AsyncStorage.setItem(ACTIVE_TIMER_KEY, JSON.stringify({ ...t, pausedAt: signal.timestamp })).catch(() => {});
          } catch {}
        });
        // v1.7 hotfix Phase 13 G4-C — 위젯 측 pause 시 = expo notif fallback cancel 폐기 (= AlarmKit native pause 정합).
      } else if (signal.action === 'resume' && isPausedRef.current && isRunning) {
        // 위험 #X 정정: pauseDuration = resume signal.timestamp - 실제 pausedAt
        const pauseDuration = Math.max(0, signal.timestamp - (pausedAtRef.current ?? signal.timestamp));
        endAtRef.current += pauseDuration;
        pausedAtRef.current = null;
        isPausedRef.current = false;
        setIsPaused(false);
        // v1.7 hotfix #WidgetAppPausedAlign — resume 시점 remaining 강제 update (= 위젯 ceil 정합).
        const remaining = Math.max(0, Math.ceil((endAtRef.current - signal.timestamp) / 1000));
        remainingSecondsRef.current = remaining;
        setRemainingSeconds(remaining);
        AsyncStorage.getItem(ACTIVE_TIMER_KEY).then(raw => {
          if (!raw) return;
          try {
            const t: ActiveTimer = JSON.parse(raw);
            AsyncStorage.setItem(ACTIVE_TIMER_KEY, JSON.stringify({ ...t, endAt: endAtRef.current, pausedAt: null })).catch(() => {});
          } catch {}
        });
        // v1.7 hotfix Phase 13 G4-C — 위젯 측 resume 시 = expo notif fallback 재등록 폐기 (= AlarmKit native resume 정합).
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
        // v1.7 hotfix Phase 13 G4-C — cold start 측 expo 알림 stale cleanup 폐기 (= AlarmKit only = stale ❌).
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

      // v1.7 hotfix #LAUnify Phase 10-G1 — 옛 LiveActivityBridge.endAll cleanup 제거. AlarmKit 자동 lifecycle.

      if (pausedAt !== null) {
        // Pause 상태 복원 — 알람 재예약 X (이미 cancelAlarms됨). LA 재등록도 skip (pause = 시간 정지 표시 의미 약함).
        const remaining = Math.max(0, Math.ceil((endAt - pausedAt) / 1000));
        remainingSecondsRef.current = remaining;
        setRemainingSeconds(remaining);
        setIsRunning(true);
        setIsPaused(true);
        isPausedRef.current = true;
        // v1.8 #PausedDialEdit — cold start 측 paused 복원 시 = 변경 비교 기준 측 = 복원된 endAt 측 저장.
        // 없으면 = 복원 후 dial 회전 + resume 시 = chain 미동작 + native fireAt 측 옛 값 + JS endAt 측 새 값 측 불일치.
        pausedOriginalEndAtRef.current = endAt;
        AsyncStorage.setItem('isTimerActive', 'true').catch(() => {});
        return;
      }

      const remaining = Math.ceil((endAt - now) / 1000);
      if (remaining > 0) {
        // 타이머 진행 중 → UI 복원
        remainingSecondsRef.current = remaining;
        setRemainingSeconds(remaining);
        setIsRunning(true);
        AsyncStorage.setItem('isTimerActive', 'true').catch(() => {});
        // v1.7 hotfix #ColdStartLA-3 — cold start 측 = 잔존 alarm 측 alarmkitIdRef 동기화만 진입.
        //   직전 (= #ColdStartLA-2) = cancelAlarm + scheduleAlarm 진입 → 잔존 LA dismiss + 새 alarm 측 LA 자동 시작 ❌
        //   → 앱 진입 후 LA 사라짐 root cause (= 사용자분 사인 정합).
        //   본 정정 = ref 동기화만 진입 + LA 잔존 영역 그대로 (= Apple Forum #729651 정합 = force quit 후 LA NOT dismissed).
        AlarmkitBridge.listAlarms().then((alarms) => {
          const timerAlarm = alarms.find(a => a.state === 'countdown' || a.state === 'paused');
          if (timerAlarm) {
            alarmkitIdRef.current = timerAlarm.id;
          }
        }).catch(() => {});
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
  // v1.7 hotfix #G5 Phase B-2 — pauseAlarm / resumeAlarm 측 = native 측 시점 측 측정 + return → JS 측 = pauseDuration 측 정확 측정 (= JS bridge 통신 영역 1초 미만 오차 ❌).
  const handlePauseResume = async () => {
    const next = !isPausedRef.current;
    isPausedRef.current = next;
    setIsPaused(next);
    const now = Date.now();
    if (next) {
      // pause: AlarmKit framework 측 .pause(id:) 호출 → native 측 = pause 시점 측 측정 + return.
      // v1.7 hotfix #G5 Phase B-2 — pausedAtRef 측 = native 측 시점 측 측정 (= JS bridge 통신 영역 정확 측정).
      const pausedAtMs = alarmkitIdRef.current
        ? await AlarmkitBridge.pauseAlarm(alarmkitIdRef.current).catch(() => 0)
        : 0;
      pausedAtRef.current = pausedAtMs > 0 ? pausedAtMs : now;
      // v1.8 #PausedDialEdit — pause 진입 시점 endAtRef 저장. resume 시 변경 여부 비교용.
      pausedOriginalEndAtRef.current = endAtRef.current;
      // v1.7 hotfix #WidgetAppPausedAlign — pause 시점 remaining 강제 update (= setInterval stale value 회피).
      const remaining = Math.max(0, Math.ceil((endAtRef.current - pausedAtRef.current) / 1000));
      remainingSecondsRef.current = remaining;
      setRemainingSeconds(remaining);
      // 타이머 플래그 잔존 (= isTimerActive=true 잔존, paused state 측 = AlarmKit framework 잔존).
    } else {
      // v1.8 #PausedDialEdit — paused 측 dial 측 사용자 회전 측 변경 여부 측 endAtRef 비교.
      // 변경 ✅ → cancel + reschedule chain (= AlarmKit framework 측 fireAt update API 공식 ❌).
      // 변경 ❌ → 기존 resumeAlarm 흐름 (= framework 자동 pauseDuration 연장).
      const original = pausedOriginalEndAtRef.current;
      const changed = original !== null && endAtRef.current !== original;
      if (changed) {
        const newRemainingSecs = Math.max(1, Math.ceil((endAtRef.current - now) / 1000));
        totalSecondsRef.current = newRemainingSecs;
        // scheduleAlarm 내부 = 기존 alarmkitIdRef cancel + 새 alarm schedule + alarmkitIdRef swap 자동.
        await scheduleAlarm(newRemainingSecs);
        // scheduleAlarm 내부 측 = Date.now() + seconds × 1000 측 fireAt 재계산 = JS bridge 영역 drift ~100ms.
        // = endAtRef 측 재정렬 (= UI 측 dial / 남은 시간 측 정확 표시).
        const reAlignedNow = Date.now();
        endAtRef.current = reAlignedNow + newRemainingSecs * 1000;
        remainingSecondsRef.current = newRemainingSecs;
        setRemainingSeconds(newRemainingSecs);
        pausedAtRef.current = null;
        pausedOriginalEndAtRef.current = null;
      } else {
        // resume: AlarmKit framework 측 .resume(id:) 호출 → native 측 = resume 시점 측 측정 + return.
        // v1.7 hotfix #G5 Phase B-2 — pauseDuration 측 = native 측 측정 시점 정확 측정 (= JS bridge 통신 영역 ❌).
        const resumedAtMs = alarmkitIdRef.current
          ? await AlarmkitBridge.resumeAlarm(alarmkitIdRef.current).catch(() => 0)
          : 0;
        const resumedAt = resumedAtMs > 0 ? resumedAtMs : now;
        const pauseDuration = resumedAt - (pausedAtRef.current ?? resumedAt);
        endAtRef.current += pauseDuration;
        pausedAtRef.current = null;
        pausedOriginalEndAtRef.current = null;
        const remainingSecs = Math.max(0, Math.ceil((endAtRef.current - resumedAt) / 1000));
        // v1.7 hotfix #WidgetAppPausedAlign — resume 시점 remaining 강제 update (= 위젯 ceil 정합).
        remainingSecondsRef.current = remainingSecs;
        setRemainingSeconds(remainingSecs);
      }
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

  // v1.8 #PausedDialEdit — paused 측 dial/키패드 변경 시 AsyncStorage 측 endAt 동기.
  // cold start 복원 시 = 변경 endAt 측 정합 (= 미동기 시 회귀: 강제 종료 후 복원 = 옛 endAt 측 잃어버림).
  const persistPausedEndAt = () => {
    AsyncStorage.getItem(ACTIVE_TIMER_KEY).then((raw) => {
      if (!raw) return;
      try {
        const tt: ActiveTimer = JSON.parse(raw);
        const updated: ActiveTimer = { ...tt, endAt: endAtRef.current };
        AsyncStorage.setItem(ACTIVE_TIMER_KEY, JSON.stringify(updated)).catch(() => {});
      } catch {}
    }).catch(() => {});
  };

  // --- 취소 ---
  const handleCancel = () => {
    cancelAlarms();
    // v1.7 hotfix #LAUnify Phase 10-G1 — LiveActivityBridge.end 호출 제거.
    // AlarmKit framework가 alarm cancel 시 LA Activity 자동 종료.
    AsyncStorage.removeItem(ACTIVE_TIMER_KEY).catch(() => {});
    setIsRunning(false);
    setIsPaused(false);
    isPausedRef.current = false;
    endAtRef.current = 0;
    pausedAtRef.current = null;
    pausedOriginalEndAtRef.current = null;
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

  // v1.8 #TimerEndGlitch — 타이머 0 도달 ~ AlarmScreen mount 사이 한 프레임 동안 timeText 가
  // 초기 세팅값으로 평가되어 깜빡임 발생. hasJustEnded 동안은 formatTime(0) 유지.
  const timeText = isRunning || hasJustEnded
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
          {/* v1.7 — 버그 제보 메일 아이콘. tap → BugReportModal */}
          <TouchableOpacity onPress={() => setBugReportVisible(true)}>
            <MaterialIcons name="email" size={24} color={colors.secondary} style={{ opacity: 0.7 }} />
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
            onSeek={
              isRunning && !isPaused
                ? undefined
                : isPaused
                  ? (m) => {
                      // v1.8 #PausedDialEdit — paused 측 dial 회전 측 = 남은 시간 재설정.
                      const newRemainingSecs = m * 60;
                      if (newRemainingSecs <= 0) return; // 0초 차단 가드
                      const nowMs = Date.now();
                      endAtRef.current = nowMs + newRemainingSecs * 1000;
                      remainingSecondsRef.current = newRemainingSecs;
                      setRemainingSeconds(newRemainingSecs);
                    }
                  : (m) => { setSelectedMinutes(m); setSelectedSeconds(0); setSelectedIndex(-1); }
            }
            onSeekStart={() => {}}
            onSeekEnd={() => { if (isPaused) persistPausedEndAt(); }}
            isWarning={isRunning && remainingSeconds <= 60}
          />
        )}
        {dialType === 'digital' && (
          <TimerDigital
            progress={digitalProgress}
            timeText={timeText}
            subText={isRunning ? t('running.minutesLeft') : t('home.minutes')}
            onSeek={
              isRunning && !isPaused
                ? undefined
                : isPaused
                  ? (m: number, s?: number) => {
                      // v1.8 #PausedDialEdit — paused 측 키패드 입력 측 = 남은 시간 재설정 (분 + 초) + AsyncStorage 동기.
                      // 키패드 측 = onSeekEnd 측 호출 ❌ → onSeek 측 직접 AsyncStorage 갱신 (= cold start 복원 정합).
                      const newRemainingSecs = m * 60 + (s ?? 0);
                      if (newRemainingSecs <= 0) return; // 0초 차단 가드
                      const nowMs = Date.now();
                      endAtRef.current = nowMs + newRemainingSecs * 1000;
                      remainingSecondsRef.current = newRemainingSecs;
                      setRemainingSeconds(newRemainingSecs);
                      persistPausedEndAt();
                    }
                  : (m: number, s?: number) => { setSelectedMinutes(m); setSelectedSeconds(s ?? 0); setSelectedIndex(-1); }
            }
            onSeekStart={() => {}}
            onSeekEnd={() => { if (isPaused) persistPausedEndAt(); }}
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
        {/* v1.6 후속 — Play 버튼 + List 버튼 horizontal layout (flex spacer 영역, Play 중앙 + List 우측, 수직 중앙 정렬) */}
        <View style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch', paddingHorizontal: 24 }}>
          <View style={{ flex: 1 }} />
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
          <View style={{ flex: 1, alignItems: 'flex-end' }} pointerEvents={isRunning ? 'none' : 'auto'}>
            <TouchableOpacity
              onPress={() => navigation.navigate('FavoritesList')}
              style={{ opacity: isRunning ? 0.3 : 1 }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 24, backgroundColor: colors.surfaceContainerLow }}>
                <MaterialIcons name="format-list-bulleted" size={20} color={colors.primary} />
                <Text style={{ fontSize: 14, fontWeight: '600', color: colors.primary }}>{t('home.list', { defaultValue: 'List' })}</Text>
              </View>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* v1.6 후속 — 즐겨찾기 영역 제거 후 AdBanner 위치 정정. flex spacer 으로 화면 하단 push. */}
      <View style={{ flex: 1 }} />
      <AdBanner />
      </ScrollView>
      {/* v1.7 — 버그 제보 모달 */}
      <BugReportModal
        visible={bugReportVisible}
        onClose={() => setBugReportVisible(false)}
      />
    </SafeAreaView>
  );
}
