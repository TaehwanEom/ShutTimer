import './src/i18n';
import * as ExpoSplashScreen from 'expo-splash-screen';
import React, { useRef, useEffect } from 'react';
import { NavigationContainer, NavigationContainerRef } from '@react-navigation/native';

ExpoSplashScreen.preventAutoHideAsync();
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import * as Notifications from 'expo-notifications';
import { StatusBar } from 'expo-status-bar';
import HomeScreen from './src/screens/HomeScreen';
import RunningScreen from './src/screens/RunningScreen';
import AlarmScreen from './src/screens/AlarmScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import EditMissionsScreen from './src/screens/EditMissionsScreen';
import AddTimerScreen from './src/screens/AddTimerScreen';
import PresentationScreen from './src/screens/PresentationScreen';
import PresentationRunningScreen from './src/screens/PresentationRunningScreen';
import PresentationFullScreen from './src/screens/PresentationFullScreen';
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
  Presentation: undefined;
  PresentationRunning: { minutes: number; seconds: number; recordingEnabled: boolean };
  PresentationFull: { minutes: number; seconds: number; remainingSeconds: number; isRunning: boolean; recordingEnabled: boolean };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

function AppNavigator() {
  const { isDark } = useTheme();
  const navigationRef = useRef<NavigationContainerRef<RootStackParamList>>(null);

  // 포어그라운드/백그라운드에서 알림 탭 시 AlarmScreen 이동
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
        <Stack.Screen name="Presentation" component={PresentationScreen} options={{ contentStyle: { backgroundColor: '#000' } }} />
        <Stack.Screen name="PresentationRunning" component={PresentationRunningScreen} options={{ gestureEnabled: false, contentStyle: { backgroundColor: '#000' } }} />
        <Stack.Screen name="PresentationFull" component={PresentationFullScreen} options={{ gestureEnabled: false, contentStyle: { backgroundColor: '#000' } }} />
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
