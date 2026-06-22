import './src/i18n';
import { useTranslation } from 'react-i18next';
import * as ExpoSplashScreen from 'expo-splash-screen';
import React, { useRef, useEffect, useState, useCallback } from 'react';
import { AppState, Platform, DeviceEventEmitter, View, Text, Alert } from 'react-native';
import Constants from 'expo-constants';
import { NavigationContainer, NavigationContainerRef } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

ExpoSplashScreen.preventAutoHideAsync();
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator, BottomTabBar } from '@react-navigation/bottom-tabs';
import AdBanner from './src/components/AdBanner';
import TabSwipeContainer from './src/components/TabSwipeContainer';
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
import { restoreRoutineState, stopRoutine } from './src/utils/routineController';
import { readControlSignal, clearControlSignal, readRoutineSnapshot } from './src/utils/appGroupSync';
import { loadRoutines } from './src/constants/routines';
import AlarmkitBridge from './modules/alarmkit-bridge';
import { SUPPRESS_ALARMKIT_BANNER_IN_FG } from './src/constants/featureFlags';
import { loadAlarmMetadata, deleteAlarmMetadata, listAllAlarmMetadata } from './src/utils/alarmkitMappingTable';
import { loadAlarms, lastAlarmOccurrenceTime } from './src/constants/alarms';
import {
  syncAllAlarms,
  disableOnceAlarmIfNeeded,
  recordAlarmSession,
  cleanupGhostAlarms,
  migrateSoundRename,
  migrateChainFixedSafety,
  getHandledFireAt,
  ALARM_CHAIN_MAX_INDEX,
  ALARM_CHAIN_INTERVAL_MS,
  rearmSafetyChain,
} from './src/utils/alarmScheduler';
import { cleanupStaleAdhocRoutines, isAdhocAlarmRoutine } from './src/utils/alarmRoutineLink';
import { recordInstallDateIfNeeded } from './src/utils/storeReview';
// v2.0 P3.6 — Session 모델 ⑨ guard 결합. additive 변경 (기존 흐름 차단 X).
import {
  bootstrapEffectRunner,
  cleanupDisabledEntityChains,
  SESSION_EVENT_NAVIGATE,
} from './src/state/effectRunner';
import { onAlarmFire, onLAControlSignal, onAppActive } from './src/state/ActionDispatcher';
import { dispatch as sessionDispatch } from './src/state/SessionController';
import { migrateLegacyToSession } from './src/state/SessionStore';
import { restoreIfNeeded, mirrorToBackup } from './src/utils/backupRestore';
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
import { ThemeProvider, useTheme } from './src/context/ThemeContext';
// @preserve IAP — Phase 2+ 복원용. 삭제 금지. (TS6133 회피 위해 import 라인 주석)
// import { PurchaseProvider } from './src/context/PurchaseContext';
import ForceUpdate from './src/components/ForceUpdate';


export type RootStackParamList = {
  Splash: undefined;
  Onboarding: undefined;
  Home: { selectedFavoriteId?: string } | undefined;
  FavoritesList: undefined;
  Alarm: { missionId?: string; missionIcon?: string; fromRoutine?: 'last_step'; routineId?: string; endMethod?: 'tap' | 'shake' | 'camera' | 'math' | 'typing' | 'tapcharge' | 'random'; alarmEntityId?: string } | undefined;
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

// v1.9 #AdBannerConsolidate — Tab 화면 5개 측 각자 AdBanner mount → 5개+ 동시 BannerAd 요청 측 = 메모리/광고비용 비효율.
// 정정 = tabBar prop 측 = AdBanner 단일 mount + BottomTabBar 통합 → 모든 Tab 화면 측 공유 = 1개 instance.
// v1.9 #AdBannerStableRef — tabBar 측 inline JSX 시 = MainTabsNavigator re-render 측 (= theme 변경 / i18n 변경) → 새 함수 reference 측 = AdBanner unmount/remount 반복 = BannerAd 측 = 매번 새 광고 요청 = 비용 ↑.
// 정정 = 모듈 외부 측 TabBarWithAd 측 = stable component reference → React.memo 측 = props 동일 시 = re-render skip → AdBanner instance 측 = mount 후 stable alive.
const TabBarWithAd = React.memo((props: any) => (
  <View>
    <AdBanner />
    <BottomTabBar {...props} />
  </View>
));

// 하단 탭 5개를 좌우 스와이프로 전환 — 각 탭 화면을 TabSwipeContainer로 감싼다.
//   module-scope 고정 컴포넌트 (= inline 함수 시 매 렌더 새 reference → 화면 remount 회귀 방지).
const wrapTabSwipe = (C: React.ComponentType<any>) => {
  const Wrapped = (props: any) => (
    <TabSwipeContainer>
      <C {...props} />
    </TabSwipeContainer>
  );
  return Wrapped;
};
const HomeTabScreen = wrapTabSwipe(HomeScreen as any);
const RoutineTabScreen = wrapTabSwipe(RoutineListScreen as any);
const AlarmTabScreen = wrapTabSwipe(AlarmListScreen as any);
const CalendarTabScreen = wrapTabSwipe(HistoryScreen as any);
const SettingsTabScreen = wrapTabSwipe(SettingsScreen as any);

// v1.6 후속 — 하단 탭 (타이머 / 루틴 / 캘린더 / 설정).
// v1.8 #TabBarI18n — tabBarLabel = i18n 분기 (ko / en / ja / zh-CN / zh-TW = 본인 언어 / 나머지 9개 언어 = en fallback)
function MainTabsNavigator() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  return (
    <Tab.Navigator
      tabBar={(props) => <TabBarWithAd {...props} />}
      screenOptions={{
      headerShown: false,
      // #BlankOnForeground (2026-06-17) — animation:'shift' 는 scene opacity/transform 을 애니메이션하는데,
      //   백그라운드 전환으로 애니메이션이 끊기면 활성 탭 scene 이 opacity 0(숨김) 상태로 멈춰 빈 화면이 됨
      //   (탭 전환 시 새 전환이 값을 리셋해 복구되던 증상). → 'none' 으로 제거해 빈 화면 차단.
      animation: 'none',
      tabBarActiveTintColor: colors.primary,
      tabBarInactiveTintColor: colors.secondary,
      tabBarStyle: { backgroundColor: colors.surfaceContainerLowest, borderTopColor: colors.outlineVariant },
      tabBarLabelStyle: { fontSize: 10, fontWeight: '500' },
    }}>
      <Tab.Screen name="HomeTab" component={HomeTabScreen} options={{
        tabBarLabel: t('tabBar.home'),
        tabBarIcon: ({ color, size }: { color: string; size: number }) => <MaterialIcons name="timer" size={size} color={color} />,
      }} />
      <Tab.Screen name="RoutineTab" component={RoutineTabScreen} options={{
        tabBarLabel: t('tabBar.routine'),
        tabBarIcon: ({ color, size }: { color: string; size: number }) => <MaterialIcons name="repeat" size={size} color={color} />,
      }} />
      <Tab.Screen name="AlarmTab" component={AlarmTabScreen} options={{
        tabBarLabel: t('tabBar.alarm'),
        tabBarIcon: ({ color, size }: { color: string; size: number }) => <MaterialIcons name="alarm" size={size} color={color} />,
      }} />
      <Tab.Screen name="CalendarTab" component={CalendarTabScreen} options={{
        tabBarLabel: t('tabBar.calendar'),
        tabBarIcon: ({ color, size }: { color: string; size: number }) => <MaterialIcons name="calendar-today" size={size} color={color} />,
      }} />
      <Tab.Screen name="SettingsTab" component={SettingsTabScreen} options={{
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
      // Phase 3-3 (2026-05-26, Android): native FSI 측 secondary action button (= "다음 진행") 측 = AlarmActionReceiver 측 emit.
      //   confirm_prompt 측 alarm 측 = routine 측 step 진행. JS 측 dispatch Advance 정합 (= iOS AdvanceNextStepIntent 등가).
      //   alarm cancel + service stop 측 = native 측 이미 처리. 본 분기 측 = JS 측 dispatch만.
      if (event.state === 'secondary_action') {
        const sMeta = await loadAlarmMetadata(event.alarmId).catch(() => null);
        Logger.warn('onAlarmStateChange-DBG', `secondary_action alarmId=${event.alarmId} meta=${sMeta ? `${sMeta.type}/${sMeta.entityId}` : 'NULL'}`);
        if (sMeta?.type === 'confirm_prompt') {
          await sessionDispatch({ type: 'Advance' }).catch(() => {});
        }
        await deleteAlarmMetadata(event.alarmId).catch(() => {});
        return;
      }
      // 2026-06-01 (Android): 잠금화면 ongoing chronometer notification 측 "정지" 버튼 = AlarmActionReceiver ACTION_STOP broadcast 측 emit.
      // 2026-06-02 사용자 항의 fix — 위젯 "정지" 즉시 누름 = 위젯 사라짐 = 실수 클릭 측 routine 종료 회귀.
      //   native 측 cancel/stopService 호출 제거 (= 위젯 + alarm 유지) + AlarmAlertActivity launchMainOnly → MainActivity 진입.
      //   JS 측 = Alert.alert 표시 ("종료하시겠습니까?" / [취소, 종료]).
      //   "종료" 선택 시 = stopRoutine + dispatch Stop → reducer effect → cancelAlarm + stopService 측 정리.
      //   "취소" 선택 시 = modal 닫기 + routine + 위젯 그대로.
      // 2026-06-03 fix(#LastStepNoConfirm) — 마지막 단계 "루틴 완료" = 확인 모달 없이 바로 종료.
      //   위젯 정지(stop_action=확인 모달+일시정지)와 구분. 네이티브 ACTION_STOP(isLastStep)이 routine_complete로 분리 emit.
      if (event.state === 'routine_complete') {
        // 2026-06-03 fix(#LastStepEndMission) — 마지막 단계 = 설정된 종료 미션(AlarmScreen) 표시 (바로 종료/확인 모달 X).
        //   직전 fix가 바로 Stop → "종료 미션 안나옴" 회귀. 정정: routine endMethod로 AlarmScreen navigate (lastStep 분기 정합).
        //   종료 미션 완료 시 AlarmScreen 측이 routine 종료 처리.
        const cMeta = await loadAlarmMetadata(event.alarmId).catch(() => null);
        const routineId = cMeta?.entityId;
        const routines = await loadRoutines().catch(() => [] as any[]);
        const r = routineId ? routines.find((x: any) => x.id === routineId) : null;
        const endMethod = r?.endMethod ?? getCachedDismissMethod() ?? DEFAULT_SETTINGS.dismissMethod;
        Logger.warn('onAlarmStateChange-DBG', `routine_complete alarmId=${event.alarmId} routineId=${routineId ?? 'NULL'} endMethod=${endMethod} → 종료 미션 navigate`);
        DeviceEventEmitter.emit(SESSION_EVENT_NAVIGATE, {
          target: 'Alarm',
          fromRoutine: 'last_step',
          routineId,
          endMethod,
        });
        return;
      }
      if (event.state === 'stop_action') {
        const stopMeta = await loadAlarmMetadata(event.alarmId).catch(() => null);
        Logger.warn('onAlarmStateChange-DBG', `stop_action alarmId=${event.alarmId} meta=${stopMeta ? `${stopMeta.type}/${stopMeta.entityId}` : 'NULL'} — confirm modal 표시 대기`);
        // 2026-06-02 — Alert.alert 측 AppState=active 측만 표시 (RN 한계).
        //   AlarmAlertActivity → MainActivity launch transition 시점 = AppState=background → Alert 호출 X.
        //   AppState change listener 측 active 측 transition 측 = Alert 표시 (= MainActivity foreground 측 직후).
        // 2026-06-02 fix(#StopPauseDuringConfirm) — 위젯 정지 시 = 종료 확인 동안 루틴 일시정지 (= 진행 차단 + stale 팝업 방지).
        //   문제: 정지가 팝업만 띄우고 루틴은 계속 진행 → 팝업 떠 있는데 다음 단계로 넘어가 팝업 stale.
        //   정정: 즉시 Pause. source 미지정 = PauseAlarmNative effect 생성 → 네이티브 알람 취소 (실제 정지).
        //     주의: source='la' 금지 — pause_action과 달리 stop 경로는 네이티브가 알람을 안 멈췄으므로 JS가 멈춰야 함.
        //   취소/팝업 닫힘 = Resume (재개). 종료 = stopRoutine + Stop. Resume은 PAUSED 외엔 no-op이라 중복 안전.
        await sessionDispatch({ type: 'Pause', timestamp: Date.now() }).catch(() => {});
        const resumeRoutine = () => {
          sessionDispatch({ type: 'Resume', timestamp: Date.now() }).catch(() => {});
        };
        const showConfirm = () => {
          Alert.alert(
            '루틴 종료',
            '진행 중인 루틴을 종료하시겠습니까?',
            [
              { text: '취소', style: 'cancel', onPress: () => { resumeRoutine(); } },
              {
                text: '종료',
                style: 'destructive',
                onPress: async () => {
                  try {
                    await stopRoutine();
                  } finally {
                    if (stopMeta?.entityId) {
                      DeviceEventEmitter.emit('routineClearedExternally', { routineId: stopMeta.entityId });
                    }
                  }
                  await sessionDispatch({ type: 'Stop', reason: 'la_widget' }).catch(() => {});
                  await deleteAlarmMetadata(event.alarmId).catch(() => {});
                },
              },
            ],
            { cancelable: true, onDismiss: () => { resumeRoutine(); } }
          );
        };
        if (AppState.currentState === 'active') {
          showConfirm();
        } else {
          Logger.warn('onAlarmStateChange-DBG', `stop_action — AppState=${AppState.currentState}, AppState=active 대기 후 Alert`);
          const sub = AppState.addEventListener('change', (nextState) => {
            if (nextState === 'active') {
              sub.remove();
              setTimeout(showConfirm, 200);  // foreground transition 직후 Alert mount 안정화
            }
          });
        }
        return;
      }
      // 2026-06-02 (Android): iOS LA PauseRoutineIntent / ResumeRoutineIntent 정합.
      //   잠금화면 위젯 측 일시정지/플레이 toggle = AlarmActionReceiver ACTION_PAUSE / ACTION_RESUME broadcast → emit.
      //   dispatchPause / dispatchResume = SessionController 측 routine state paused 토글.
      if (event.state === 'pause_action' || event.state === 'resume_action') {
        const ts = Date.now();
        Logger.warn('onAlarmStateChange-DBG', `${event.state} alarmId=${event.alarmId} timestamp=${ts}`);
        if (event.state === 'pause_action') {
          await sessionDispatch({ type: 'Pause', timestamp: ts, source: 'la' as any }).catch(() => {});
        } else {
          await sessionDispatch({ type: 'Resume', timestamp: ts, source: 'la' as any }).catch(() => {});
        }
        return;
      }
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
      // 2026-06-03 fix(#FireNavToTab) — 알람/루틴 발화 시 = 발화 항목의 탭으로 이동 (어느 탭에 있든 보편 규칙).
      //   루틴 스텝(confirm_prompt): ad-hoc 알람 루틴 → AlarmTab / 저장 루틴 → RoutineTab.
      //   (alarm_main / timer_main 은 아래 AlarmScreen navigate + goHome 측에서 각자 탭 복귀 처리됨.)
      if (meta.type === 'confirm_prompt') {
        const fireTab = isAdhocAlarmRoutine(meta.entityId) ? 'AlarmTab' : 'RoutineTab';
        Logger.warn('onAlarmStateChange-DBG', `confirm_prompt fire → navigate ${fireTab} entityId=${meta.entityId}`);
        DeviceEventEmitter.emit(SESSION_EVENT_NAVIGATE, { target: fireTab });
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
        // v2.0 #ChainFixedSafety (2026-05-28) — iOS 전용. Android 측 = chainIndex 1+ daily/weekly 유지 → 본 분기 X.
        //   iOS 측 = chainIndex 1+ .fixed → 발화 후 소비 → 매일 chainIndex 0 발화 시점 측 listener 측 그날 safety chain 재예약.
        //   listener 미발화 시 (= 앱 완전 종료) = 그날 safety chain X (= chainIndex 0 만 발화). 다음 syncAllAlarms 측 복구.
        //   중복 방지 = Day 1 (= 초기 schedule 직후 chainIndex 0 첫 발화) 측 chainIndex 1+ 측 이미 존재 → 측 = skip rearm.
        if (Platform.OS === 'ios') {
          if (curIdx === 0) {
            const allAlarms = await loadAlarms().catch(() => []);
            const alarm = allAlarms.find(a => a.id === meta.entityId);
            if (alarm && (alarm.repeat === 'daily' || alarm.repeat === 'weekly')) {
              const allMetaSnap = await listAllAlarmMetadata().catch(() => []);
              const hasExistingSafety = allMetaSnap.some(m =>
                m.type === 'alarm_main' &&
                m.entityId === meta.entityId &&
                (m.chainIndex ?? 0) >= 1 &&
                m.deleted !== true
              );
              if (!hasExistingSafety) {
                const baseFireAt = Date.now();
                Logger.warn('onAlarmStateChange-DBG', `chainIndex 0 alerting → rearmSafetyChain entityId=${meta.entityId} baseFireAt=${baseFireAt}`);
                await rearmSafetyChain(alarm, baseFireAt).catch(() => {});
              } else {
                Logger.warn('onAlarmStateChange-DBG', `chainIndex 0 alerting skip rearm (existing safety chain) entityId=${meta.entityId}`);
              }
            }
          } else {
            // chainIndex >= 1 (iOS safety chain 멤버) .fixed 측 = 발화 후 framework 자동 제거 → JS metadata orphan cleanup.
            //   Android 측 = 동일 alarmId 측 daily 재예약 (= 메타 삭제 ❌, alarmId 재사용).
            await deleteAlarmMetadata(event.alarmId).catch(() => {});
          }
        }
        return;
      }

      // 2026-06-03 (#FireNavToTab) — 옛 confirm_prompt navigate 블록 제거.
      //   위 #FireNavToTab emit(SESSION_EVENT_NAVIGATE {target:fireTab})가 발화 시 탭 이동을 전담.
      //   옛 블록은 RoutineTab/AlarmTab guard 때문에 "다른 탭에서 루틴 알람 울려도 이동 안 됨" 버그 + 신규 emit과 중복 navigate(ad-hoc 시 reset) 원인이라 제거.
      //   (LA "다음 진행" 버튼은 AlarmKit alerting state가 자동 표시 — navigate와 무관.)
    });
    return () => sub.remove();
  }, []);

  // #LockedColdStartGap (2026-06-05 도입 / 2026-06-21 재설계) — alerting 알람이 없는 콜드 스타트에서
  //   "방금 발화했지만 아직 미해제" 알람을 추론해 라이브 alerting 케이스와 동일 흐름(onAlarmFire+navigate)으로 진입.
  //   2026-06-21 재설계 사유: 옛 판별(미래 안전멤버 2분 윈도우)은 콜드 스타트 syncAllAlarms가 안전체인을
  //     내일 base로 재무장 → fireAt이 윈도우 밖 → 영구 미진입(dead code) 회귀. 실기기 os_log로 확인.
  //     교체: 알람의 직전 발화 시각(lastAlarmOccurrenceTime) 기준 + handledFireAt 재진입 가드.
  const runLockedColdStartGapFallback = useCallback(async () => {
    // iOS 전용 — 본 추론은 iOS 체인 구조(chainIndex 1+ = .fixed 단발 소비형) 전제.
    //   Android 는 chainIndex 1+ 가 native daily 반복(소비 X)이라 fireAt 계산이 달라 오작동 위험 → 제외.
    //   (Android 잠금-발화 복원은 Android창에서 별도 처리.)
    if (Platform.OS !== 'ios') return;
    const curRoute = navigationRef.current?.getCurrentRoute()?.name;
    // 다른 핸들러가 이미 알람/루틴 화면으로 보냈으면 skip. ('RoutineTab'은 Home 내부 탭 → string 캐스트.)
    if ((curRoute as string) === 'RoutineTab' || curRoute === 'RoutineAlarm' || curRoute === 'Alarm') return;
    const now = Date.now();
    const allMeta = await listAllAlarmMetadata();
    const alarms = await loadAlarms();
    // #LockedColdStartGap 재설계 (2026-06-21) — 판별 기준을 "미래 안전멤버 존재"에서 "방금 지나간 발화 시각"으로 교체.
    //   옛 방식은 콜드 스타트 시 syncAllAlarms가 안전체인을 내일 base로 재무장 → fireAt이 윈도우 밖 → 영구 미진입(dead code) 회귀.
    //   (AlarmKit framework는 "방금 발화" 신호를 안 줌 = 시각 추론이 유일 경로. Apple Forums 809398 / mjtsai 확인.)
    //   판별: enabled 알람의 직전 발화 시각(lastAlarmOccurrenceTime)이 활성 윈도우(체인 전체 ≈ 60분) 안 + 아직 미처리(handledFireAt < lastOcc).
    const ACTIVE_WINDOW_MS = (ALARM_CHAIN_MAX_INDEX + 1) * ALARM_CHAIN_INTERVAL_MS; // 30회 × 2분 = 60분
    let target: { entityId: string; fireAlarmId: string } | null = null;
    const diag: string[] = []; // 검증용 — 각 enabled 알람이 왜 탈락했는지(실패 진단).
    for (const alarm of alarms) {
      if (!alarm.enabled) continue;
      const lastOcc = lastAlarmOccurrenceTime(alarm, new Date(now));
      if (lastOcc == null) { diag.push(`${alarm.id}:noLastOcc`); continue; }
      const sinceMin = Math.round((now - lastOcc) / 60000);
      if (now - lastOcc > ACTIVE_WINDOW_MS) { diag.push(`${alarm.id}:window(${sinceMin}m>60m)`); continue; } // 활성 윈도우 밖
      const handledAt = await getHandledFireAt(alarm.id);
      if (handledAt != null && handledAt >= lastOcc) { diag.push(`${alarm.id}:handled`); continue; } // 이미 처리됨
      // 세션의 currentAlarmId = chain0(.relative) 우선. 메타 없으면 해당 알람 skip (= 발화 알람 식별 불가).
      const chain0 = allMeta.find(
        m => m.type === 'alarm_main' && m.entityId === alarm.id && (m.chainIndex ?? 0) === 0 && m.deleted !== true,
      );
      if (!chain0) { diag.push(`${alarm.id}:noChain0`); continue; }
      target = { entityId: alarm.id, fireAlarmId: chain0.alarmId };
      break;
    }
    if (!target) {
      // 검증용 — fallback이 루틴을 못 시작시킨 경우 원인 진단(윈도우 밖/이미 처리/chain0 없음 등).
      Logger.warn('NAV-DBG-COLD', `lockedColdStartGap(recentFire) no-target enabledCnt=${alarms.filter(a => a.enabled).length} reasons=[${diag.join(',')}]`);
      return;
    }
    const { entityId, fireAlarmId } = target;
    Logger.warn('NAV-DBG-COLD', `lockedColdStartGap(recentFire) detected entityId=${entityId} fireAlarmId=${fireAlarmId} → onAlarmFire+navigate Alarm`);
    // 라이브 케이스에서 onAlarmStateChange listener 가 하던 세션 생성을 직접 수행 (gap 엔 alerting 이벤트 X).
    //   AlarmScreen goHome(dismiss) 의 routine 시작은 currentSession 존재가 전제(R-7 가드)이므로 필수.
    await onAlarmFire({ alarmId: fireAlarmId, entityId, alarmType: 'main' }).catch(() => ({ ghost: false }));
    await recordAlarmSession().catch(() => {});
    await disableOnceAlarmIfNeeded(entityId).catch(() => {});
    navigationRef.current?.navigate('Alarm', {
      endMethod: getCachedDismissMethod() ?? DEFAULT_SETTINGS.dismissMethod,
      alarmEntityId: entityId,
    });
  }, []);

  // v1.6 T1 / v1.8 FIX-④ — alerting 알람 조회 + navigate.
  //   호출 시점:
  //     (1) 콜드 스타트 1.5초 뒤 (= 앱 kill 후 알람 발화 case)
  //     (2) AppState 'background → active' 전환 시 (= 백그라운드 발화 → 배너 탭으로 진입 case)
  //   직전 (1)만 있어서 — 백그라운드 알람 발화 후 배너 탭으로 active 진입 시 다음 체인 멤버(최대 2분)
  //   까지 AlarmScreen 미마운트. 이때 onAlarmStateChange listener 는 'background return' 가드로 skip.
  //   #LockedColdStartGap (2026-06-05) — alerting 없을 때 runLockedColdStartGapFallback 로 gap 보완.
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
      if (!alerting) {
        // #LockedColdStartGap (2026-06-05) — 잠금 중 루틴알람 발화 → 잠금해제 cold-start 가
        //   안전체인(2분 간격) 멤버 사이 "gap"에 떨어지면 현재 alerting 알람이 없어 진입 못 하던 회귀.
        //   (앱이 잠금 중 죽어 발화 listener 미실행 → 세션 X → 루틴 미시작. 다음 안전멤버 발화까지 최대 2분 공백.)
        //   메타로 "발화 사이클 진행 중 + 미해제" 를 추론해, 라이브 alerting alarm_main 케이스와
        //   동일하게 onAlarmFire(세션 생성) + navigate('Alarm') → 미션 → 루틴 시작.
        //   부활방지 가드: 해제 시 cancelSafetyChainPreservingDaily 가 안전체인(chainIndex≥1) metadata
        //     를 삭제/deleted=true → near-future 안전멤버 없음 → 미진입. (내일치 안전체인은 fireAt≈23h → 제외.)
        //   ⚠️ 공통 JS — Android 는 체인 구현이 달라 동일 보장 X (Android창 별도 검증). iOS 표준 경로.
        await runLockedColdStartGapFallback();
        return;
      }
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
        // #LastStepMissionPop fix (2026-06-09) — cold-start race 가드.
        //   위 await onAlarmFire 는 이전 confirm_prompt 알람 cancel(AlarmKit, ~3초 지연) 포함 → 그 사이
        //   onAlarmStateChange/LA signal 경로가 AlarmScreen(미션, 특히 last_step camera)을 mount 함.
        //   667 가드는 await 전 1회 체크라 그땐 아직 Alarm route 아님 → 통과 → 아래 navigate/reset 이
        //   뒤늦게 그 미션 화면을 stack 에서 pop(밀어냄) → "마지막 단계 미션 갑자기 종료" 회귀.
        //   정정: navigate 직전(await 후) route 재확인 — Alarm/RoutineAlarm 떠 있으면 navigate-away 금지.
        const routeAfterFire = navigationRef.current?.getCurrentRoute()?.name;
        if (routeAfterFire === 'Alarm' || routeAfterFire === 'RoutineAlarm') {
          Logger.warn('NAV-DBG-COLD', `LastStepMissionPop 가드 발동(alertingCheck) — route=${routeAfterFire} 미션화면 유지, navigate-away skip`);
          return;
        }
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
      Logger.warn('LAControl', `signal: ${signal.action} ${signal.routineId} AppState: ${AppState.currentState}`);
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
        // #LastStepMissionPop fix (2026-06-09) — RoutineAlarm(미션 화면)도 가드에 포함 → 미션 중 pop 방지.
        if (route !== 'Alarm' && route !== 'RoutineAlarm' && (route as string) !== 'AlarmTab') {
          (navigationRef.current as any).navigate('Home', { screen: 'AlarmTab' });
        }
      } else if (payload.target === 'RoutineTab') {
        const route = navigationRef.current?.getCurrentRoute()?.name;
        if (route !== 'Alarm' && route !== 'RoutineAlarm' && (route as string) !== 'RoutineTab') {
          Logger.warn('NAV-DBG', `SESSION_EVENT_NAVIGATE RoutineTab route=${route}`);
          (navigationRef.current as any).navigate('Home', { screen: 'RoutineTab' });
        }
      } else if (payload.target === 'Home') {
        navigationRef.current?.reset({ index: 0, routes: [{ name: 'Home' }] });
      }
    });
    return () => sub.remove();
  }, []);

  // #BackupRestore — 앱이 백그라운드로 갈 때 백업 미러 (설정·카테고리 등 모든 변경 catch-all).
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'background' || s === 'inactive') {
        mirrorToBackup().catch(() => {});
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
        // 삭제 후 재설치 복원 (#BackupRestore) — 알람 sync 전에 실행해야 복원된 알람이 재예약됨.
        //   프레시 설치 + Keychain 백업 있으면 알람·온보딩 복원. 정상 사용 중엔 no-op.
        await restoreIfNeeded().catch(() => false);
        // v1.8 #SoundRenameMigration — 사운드 리네임 회귀 1회성 정정. syncAllAlarms 앞에서 실행
        //   → 옛 체인 재등록 후 syncAllAlarms 가 fresh 체인을 live 로 인식해 skip.
        await migrateSoundRename();
        // v2.0 #ChainFixedSafetyMigration (2026-05-28) — 옛 .relative(daily) 체인 → .fixed 체인 1회성 정정. iOS 전용.
        //   업데이트 후 첫 부팅 시 = 옛 체인 wipe + 새 chainMemberRecurrence 측 재등록.
        //   baseFireAt = next future occurrence → 유령 발화 ❌ + listener metadata cleanup 정합.
        await migrateChainFixedSafety();
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
          // #LastStepMissionPop fix (2026-06-09) — 위 981 가드는 async restoreRoutineState 전 1회 체크라,
          //   그 사이 AlarmScreen(미션, last_step 등)이 mount되면 아래 navigateTarget/resetTarget 가
          //   그 미션 화면을 stack 에서 pop 함. navigate 직전 route 재확인으로 방지.
          const routeNow = navigationRef.current?.getCurrentRoute()?.name;
          if (routeNow === 'Alarm' || routeNow === 'RoutineAlarm') {
            Logger.warn('NAV-DBG-COLD', `LastStepMissionPop 가드 발동(restoreRoutineState) — route=${routeNow} 미션화면 유지, navigate-away skip`);
            return;
          }
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
  // #BackupRestore 타이밍 수정 — 앱 트리(ThemeProvider/SplashScreen) 렌더 전에 복원을 완료.
  //   사유: ThemeProvider(다크모드·primary color)와 SplashScreen(온보딩 분기)이 mount 시 AsyncStorage 를 읽음.
  //         복원이 그 뒤에 끝나면 = 재설치 시 온보딩 재노출 + 설정 기본값으로 회귀(= 레이스).
  //         → 렌더 전에 restoreIfNeeded 를 await 해서 복원된 값으로 초기화되게 게이팅.
  //   정상 실행(온보딩 완료 상태): onboardingCompleted!=null → restoreIfNeeded 즉시 no-op(지연 없음).
  //   guard(restoreAttempted) 가 있어 부트스트랩의 restoreIfNeeded 와 중복 호출돼도 1회만 수행됨.
  const [restoreReady, setRestoreReady] = useState(false);
  useEffect(() => {
    restoreIfNeeded().catch(() => false).finally(() => setRestoreReady(true));
  }, []);

  // 복원 완료 전 — 네이티브 스플래시(흰 배경) 유지로 깜빡임 방지.
  if (!restoreReady) {
    return <View style={{ flex: 1, backgroundColor: '#FFFFFF' }} />;
  }

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
