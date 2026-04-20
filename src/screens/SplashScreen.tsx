import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../App';
import * as ExpoSplashScreen from 'expo-splash-screen';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MISSIONS_STORAGE_KEY } from '../constants/missions';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Splash'>;
};

export default function SplashScreen({ navigation }: Props) {
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    ExpoSplashScreen.hideAsync();

    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 800,
      useNativeDriver: true,
    }).start();

    // 첫 실행 vs 기존 사용자 분기 → Onboarding or Home
    // 기준:
    //  - onboardingCompleted='true' → Home (이미 온보딩 완료)
    //  - attStatus 또는 missions 데이터 존재 → Home (v1.5 이전 기존 사용자, 권한 응답 이력 있음)
    //  - 둘 다 없음 → Onboarding (첫 설치)
    const timer = setTimeout(async () => {
      try {
        const [onboarded, attStatus, missions] = await Promise.all([
          AsyncStorage.getItem('onboardingCompleted'),
          AsyncStorage.getItem('attStatus'),
          AsyncStorage.getItem(MISSIONS_STORAGE_KEY),
        ]);
        const isExistingUser = onboarded === 'true' || attStatus !== null || missions !== null;
        navigation.replace(isExistingUser ? 'Home' : 'Onboarding');
      } catch {
        navigation.replace('Home');
      }
    }, 1500);

    return () => clearTimeout(timer);
  }, []);

  return (
    <View style={styles.container}>
      <Animated.View style={[styles.center, { opacity: fadeAnim }]}>
        <View style={styles.titleRow}>
          <MaterialIcons name="alarm" size={36} color="#dc3535" />
          <Text style={styles.title}>ShutTimer</Text>
        </View>
      </Animated.View>
      <Text style={styles.byline}>by TLabs.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: {
    alignItems: 'center',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  title: {
    fontSize: 32,
    fontWeight: '800',
    color: '#1a1c1f',
    letterSpacing: -1,
  },
  byline: {
    position: 'absolute',
    bottom: 48,
    fontSize: 13,
    fontWeight: '600',
    color: '#999999',
    letterSpacing: 0.5,
  },
});
