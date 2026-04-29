import './src/i18n';
import * as ExpoSplashScreen from 'expo-splash-screen';
import React, { useRef, useEffect } from 'react';
import { AppState, Platform, DeviceEventEmitter } from 'react-native';
import Constants from 'expo-constants';
import { NavigationContainer, NavigationContainerRef } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

ExpoSplashScreen.preventAutoHideAsync();
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import * as Notifications from 'expo-notifications';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SETTINGS_KEY } from './src/constants/settings';
import { MISSIONS_STORAGE_KEY } from './src/constants/missions';
import { preloadDismissMethod } from './src/utils/settingsCache';
import { Logger } from './src/utils/logger';
import ErrorBoundary from './src/components/ErrorBoundary';

Notifications.setNotificationHandler({
  handleNotification: async () => {
    const appState = AppState.currentState;
    let phase = 'init';
    let alarmEnabledRaw: string | null = null;
    let isAlarmActive: string | null = null;
    let isTimerActive: string | null = null;
    let isRoutineActive: string | null = null;

    Logger.info('NotifHandler', `ENTER appState=${appState}`);

    try {
      phase = 'reading_storage';
      [alarmEnabledRaw, isAlarmActive, isTimerActive, isRoutineActive] = await Promise.all([
        AsyncStorage.getItem(SETTINGS_KEY.ALARM_ENABLED),
        AsyncStorage.getItem('isAlarmActive'),
        AsyncStorage.getItem('isTimerActive'),
        AsyncStorage.getItem('isRoutineActive'),
      ]);
      phase = 'computing';

      const alarmEnabled = alarmEnabledRaw !== 'false';
      // v1.6: 루틴 실행 중 포그라운드 상태면 다른 루틴/타이머 알림 suppress (중복 발화 방지)
      const suppress = (isAlarmActive === 'true' || isTimerActive === 'true' || isRoutineActive === 'true') && appState === 'active';

      const result = suppress || !alarmEnabled
        ? { shouldPlaySound: false, shouldShowBanner: false, shouldShowList: false, shouldSetBadge: false }
        : { shouldPlaySound: true, shouldShowBanner: true, shouldShowList: true, shouldSetBadge: true };

      Logger.info(
        'NotifHandler',
        `OK raw=${alarmEnabledRaw} alarm=${isAlarmActive} timer=${isTimerActive} routine=${isRoutineActive} suppress=${suppress} enabled=${alarmEnabled} → sound=${result.shouldPlaySound}`
      );
      return result;
    } catch (e) {
      Logger.error('NotifHandler', `THROW phase=${phase} appState=${appState} err=${e instanceof Error ? e.message : String(e)}`);
      return {
        shouldPlaySound: true,
        shouldShowBanner: true,
        shouldShowList: true,
        shouldSetBadge: true,
      };
    }
  },
});
import { StatusBar } from 'expo-status-bar';
import HomeScreen from './src/screens/HomeScreen';
import RunningScreen from './src/screens/RunningScreen';
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
import RoutineSoundScreen from './src/screens/RoutineSoundScreen';
import { syncRollingSchedule } from './src/utils/routineScheduler';
import { restoreRoutineState, pauseRoutineFromLA, resumeRoutineFromLA, stopRoutine, advanceRoutineFromLA, setLiveActivityStage, syncRoutineFromSnapshot } from './src/utils/routineController';
import { readControlSignal, clearControlSignal } from './src/utils/appGroupSync';
import { loadRoutines } from './src/constants/routines';
import AlarmkitBridge from './modules/alarmkit-bridge';
import { loadAlarmMetadata, deleteAlarmMetadata } from './src/utils/alarmkitMappingTable';
// @v1.5-poc — 영구 내부 검증 도구. __DEV__ 조건부 require로 production 번들에서 완전 제외. dev client는 자동 require로 그대로 작동. 삭제 금지.
const PoCPhotoValidationScreen = __DEV__
  ? require('./src/screens/PoCPhotoValidationScreen').default
  : null;
import { Mission } from './src/constants/missions';
import { ThemeProvider, useTheme } from './src/context/ThemeContext';
// @preserve IAP — Phase 2+ 복원용. 삭제 금지. (TS6133 회피 위해 import 라인 주석)
// import { PurchaseProvider } from './src/context/PurchaseContext';
import ForceUpdate from './src/components/ForceUpdate';

const isExpoGo = (Constants as any).appOwnership === 'expo';

export type RootStackParamList = {
  Splash: undefined;
  Onboarding: undefined;
  Home: undefined;
  Running: { mission: Mission | null; minutes: number };
  Alarm: { missionId?: string; missionIcon?: string } | undefined;
  Settings: undefined;
  EditMissions: undefined;
  AddTimer: { editId?: string; editIcon?: string; editMinutes?: number; dialType?: string } | undefined;
  History: undefined;
  Notice: undefined;
  MissionSelect: undefined;
  // @v1.6 루틴 기능
  RoutineList: { initialTab?: 'scheduled' | 'manual' } | undefined;
  RoutineEdit: {
    routineId?: string;
    /** 신규 생성 시 모드 — 미지정 시 'scheduled' default. 편집 모드면 무시 (기존 routine 의 schedule 유무 유지) */
    mode?: 'scheduled' | 'manual';
    // Phase 4: 하위 화면에서 merge:true 로 반환되는 값들 (useEffect로 소비 후 undefined 세팅)
    selectedCategory?: string;
    selectedDays?: number[];
    selectedSound?: string;
  } | undefined;
  RoutineAlarm: { routineId: string };
  RoutineCategory: { current?: string } | undefined;
  RoutineDays: { current?: number[] } | undefined;
  RoutineSound: { current?: string } | undefined;
  // @v1.5-poc — 영구 유지. __DEV__ 가드로 production 빌드 런타임에서 접근 차단.
  PoCPhotoValidation: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

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

  // 알림 도착 시 자동으로 AlarmScreen 이동 (탭 안 해도) + 이중 가드 (시나리오 A 방어)
  useEffect(() => {
    const subscription = Notifications.addNotificationReceivedListener(async (notification) => {
      // v1.6 Phase 12 — expo-notifications 폴백 경로의 routine_confirm_prompt fire 시 LA stage 자동 전환
      const data = notification?.request?.content?.data as any;
      if (data?.type === 'routine_confirm_prompt') {
        await setLiveActivityStage('manual_prompt').catch(() => {});
      }
      if (!navigationRef.current?.isReady()) return;
      const route = navigationRef.current?.getCurrentRoute()?.name;
      if (route === 'Alarm') return;
      const isAlarmActive = await AsyncStorage.getItem('isAlarmActive');
      if (isAlarmActive === 'true') return;
      // routine 진행 중이면 단일 timer 알람 fallback 차단
      const isRoutineActive = await AsyncStorage.getItem('isRoutineActive');
      if (isRoutineActive === 'true') return;
      navigationRef.current?.navigate('Alarm');
    });
    return () => subscription.remove();
  }, []);

  // 알림 탭 시 적절한 화면으로 이동
  // v1.6: 루틴 알림 분기 — data.type으로 routine_prealert / routine_chain / (기본: Alarm) 구분
  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener(async (response) => {
      if (!navigationRef.current?.isReady()) return;
      const data = (response?.notification?.request?.content?.data ?? {}) as any;
      const currentRoute = navigationRef.current?.getCurrentRoute()?.name;

      if (data?.type === 'routine_prealert' && typeof data?.routineId === 'string') {
        if (currentRoute === 'RoutineList' || currentRoute === 'RoutineAlarm') return;
        navigationRef.current?.navigate('RoutineList');
        return;
      }
      if (data?.type === 'routine_chain' && typeof data?.routineId === 'string') {
        // 자동 진행 체인 — RoutineList 의 inline 진행이 active routine sync 로 자동 마운트
        if (currentRoute === 'RoutineList') return;
        navigationRef.current?.navigate('RoutineList');
        return;
      }
      if (data?.type === 'routine_confirm_prompt' && typeof data?.routineId === 'string') {
        // v1.6 Phase 12 — 알림 탭 경로의 routine_confirm_prompt 도 LA stage 자동 전환
        await setLiveActivityStage('manual_prompt').catch(() => {});
        // v1.6: 확인 후 진행 모드 배경 알림 — endMethod 별 분기.
        // tap/shake → RoutineList (active routine sync → ActiveRoutineSection 마운트 → awaitingConfirm 분기에서 Modal alarm 표시).
        // camera → RoutineAlarm (scan UI).
        if (currentRoute === 'RoutineAlarm' || currentRoute === 'RoutineList') return;
        const routines = await loadRoutines();
        const r = routines.find(x => x.id === data.routineId);
        if (!r) {
          navigationRef.current?.reset({ index: 1, routes: [{ name: 'Home' }, { name: 'RoutineList' }] });
          return;
        }
        if (!navigationRef.current?.isReady()) return;
        if (r.endMethod === 'camera') {
          navigationRef.current.navigate('RoutineAlarm', { routineId: data.routineId });
        } else {
          navigationRef.current.navigate('RoutineList');
        }
        return;
      }

      // 기본 알람 경로 — routine 진행 중이면 차단
      if (currentRoute === 'Alarm') return;
      const isAlarmActive = await AsyncStorage.getItem('isAlarmActive');
      if (isAlarmActive === 'true') return;
      const isRoutineActive = await AsyncStorage.getItem('isRoutineActive');
      if (isRoutineActive === 'true') return;
      navigationRef.current?.navigate('Alarm');
    });
    return () => subscription.remove();
  }, []);

  // 콜드 스타트: 알림 탭으로 앱 진입 시 적절한 화면 이동
  useEffect(() => {
    Notifications.getLastNotificationResponseAsync()
      .then(async (response) => {
        if (!response) return;
        const data = (response?.notification?.request?.content?.data ?? {}) as any;
        if (data?.type === 'routine_prealert') {
          navigationRef.current?.navigate('RoutineList');
          return;
        }
        if (data?.type === 'routine_chain' && typeof data?.routineId === 'string') {
          navigationRef.current?.navigate('RoutineList');
          return;
        }
        if (data?.type === 'routine_confirm_prompt' && typeof data?.routineId === 'string') {
          // v1.6 Phase 12 — cold-start 알림 탭 경로도 LA stage 자동 전환
          await setLiveActivityStage('manual_prompt').catch(() => {});
          // endMethod 별 분기. tap/shake → RoutineList (inline). camera → RoutineAlarm.
          const routines = await loadRoutines();
          const r = routines.find(x => x.id === data.routineId);
          if (!r) {
            navigationRef.current?.reset({ index: 1, routes: [{ name: 'Home' }, { name: 'RoutineList' }] });
            return;
          }
          if (!navigationRef.current?.isReady()) return;
          if (r.endMethod === 'camera') {
            navigationRef.current.navigate('RoutineAlarm', { routineId: data.routineId });
          } else {
            navigationRef.current.navigate('RoutineList');
          }
          return;
        }
        // 기본 알람 경로 — routine 진행 중이면 차단
        const isRoutineActive = await AsyncStorage.getItem('isRoutineActive');
        if (isRoutineActive === 'true') return;
        navigationRef.current?.navigate('Alarm');
      })
      .catch(e => {
        Logger.warn('AppNavigator', `Failed to get last notification response: ${e}`);
      });
  }, []);

  // v1.6 T1 — AlarmKit 알람 발화 listener (chain / confirm_prompt). prealert 는 mapping table 미저장 → 무시.
  useEffect(() => {
    const sub = AlarmkitBridge.addListener('onAlarmStateChange', async (event) => {
      console.warn('[onAlarmStateChange]', event.alarmId, event.state, 'AppState:', AppState.currentState);
      if (event.state !== 'alerting') return;
      const meta = await loadAlarmMetadata(event.alarmId);
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
        navigationRef.current?.navigate('Alarm');
        return;
      }

      if (meta.type === 'confirm_prompt') {
        // v1.6 Phase 12 — alerting 시 LA stage='manual_prompt' 자동 전환 (위젯 "다음 진행" Button 노출)
        Logger.warn('onAlarmStateChange', `confirm_prompt route=${currentRoute} routineId=${meta.routineId}`);
        await setLiveActivityStage('manual_prompt').catch(() => {});
        if (currentRoute === 'RoutineAlarm' || currentRoute === 'RoutineList') return;
        const routines = await loadRoutines();
        const r = routines.find(x => x.id === meta.routineId);
        if (!r) {
          navigationRef.current?.reset({ index: 1, routes: [{ name: 'Home' }, { name: 'RoutineList' }] });
          return;
        }
        if (!navigationRef.current?.isReady()) return;
        if (r.endMethod === 'camera') {
          navigationRef.current.navigate('RoutineAlarm', { routineId: meta.routineId });
        } else {
          navigationRef.current.navigate('RoutineList');
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
        if (currentRoute === 'RoutineList' || currentRoute === 'RoutineAlarm') return;

        if (meta.type === 'chain') {
          // v1.6 Phase 12 — 'chain' 분기 제거 (옵션 A 폐기). cold-start 잔존 mapping silent cleanup.
          await deleteAlarmMetadata(alerting.id);
          return;
        }
        if (meta.type === 'timer_main') {
          // v1.6 Phase 9: cold-start 시 fire 된 timer_main 알람
          // v1.6 hotfix — deleteAlarmMetadata 호출 제거. AlarmScreen 가 cleanup 책임 통합.
          navigationRef.current?.navigate('Alarm');
          return;
        }
        if (meta.type === 'confirm_prompt') {
          // v1.6 Phase 12 — cold-start AlarmKit alerting 경로도 LA stage 자동 전환
          await setLiveActivityStage('manual_prompt').catch(() => {});
          const routines = await loadRoutines();
          const r = routines.find(x => x.id === meta.routineId);
          if (!r) {
            navigationRef.current?.reset({ index: 1, routes: [{ name: 'Home' }, { name: 'RoutineList' }] });
            return;
          }
          if (r.endMethod === 'camera') {
            navigationRef.current.navigate('RoutineAlarm', { routineId: meta.routineId });
          } else {
            navigationRef.current.navigate('RoutineList');
          }
        }
      } catch {}
    }, 1500);
    return () => clearTimeout(timer);
  }, []);

  // v1.6 Phase 10-D — LA control signal polling (App Group ↔ RN 동기화)
  // LiveActivityIntent.perform() 안에서 설정한 control signal 을 cold-start + AppState 'active' + 1초 polling 시 처리.
  // signal.routineId.startsWith('main_timer_') = timer 측 (DeviceEventEmitter emit) / 그 외 = routine 측 (controller 호출).
  // v1.6 hotfix — 1초 setInterval polling 추가. iPhone foreground active 유지 시 Watch / LA Button 신호 처리 누락 방지.
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
              if (route !== 'Alarm') navigationRef.current.navigate('Alarm');
            }
          } else {
            // timer 측 (pause/resume/stop) — HomeScreen listener 가 처리
            DeviceEventEmitter.emit('laControlTimer', signal);
          }
        } else {
          // routine 측 — pause/resume = LA Intent 가 이미 native 처리. RN 은 ar 동기화만.
          // 위험 #X 정정: signal.timestamp = LA Intent perform 시점 (실제 누름 시각). RN polling 시점 X.
          if (signal.action === 'pause') await pauseRoutineFromLA(signal.timestamp);
          else if (signal.action === 'resume') await resumeRoutineFromLA(signal.timestamp);
          else if (signal.action === 'stop') {
            await stopRoutine();
            // v1.6 Phase 12 — 위젯 ✕ stop 시 RoutineListScreen 의 activeManualRoutineId 정리 트리거.
            // (onClose 콜백은 JS 내부 stop 에서만 호출 → 외부 stop 경로 별도 emit 필요)
            DeviceEventEmitter.emit('routineClearedExternally', { routineId: signal.routineId });
          }
          // v1.6 hotfix — AdvanceNextStepIntent.perform() native 처리 완료 신호.
          // native 가 alarm stop + 다음 step schedule + snapshot 갱신 완료 → RN 은 ar/LA 동기화만.
          else if (signal.action === 'advance_done') await syncRoutineFromSnapshot(signal.routineId);
          // v1.6 Phase 12 — 위젯 "다음 진행" Button (AdvanceNextStepIntent) perform 후 routine advance
          // (native 처리 fallback 또는 iOS<26 경로).
          else if (signal.action === 'advance') await advanceRoutineFromLA(signal.routineId);
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
    // v1.6 hotfix — 1초 polling (foreground active 유지 시 Watch / LA Button 신호 즉시 반영).
    const poll = setInterval(handleControlSignal, 1000);
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
    // 콜드 스타트 복원 — 약간 지연 후 navigationRef 준비되면 분기
    const timer = setTimeout(() => {
      if (!navigationRef.current?.isReady()) return;
      // L331 getLastNotificationResponseAsync 핸들러가 이미 RoutineList/RoutineAlarm 로 navigate 했으면 skip
      // (알림 탭으로 앱 진입 시 양쪽 모두 fire → RoutineAlarm 2개 stack 되는 회귀 차단)
      const currentRoute = navigationRef.current.getCurrentRoute()?.name;
      if (currentRoute === 'RoutineList' || currentRoute === 'RoutineAlarm') return;
      restoreRoutineState()
        .then(async (res) => {
          if (!navigationRef.current?.isReady()) return;
          if (res.kind === 'run') {
            // RoutineList 의 inline ActiveRoutineSection 이 active routine sync 로 자동 마운트
            navigationRef.current.navigate('RoutineList');
          } else if (res.kind === 'alarm') {
            // 'alarm' kind 는 controller 의 advance_confirm 매핑 — endMethod 별 분기.
            // tap/shake → RoutineList (inline ActiveRoutineSection 의 awaitingConfirm 분기에서 Modal alarm 표시).
            // camera → RoutineAlarm (scan UI).
            const routines = await loadRoutines();
            const r = routines.find(x => x.id === res.routineId);
            if (!r) {
              navigationRef.current?.reset({ index: 1, routes: [{ name: 'Home' }, { name: 'RoutineList' }] });
              return;
            }
            if (!navigationRef.current?.isReady()) return;
            if (r.endMethod === 'camera') {
              navigationRef.current.navigate('RoutineAlarm', { routineId: res.routineId });
            } else {
              navigationRef.current.navigate('RoutineList');
            }
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
        screenOptions={{ headerShown: false }}
      >
        <Stack.Screen name="Splash" component={SplashScreen} />
        <Stack.Screen name="Onboarding" component={OnboardingScreen} options={{ gestureEnabled: false }} />
        <Stack.Screen name="Home" component={HomeScreen} />
        <Stack.Screen name="Running" component={RunningScreen} options={{ gestureEnabled: false }} />
        <Stack.Screen name="Alarm" component={AlarmScreen} options={{ gestureEnabled: false }} />
        <Stack.Screen name="Settings" component={SettingsScreen} />
        <Stack.Screen name="EditMissions" component={EditMissionsScreen} />
        <Stack.Screen name="AddTimer" component={AddTimerScreen} />
        <Stack.Screen name="History" component={HistoryScreen} />
        <Stack.Screen name="Notice" component={NoticeScreen} />
        <Stack.Screen name="MissionSelect" component={MissionSelectScreen} />
        <Stack.Screen name="RoutineList" component={RoutineListScreen} />
        <Stack.Screen name="RoutineEdit" component={RoutineEditScreen} />
        <Stack.Screen name="RoutineAlarm" component={RoutineAlarmScreen} options={{ gestureEnabled: false }} />
        <Stack.Screen name="RoutineCategory" component={RoutineCategoryScreen} />
        <Stack.Screen name="RoutineDays" component={RoutineDaysScreen} />
        <Stack.Screen name="RoutineSound" component={RoutineSoundScreen} />
        {/* @v1.5-poc — 영구 내부 검증 도구. __DEV__ 가드로 프로덕션 빌드에서 자동 제외. 삭제 금지. */}
        {__DEV__ && (
          <Stack.Screen name="PoCPhotoValidation" component={PoCPhotoValidationScreen} />
        )}
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
