import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TouchableWithoutFeedback,
  SafeAreaView,
  StatusBar,
  Animated,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { useFocusEffect } from '@react-navigation/native';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';
// TODO: EAS Build 후 활성화
// import { initWhisper } from 'whisper.rn';
const initWhisper: any = null;
import * as ScreenOrientation from 'expo-screen-orientation';
import { RootStackParamList } from '../../App';
import { useTranslation } from 'react-i18next';

const NEON = '#39FF14';
const RECORDS_KEY = 'shutimer_presentation_records';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'PresentationRunning'>;
  route: RouteProp<RootStackParamList, 'PresentationRunning'>;
};

type Record = { id: string; date: string; duration: number; filePath: string; transcript?: string; title?: string };

function formatDuration(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function PresentationRunningScreen({ navigation, route }: Props) {
  const { t } = useTranslation();
  const { minutes, seconds, recordingEnabled } = route.params;
  const totalSec = minutes * 60 + seconds;

  const [remainingSeconds, setRemainingSeconds] = useState(totalSec);
  const remainingRef = useRef(totalSec);
  const [isPaused, setIsPaused] = useState(false);
  const isPausedRef = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const [isLandscape, setIsLandscape] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const fadeAnim = useRef(new Animated.Value(1)).current;

  const flashAnim = useRef(new Animated.Value(0)).current;
  const flashLoopRef = useRef<Animated.CompositeAnimation | null>(null);
  const [flashColor, setFlashColor] = useState('#ff0000');

  // 모든 방향 허용
  useFocusEffect(
    useCallback(() => {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.DEFAULT);
    }, [])
  );

  // orientation 감지
  useEffect(() => {
    ScreenOrientation.getOrientationAsync().then((o) => {
      setIsLandscape(
        o === ScreenOrientation.Orientation.LANDSCAPE_LEFT ||
        o === ScreenOrientation.Orientation.LANDSCAPE_RIGHT
      );
    });

    const sub = ScreenOrientation.addOrientationChangeListener((event) => {
      const o = event.orientationInfo.orientation;
      const land = o === ScreenOrientation.Orientation.LANDSCAPE_LEFT ||
        o === ScreenOrientation.Orientation.LANDSCAPE_RIGHT;
      // 블랙아웃 → 전환 → 페이드인
      Animated.timing(fadeAnim, { toValue: 0, duration: 150, useNativeDriver: true }).start(() => {
        setIsLandscape(land);
        Animated.timing(fadeAnim, { toValue: 1, duration: 300, useNativeDriver: true }).start();
      });
    });
    return () => ScreenOrientation.removeOrientationChangeListener(sub);
  }, []);

  // 깜빡임
  const triggerFlash = useCallback((persistent: boolean, color: string) => {
    setFlashColor(color);
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
      const blink = Animated.sequence([
        Animated.timing(flashAnim, { toValue: 1, duration: 200, useNativeDriver: false }),
        Animated.timing(flashAnim, { toValue: 0, duration: 200, useNativeDriver: false }),
      ]);
      Animated.loop(blink, { iterations: 6 }).start();
    }
  }, [flashAnim]);

  const stopFlash = useCallback(() => {
    flashLoopRef.current?.stop();
    flashLoopRef.current = null;
    flashAnim.setValue(0);
  }, [flashAnim]);

  // 녹음 시작
  useEffect(() => {
    if (recordingEnabled) {
      (async () => {
        try {
          const { granted } = await Audio.requestPermissionsAsync();
          if (!granted) return;
          await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
          const { recording } = await Audio.Recording.createAsync(
            Audio.RecordingOptionsPresets.HIGH_QUALITY
          );
          recordingRef.current = recording;
        } catch {}
      })();
    }
    return () => {
      if (recordingRef.current) {
        recordingRef.current.stopAndUnloadAsync().catch(() => {});
      }
    };
  }, []);

  // 타이머 interval
  useEffect(() => {
    if (isPaused) return;

    // 시작/재개 시 현재 남은 시간에 맞는 깜빡임 즉시 적용
    const cur = remainingRef.current;
    if (cur <= 60) triggerFlash(true, '#ff0000');
    else if (cur <= 3 * 60) triggerFlash(false, '#ffcc00');
    else if (cur <= 5 * 60) triggerFlash(false, '#00cc66');

    intervalRef.current = setInterval(() => {
      remainingRef.current -= 1;
      const r = remainingRef.current;
      setRemainingSeconds(r);

      if (r === 5 * 60) triggerFlash(false, '#00cc66');
      else if (r === 3 * 60) triggerFlash(false, '#ffcc00');
      else if (r === 60) triggerFlash(true, '#ff0000');

      if (r <= 0) {
        clearInterval(intervalRef.current!);
        intervalRef.current = null;
        stopFlash();
      }
    }, 1000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isPaused]);

  const saveRecordAndGoBack = async () => {
    if (recordingRef.current) {
      try {
        await recordingRef.current.stopAndUnloadAsync();
        const uri = recordingRef.current.getURI();
        recordingRef.current = null;
        if (uri) {
          const elapsed = totalSec - remainingRef.current;

          // STT 변환
          let transcript = '';
          if (!initWhisper) {
            // whisper.rn 미설치 (Expo Go) → STT 스킵
          } else try {
            setIsTranscribing(true);
            const modelPath = (FileSystem.documentDirectory ?? '') + 'ggml-base.bin';
            const modelInfo = await FileSystem.getInfoAsync(modelPath);
            if (!modelInfo.exists) {
              const downloadResult = await FileSystem.downloadAsync(
                'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin?download=true',
                modelPath,
                { headers: { 'Accept': 'application/octet-stream' } }
              );
              if (downloadResult.status !== 200) {
                // 다운로드 실패 시 불완전 파일 제거
                await FileSystem.deleteAsync(modelPath, { idempotent: true });
                throw new Error(`Model download failed: ${downloadResult.status}`);
              }
            }
            const ctx = await initWhisper({ filePath: modelPath });
            const { result } = await ctx.transcribe(uri, { language: 'ko' });
            transcript = result.trim();
            await ctx.release();
          } catch (e) {
            console.warn('STT error:', e);
            transcript = '';
          } finally {
            setIsTranscribing(false);
          }

          const record: Record = {
            id: Date.now().toString(),
            date: new Date().toISOString(),
            duration: elapsed,
            filePath: uri,
            transcript,
          };
          const existing = await AsyncStorage.getItem(RECORDS_KEY);
          const list: Record[] = existing ? JSON.parse(existing) : [];
          list.unshift(record);
          await AsyncStorage.setItem(RECORDS_KEY, JSON.stringify(list));
        }
      } catch {}
    }
    await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
    navigation.goBack();
  };

  const handleStop = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    stopFlash();
    saveRecordAndGoBack();
  };

  const handlePauseResume = () => {
    if (remainingRef.current <= 0) {
      handleStop();
      return;
    }
    const next = !isPausedRef.current;
    isPausedRef.current = next;
    setIsPaused(next);
  };

  const flashBg = flashAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['#000000', flashColor],
  });

  // 가로 모드: 전체화면 타이머
  if (isLandscape) {
    return (
      <Animated.View style={[styles.container, { opacity: fadeAnim }]}>
        <TouchableWithoutFeedback onPress={handlePauseResume}>
          <Animated.View style={[styles.container, styles.landscapeContainer, { backgroundColor: flashBg }]}>
            <StatusBar hidden />
            <Text style={styles.landscapeTime}>{formatDuration(remainingSeconds)}</Text>
            {isPaused && (
              <Text style={styles.pausedIndicator}>{t('running.pause')}</Text>
            )}
          </Animated.View>
        </TouchableWithoutFeedback>
      </Animated.View>
    );
  }

  // 세로 모드: 타이머 + 버튼
  return (
    <Animated.View style={[styles.container, { opacity: fadeAnim }]}>
      <Animated.View style={[styles.container, { backgroundColor: flashBg }]}>
        <SafeAreaView style={styles.safeArea}>
          <View style={styles.timerSection}>
            <Text style={styles.timeText}>{formatDuration(remainingSeconds)}</Text>
          </View>

          {isTranscribing && (
            <Text style={{ color: NEON, fontSize: 13, fontWeight: '600', marginBottom: 16, opacity: 0.7, letterSpacing: 0.5 }}>
              텍스트 변환 중...
            </Text>
          )}
          <View style={styles.controls}>
            <TouchableOpacity style={styles.controlBtn} onPress={handlePauseResume} disabled={remainingSeconds <= 0}>
              <View style={[styles.controlIconWrapper, remainingSeconds <= 0 && { borderColor: '#666' }]}>
                <MaterialIcons
                  name={isPaused ? 'play-arrow' : 'pause'}
                  size={28}
                  color={remainingSeconds <= 0 ? '#666' : NEON}
                />
              </View>
              <Text style={[styles.controlLabel, remainingSeconds <= 0 && { color: '#666' }]}>
                {isPaused ? t('running.resume') : t('running.pause')}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.controlBtn} onPress={handleStop}>
              <View style={[styles.controlIconWrapper, { borderColor: remainingSeconds <= 0 ? NEON : '#666' }]}>
                <MaterialIcons name="stop" size={28} color={remainingSeconds <= 0 ? NEON : '#666'} />
              </View>
              <Text style={[styles.controlLabel, { color: remainingSeconds <= 0 ? NEON : '#666' }]}>{t('running.stop', { defaultValue: '정지' })}</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  safeArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  timerSection: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  timeText: {
    fontSize: 90,
    fontWeight: '800',
    color: NEON,
    letterSpacing: -2,
  },
  controls: {
    flexDirection: 'row',
    gap: 32,
    paddingBottom: 48,
  },
  controlBtn: {
    alignItems: 'center',
    gap: 8,
  },
  controlIconWrapper: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 2,
    borderColor: NEON,
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: NEON,
    letterSpacing: 0.5,
  },
  landscapeContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  landscapeTime: {
    fontSize: 120,
    fontWeight: '800',
    color: NEON,
    letterSpacing: -4,
  },
  pausedIndicator: {
    fontSize: 16,
    fontWeight: '700',
    color: 'rgba(57,255,20,0.5)',
    marginTop: 16,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
});
