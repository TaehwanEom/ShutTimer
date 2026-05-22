import './src/i18n';
import { useTranslation } from 'react-i18next';
import * as ExpoSplashScreen from 'expo-splash-screen';
import React, { useRef, useEffect } from 'react';
import { AppState, Platform, DeviceEventEmitter, View, Text } from 'react-native';
import Constants from 'expo-constants';
import { NavigationContainer, NavigationContainerRef } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

ExpoSplashScreen.preventAutoHideAsync();
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { MaterialIcons } from '@expo/vector-icons';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SETTINGS_KEY } from './src/constants/settings';
import { MISSIONS_STORAGE_KEY } from './src/constants/missions';
import { preloadDismissMethod, getCachedDismissMethod } from './src/utils/settingsCache';
import { DEFAULT_SETTINGS } from './src/constants/settings';
import { Logger } from './src/utils/logger';
import ErrorBoundary from './src/components/ErrorBoundary';

// v1.7 hotfix Phase 13 G4-F — Notifications.setNotificationHandler 통째 폐기 (= AlarmKit only).
import { StatusBar } from 'expo-status-bar';
import HomeScreen from './src/screens/HomeScreen';
import AlarmScreen from './src/screens/AlarmScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import EditMissionsScreen from './src/screens/EditMissionsScreen';
import OnboardingScreen from './src/screens/OnboardingScreen';
import AddTimerScreen from './src/screens/AddTimerScreen';
import SplashScreen from './src/screens/SplashScreen';
import HistoryScreen from './src/screens/HistoryScreen';
import NoticeScreen from './src/screens/NoticeScreen';
import MissionSelectScreen from './src/screens/MissionSelectScreen';
import RoutineListScreen from './src/screens/RoutineListScreen';
import RoutineEditScreen from './src/screens/RoutineEditScreen';
import RoutineAlarmScreen from './src/screens/RoutineAlarmScreen';
import RoutineCategoryScreen from './src/screens/RoutineCategoryScreen';
import RoutineDaysScreen from './src/screens/RoutineDaysScreen';
import FavoritesListScreen from './src/screens/FavoritesListScreen';
import AlarmListScreen from './src/screens/AlarmListScreen';
import AlarmEditScreen from './src/screens/AlarmEditScreen';
import { syncRollingSchedule } from './src/utils/routineScheduler';
import { restoreRoutineState, pauseRoutineFromLA, resumeRoutineFromLA, stopRoutine, advanceRoutineFromLA, syncRoutineFromSnapshot, markAwaitingConfirm } from './src/utils/routineController';
import { readControlSignal, clearControlSignal, readRoutineSnapshot } from './src/utils/appGroupSync';
import { loadRoutines } from './src/constants/routines';
import AlarmkitBridge from './modules/alarmkit-bridge';
import { SUPPRESS_ALARMKIT_BANNER_IN_FG } from './src/constants/featureFlags';
import { loadAlarmMetadata, deleteAlarmMetadata } from './src/utils/alarmkitMappingTable';
import { loadAlarms } from './src/constants/alarms';
import {
  syncAllAlarms,
  disableOnceAlarmIfNeeded,
  recordAlarmSession,
  cleanupGhostAlarms,
  ALARM_CHAIN_MAX_INDEX,
} from './src/utils/alarmScheduler';
import { cleanupStaleAdhocRoutines, isAdhocAlarmRoutine } from './src/utils/alarmRoutineLink';
import { recordInstallDateIfNeeded } from './src/utils/storeReview';
/*
  ═══════════════════════════════════════════════════════════
   @preserve @v1.5-poc — PoCPhotoValidationScreen require 영역
   보존 결정일: 2026-05-03
   비활성화 사유: 사용자 명시 — 본 빌드 노출 ❌, 나중에 재사용
   재활성화: 주석 해제만으로 즉시 복원 가능
   ⚠️ 이 블록 삭제 금지.

   @preserve-original:
   const PoCPhotoValidationScreen = __DEV__
     ? require('./src/screens/PoCPhotoValidationScreen').default
     : null;
  ═══════════════════════════════════════════════════════════
*/
import { Mission } from './src/constants/missions';
import { ThemeProvider, useTheme } from './src/context/ThemeContext';
// @preserve IAP — Phase 2+ 복원용. 삭제 금지. (TS6133 회피 위해 import 라인 주석)
// import { PurchaseProvider } from './src/context/PurchaseContext';
import ForceUpdate from './src/components/ForceUpdate';

const isExpoGo = (Constants as any).appOwnership === 'expo';

export type RootStackParamList = {
  Splash: undefined;
  Onboarding: undefined;
  Home: { selectedFavoriteId?: string } | undefined;
  FavoritesList: undefined;
  Alarm: { missionId?: string; missionIcon?: string; fromRoutine?: 'last_step'; routineId?: string; endMethod?: 'tap' | 'shake' | 'camera' | 'math' | 'typing' | 'random'; alarmEntityId?: string } | undefined;
  // v1.8 — Settings / History / AlarmList Stack.Screen 제거. MainTabsNavigator Tab.Screen만 사용.
  EditMissions: undefined;
  AddTimer: { editId?: string; editIcon?: string; editMinutes?: number; dialType?: string } | undefined;
  Notice: undefined;
  MissionSelect: undefined;
  // @v1.6 루틴 기능
  // v1.8 — RoutineList Stack.Screen 제거. MainTabsNavigator RoutineTab 측만 사용.
  // 탭 정보 측 = AsyncStorage 측 'pendingRoutineInitialTab' 키 임시 전달.
  RoutineEdit: {
    routineId?: string;
    /** 신규 생성 시 모드 — 미지정 시 'scheduled' default. 편집 모드면 무시 (기존 routine 의 schedule 유무 유지) */
    mode?: 'scheduled' | 'manual';
    // Phase 4: 하위 화면에서 merge:true 로 반환되는 값들 (useEffect로 소비 후 undefined 세팅)
    selectedCategory?: string;
    selectedDays?: number[];
  } | undefined;
  RoutineAlarm: { routineId: string };
  RoutineCategory: { current?: string } | undefined;
  RoutineDays: { current?: number[] } | undefined;
  // v1.6+ 알람 기능
  AlarmEdit: { alarmId?: string } | undefined;
  // @v1.5-poc — 영구 유지. __DEV__ 가드로 production 빌드 런타임에서 접근 차단.
  PoCPhotoValidation: undefined;
};

// v1.6+ 알람 기능 — Tab generic 정의 (= 위험 #7 정정).
export type MainTabParamList = {
  HomeTab: undefined;
  AlarmTab: undefined;
  RoutineTab: undefined;
  CalendarTab: undefined;
  SettingsTab: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<MainTabParamList>();

// v1.6 후속 — Calendar placeholder (= Phase A 샘플, Phase C 에서 신설 화면 교체).
function CalendarPlaceholder() {
  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
      <Text style={{ fontSize: 18, color: '#888' }}>준비 중</Text>
    </View>
  );
}

// v1.6 후속 — 하단 탭 (타이머 / 루틴 / 캘린더 / 설정).
// v1.8 #TabBarI18n — tabBarLabel = i18n 분기 (ko / en / ja / zh-CN / zh-TW = 본인 언어 / 나머지 9개 언어 = en fallback)
function MainTabsNavigator() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  return (
    <Tab.Navigator screenOptions={{
      headerShown: false,
      tabBarActiveTintColor: colors.primary,
      tabBarInactiveTintColor: colors.secondary,
      tabBarStyle: { backgroundColor: colors.surfaceContainerLowest, borderTopColor: colors.outlineVariant },
      tabBarLabelStyle: { fontSize: 10, fontWeight: '500' },
    }}>
      <Tab.Screen name="HomeTab" component={HomeScreen as any} options={{
        tabBarLabel: t('tabBar.home'),
        tabBarIcon: ({ color, size }: { color: string; size: number }) => <MaterialIcons name="timer" size={size} color={color} />,
      }} />
      <Tab.Screen name="RoutineTab" component={RoutineListScreen as any} options={{
        tabBarLabel: t('tabBar.routine'),
        tabBarIcon: ({ color, size }: { color: string; size: number }) => <MaterialIcons name="repeat" size={size} color={color} />,
      }} />
      <Tab.Screen name="AlarmTab" component={AlarmListScreen as any} options={{
        tabBarLabel: t('tabBar.alarm'),
        tabBarIcon: ({ color, size }: { color: string; size: number }) => <MaterialIcons name="alarm" size={size} color={color} />,
      }} />
      <Tab.Screen name="CalendarTab" component={HistoryScreen as any} options={{
        tabBarLabel: t('tabBar.calendar'),
        tabBarIcon: ({ color, size }: { color: string; size: number }) => <MaterialIcons name="calendar-today" size={size} color={color} />,
      }} />
      <Tab.Screen name="SettingsTab" component={SettingsScreen as any} options={{
        tabBarLabel: t('tabBar.settings'),
        tabBarIcon: ({ color, size }: { color: string; size: number }) => <MaterialIcons name="settings" size={size} color={color} />,
      }} />
    </Tab.Navigator>
  );
}

function AppNavigator() {
  const { isDark } = useTheme();
  const navigationRef = useRef<NavigationContainerRef<RootStackParamList>>(null);

  // 앱 시작 시 stale 플래그 초기화 (killed 후 콜드 스타트 대비) + 설정 사전 로드
  useEffect(() => {
    AsyncStorage.removeItem('isTimerActive').catch(() => {});
    AsyncStorage.removeItem('isAlarmActive').catch(() => {});
    // v1.6: 루틴 활성 플래그도 stale 방지 (kill 후 재시작 시 단일 타이머 알림 suppress 차단 방지)
    AsyncStorage.removeItem('isRoutineActive').catch(() => {});
    // dismissMethod 사전 로드 → AlarmScreen 마운트 시 즉시 사용 (흔들기 애니메이션 지연 제거)
    preloadDismissMethod();
  }, []);

  // v1.6: 화면 켜짐 유지 — 설정 ON이면 앱 foreground 동안 화면 자동 잠금 차단.
  // 초기 mount + AppState 'active' 복귀 시 재적용. 토글 즉시 반영은 SettingsScreen에서 직접 호출.
  useEffect(() => {
    const KEEP_AWAKE_TAG = 'ShutTimer_keepScreenOn';
    const apply = async () => {
      try {
        const raw = await AsyncStorage.getItem(SETTINGS_KEY.KEEP_SCREEN_ON);
        if (raw === 'true') {
          await activateKeepAwakeAsync(KEEP_AWAKE_TAG);
        } else {
          deactivateKeepAwake(KEEP_AWAKE_TAG);
        }
      } catch {}
    };
    apply();
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') apply();
    });
    return () => sub.remove();
  }, []);

  // AdMob 초기화: isExpoGo 분기로 Expo Go 호환
  useEffect(() => {
    const ownership = (Constants as any).appOwnership;
    const execEnv = (Constants as any).executionEnvironment;
    const isExpoGoLocal = ownership === 'expo' || execEnv === 'storeClient';
    if (isExpoGoLocal) return;
    if (Platform.OS !== 'ios' && Platform.OS !== 'android') return;
    try {
      const { default: mobileAds } = require('react-native-google-mobile-ads');
      mobileAds()
        .initialize()
        .then(() => {
          Logger.info('AdMob', 'MobileAds SDK initialized');
        })
        .catch((e: any) => {
          Logger.warn('AdMob', `Initialize failed: ${e?.message || e}`);
        });
    } catch (e: any) {
      Logger.warn('AdMob', `require failed: ${e?.message || e}`);
    }
  }, []);

  // ATT 요청 + 진단 로그: iOS 14.5+ 에서 추적 허가 요청 후 AsyncStorage에 저장 (AdMob npa 판단에 활용)
  // @v1.5 — 신규 사용자(Onboarding 대상)는 Onboarding이 권한 처리. 여기선 기존 사용자만 대상.
  useEffect(() => {
    const run = async () => {
      try {
        await AsyncStorage.setItem('att_debug_log', JSON.stringify([]));
        const appendLog = async (msg: string) => {
          const prev = await AsyncStorage.getItem('att_debug_log');
          const arr = JSON.parse(prev || '[]');
          arr.push(`${new Date().toISOString()} ${msg}`);
          await AsyncStorage.setItem('att_debug_log', JSON.stringify(arr));
        };

        const ownership = (Constants as any).appOwnership;
        const execEnv = (Constants as any).executionEnvironment;
        const isExpoGoLocal = ownership === 'expo' || execEnv === 'storeClient';

        await appendLog(`Enter. ownership=${ownership}, execEnv=${execEnv}, isExpoGoLocal=${isExpoGoLocal}, platform=${Platform.OS}`);

        if (isExpoGoLocal) { await appendLog('Skip: isExpoGo'); return; }
        if (Platform.OS !== 'ios') { await appendLog('Skip: not iOS'); return; }

        // @v1.5 — Onboarding이 권한 담당하는 신규 사용자는 여기서 자동 요청 스킵
        // (Splash가 onboardingCompleted/attStatus/missions 기준으로 신규/기존 분기와 동일 판정)
        const [onboarded, attStored, missionsStored] = await Promise.all([
          AsyncStorage.getItem('onboardingCompleted'),
          AsyncStorage.getItem('attStatus'),
          AsyncStorage.getItem(MISSIONS_STORAGE_KEY),
        ]);
        const isNewUser = onboarded !== 'true' && attStored === null && missionsStored === null;
        if (isNewUser) {
          await appendLog('Skip: new user — Onboarding will handle permissions');
          return;
        }

        const callATT = async () => {
          try {
            await appendLog('Requiring module...');
            const att = require('expo-tracking-transparency');
            await appendLog(`Module loaded. keys=${Object.keys(att).join(',')}`);

            const current = await att.getTrackingPermissionsAsync();
            await appendLog(`Current status=${current.status}, canAskAgain=${current.canAskAgain}`);

            if (current.status === 'undetermined') {
              await appendLog('Calling request...');
              const result = await att.requestTrackingPermissionsAsync();
              await appendLog(`Request result=${result.status}`);
              await AsyncStorage.setItem('attStatus', result.status);
            } else {
              await appendLog(`Already decided, storing: ${current.status}`);
              await AsyncStorage.setItem('attStatus', current.status);
            }
          } catch (e: any) {
            await appendLog(`ERROR in callATT: ${e?.message || e}`);
          }
        };

        if (AppState.currentState === 'active') {
          await callATT();
        } else {
          await appendLog(`AppState=${AppState.currentState}, waiting for active`);
          const sub = AppState.addEventListener('change', async (s) => {
            if (s === 'active') {
              sub.remove();
              await callATT();
            }
          });
        }
      } catch (e: any) {
        Logger.warn('ATT', `Top-level error: ${e?.message || e}`);
      }
    };
    run();
  }, []);

  // v1.7 hotfix Phase 13 G4-F — expo-notifications 측 listener 3 useEffect 통째 폐기 (= AlarmKit only).
  // 알림 도착 / tap / cold start 측 = AlarmKit framework 측 자체 처리:
  //   - alerting state → onAlarmStateChange listener (= 본 file 측 잔존)
  //   - alarm UI tap → OpenAppDismiss Intent (= 자체 navigate)
  //   - cold start → AlarmKit 측 자체 lifecycle 정합

  // v1.6 T1 + v1.7 hotfix #3 — AlarmKit 알람 발화 listener.
  // 분기 type: chain / timer_main / alarm_main / confirm_prompt.
  // prealert 측 = metadata 저장 (= cleanup lookup 용) but listener 분기 ❌ → silent skip
  // (= 의도: prealert = 화면 전환 ❌, 알림만. routine 시작 시 cancelRoutinePrealerts 가 잔존 정리).
  useEffect(() => {
    const sub = AlarmkitBridge.addListener('onAlarmStateChange', async (event) => {
      // v1.7 hotfix #DBG-C — listener 진입 + suppress flag (= banner 잔존 / banner 미노출 분기 추적용).
      // Logger.warn (= AsyncStorage 영역 → 설정 측 "로그 공유" 측 조회 영역. TestFlight console 미라우팅 회피).
      Logger.warn('onAlarmStateChange-DBG', `alarmId=${event.alarmId} state=${event.state} AppState=${AppState.currentState} suppressFlag=${SUPPRESS_ALARMKIT_BANNER_IN_FG}`);
      // v1.8 #ChainMarker — bundle 적용 검증용 마커. 본 로그 안 보이면 = 디바이스 측 옛 bundle.
      Logger.warn('CHAIN-MARKER-V18', `listener entered state=${event.state} alarmId=${event.alarmId}`);
      if (event.state !== 'alerting') return;
      // v1.6 — 앱 active 시 AlarmKit 시스템 banner 차단. in-app modal + expo-av 사운드 정공.
      // v1.8 #AndroidNativeSound — 안드로이드 제외 (네이티브 AlarmService가 포그라운드에서도 계속 재생).
      if (SUPPRESS_ALARMKIT_BANNER_IN_FG && AppState.currentState === 'active' && Platform.OS !== 'android') {
        Logger.warn('onAlarmStateChange-DBG', `suppressFlag 진입 → cancelAlarm ${event.alarmId}`);
        await AlarmkitBridge.cancelAlarm(event.alarmId).catch(() => {});
      }
      const metaRaw = await loadAlarmMetadata(event.alarmId);
      // v1.7 hotfix #26 — debug log: meta lookup 결과 (= 베너 미노출 추적용).
      // meta=null = mapping table 측 잔존 ❌ → silent skip 진입 = 사용자 측 모름.
      Logger.warn('onAlarmStateChange-DBG', `meta lookup alarmId=${event.alarmId} meta=${metaRaw ? `${metaRaw.type}/${metaRaw.entityId}` : 'NULL'}`);
      // v1.7 hotfix #34 — meta=NULL 시 = routine_snapshot 측 fallback (= confirm_prompt 분기 정합).
      // root cause = AdvanceNextStepIntent native 측 = 다음 step alarm schedule 시 mapping table saveAlarmMetadata ❌ →
      //   다음 step alerting 시 listener 측 meta lookup NULL → silent skip → ar.awaitingConfirm 갱신 ❌ →
      //   X 버튼 시 stopRoutine 분기 진입 ❌ → routine 종료 ❌ 회귀 영역.
      // 정정 = readRoutineSnapshot 측 currentAlarmId 매칭 시 = confirm_prompt + entityId=routineId fallback 영역.
      let meta = metaRaw;
      if (!meta) {
        const snap = readRoutineSnapshot();
        if (snap && snap.currentAlarmId === event.alarmId) {
          meta = { alarmId: event.alarmId, type: 'confirm_prompt', entityId: snap.routineId, createdAt: Date.now() };
          Logger.warn('onAlarmStateChange-DBG', `meta NULL fallback from snapshot routineId=${snap.routineId}`);
        }
      }
      if (!meta) return;
      if (!navigationRef.current?.isReady()) return;
      const currentRoute = navigationRef.current?.getCurrentRoute()?.name;

      // v1.6 Phase 12 — 'chain' 분기 제거 (옵션 A 폐기). 잔존 mapping silent cleanup 만.
      if (meta.type === 'chain') {
        await deleteAlarmMetadata(event.alarmId);
        return;
      }

      if (meta.type === 'timer_main') {
        // v1.6 Phase 9: 일반 타이머 AlarmKit fire → AlarmScreen navigate
        // v1.6 hotfix — deleteAlarmMetadata 호출 제거. AlarmScreen.stopAudioAndVibration 의
        // listAllAlarmMetadata loop 가 cancel + delete 통합 처리 (race 방지: listener 가
        // 먼저 metadata 삭제하면 AlarmScreen cleanup 이 A 를 못 찾아 system 측 ghost 잔존).
        if (currentRoute === 'Alarm') return;
        Logger.warn('NAV-DBG-COLD', `onAlarmState-timer_main navigate Alarm currentRoute=${currentRoute} alarmId=${event.alarmId}`);
        navigationRef.current?.navigate('Alarm');
        return;
      }

      // v1.6+ 알람 entity 측 발화 분기 (= type='alarm_main').
      if (meta.type === 'alarm_main') {
        // sessions 기록 (= 결정 6-B, icon='alarm' 고정)
        await recordAlarmSession().catch(() => {});
        // v1.8 #AlarmChainEager — chain 전체는 scheduleAlarmMain 측 등록 시점에 미리 예약됨.
        //   listener 측 추가 schedule ❌ (= 잠금 상태 앱 suspend 시 listener 미발화 → lazy chain 끊김 회귀 차단).
        //   사용자 dismiss 경로 = cancelAlarmsForEntity → entityId 묶음 일괄 cancel + once disable.
        //   마지막 chain (chainIndex >= 49) 발화 시 = 'once' 알람 자동 disable.
        const curIdx = meta.chainIndex ?? 0;
        if (curIdx >= ALARM_CHAIN_MAX_INDEX) {
          await disableOnceAlarmIfNeeded(meta.entityId).catch(() => {});
        }
        if (currentRoute === 'Alarm') return;
        // v1.8 #AlarmChainRevive — background AlarmScreen mount 차단 (= 잠금 그대로 두면 30초 missionDuration
        //   만료 → cancelAlarmsForEntity → chain 일괄 cancel 회귀). 사용자 잠금 해제 후 앱 진입 시점은
        //   cold-start path (= 본 file 아래 alerting alarm lookup useEffect) 가 잡아 navigate.
        if (AppState.currentState === 'background') return;
        // 알람별 dismissMethod + soundKey lookup → navigate params 전달.
        Logger.warn('NAV-DBG-COLD', `onAlarmState-alarm_main navigate Alarm currentRoute=${currentRoute} entityId=${meta.entityId} endMethod=${getCachedDismissMethod() ?? DEFAULT_SETTINGS.dismissMethod}`);
        navigationRef.current?.navigate('Alarm', {
          endMethod: getCachedDismissMethod() ?? DEFAULT_SETTINGS.dismissMethod,
          alarmEntityId: meta.entityId,
        });
        return;
      }

      if (meta.type === 'confirm_prompt') {
        // v1.7 hotfix #LAUnify Phase 10-G1 — setLiveActivityStage 호출 제거.
        // AlarmKit alerting state → AlarmKitLiveActivity widget mode=.alert 자동 진입 → "다음 진행" 버튼 표시.
        Logger.warn('onAlarmStateChange', `confirm_prompt route=${currentRoute} entityId=${meta.entityId}`);
        // v1.7 hotfix #6 — ar.awaitingConfirm=true 동기 갱신.
        await markAwaitingConfirm(meta.entityId).catch(() => {});
        // v1.7 hotfix #LastStepDirectNavigate — 마지막 step 측 = AlarmScreen navigate 직접.
        // listener 측 navigate('RoutineList') / ('AlarmTab') 측 = 마지막 step 측 = 시각 race
        // (= RoutineList → AlarmScreen 잠깐 표시) 회피.
        const snap = readRoutineSnapshot();
        if (snap && snap.routineId === meta.entityId && snap.currentStepIndex + 1 >= snap.totalSteps) {
          if (currentRoute !== 'Alarm') {
            const lastRoutines = await loadRoutines();
            const lastR = lastRoutines.find(x => x.id === meta.entityId);
            navigationRef.current?.navigate('Alarm', {
              fromRoutine: 'last_step',
              routineId: meta.entityId,
              endMethod: lastR?.endMethod ?? 'tap',
            });
          }
          return;
        }
        // v1.7 Phase 2-B — ad-hoc 알람 routine 측 = AlarmTab (MainTabsNavigator 안 = tab bar 보존). 루틴 탭 진입 ❌.
        const isAdhoc = isAdhocAlarmRoutine(meta.entityId);
        if (currentRoute === 'RoutineAlarm' || (currentRoute as string) === 'RoutineTab' || currentRoute === 'Alarm' || (currentRoute as string) === 'AlarmTab') return;
        const routines = await loadRoutines();
        const r = routines.find(x => x.id === meta.entityId);
        if (!r) {
          if (isAdhoc) {
            navigationRef.current?.reset({
              index: 0,
              routes: [{ name: 'Home', state: { routes: [{ name: 'AlarmTab' }] } }],
            });
          } else {
            Logger.warn('NAV-DBG', `reset target=RoutineTab source=onAlarmStateChange/confirm_prompt-noRoutine currentRoute=${currentRoute}`);
            navigationRef.current?.reset({ index: 0, routes: [{ name: 'Home', state: { routes: [{ name: 'RoutineTab' }] } }] } as any);
          }
          return;
        }
        if (!navigationRef.current?.isReady()) return;
        // v1.6 A-1 — 모달 통일. 일반 routine = RoutineList. (v1.7 Phase 2-B — ad-hoc = AlarmTab nested)
        if (isAdhoc) {
          (navigationRef.current as any).navigate('Home', { screen: 'AlarmTab' });
        } else {
          Logger.warn('NAV-DBG', `navigate target=RoutineTab source=onAlarmStateChange/confirm_prompt-routine currentRoute=${currentRoute}`);
          (navigationRef.current as any).navigate('Home', { screen: 'RoutineTab' });
        }
      }
    });
    return () => sub.remove();
  }, []);

  // v1.6 T1 — 콜드스타트 시 AlarmKit alerting 알람 조회 (앱 kill 후 알람 발화 case)
  useEffect(() => {
    const timer = setTimeout(async () => {
      if (!navigationRef.current?.isReady()) return;
      try {
        const alarms = await AlarmkitBridge.listAlarms();
        const alerting = alarms.find(a => a.state === 'alerting');
        if (!alerting) return;
        const meta = await loadAlarmMetadata(alerting.id);
        if (!meta) return;
        const currentRoute = navigationRef.current?.getCurrentRoute()?.name;
        // 다른 알림 핸들러가 이미 navigate 했으면 skip
        if ((currentRoute as string) === 'RoutineTab' || currentRoute === 'RoutineAlarm' || currentRoute === 'Alarm') return;

        if (meta.type === 'chain') {
          // v1.6 Phase 12 — 'chain' 분기 제거 (옵션 A 폐기). cold-start 잔존 mapping silent cleanup.
          await deleteAlarmMetadata(alerting.id);
          return;
        }
        if (meta.type === 'timer_main') {
          // v1.6 Phase 9: cold-start 시 fire 된 timer_main 알람
          // v1.6 hotfix — deleteAlarmMetadata 호출 제거. AlarmScreen 가 cleanup 책임 통합.
          Logger.warn('NAV-DBG-COLD', `coldStart-timer_main navigate Alarm alarmId=${alerting.id}`);
          navigationRef.current?.navigate('Alarm');
          return;
        }
        // v1.6+ cold-start 시 fire 된 알람 entity (= type='alarm_main').
        if (meta.type === 'alarm_main') {
          await recordAlarmSession().catch(() => {});
          // v1.8 — chain 정책 폐기. cold-start 측도 동일 흐름 (= 'once' 측만 자동 disable).
          await disableOnceAlarmIfNeeded(meta.entityId).catch(() => {});
          Logger.warn('NAV-DBG-COLD', `coldStart-alarm_main navigate Alarm entityId=${meta.entityId} endMethod=${getCachedDismissMethod() ?? DEFAULT_SETTINGS.dismissMethod}`);
          // v1.7 hotfix #SoundMismatch — alarmSoundKey 측 폐기.
          navigationRef.current?.navigate('Alarm', {
            endMethod: getCachedDismissMethod() ?? DEFAULT_SETTINGS.dismissMethod,
            alarmEntityId: meta.entityId,
          });
          return;
        }
        if (meta.type === 'confirm_prompt') {
          // v1.7 hotfix #LAUnify Phase 10-G1 — setLiveActivityStage 호출 제거 (AlarmKit 자동 처리).
          // v1.7 hotfix #6 — cold-start 측 동일 ar 동기 갱신.
          await markAwaitingConfirm(meta.entityId).catch(() => {});
          // v1.7 Phase 2-B — ad-hoc 알람 routine 측 = AlarmTab (nested = tab bar 보존).
          const isAdhoc = isAdhocAlarmRoutine(meta.entityId);
          const routines = await loadRoutines();
          const r = routines.find(x => x.id === meta.entityId);
          if (!r) {
            if (isAdhoc) {
              navigationRef.current?.reset({
                index: 0,
                routes: [{ name: 'Home', state: { routes: [{ name: 'AlarmTab' }] } }],
              });
            } else {
              Logger.warn('NAV-DBG', `reset target=RoutineTab source=cold-start-1.5s/listAlarms-confirm_prompt-noRoutine`);
              navigationRef.current?.reset({ index: 0, routes: [{ name: 'Home', state: { routes: [{ name: 'RoutineTab' }] } }] } as any);
            }
            return;
          }
          // v1.6 A-1 — 모달 통일. 일반 routine = RoutineList. (v1.7 Phase 2-B — ad-hoc = AlarmTab nested)
          if (isAdhoc) {
            (navigationRef.current as any).navigate('Home', { screen: 'AlarmTab' });
          } else {
            Logger.warn('NAV-DBG', `navigate target=RoutineTab source=cold-start-1.5s/listAlarms-confirm_prompt-routine`);
            (navigationRef.current as any).navigate('Home', { screen: 'RoutineTab' });
          }
        }
      } catch {}
    }, 1500);
    return () => clearTimeout(timer);
  }, []);

  // v1.8 #PollingThrottle — 30초 디버그 polling 폐기 (= CPU 영역 ↓, 사용자분 측 측정 ❌ 영역).
  //   직전 v1.7 hotfix #26 = 30s 주기 listAlarms + console.warn → 디버그 추적용. production 측 측정 ❌ 영역.
  //   사용자분 측 발열 영역 root cause 후보 → 폐기 진입.

  // v1.6 Phase 10-D — LA control signal polling (App Group ↔ RN 동기화)
  // LiveActivityIntent.perform() 안에서 설정한 control signal 을 cold-start + AppState 'active' + 3초 polling 시 처리.
  // signal.routineId.startsWith('main_timer_') = timer 측 (DeviceEventEmitter emit) / 그 외 = routine 측 (controller 호출).
  // v1.8 #PollingThrottle — 1초 → 3초 polling. iPhone foreground active 유지 시 Watch / LA Button 신호 처리 누락 방지 영역 + CPU 영역 ↓.
  useEffect(() => {
    let inFlight = false;
    const handleControlSignal = async () => {
      if (inFlight) return;
      const signal = readControlSignal();
      if (!signal) return;
      console.warn('[LAControl] signal:', signal.action, signal.routineId, 'AppState:', AppState.currentState);
      inFlight = true;
      clearControlSignal();
      try {
        if (signal.routineId.startsWith('main_timer_')) {
          // v1.6 hotfix — timer_main alarm slide-to-stop 시 OpenAppDismissIntent 가 'open_app_dismiss'
          // 작성. 앱 자동 foreground 진입 후 본 polling 이 받아 AlarmScreen 진입 → dismiss method UI.
          if (signal.action === 'open_app_dismiss') {
            if (navigationRef.current?.isReady()) {
              const route = navigationRef.current.getCurrentRoute()?.name;
              if (route !== 'Alarm') {
                // v1.7 hotfix #ColdStartRemount — currentRoute='Splash' 시 race 회피.
                // Splash 측 setTimeout 1.5초 후 navigation.replace('Home') 측 = stack reorder → AlarmScreen unmount + remount 회귀.
                // 정공 = navigation.reset 측 직접 [Home, Alarm] stack set → Splash 측 self-replace 측 = noop (= Splash instance ❌).
                if (route === 'Splash') {
                  Logger.warn('NAV-DBG-COLD', `polling-timer_main reset[Home,Alarm] from Splash routineId=${signal.routineId}`);
                  navigationRef.current.reset({ index: 1, routes: [{ name: 'Home' }, { name: 'Alarm' }] });
                } else {
                  Logger.warn('NAV-DBG-COLD', `polling-timer_main navigate Alarm route=${route} routineId=${signal.routineId}`);
                  navigationRef.current.navigate('Alarm');
                }
              }
            }
          } else {
            // timer 측 (pause/resume/stop) — HomeScreen listener 가 처리
            DeviceEventEmitter.emit('laControlTimer', signal);
          }
        } else {
          // routine 측 — pause/resume = LA Intent 가 이미 native 처리. RN 은 ar 동기화만.
          // 위험 #X 정정: signal.timestamp = LA Intent perform 시점 (실제 누름 시각). RN polling 시점 X.
          // v1.7 hotfix — 본 앱 = "앱 진입 → dismiss method (탭/흔들기/스캔미션)" 정공.
          // 잠금 해제 시 iOS 시스템이 alerting alarm 을 자동 dismiss → stopIntent perform → 본 signal.
          // 사용자 명시 누름 vs 시스템 자동 dismiss 구분 ❌ 영역. routine 정지 ❌가 사용자 의도.
          // → stopRoutine() 호출 ❌. navigate 만 + routine 진행 보존. 명시적 정지는 위젯 ✕ 또는 휴지통.
          if (signal.action === 'open_app_dismiss') {
            // v1.7 hotfix #DBG-LA — open_app_dismiss signal 진입 (= 이중 이동 / 종료 ❌ root cause 추적용).
            Logger.warn('LAControl-DBG', `open_app_dismiss 분기 진입 routineId=${signal.routineId}`);
            // v1.7 hotfix #16 — AlarmScreen mount race 회귀 차단.
            // 알람 entity banner 터치 시 stopIntent (OpenAppDismissIntent) perform → signal 작성 →
            // polling 처리 시점 = AlarmScreen mount 진행 중 = currentRoute='Home' → 가드 통과 →
            // navigate('RoutineList'/'AlarmTab') 강제 호출 → AlarmScreen 잠깐 표시 후 강제 전환.
            // fix: isAlarmActive AsyncStorage 검사 + 200ms 지연 후 currentRoute 재확인.
            const isAlarmActiveRaw = await AsyncStorage.getItem('isAlarmActive');
            Logger.warn('LAControl-DBG', `isAlarmActive=${isAlarmActiveRaw}`);
            if (isAlarmActiveRaw === 'true') {
              Logger.warn('LAControl-DBG', 'isAlarmActive=true → return');
              return;
            }

            // v1.7 hotfix #33 — adhoc + awaitingConfirm 측 = setTimeout 200ms 우회 (= 즉시 stopRoutine).
            // 본 영역 = AlarmScreen mount 영역 ❌ (= AlarmTab 측 모달 영역만) → setTimeout race 회피 영역 영역 ❌.
            // 200ms 단축 + AppState change wake-up + stopRoutine 영역 = 사용자분 측 체감 딜레이 영역 단축.
            const arRawFast = await AsyncStorage.getItem('shuttimer_active_routine').catch(() => null);
            let arParsedFast: any = null;
            try { arParsedFast = arRawFast ? JSON.parse(arRawFast) : null; } catch {}
            const isAdhocFast = isAdhocAlarmRoutine(signal.routineId);
            const routeNameFast = navigationRef.current?.getCurrentRoute()?.name;
            Logger.warn('LAControl-DBG', `fast 분기 검사 awaitingConfirm=${arParsedFast?.awaitingConfirm} isAdhoc=${isAdhocFast} route=${routeNameFast} navReady=${navigationRef.current?.isReady()}`);
            if (arParsedFast?.awaitingConfirm === true && navigationRef.current?.isReady()) {
              Logger.warn('LAControl-DBG', 'fast 분기 진입 → stopRoutine 호출');
              await stopRoutine().catch(() => {});
              // v1.7 hotfix O1 — routineClearedExternally emit (= RoutineList / AlarmList / ActiveRoutineSection listener trigger).
              // 패턴 정합 = "stop" signal 측 (= L757 영역) + HomeScreen 측 = stopRoutine + emit 영역.
              // 직전 = emit ❌ → listener trigger ❌ → UI 갱신 ❌ → 사용자분 측 "중단 ❌" 회귀 영역.
              DeviceEventEmitter.emit('routineClearedExternally', { routineId: signal.routineId });
              const routeFast = navigationRef.current.getCurrentRoute()?.name;
              Logger.warn('LAControl-DBG', `fast stopRoutine + emit OK route=${routeFast} isAdhoc=${isAdhocFast}`);
              if (isAdhocFast) {
                if (routeFast !== 'Alarm' && (routeFast as string) !== 'AlarmTab') {
                  Logger.warn('LAControl-DBG', `fast adhoc navigate AlarmTab (route=${routeFast})`);
                  (navigationRef.current as any).navigate('Home', { screen: 'AlarmTab' });
                } else {
                  Logger.warn('LAControl-DBG', `fast adhoc navigate skip (route=${routeFast})`);
                }
              } else {
                // v1.7 hotfix #routine-tab-unify Phase 2 — 단일 변환. fast 분기 측 'open_app_dismiss' non-adhoc 영역.
                // Bottom Tab 'RoutineTab' 단일 진입 경로 통합 영역 (= 사용자분 측 = "또다른 루틴 페이지" 정합).
                // 본 commit = 본 1줄만 변환. 다른 navigate 측 = 다음 phase 영역.
                if ((routeFast as string) !== 'RoutineTab') {
                  Logger.warn('LAControl-DBG', `fast non-adhoc navigate RoutineTab (route=${routeFast})`);
                  (navigationRef.current as any).navigate('Home', { screen: 'RoutineTab' });
                } else {
                  Logger.warn('LAControl-DBG', `fast non-adhoc navigate skip (route=${routeFast})`);
                }
              }
              return;
            }

            Logger.warn('LAControl-DBG', 'fast 분기 skip → setTimeout 200ms 진입');
            await new Promise(resolve => setTimeout(resolve, 200));
            if (navigationRef.current?.isReady()) {
              // v1.7 hotfix #22 — alarm entity 측 = AlarmScreen navigate (= 베너 터치 무반응 정정).
              // OpenAppDismissIntent.perform 측 routineId = alarm.id (= alarmScheduler.ts entityId).
              // 일반 routine 분기 진입 전 = alarms lookup → 매칭 시 AlarmScreen navigate.
              const alarms = await loadAlarms();
              const alarmEntity = alarms.find(x => x.id === signal.routineId);
              if (alarmEntity) {
                // v1.8 #AlarmRepeat 제거 — 밀어서 중지 시 체인 일괄 cancel 삭제.
                //   체인은 미션 완료할 때까지 살아남아야 한다 (= 미션 유도 장치). cancel은 미션 완료
                //   경로(AlarmScreen.stopAudioAndVibration)에만 존재. 여기선 navigate만.
                //   plan: docs/plan-2026-05-22-ios-slide-stop-chain-cancel-fix.md (FIX-2026-05-22-slide-stop-cancel)
                const route = navigationRef.current.getCurrentRoute()?.name;
                if (route !== 'Alarm') {
                  Logger.warn('NAV-DBG-COLD', `polling-standard navigate Alarm route=${route} entityId=${alarmEntity.id} endMethod=${getCachedDismissMethod() ?? DEFAULT_SETTINGS.dismissMethod}`);
                  // v1.7 hotfix #SoundMismatch — alarmSoundKey 측 폐기.
                  navigationRef.current.navigate('Alarm', {
                    endMethod: getCachedDismissMethod() ?? DEFAULT_SETTINGS.dismissMethod,
                    alarmEntityId: alarmEntity.id,
                  } as never);
                }
                return;
              }
              const isAdhoc = isAdhocAlarmRoutine(signal.routineId);
              const route = navigationRef.current.getCurrentRoute()?.name;
              // v1.7 hotfix #31 — confirm_prompt alerting 시 밀어서 종료 (= Slide to Stop) = routine 정지 의도.
              // ar.awaitingConfirm === true 시 = stopRoutine 호출 + navigate (= 정지 화면).
              // false 시 = 기존 흐름 (= 일반 step alerting 측 진행 보존).
              // v1.7 hotfix — b967967 측 추측 회귀 정정 (= "위로 밀어 잠금 해제 = OpenAppDismiss" 가정 ❌).
              // 정공 = OpenAppDismissIntent perform = "밀어서 종료 (Slide to Stop)" 측만 호출 = 사용자 명시 정지 의도.
              // adhoc + non-adhoc 모두 = stopRoutine 영역. navigate 영역만 분기 (= adhoc → AlarmTab / non-adhoc → RoutineList).
              const arRaw2 = await AsyncStorage.getItem('shuttimer_active_routine').catch(() => null);
              let arParsed: any = null;
              try { arParsed = arRaw2 ? JSON.parse(arRaw2) : null; } catch {}
              Logger.warn('LAControl-DBG', `standard 분기 검사 awaitingConfirm=${arParsed?.awaitingConfirm} isAdhoc=${isAdhoc} route=${route}`);
              if (arParsed?.awaitingConfirm === true) {
                Logger.warn('LAControl-DBG', 'standard 분기 진입 → stopRoutine 호출');
                await stopRoutine().catch(() => {});
                // v1.7 hotfix O1 — routineClearedExternally emit (= 패턴 정합 영역).
                DeviceEventEmitter.emit('routineClearedExternally', { routineId: signal.routineId });
                Logger.warn('LAControl-DBG', `standard stopRoutine + emit OK route=${route} isAdhoc=${isAdhoc}`);
                if (isAdhoc) {
                  if (route !== 'Alarm' && (route as string) !== 'AlarmTab') {
                    Logger.warn('LAControl-DBG', `standard adhoc navigate AlarmTab (route=${route})`);
                    (navigationRef.current as any).navigate('Home', { screen: 'AlarmTab' });
                  } else {
                    Logger.warn('LAControl-DBG', `standard adhoc navigate skip (route=${route})`);
                  }
                } else {
                  if ((route as string) !== 'RoutineTab') {
                    Logger.warn('LAControl-DBG', `standard non-adhoc navigate RoutineTab (route=${route})`);
                    Logger.warn('NAV-DBG', `navigate target=RoutineTab source=la-control/open_app_dismiss-standard-stopRoutine currentRoute=${route}`);
                    (navigationRef.current as any).navigate('Home', { screen: 'RoutineTab' });
                  } else {
                    Logger.warn('LAControl-DBG', `standard non-adhoc navigate skip (route=${route})`);
                  }
                }
                return;
              }
              // v1.7 hotfix #2 — AlarmScreen 활성 시 (= 사용자 정상 dismiss flow 진행 중)
              // navigate trigger 차단. cancelAlarm 측 stop 호출이 stopIntent perform 영역 측
              // 'open_app_dismiss' signal 발생 → 종료 스크린 직후 강제 전환 회귀 차단.
              if (isAdhoc) {
                if (route !== 'Alarm' && (route as string) !== 'AlarmTab') {
                  (navigationRef.current as any).navigate('Home', { screen: 'AlarmTab' });
                }
              } else {
                if (route !== 'Alarm' && (route as string) !== 'RoutineTab') {
                  Logger.warn('NAV-DBG', `navigate target=RoutineTab source=la-control/open_app_dismiss-standard-default currentRoute=${route}`);
                  (navigationRef.current as any).navigate('Home', { screen: 'RoutineTab' });
                }
              }
            }
          }
          else if (signal.action === 'pause') {
            // v1.6 #4-B Fix 2 — emit try/finally 분리. pauseRoutineFromLA throw 시에도 emit 보장 (UI 동기화).
            try {
              await pauseRoutineFromLA(signal.timestamp);
            } finally {
              DeviceEventEmitter.emit('routinePausedExternally', { routineId: signal.routineId, timestamp: signal.timestamp });
            }
          }
          else if (signal.action === 'resume') {
            try {
              await resumeRoutineFromLA(signal.timestamp);
            } finally {
              DeviceEventEmitter.emit('routineResumedExternally', { routineId: signal.routineId, timestamp: signal.timestamp });
            }
          }
          else if (signal.action === 'stop') {
            // v1.6 Phase 12 — 위젯 ✕ stop 시 RoutineListScreen 의 activeManualRoutineId 정리 트리거.
            // (onClose 콜백은 JS 내부 stop 에서만 호출 → 외부 stop 경로 별도 emit 필요)
            try {
              await stopRoutine();
            } finally {
              DeviceEventEmitter.emit('routineClearedExternally', { routineId: signal.routineId });
            }
          }
          // v1.6 hotfix — AdvanceNextStepIntent.perform() native 처리 완료 신호.
          // native 가 alarm stop + 다음 step schedule + snapshot 갱신 완료 → RN 은 ar/LA 동기화만.
          else if (signal.action === 'advance_done') {
            await syncRoutineFromSnapshot(signal.routineId);
            // 앱 active 시 ActiveRoutineSection modal 자동 dismiss + 사운드 stop
            DeviceEventEmitter.emit('routineAdvancedExternally', { routineId: signal.routineId });
          }
          // v1.6 Phase 12 — 위젯 "다음 진행" Button (AdvanceNextStepIntent) perform 후 routine advance
          // (native 처리 fallback 또는 iOS<26 경로).
          else if (signal.action === 'advance') {
            await advanceRoutineFromLA(signal.routineId);
            DeviceEventEmitter.emit('routineAdvancedExternally', { routineId: signal.routineId });
          }
        }
      } catch (e) {
        Logger.warn('LAControl', `signal handle failed: ${e}`);
      } finally {
        inFlight = false;
      }
    };
    // cold-start
    const t = setTimeout(handleControlSignal, 1500);
    // foreground 진입 시
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') handleControlSignal();
    });
    // v1.8 #PollingThrottle — 1초 → 3초 polling. foreground active 유지 시 Watch / LA Button 신호 3초 이내 반영 + CPU 영역 ↓.
    const poll = setInterval(handleControlSignal, 3000);
    return () => {
      clearTimeout(t);
      clearInterval(poll);
      sub.remove();
    };
  }, []);

  // v1.6: 앱 기동 시 루틴 알림 rolling 재동기화 + ActiveRoutine 자동 복원
  useEffect(() => {
    syncRollingSchedule().catch((e) => {
      Logger.warn('AppNavigator', `syncRollingSchedule failed: ${e}`);
    });
    // v1.6+ 알람 측 = stale 'alarm_main' cleanup + enabled=true 알람 재예약.
    // v1.7 hotfix #GhostAlarmCleanup — syncAllAlarms 후 = framework 측 mapping table 측 등록 ❌ 유령 알람 cleanup. 순차 호출 (= race 회피).
    (async () => {
      try {
        await syncAllAlarms();
        await cleanupGhostAlarms();
      } catch (e) {
        Logger.warn('AppNavigator', `syncAllAlarms / cleanupGhostAlarms failed: ${String(e)}`);
      }
    })();
    // v1.7 Phase 2-A — 시작 시 잔존 ad-hoc routine (= 비정상 종료 / 다른 알람 fire 안 함) 정리.
    cleanupStaleAdhocRoutines().catch((e) => {
      Logger.warn('AppNavigator', `cleanupStaleAdhocRoutines failed: ${e}`);
    });
    // v1.8 #StoreReview — 첫 실행 시 install date 기록 (= 별점 요청 트리거 영역 = 3일 + 성공 5회 동시 만족 시)
    recordInstallDateIfNeeded().catch((e) => {
      Logger.warn('AppNavigator', `recordInstallDateIfNeeded failed: ${e}`);
    });
    // 콜드 스타트 복원 — 약간 지연 후 navigationRef 준비되면 분기
    const timer = setTimeout(() => {
      if (!navigationRef.current?.isReady()) return;
      // L331 getLastNotificationResponseAsync 핸들러가 이미 RoutineList/RoutineAlarm 로 navigate 했으면 skip
      // (알림 탭으로 앱 진입 시 양쪽 모두 fire → RoutineAlarm 2개 stack 되는 회귀 차단)
      const currentRoute = navigationRef.current.getCurrentRoute()?.name;
      if ((currentRoute as string) === 'RoutineTab' || currentRoute === 'RoutineAlarm' || currentRoute === 'Alarm') return;
      restoreRoutineState()
        .then(async (res) => {
          if (!navigationRef.current?.isReady()) return;
          const navigateTarget = (isAdhoc: boolean) => {
            if (isAdhoc) {
              // v1.7 Phase 2-B — ad-hoc = AlarmTab (nested = tab bar 보존).
              (navigationRef.current as any)!.navigate('Home', { screen: 'AlarmTab' });
            } else {
              (navigationRef.current as any)!.navigate('Home', { screen: 'RoutineTab' });
            }
          };
          const resetTarget = (isAdhoc: boolean) => {
            if (isAdhoc) {
              navigationRef.current!.reset({
                index: 0,
                routes: [{ name: 'Home', state: { routes: [{ name: 'AlarmTab' }] } }],
              });
            } else {
              navigationRef.current!.reset({ index: 0, routes: [{ name: 'Home', state: { routes: [{ name: 'RoutineTab' }] } }] } as any);
            }
          };
          if (res.kind === 'run') {
            navigateTarget(isAdhocAlarmRoutine(res.routineId));
          } else if (res.kind === 'alarm') {
            // 'alarm' kind = controller advance_confirm 매핑.
            const isAdhoc = isAdhocAlarmRoutine(res.routineId);
            const routines = await loadRoutines();
            const r = routines.find(x => x.id === res.routineId);
            if (!r) {
              resetTarget(isAdhoc);
              return;
            }
            if (!navigationRef.current?.isReady()) return;
            navigateTarget(isAdhoc);
          }
        })
        .catch((e) => Logger.warn('AppNavigator', `restoreRoutineState failed: ${e}`));
    }, 1500);
    return () => clearTimeout(timer);
  }, []);

  return (
    <>
    <StatusBar style={isDark ? 'light' : 'dark'} />
    <NavigationContainer ref={navigationRef}>
      <Stack.Navigator
        initialRouteName="Splash"
        screenOptions={{ headerShown: false, gestureEnabled: false }}
      >
        <Stack.Screen name="Splash" component={SplashScreen} />
        <Stack.Screen name="Onboarding" component={OnboardingScreen} options={{ gestureEnabled: false }} />
        <Stack.Screen name="Home" component={MainTabsNavigator} />
        <Stack.Screen name="Alarm" component={AlarmScreen} options={{ gestureEnabled: false }} />
        <Stack.Screen name="EditMissions" component={EditMissionsScreen} />
        <Stack.Screen name="AddTimer" component={AddTimerScreen} />
        <Stack.Screen name="Notice" component={NoticeScreen} />
        <Stack.Screen name="MissionSelect" component={MissionSelectScreen} />
        <Stack.Screen name="RoutineEdit" component={RoutineEditScreen} />
        <Stack.Screen name="RoutineAlarm" component={RoutineAlarmScreen} options={{ gestureEnabled: false }} />
        <Stack.Screen name="RoutineCategory" component={RoutineCategoryScreen} />
        <Stack.Screen name="RoutineDays" component={RoutineDaysScreen} />
        <Stack.Screen name="FavoritesList" component={FavoritesListScreen} />
        <Stack.Screen name="AlarmEdit" component={AlarmEditScreen} />
        {/*
          ═══════════════════════════════════════════════════════════
           @preserve @v1.5-poc — PoCPhotoValidation Stack.Screen
           보존 결정일: 2026-05-03
           비활성화 사유: 사용자 명시 — 본 빌드 노출 ❌, 나중에 재사용
           재활성화: 주석 해제만으로 즉시 복원 가능 (+ App.tsx require 영역도 해제)
           ⚠️ 이 블록 삭제 금지.

           @preserve-original:
           {__DEV__ && (
             <Stack.Screen name="PoCPhotoValidation" component={PoCPhotoValidationScreen} />
           )}
          ═══════════════════════════════════════════════════════════
        */}
      </Stack.Navigator>
    </NavigationContainer>
    </>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <SafeAreaProvider>
          {/*
            ═══════════════════════════════════════════════════════════
             @preserve IAP (PurchaseProvider 래퍼) — Phase 2+ 재활성화용
             보존 결정일: 2026-04-14
             비활성화 사유: 사업자등록 전까지 IAP 보류 (B안)
             재활성화 조건: 사업자등록 + ASC Paid Apps Agreement 활성화
             ⚠️ 이 블록 삭제 금지. 주석 해제만으로 복원 가능해야 함.

             @preserve-original:
             <PurchaseProvider>
               <ForceUpdate />
               <AppNavigator />
             </PurchaseProvider>
            ═══════════════════════════════════════════════════════════
          */}
          <ForceUpdate />
          <AppNavigator />
        </SafeAreaProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
