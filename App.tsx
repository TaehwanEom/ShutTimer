import './src/i18n';
import * as ExpoSplashScreen from 'expo-splash-screen';
import React, { useRef, useEffect } from 'react';
import { NavigationContainer, NavigationContainerRef } from '@react-navigation/native';

ExpoSplashScreen.preventAutoHideAsync();
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import mobileAds, { MaxAdContentRating } from 'react-native-google-mobile-ads';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SETTINGS_KEY } from './src/constants/settings';

Notifications.setNotificationHandler({
  handleNotification: async () => {
    let shouldPlaySound = true;
    try {
      const raw = await AsyncStorage.getItem(SETTINGS_KEY.ALARM_ENABLED);
      shouldPlaySound = raw !== 'false';
    } catch {}
    return {
      shouldShowAlert: true,
      shouldPlaySound,
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true,
    };
  },
});

// Android 알림 채널 등록 (iOS는 무영향)
if (Platform.OS === 'android') {
  Notifications.setNotificationChannelAsync('alarm-sound', {
    name: '경보음 알람',
    importance: Notifications.AndroidImportance.HIGH,
    sound: 'notification_alarm.wav',
    vibrationPattern: [0, 500, 300, 500],
  }).catch(() => {});
  Notifications.setNotificationChannelAsync('alarm-ringtone', {
    name: '벨소리 알람',
    importance: Notifications.AndroidImportance.HIGH,
    sound: 'notification_ringtone.wav',
    vibrationPattern: [0, 500, 300, 500],
  }).catch(() => {});
  Notifications.setNotificationChannelAsync('alarm-silent', {
    name: '무음 알람',
    importance: Notifications.AndroidImportance.HIGH,
    sound: null,
    vibrationPattern: [0, 500, 300, 500],
  }).catch(() => {});
}
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
import { PurchaseProvider } from './src/context/PurchaseContext';
import ForceUpdate from './src/components/ForceUpdate';

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

  // AdMob SDK 초기화 (마운트 1회) + 테스트 디바이스 등록 (시뮬레이터)
  useEffect(() => {
    mobileAds()
      .setRequestConfiguration({
        maxAdContentRating: MaxAdContentRating.G,
        testDeviceIdentifiers: ['EMULATOR'],
      })
      .then(() => mobileAds().initialize())
      .then((adapterStatuses) => {
        if (__DEV__) console.log('AdMob initialized. Adapter statuses:', adapterStatuses);
      })
      .catch((e) => console.warn('AdMob init failed:', e));
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
    Notifications.getLastNotificationResponseAsync().then(response => {
      if (response) {
        navigationRef.current?.navigate('Alarm');
      }
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
    <ThemeProvider>
      <PurchaseProvider>
        <ForceUpdate />
        <AppNavigator />
      </PurchaseProvider>
    </ThemeProvider>
  );
}
