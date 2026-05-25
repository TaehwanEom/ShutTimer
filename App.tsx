import './src/i18n';
import { useTranslation } from 'react-i18next';
import * as ExpoSplashScreen from 'expo-splash-screen';
import React, { useRef, useEffect, useCallback } from 'react';
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
import { Logger, flushLogs } from './src/utils/logger';
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
import { restoreRoutineState, stopRoutine, advanceRoutineFromLA, syncRoutineFromSnapshot } from './src/utils/routineController';
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
  migrateSoundRename,
  ALARM_CHAIN_MAX_INDEX,
} from './src/utils/alarmScheduler';
import { cleanupStaleAdhocRoutines, isAdhocAlarmRoutine } from './src/utils/alarmRoutineLink';
import { recordInstallDateIfNeeded } from './src/utils/storeReview';
// v2.0 P3.6 — Session 모델 ⑨ guard 결합. additive 변경 (기존 흐름 차단 X).
import {
  bootstrapEffectRunner,
  isGhostAlarmFire,
  cleanupDisabledEntityChains,
  SESSION_EVENT_NAVIGATE,
} from './src/state/effectRunner';
import { onAlarmFire, onLAControlSignal, onAppActive } from './src/state/ActionDispatcher';
import { migrateLegacyToSession } from './src/state/SessionStore';
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
    // v1.9 #PreloadDismissAwait — 측 fire-and-forget → AsyncStorage read 완료 전 AlarmScreen mount 시 = null 반환 → 기본값 fallback 회귀.
    //   정정 = .catch() 측 logging 측만 (= 측 = await 측 useEffect 측 안 됨 → IIFE 측 internal await 측 보장).
    (async () => {
      try { await preloadDismissMethod(); } catch (e) { Logger.warn('App', `preloadDismissMethod fail: ${String(e)}`); }
    })();
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
      // v1.9 #ListenerCancelOrder — cancelAlarm 호출 측 = meta lookup 후로 이동.
      //   직전 = state==='alerting' 즉시 cancelAlarm → AlarmScreen 측 startAlarmAudio 측 race 가능 + meta type 측 무관 cancel.
      //   정정 = meta lookup 후 = (a) deleted=true → silent cancel + return / (b) 의도된 type 만 SUPPRESS cancel / (c) 그 외 NULL/unknown 측 = cancel skip.
      const metaRaw = await loadAlarmMetadata(event.alarmId);
      Logger.warn('onAlarmStateChange-DBG', `meta lookup alarmId=${event.alarmId} meta=${metaRaw ? `${metaRaw.type}/${metaRaw.entityId}${metaRaw.deleted ? '/DELETED' : ''}` : 'NULL'}`);
      // v1.9 #SoftDelete — meta.deleted=true 측 = cancelAlarmsForEntity F2 verify 후 stale 잔존 (= native cancel 실패).
      //   직전 fire 시 = 사용자 화면 진입 + native banner+사운드 = 회귀. 정정 = silent native cancel + metadata 정식 delete + return.
      if (metaRaw && metaRaw.deleted === true) {
        Logger.warn('onAlarmStateChange-DBG', `deleted alarm fire → silent native cancel + metadata delete alarmId=${event.alarmId}`);
        await AlarmkitBridge.cancelAlarm(event.alarmId).catch(() => {});
        await deleteAlarmMetadata(event.alarmId).catch(() => {});
        return;
      }
      // v1.6 — 앱 active 시 AlarmKit 시스템 banner 차단. in-app modal + expo-av 사운드 정공.
      // v1.8 #AndroidNativeSound — 안드로이드 제외 (네이티브 AlarmService가 포그라운드에서도 계속 재생).
      if (SUPPRESS_ALARMKIT_BANNER_IN_FG && AppState.currentState === 'active' && Platform.OS !== 'android') {
        Logger.warn('onAlarmStateChange-DBG', `suppressFlag 진입 → cancelAlarm ${event.alarmId}`);
        await AlarmkitBridge.cancelAlarm(event.alarmId).catch(() => {});
      }
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
      // v2.0 영역 B — Session dispatch 흡수. alarm_main 측 navigate + ⑨ guard 모두 dispatch 가 처리.
      //   confirm_prompt / prealert 는 옛 흐름 유지 (영역 D 미흡수).
      //   ghost=true 시 옛 흐름 즉시 종료 (silent native cleanup 완료).
      // Sub A-3 fix (2026-05-25, Timer 통합) — timer_main 포함 (= alarm_main과 동일 path 통합).
      //   Timer Session 생성됨 (Sub A-2 dispatch Start kind='timer') → transition OnAlarmFire 측 entityId 매칭 → STEP_ALERTING 전이.
      if (meta.type === 'alarm_main' || meta.type === 'timer_main' || meta.type === 'confirm_prompt' || meta.type === 'prealert') {
        const alarmType: 'main' | 'confirm_prompt' | 'prealert' =
          meta.type === 'alarm_main' || meta.type === 'timer_main' ? 'main' : meta.type;
        const fireResult = await onAlarmFire({
          alarmId: event.alarmId,
          entityId: meta.entityId,
          alarmType,
        }).catch(() => ({ ghost: false }));
        if (fireResult.ghost) return;
      }
      // 옵션 4 fix + Sub A-3 (2026-05-25) — alarm_main + timer_main 둘 다 포그라운드 + AppState='active' 시 SESSION_EVENT_NAVIGATE Alarm emit.
      //   원인: suppressFlag 가드 (line 332-337) 가 포그라운드 알람 즉시 cancel → native UI X. 위반-11 fix 후 NavigateAlarmScreen effect 제거 → in-app mount path X.
      //   옵션 2 fix (transition OnAppActive)는 background→active transition만 trigger. 이미 active 상태에서 fire = transition 없음 → 무작동.
      //   정정: 포그라운드 알람 fire 시 직접 SESSION_EVENT_NAVIGATE Alarm emit → AlarmScreen mount.
      if ((meta.type === 'alarm_main' || meta.type === 'timer_main') && AppState.currentState === 'active') {
        Logger.warn('onAlarmStateChange-DBG', `포그라운드 알람 (${meta.type}) → SESSION_EVENT_NAVIGATE Alarm entityId=${meta.entityId}`);
        DeviceEventEmitter.emit(SESSION_EVENT_NAVIGATE, {
          target: 'Alarm',
          alarmEntityId: meta.entityId,
        });
      }
      if (!navigationRef.current?.isReady()) return;
      const currentRoute = navigationRef.current?.getCurrentRoute()?.name;

      // v1.6 Phase 12 — 'chain' 분기 제거 (옵션 A 폐기). 잔존 mapping silent cleanup 만.
      if (meta.type === 'chain') {
        await deleteAlarmMetadata(event.alarmId);
        return;
      }

      // Sub A-3 fix (2026-05-25, Timer 통합) — timer_main listener 분기 폐기.
      //   옛 동작: navigationRef.navigate('Alarm') 직접 호출 (= Session 외부 path).
      //   정정: Timer Session 생성됨 (Sub A-2) → onAlarmFire (alarmType='main') 위에서 처리됨 → transition OnAlarmFire 측 entityId 매칭 → STEP_ALERTING 전이 → 옵션 4 fix 측 SESSION_EVENT_NAVIGATE Alarm emit (단 timer_main도 emit 대상 포함).
      //   = 옛 navigate 직접 호출 폐기. 통합 path 사용.

      // v1.6+ 알람 entity 측 발화 분기 (= type='alarm_main').
      // v2.0 영역 B — ⑨ guard + navigate 는 dispatch 가 처리 (위 onAlarmFire). 본 분기는 부수 작업만.
      if (meta.type === 'alarm_main') {
        // sessions 기록 (= 결정 6-B, icon='alarm' 고정)
        await recordAlarmSession().catch(() => {});
        // v1.8 #AlarmChainEager — chain 마지막 (chainIndex >= max) 발화 시 'once' 알람 자동 disable.
        const curIdx = meta.chainIndex ?? 0;
        if (curIdx >= ALARM_CHAIN_MAX_INDEX) {
          await disableOnceAlarmIfNeeded(meta.entityId).catch(() => {});
        }
        return;
      }

      if (meta.type === 'confirm_prompt') {
        // v1.7 hotfix #LAUnify Phase 10-G1 — setLiveActivityStage 호출 제거.
        // AlarmKit alerting state → AlarmKitLiveActivity widget mode=.alert 자동 진입 → "다음 진행" 버튼 표시.
        Logger.warn('onAlarmStateChange', `confirm_prompt route=${currentRoute} entityId=${meta.entityId}`);
        // v2.0 P2-3 — markAwaitingConfirm 호출 폐기 (dual SoT 해소).
        //   transition OnAlarmFire confirm_prompt 측 effect (SaveActiveRoutine + EmitEvent 'routineAwaitingConfirmExternally') 가 통합 처리.
        // 옵션 A fix (정식 사이클 §3-B 7번, 2026-05-25 사용자 요구) — lastStep confirm_prompt fire 자동 navigate 제거.
        //   옛 동작: 마지막 step alarm fire 시 자동 navigate AlarmScreen (= 사용자 입력 X) → 종료방식 화면 자동 진입.
        //   정식 사이클 §3-B 7번: "마지막 루틴 후 사용자 행위 → 종료방식 스크린". 사용자 입력 trigger 필수.
        //   정정: confirm_prompt fire 시점 자동 navigate X. 사용자 잠금 해제 (= OpenAppDismissIntent perform) 시점에 종료방식 진입.
        //   진입 trigger 위치: ActionDispatcher.onLAControlSignal('open_app_dismiss') lastStep 분기 (A-2 fix).
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

  // v1.6 T1 / v1.8 FIX-④ — alerting 알람 조회 + navigate.
  //   호출 시점:
  //     (1) 콜드 스타트 1.5초 뒤 (= 앱 kill 후 알람 발화 case)
  //     (2) AppState 'background → active' 전환 시 (= 백그라운드 발화 → 배너 탭으로 진입 case)
  //   직전 (1)만 있어서 — 백그라운드 알람 발화 후 배너 탭으로 active 진입 시 다음 체인 멤버(최대 2분)
  //   까지 AlarmScreen 미마운트. 이때 onAlarmStateChange listener 는 'background return' 가드로 skip.
  const runAlertingAlarmCheck = useCallback(async () => {
    if (!navigationRef.current?.isReady()) return;
    // v1.8 FIX-⑥ #SplashGate — Splash 상태에서 navigate 시 Splash→Home 전환 중 pop 회귀 차단. 최대 5초 polling.
    for (let i = 0; i < 50; i++) {
      const curRoute = navigationRef.current?.getCurrentRoute()?.name;
      if (curRoute !== 'Splash') break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
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
        // v1.6 Phase 12 — 'chain' 분기 제거 (옵션 A 폐기). 잔존 mapping silent cleanup.
        await deleteAlarmMetadata(alerting.id);
        return;
      }
      // Sub A-3 fix (2026-05-25, Timer 통합) — timer_main 분기 폐기.
      //   Timer Session 통합됨 → cold start / active 진입 시 OnAppActive dispatch → 옵션 2 fix (transition OnAppActive STEP_ALERTING + alarmBinding) → NavigateAlarmScreen effect → AlarmScreen mount.
      //   = 옛 직접 navigate 폐기. 통합 path 사용.
      if (meta.type === 'alarm_main') {
        await recordAlarmSession().catch(() => {});
        await disableOnceAlarmIfNeeded(meta.entityId).catch(() => {});
        Logger.warn('NAV-DBG-COLD', `alertingCheck-alarm_main navigate Alarm entityId=${meta.entityId} endMethod=${getCachedDismissMethod() ?? DEFAULT_SETTINGS.dismissMethod}`);
        navigationRef.current?.navigate('Alarm', {
          endMethod: getCachedDismissMethod() ?? DEFAULT_SETTINGS.dismissMethod,
          alarmEntityId: meta.entityId,
        });
        return;
      }
      if (meta.type === 'confirm_prompt') {
        // v2.0 P2-3 — markAwaitingConfirm 호출 폐기. dispatch OnAlarmFire(confirm_prompt) 측 통합.
        //   cold-start 측 잔존 alerting 검증 path → onAlarmStateChange listener 부착 후 state 변경 X case 안전망.
        await onAlarmFire({
          alarmId: alerting.id,
          entityId: meta.entityId,
          alarmType: 'confirm_prompt',
        }).catch(() => ({ ghost: false }));
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
            Logger.warn('NAV-DBG', `reset target=RoutineTab source=alertingCheck-confirm_prompt-noRoutine`);
            navigationRef.current?.reset({ index: 0, routes: [{ name: 'Home', state: { routes: [{ name: 'RoutineTab' }] } }] } as any);
          }
          return;
        }
        if (isAdhoc) {
          (navigationRef.current as any).navigate('Home', { screen: 'AlarmTab' });
        } else {
          Logger.warn('NAV-DBG', `navigate target=RoutineTab source=alertingCheck-confirm_prompt-routine`);
          (navigationRef.current as any).navigate('Home', { screen: 'RoutineTab' });
        }
      }
    } catch {}
  }, []);

  // 콜드 스타트 1.5초 뒤 1회 체크.
  useEffect(() => {
    const timer = setTimeout(runAlertingAlarmCheck, 1500);
    return () => clearTimeout(timer);
  }, [runAlertingAlarmCheck]);

  // v1.8 FIX-④ — AppState 'active' 전환 시 alerting 알람 즉시 체크 + navigate.
  //   백그라운드 알람 발화 → 배너 탭/앱 진입 시 AlarmScreen 즉시 마운트 (= 다음 체인 멤버 2분 대기 회귀 차단).
  // 옵션 2 fix 보완 (2026-05-25) — onAppActive dispatch 추가.
  //   사용자 자발 앱 진입 (= background → active transition) 시 dispatch OnAppActive 호출 → transition OnAppActive 측 STEP_ALERTING + alarmBinding 시 NavigateAlarmScreen effect 발동 → AlarmScreen mount + chain 회수.
  //   기존엔 cold start 시 restoreRoutineState → dispatch OnAppActive만 호출 → background → active transition 시 호출 X → 옵션 2 fix 무작동 회귀.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      // v1.9 #BackgroundLogFlush — background 진입 시 = 즉시 log flush (debounce 측 pending log 측 kill 전 보존).
      if (state === 'background' || state === 'inactive') {
        flushLogs();
      }
      if (state === 'active') {
        onAppActive().catch(() => {});
        runAlertingAlarmCheck();
        // v1.9 #StepEndCatchUp — AppState=active 진입 시 = restoreRoutineState 호출 → stepEndAt 만료 시 OnEndAtReached dispatch.
        //   직전 = native AlarmKit .timer(duration:) 측 = background throttle/deferral 시 = countdown 측 정시 fire 안 됨 (log02 측 step 02 5분 지연 보고).
        //   정정 = active 진입 시 = JS 측 stepEndAt 검사 + 만료 시 즉시 advance → native fire 측 지연 측 = JS 측 fallback 보장.
        restoreRoutineState().catch(() => {});
        // v1.9 #OrphanCleanupOnActive — AppState=active 진입 시 orphan alarm cleanup 호출.
        //   직전 = cleanupGhostAlarms 측 = AppNavigator cold start 측만 호출. 사용자 측 앱 측 = 이미 띄워둔 상태 측
        //   = cold start 측 X → orphan 측 잔존 → 옛 잘못된 alarm 매일 fire.
        //   정정 = active 진입 시 5초 지연 후 cleanup → scheduleAlarm + saveAlarmMetadata 측 race 회피.
        //   v1.9 #CleanupDelayExtend — 2초 → 5초 (= 사용자 측 알람 등록 직후 active 전환 race 회피, AsyncStorage commit 보장).
        setTimeout(() => {
          cleanupGhostAlarms().catch(() => {});
        }, 5000);
      }
    });
    return () => sub.remove();
  }, [runAlertingAlarmCheck]);

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
            // v2.0 영역 C — 옛 fast/standard 5분기 + isAlarmActive 가드 + SplashGate 모두 ActionDispatcher 흡수.
            //   비즈니스 로직 (awaitingConfirm/alarm_main/ad-hoc) → onLAControlSignal. navigate 측 SplashGate 는 SESSION_EVENT_NAVIGATE listener 측.
            await onLAControlSignal({
              action: 'open_app_dismiss',
              routineId: signal.routineId,
              timestamp: signal.timestamp,
            });
          }
          // v2.0 영역 F — pause/resume/stop/advance/advance_done 모두 ActionDispatcher 흡수.
          //   옛 함수 호출 + emit + dispatch 모두 onLAControlSignal 안에서 처리.
          else if (
            signal.action === 'pause' ||
            signal.action === 'resume' ||
            signal.action === 'stop' ||
            signal.action === 'advance' ||
            signal.action === 'advance_done'
          ) {
            // M0 진단 보존 — advance_done caller 추적 로그.
            if (signal.action === 'advance_done') {
              try {
                const snap = readRoutineSnapshot();
                Logger.warn('LAControl-DBG', `advance_done 진입 routineId=${signal.routineId} AppState=${AppState.currentState} route=${navigationRef.current?.getCurrentRoute()?.name} snapshot=${JSON.stringify(snap)}`);
              } catch (e) {
                Logger.warn('LAControl-DBG', `advance_done snapshot read fail err=${String(e)}`);
              }
            }
            await onLAControlSignal({
              action: signal.action,
              routineId: signal.routineId,
              timestamp: signal.timestamp,
            });
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
  // v2.0 영역 B+C — Session NavigateAlarmScreen / Tab navigate effect → 실 navigate 위임.
  //   옛 onAlarmStateChange / open_app_dismiss handler 의 직접 navigate 제거 + 본 listener 가 대체.
  //   가드: currentRoute='Alarm' 시 중복 차단, AppState='background' 시 mount 차단, Splash 시 polling.
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(SESSION_EVENT_NAVIGATE, async (payload: { target: string; alarmEntityId?: string; fromRoutine?: string; routineId?: string; endMethod?: string }) => {
      if (!navigationRef.current?.isReady()) return;

      if (payload.target === 'Alarm') {
        // 옛 setTimeout 200ms + SplashGate polling (FIX-⑥) 흡수.
        await new Promise((resolve) => setTimeout(resolve, 200));
        for (let i = 0; i < 50; i++) {
          const curRoute = navigationRef.current?.getCurrentRoute()?.name;
          if (curRoute !== 'Splash') break;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        Logger.warn('LAControl-DBG', `SESSION_EVENT_NAVIGATE Alarm SplashGate 종료 route=${navigationRef.current?.getCurrentRoute()?.name}`);

        const route = navigationRef.current?.getCurrentRoute()?.name;
        if (route === 'Alarm') return; // 중복 차단
        // v2.0 P0-C R-1 fix — AppState='background' 가드 제거 (옛 시스템 정합).
        //   log02 측 5번 alarm fire 중 1번만 mount 회귀 (사용자 메모 "종료 미션 안나옴").
        //   원인: LA Intent perform 측 AppState transition delay → 가드 측 navigate skip.
        //   옛 listener 측 alarm_main 분기 = 가드 0 + navigate 직접 호출 → background 측에서도 navigate OK.
        //   본 fix = 옛 동작 정합. navigate 호출 후 사용자 active 진입 시 화면 표시.

        // 옵션 A fix (2026-05-25) — lastStep payload 측 fromRoutine + routineId + endMethod 처리.
        //   payload.endMethod 우선 (routine.endMethod), 미제공 시 settings cache → default.
        const resolvedEndMethod = payload.endMethod ?? getCachedDismissMethod() ?? DEFAULT_SETTINGS.dismissMethod;
        Logger.warn('NAV-DBG-COLD', `SESSION_EVENT_NAVIGATE Alarm alarmEntityId=${payload.alarmEntityId} endMethod=${resolvedEndMethod} fromRoutine=${payload.fromRoutine ?? '(none)'} routineId=${payload.routineId ?? '(none)'}`);
        navigationRef.current?.navigate('Alarm', {
          endMethod: resolvedEndMethod,
          alarmEntityId: payload.alarmEntityId,
          fromRoutine: payload.fromRoutine,
          routineId: payload.routineId,
        } as never);
      } else if (payload.target === 'AlarmTab') {
        const route = navigationRef.current?.getCurrentRoute()?.name;
        if (route !== 'Alarm' && (route as string) !== 'AlarmTab') {
          (navigationRef.current as any).navigate('Home', { screen: 'AlarmTab' });
        }
      } else if (payload.target === 'RoutineTab') {
        const route = navigationRef.current?.getCurrentRoute()?.name;
        if (route !== 'Alarm' && (route as string) !== 'RoutineTab') {
          Logger.warn('NAV-DBG', `SESSION_EVENT_NAVIGATE RoutineTab route=${route}`);
          (navigationRef.current as any).navigate('Home', { screen: 'RoutineTab' });
        }
      } else if (payload.target === 'Home') {
        navigationRef.current?.reset({ index: 0, routes: [{ name: 'Home' }] });
      }
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    // v2.0 P3.6 — Session 모델 effect runner 부트스트랩. 1회성 가드 내장.
    bootstrapEffectRunner();
    // v2.0 J — 옛 keys (shuttimer_active_routine / activeTimer / isRoutineActive) → Session 1회성 복원.
    //   flag (@shuttimer/session_migration_v1) 가드 → 첫 cold-start 만 실행. 옛 ar 보존 (rollback 안전).
    migrateLegacyToSession()
      .then((r) => Logger.info('AppNavigator', `migrateLegacyToSession result=${JSON.stringify(r)}`))
      .catch((e) => Logger.warn('AppNavigator', `migrateLegacyToSession failed: ${String(e)}`));
    syncRollingSchedule().catch((e) => {
      Logger.warn('AppNavigator', `syncRollingSchedule failed: ${e}`);
    });
    // v1.6+ 알람 측 = stale 'alarm_main' cleanup + enabled=true 알람 재예약.
    // v1.7 hotfix #GhostAlarmCleanup — syncAllAlarms 후 = framework 측 mapping table 측 등록 ❌ 유령 알람 cleanup. 순차 호출 (= race 회피).
    (async () => {
      try {
        // v1.8 #SoundRenameMigration — 사운드 리네임 회귀 1회성 정정. syncAllAlarms 앞에서 실행
        //   → 옛 체인 재등록 후 syncAllAlarms 가 fresh 체인을 live 로 인식해 skip.
        await migrateSoundRename();
        await syncAllAlarms();
        await cleanupGhostAlarms();
        // v2.0 P3.6 ⑨ guard — disabled alarm entity 의 chain 잔존 정리 (cleanupGhostAlarms 가 못 잡는 영역).
        //   cleanupGhostAlarms = framework 측 ≠ mapping 측 ghost 만 정리. enabled=false alarm 의 정상 mapping 은 별건.
        //   본 호출 = enabled=false alarm 의 alarm_main chain 전체 mapping + native cancel.
        await cleanupDisabledEntityChains();
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
