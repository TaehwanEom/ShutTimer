import './src/i18n';
import * as ExpoSplashScreen from 'expo-splash-screen';
import React, { useRef, useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import Constants from 'expo-constants';
import { NavigationContainer, NavigationContainerRef } from '@react-navigation/native';

ExpoSplashScreen.preventAutoHideAsync();
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SETTINGS_KEY } from './src/constants/settings';
import { Logger } from './src/utils/logger';
import ErrorBoundary from './src/components/ErrorBoundary';

Notifications.setNotificationHandler({
  handleNotification: async () => {
    const appState = AppState.currentState;
    let phase = 'init';
    let alarmEnabledRaw: string | null = null;
    let isAlarmActive: string | null = null;
    let isTimerActive: string | null = null;

    Logger.info('NotifHandler', `ENTER appState=${appState}`);

    try {
      phase = 'reading_storage';
      [alarmEnabledRaw, isAlarmActive, isTimerActive] = await Promise.all([
        AsyncStorage.getItem(SETTINGS_KEY.ALARM_ENABLED),
        AsyncStorage.getItem('isAlarmActive'),
        AsyncStorage.getItem('isTimerActive'),
      ]);
      phase = 'computing';

      const alarmEnabled = alarmEnabledRaw !== 'false';
      const suppress = (isAlarmActive === 'true' || isTimerActive === 'true') && appState === 'active';

      const result = suppress || !alarmEnabled
        ? { shouldPlaySound: false, shouldShowBanner: false, shouldShowList: false, shouldSetBadge: false }
        : { shouldPlaySound: true, shouldShowBanner: true, shouldShowList: true, shouldSetBadge: true };

      Logger.info(
        'NotifHandler',
        `OK raw=${alarmEnabledRaw} alarm=${isAlarmActive} timer=${isTimerActive} suppress=${suppress} enabled=${alarmEnabled} → sound=${result.shouldPlaySound}`
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
import AddTimerScreen from './src/screens/AddTimerScreen';
import SplashScreen from './src/screens/SplashScreen';
import HistoryScreen from './src/screens/HistoryScreen';
import NoticeScreen from './src/screens/NoticeScreen';
import { Mission } from './src/constants/missions';
import { ThemeProvider, useTheme } from './src/context/ThemeContext';
// @preserve IAP — Phase 2+ 복원용. 삭제 금지. (TS6133 회피 위해 import 라인 주석)
// import { PurchaseProvider } from './src/context/PurchaseContext';
import ForceUpdate from './src/components/ForceUpdate';

const isExpoGo = (Constants as any).appOwnership === 'expo';

export type RootStackParamList = {
  Splash: undefined;
  Home: undefined;
  Running: { mission: Mission | null; minutes: number };
  Alarm: { missionId?: string; missionIcon?: string } | undefined;
  Settings: undefined;
  EditMissions: undefined;
  AddTimer: { editId?: string; editIcon?: string; editMinutes?: number; dialType?: string } | undefined;
  History: undefined;
  Notice: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

function AppNavigator() {
  const { isDark } = useTheme();
  const navigationRef = useRef<NavigationContainerRef<RootStackParamList>>(null);

  // 앱 시작 시 stale 플래그 초기화 (killed 후 콜드 스타트 대비)
  useEffect(() => {
    AsyncStorage.removeItem('isTimerActive').catch(() => {});
    AsyncStorage.removeItem('isAlarmActive').catch(() => {});
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

  // 알림 도착 시 자동으로 AlarmScreen 이동 (탭 안 해도)
  useEffect(() => {
    const subscription = Notifications.addNotificationReceivedListener(() => {
      navigationRef.current?.navigate('Alarm');
    });
    return () => subscription.remove();
  }, []);

  // 알림 탭 시 AlarmScreen 이동
  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener(() => {
      navigationRef.current?.navigate('Alarm');
    });
    return () => subscription.remove();
  }, []);

  // 콜드 스타트: 알림 탭으로 앱 진입 시 AlarmScreen 이동
  useEffect(() => {
    Notifications.getLastNotificationResponseAsync()
      .then(response => {
        if (response) {
          navigationRef.current?.navigate('Alarm');
        }
      })
      .catch(e => {
        Logger.warn('AppNavigator', `Failed to get last notification response: ${e}`);
      });
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
        <Stack.Screen name="Home" component={HomeScreen} />
        <Stack.Screen name="Running" component={RunningScreen} options={{ gestureEnabled: false }} />
        <Stack.Screen name="Alarm" component={AlarmScreen} options={{ gestureEnabled: false }} />
        <Stack.Screen name="Settings" component={SettingsScreen} />
        <Stack.Screen name="EditMissions" component={EditMissionsScreen} />
        <Stack.Screen name="AddTimer" component={AddTimerScreen} />
        <Stack.Screen name="History" component={HistoryScreen} />
        <Stack.Screen name="Notice" component={NoticeScreen} />
      </Stack.Navigator>
    </NavigationContainer>
    </>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
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
      </ThemeProvider>
    </ErrorBoundary>
  );
}
