import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  Vibration,
  Animated,
  Easing,
  AppState,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Accelerometer } from 'expo-sensors';
import { Audio } from 'expo-av';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MaterialIcons } from '@expo/vector-icons';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { RootStackParamList } from '../../App';
// TODO: EAS Build 후 활성화
// import ImageLabeling from '@react-native-ml-kit/image-labeling';
const ImageLabeling: { label: (uri: string) => Promise<Array<{ text: string; confidence: number }>> } | null = null;
import Svg, { Circle } from 'react-native-svg';
import { colors } from '../constants/theme';
import { SETTINGS_KEY, DismissMethod, DEFAULT_SETTINGS } from '../constants/settings';
import { ALARM_SOUNDS, DEFAULT_SOUND_ID } from '../constants/sounds';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useTranslation } from 'react-i18next';
// AdMob — EAS Development Build 필요, Expo Go 불가
// import { RewardedInterstitialAd, TestIds, AdEventType } from 'react-native-google-mobile-ads';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Alarm'>;
  route: RouteProp<RootStackParamList, 'Alarm'>;
};

const MISSION_LABELS: Record<string, string[]> = {
  tv: ['Television', 'Screen', 'Monitor', 'Television set'],
  read: ['Book', 'Magazine'],
  study: ['Book', 'Laptop', 'Notebook', 'Pen'],
  brush: ['Toothbrush'],
  bath: ['Bathtub', 'Sink', 'Bathroom'],
  play: ['Toy'],
  game: [], // 검증 스킵
};

const SHAKE_THRESHOLD = 1.8;
const SHAKE_COUNT_REQUIRED = 3;
const SHAKE_COOLDOWN_MS = 500;
const VIBRATION_PATTERN = [0, 500, 300, 500, 300, 500];
const AUTO_DISMISS_MS: Record<string, number> = {
  camera: 5 * 60 * 1000,
  tap: 3 * 60 * 1000,
  shake: 3 * 60 * 1000,
};

export default function AlarmScreen({ navigation, route }: Props) {
  const { t } = useTranslation();
  const [flash, setFlash] = useState<'off' | 'on'>('off');
  const [facing, setFacing] = useState<'back' | 'front'>('back');
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);

  const missionId = route.params?.missionId ?? null;
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [dismissMethod, setDismissMethod] = useState<DismissMethod>(DEFAULT_SETTINGS.dismissMethod);
  const [vibrationEnabled, setVibrationEnabled] = useState(DEFAULT_SETTINGS.vibrationEnabled);
  const soundRef = useRef<Audio.Sound | null>(null);
  const [failCount, setFailCount] = useState(0);
  const [failMessage, setFailMessage] = useState(false);

  const hasCameraPermission = permission?.granted === true;
  const shakeCountRef = useRef(0);
  const lastShakeTimeRef = useRef(0);

  const goHome = useCallback(() => {
    Vibration.cancel();
    soundRef.current?.stopAsync().catch(() => {});
    soundRef.current?.unloadAsync().catch(() => {});
    soundRef.current = null;
    navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
  }, [navigation]);

  const dismiss = useCallback(() => {
    goHome();
  }, [goHome]);

  // 자동 종료 타이머
  useEffect(() => {
    if (!settingsLoaded) return;
    const timeout = setTimeout(dismiss, AUTO_DISMISS_MS[dismissMethod] ?? 3 * 60 * 1000);
    return () => clearTimeout(timeout);
  }, [dismissMethod, settingsLoaded, dismiss]);

  // portrait 잠금 + 설정 로드
  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
  }, []);

  useEffect(() => {
    AsyncStorage.multiGet([SETTINGS_KEY.DISMISS_METHOD, SETTINGS_KEY.VIBRATION_ENABLED, SETTINGS_KEY.ALARM_SOUND]).then(pairs => {
      const method = pairs[0][1] as DismissMethod | null;
      const vibration = pairs[1][1];
      const soundId = pairs[2][1] ?? DEFAULT_SOUND_ID;
      if (method) setDismissMethod(method);
      if (vibration !== null) setVibrationEnabled(vibration === 'true');
      setSettingsLoaded(true);

      // 알람 사운드 재생
      const soundItem = ALARM_SOUNDS.find(s => s.id === soundId) ?? ALARM_SOUNDS[0];
      Audio.setAudioModeAsync({ playsInSilentModeIOS: true, staysActiveInBackground: true }).then(() => {
        Audio.Sound.createAsync(soundItem.source, { isLooping: true }).then(({ sound }) => {
          soundRef.current = sound;
          sound.playAsync();
        }).catch(() => {});
      });
    });

    return () => {
      soundRef.current?.stopAsync().catch(() => {});
      soundRef.current?.unloadAsync().catch(() => {});
    };
  }, []);

  // 진동 + 백그라운드 복귀 시 재시작
  useEffect(() => {
    if (!vibrationEnabled) return;
    Vibration.vibrate(VIBRATION_PATTERN, true);

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        Vibration.vibrate(VIBRATION_PATTERN, true);
      }
    });

    return () => {
      Vibration.cancel();
      sub.remove();
    };
  }, [vibrationEnabled]);

  // 흔들기 감지
  useEffect(() => {
    if (dismissMethod !== 'shake') return;

    shakeCountRef.current = 0;
    lastShakeTimeRef.current = 0;
    Accelerometer.setUpdateInterval(100);
    const sub = Accelerometer.addListener(({ x, y, z }) => {
      const total = Math.sqrt(x * x + y * y + z * z);
      const now = Date.now();
      if (total > SHAKE_THRESHOLD && now - lastShakeTimeRef.current > SHAKE_COOLDOWN_MS) {
        lastShakeTimeRef.current = now;
        shakeCountRef.current += 1;
        if (shakeCountRef.current >= SHAKE_COUNT_REQUIRED) {
          sub.remove();
          dismiss();
        }
      }
    });
    return () => sub.remove();
  }, [dismissMethod]);

  // Shake 애니메이션 — 훅은 항상 최상단
  const pulse = useRef(new Animated.Value(1)).current;
  const ripple1 = useRef(new Animated.Value(0)).current;
  const ripple2 = useRef(new Animated.Value(0)).current;
  const rotate = useRef(new Animated.Value(0)).current;

  const tapRipple1 = useRef(new Animated.Value(0)).current;
  const tapRipple2 = useRef(new Animated.Value(0)).current;
  const tapFingerScale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (dismissMethod !== 'shake') return;

    const pulseAnim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.1, duration: 600, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 600, useNativeDriver: true }),
      ])
    );
    const rippleAnim1 = Animated.loop(
      Animated.timing(ripple1, { toValue: 1, duration: 700, useNativeDriver: true })
    );
    const rippleAnim2 = Animated.loop(
      Animated.sequence([
        Animated.delay(350),
        Animated.timing(ripple2, { toValue: 1, duration: 700, useNativeDriver: true }),
      ])
    );
    const rotateAnim = Animated.loop(
      Animated.sequence([
        Animated.timing(rotate, { toValue: 1, duration: 75, useNativeDriver: true }),
        Animated.timing(rotate, { toValue: -1, duration: 150, useNativeDriver: true }),
        Animated.timing(rotate, { toValue: 0, duration: 75, useNativeDriver: true }),
      ])
    );

    pulseAnim.start();
    rippleAnim1.start();
    rippleAnim2.start();
    rotateAnim.start();

    return () => {
      pulseAnim.stop();
      rippleAnim1.stop();
      rippleAnim2.stop();
      rotateAnim.stop();
      pulse.setValue(1);
      ripple1.setValue(0);
      ripple2.setValue(0);
      rotate.setValue(0);
    };
  }, [dismissMethod]);

  useEffect(() => {
    if (dismissMethod !== 'tap') return;

    const fingerAnim = Animated.loop(
      Animated.sequence([
        Animated.timing(tapFingerScale, { toValue: 0.75, duration: 120, useNativeDriver: true, easing: Easing.in(Easing.ease) }),
        Animated.timing(tapFingerScale, { toValue: 1, duration: 250, useNativeDriver: true, easing: Easing.out(Easing.back(2)) }),
        Animated.delay(1000),
      ])
    );
    const rippleAnim1 = Animated.loop(
      Animated.timing(tapRipple1, { toValue: 1, duration: 1200, useNativeDriver: true })
    );
    const rippleAnim2 = Animated.loop(
      Animated.sequence([
        Animated.delay(600),
        Animated.timing(tapRipple2, { toValue: 1, duration: 1200, useNativeDriver: true }),
      ])
    );

    fingerAnim.start();
    rippleAnim1.start();
    rippleAnim2.start();

    return () => {
      fingerAnim.stop(); rippleAnim1.stop(); rippleAnim2.stop();
      tapFingerScale.setValue(1); tapRipple1.setValue(0); tapRipple2.setValue(0);
    };
  }, [dismissMethod]);

  const rippleStyle = (anim: Animated.Value) => ({
    position: 'absolute' as const,
    width: 180,
    height: 180,
    borderRadius: 90,
    borderWidth: 2,
    borderColor: colors.onPrimary,
    opacity: anim.interpolate({ inputRange: [0, 1], outputRange: [0.6, 0] }),
    transform: [{ scale: anim.interpolate({ inputRange: [0, 1], outputRange: [1, 2.2] }) }],
  });

  const handleShutter = async () => {
    try {
      const photo = await cameraRef.current?.takePictureAsync();
      if (!photo?.uri) return;

      // missionId 없음 or game 미션 or ML Kit 미설치 → 검증 스킵
      const labels = missionId ? MISSION_LABELS[missionId] : null;
      if (!labels || labels.length === 0 || !ImageLabeling) {
        dismiss();
        return;
      }

      // Image Labeling 검증
      const result = await ImageLabeling.label(photo.uri);
      const matched = result.some(
        (item: { text: string; confidence: number }) =>
          item.confidence >= 0.6 &&
          labels.some(l => item.text.toLowerCase().includes(l.toLowerCase()))
      );

      if (matched) {
        dismiss();
      } else {
        const newCount = failCount + 1;
        setFailCount(newCount);
        if (newCount >= 3) {
          // 3회 실패 → 강제 종료 허용 (failCount 유지, UI에서 버튼 표시)
        }
        Vibration.vibrate(200);
        setFailMessage(true);
        setTimeout(() => setFailMessage(false), 1500);
      }
    } catch {
      // 인식 실패 시 그냥 종료
      dismiss();
    }
  };

  // 설정 로드 전 빈 화면
  if (!settingsLoaded) {
    return <SafeAreaView style={styles.container} />;
  }

  // Camera 모드 레이아웃
  if (dismissMethod === 'camera') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <View>
            <Text style={styles.headerTitle}>ShutTimer</Text>
          </View>
        </View>

        <View style={styles.viewfinderSection}>
          <Svg width={328} height={328} style={{ position: 'absolute' }}>
            <Circle cx={164} cy={164} r={163} fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth={2} />
          </Svg>
          <View style={styles.viewfinder}>
            {hasCameraPermission ? (
              <CameraView
                ref={cameraRef}
                style={StyleSheet.absoluteFill}
                facing={facing}
                flash={flash}
              />
            ) : (
              <View style={styles.instructionWrapper}>
                <Text style={styles.instructionText}>{t('alarm.takePhoto')}</Text>
                <View style={styles.instructionBadge}>
                  <MaterialIcons name="photo-camera" size={14} color={colors.primary} />
                  <Text style={styles.instructionBadgeText}>{t('alarm.cameraRequired')}</Text>
                </View>
                <TouchableOpacity style={styles.permissionButton} onPress={requestPermission}>
                  <Text style={styles.permissionButtonText}>{t('alarm.allowCamera')}</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>

        <View style={styles.shutterSection}>
          <TouchableOpacity onPress={handleShutter} activeOpacity={0.8}>
            <Svg width={104} height={104}>
              <Circle cx={52} cy={52} r={48} fill={colors.onPrimary} />
              <Circle cx={52} cy={52} r={36} fill={colors.primary} />
              <Circle cx={52} cy={52} r={29} fill={colors.onPrimary} />
            </Svg>
          </TouchableOpacity>
          <View style={styles.cameraControls}>
            <TouchableOpacity
              style={styles.cameraControlBtn}
              onPress={() => setFlash(f => f === 'off' ? 'on' : 'off')}
            >
              <MaterialIcons
                name={flash === 'off' ? 'flash-off' : 'flash-on'}
                size={24}
                color={colors.onPrimary}
                style={{ opacity: 0.8 }}
              />
              <Text style={styles.cameraControlLabel}>{t('alarm.flash')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.cameraControlBtn}
              onPress={() => setFacing(f => f === 'back' ? 'front' : 'back')}
            >
              <MaterialIcons name="flip-camera-ios" size={24} color={colors.onPrimary} style={{ opacity: 0.8 }} />
              <Text style={styles.cameraControlLabel}>{t('alarm.flip')}</Text>
            </TouchableOpacity>
          </View>
        </View>
        {failMessage && (
          <Text style={{ color: colors.onPrimary, fontSize: 15, fontWeight: '700', textAlign: 'center', marginBottom: 8, opacity: 0.9 }}>
            {t('alarm.retakePhoto', { defaultValue: '다시 찍어주세요' })}
          </Text>
        )}
        {failCount >= 3 && (
          <TouchableOpacity
            style={{ paddingVertical: 12, paddingHorizontal: 32, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.15)', marginBottom: 8 }}
            onPress={dismiss}
          >
            <Text style={{ color: colors.onPrimary, fontSize: 14, fontWeight: '700' }}>
              {t('alarm.forceClose', { defaultValue: '강제 종료' })}
            </Text>
          </TouchableOpacity>
        )}
        <View style={styles.adSlot}><Text style={styles.adLabel}>AD</Text></View>
      </SafeAreaView>
    );
  }

  // Tap 모드 레이아웃
  if (dismissMethod === 'tap') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <View>
            <Text style={styles.headerTitle}>ShutTimer</Text>
          </View>
        </View>

        <View style={[styles.centerSection, { paddingTop: 40 }]}>
          <View style={styles.rippleWrapper}>
            <Animated.View style={rippleStyle(tapRipple1)} />
            <Animated.View style={rippleStyle(tapRipple2)} />
            <View style={styles.centerIconWrapper}>
              <Animated.View style={{ transform: [{ scale: tapFingerScale }] }}>
                <MaterialIcons name="touch-app" size={96} color={colors.onPrimary} style={{ opacity: 0.9 }} />
              </Animated.View>
            </View>
          </View>
          <View style={{ alignItems: 'center', gap: 6 }}>
            <Text style={styles.centerTitle}>{t('alarm.timerDone')}</Text>
            <Text style={styles.centerSubtitle}>{t('alarm.tapInstruction')}</Text>
          </View>
        </View>

        <View style={styles.tapSection}>
          <TouchableOpacity style={styles.tapButton} onPress={dismiss} activeOpacity={0.8}>
            <Text style={styles.tapButtonText}>{t('alarm.tapButton')}</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.adSlot}><Text style={styles.adLabel}>AD</Text></View>
      </SafeAreaView>
    );
  }

  // Shake 모드 레이아웃
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>ShutTimer</Text>
        </View>
      </View>

      <View style={styles.centerSection}>
        <View style={styles.rippleWrapper}>
          <Animated.View style={rippleStyle(ripple1)} />
          <Animated.View style={rippleStyle(ripple2)} />
          <Animated.View style={[styles.centerIconWrapper, {
            transform: [
              { scale: pulse },
              { rotate: rotate.interpolate({ inputRange: [-1, 1], outputRange: ['-20deg', '20deg'] }) },
            ],
          }]}>
            <MaterialIcons name="vibration" size={96} color={colors.onPrimary} style={{ opacity: 0.9 }} />
          </Animated.View>
        </View>
        <Text style={styles.centerTitle}>{t('alarm.timerDone')}</Text>
        <Text style={styles.centerSubtitle}>{t('alarm.shakeInstruction')}</Text>
      </View>
      <View style={styles.adSlot}><Text style={styles.adLabel}>AD</Text></View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.primary,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: 32,
    paddingTop: 16,
    paddingBottom: 8,
  },
  headerSubtitle: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.onPrimary,
    opacity: 0.6,
    letterSpacing: 3,
  },
  headerTitle: {
    fontSize: 32,
    fontWeight: '800',
    color: colors.onPrimary,
    letterSpacing: -1,
    marginTop: 4,
  },
  // Camera 모드
  viewfinderSection: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 48,
  },
  viewfinder: {
    width: 320,
    height: 320,
    borderRadius: 160,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  instructionWrapper: {
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 32,
  },
  instructionText: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.onPrimary,
    textAlign: 'center',
    lineHeight: 26,
    letterSpacing: -0.3,
  },
  instructionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: colors.onPrimary,
  },
  instructionBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.primary,
    letterSpacing: 1,
  },
  permissionButton: {
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
  },
  permissionButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.onPrimary,
    letterSpacing: 0.5,
  },
  shutterSection: {
    paddingBottom: 64,
    alignItems: 'center',
    gap: 32,
  },
  cameraControls: {
    flexDirection: 'row',
    gap: 48,
  },
  cameraControlBtn: {
    alignItems: 'center',
    gap: 6,
  },
  cameraControlLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.onPrimary,
    opacity: 0.8,
    letterSpacing: 1,
  },
  // Tap / Shake 공통
  centerSection: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
    paddingHorizontal: 40,
  },
  rippleWrapper: {
    width: 180,
    height: 180,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 100,
  },
  centerIconWrapper: {
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: colors.onPrimary,
    letterSpacing: -0.5,
  },
  centerSubtitle: {
    fontSize: 15,
    fontWeight: '500',
    color: colors.onPrimary,
    opacity: 0.7,
    textAlign: 'center',
    letterSpacing: -0.2,
  },
  // Tap 모드 버튼
  tapSection: {
    paddingBottom: 64,
    paddingHorizontal: 32,
  },
  tapButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    width: '100%',
    paddingVertical: 24,
    borderRadius: 20,
    backgroundColor: colors.onPrimary,
  },
  tapButtonText: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.primary,
    letterSpacing: -0.3,
  },
  adSlot: {
    width: '100%',
    height: 60,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  adLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 2,
    color: 'rgba(255,255,255,0.35)',
  },
});
