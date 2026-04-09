import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View,
  Text,
  StyleSheet,
  TouchableWithoutFeedback,
  StatusBar,
  Animated,
} from 'react-native';
import { Audio } from 'expo-av';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ScreenOrientation from 'expo-screen-orientation';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { RootStackParamList } from '../../App';
const NEON = '#39FF14';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'PresentationFull'>;
  route: RouteProp<RootStackParamList, 'PresentationFull'>;
};

type Record = {
  id: string;
  date: string;
  duration: number;
  filePath: string;
};

const RECORDS_KEY = 'shutimer_presentation_records';

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function PresentationFullScreen({ navigation, route }: Props) {
  const { minutes, seconds, remainingSeconds: initRemaining, isRunning: initRunning, recordingEnabled } = route.params;
  const totalSec = minutes * 60 + seconds;

  const [remainingSeconds, setRemainingSeconds] = useState(initRunning ? initRemaining : totalSec);
  const remainingRef = useRef(initRunning ? initRemaining : totalSec);
  const [isRunning, setIsRunning] = useState(initRunning);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingRef = useRef<Audio.Recording | null>(null);

  const flashAnim = useRef(new Animated.Value(0)).current;
  const flashLoopRef = useRef<Animated.CompositeAnimation | null>(null);

  // mount 시 orientation lock 해제 (PresentationScreen cleanup의 PORTRAIT_UP lock 덮어쓰기)
  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.DEFAULT);
  }, []);

  // 세로 전환 감지 → 돌아가기
  useEffect(() => {
    const sub = ScreenOrientation.addOrientationChangeListener((event) => {
      const o = event.orientationInfo.orientation;
      if (
        o === ScreenOrientation.Orientation.PORTRAIT_UP ||
        o === ScreenOrientation.Orientation.PORTRAIT_DOWN
      ) {
        navigation.goBack();
      }
    });
    return () => ScreenOrientation.removeOrientationChangeListener(sub);
  }, []);

  // 깜빡임
  const triggerFlash = useCallback((persistent: boolean) => {
    if (persistent) {
      if (flashLoopRef.current) return;
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(flashAnim, { toValue: 1, duration: 300, useNativeDriver: false }),
          Animated.timing(flashAnim, { toValue: 0, duration: 300, useNativeDriver: false }),
        ])
      );
      flashLoopRef.current = loop;
      loop.start();
    } else {
      Animated.sequence([
        Animated.timing(flashAnim, { toValue: 1, duration: 150, useNativeDriver: false }),
        Animated.timing(flashAnim, { toValue: 0, duration: 150, useNativeDriver: false }),
      ]).start();
    }
  }, [flashAnim]);

  const stopFlash = useCallback(() => {
    flashLoopRef.current?.stop();
    flashLoopRef.current = null;
    flashAnim.setValue(0);
  }, [flashAnim]);

  // 타이머 정지
  const stopTimer = useCallback(async () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setIsRunning(false);
    stopFlash();

    if (recordingRef.current) {
      try {
        await recordingRef.current.stopAndUnloadAsync();
        const uri = recordingRef.current.getURI();
        recordingRef.current = null;
        if (uri) {
          const elapsed = totalSec - remainingRef.current;
          const record: Record = {
            id: Date.now().toString(),
            date: new Date().toISOString(),
            duration: elapsed,
            filePath: uri,
          };
          const existing = await AsyncStorage.getItem(RECORDS_KEY);
          const list: Record[] = existing ? JSON.parse(existing) : [];
          list.unshift(record);
          await AsyncStorage.setItem(RECORDS_KEY, JSON.stringify(list));
        }
      } catch {}
    }
  }, [totalSec, stopFlash]);

  // 타이머 시작
  const startTimer = useCallback(async () => {
    if (totalSec === 0) return;
    setIsRunning(true);

    if (recordingEnabled) {
      try {
        await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
        const { recording } = await Audio.Recording.createAsync(
          Audio.RecordingOptionsPresets.HIGH_QUALITY
        );
        recordingRef.current = recording;
      } catch {}
    }

    intervalRef.current = setInterval(() => {
      remainingRef.current -= 1;
      const r = remainingRef.current;
      setRemainingSeconds(r);

      if (r === 5 * 60 || r === 3 * 60) triggerFlash(false);
      else if (r === 60) triggerFlash(true);

      if (r <= 0) stopTimer();
    }, 1000);
  }, [totalSec, recordingEnabled, triggerFlash, stopTimer]);

  // 이미 진행 중이면 interval 시작
  useEffect(() => {
    if (initRunning && remainingRef.current > 0) {
      setIsRunning(true);

      if (remainingRef.current <= 60) {
        triggerFlash(true);
      }

      intervalRef.current = setInterval(() => {
        remainingRef.current -= 1;
        const r = remainingRef.current;
        setRemainingSeconds(r);

        if (r === 5 * 60 || r === 3 * 60) triggerFlash(false);
        else if (r === 60) triggerFlash(true);

        if (r <= 0) stopTimer();
      }, 1000);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  // cleanup
  useEffect(() => {
    return () => {
      if (recordingRef.current) {
        recordingRef.current.stopAndUnloadAsync().catch(() => {});
      }
    };
  }, []);

  const handlePress = () => {
    if (isRunning) {
      stopTimer();
    } else {
      startTimer();
    }
  };

  const flashBg = flashAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['#000000', '#ff0000'],
  });

  return (
    <TouchableWithoutFeedback onPress={handlePress}>
      <Animated.View style={[styles.container, { backgroundColor: flashBg }]}>
        <StatusBar hidden />
        <Text style={[styles.time, isRunning && styles.timeRunning]}>
          {formatDuration(remainingSeconds)}
        </Text>
      </Animated.View>
    </TouchableWithoutFeedback>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000000',
  },
  time: {
    fontSize: 120,
    fontWeight: '800',
    color: NEON,
    letterSpacing: -4,
  },
  timeRunning: {
    color: NEON,
  },
});
