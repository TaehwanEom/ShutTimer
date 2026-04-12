import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
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
import ImageLabeling from '@react-native-ml-kit/image-labeling';
import Svg, { Circle } from 'react-native-svg';
import { colors } from '../constants/theme';
import { SETTINGS_KEY, DismissMethod, DEFAULT_SETTINGS } from '../constants/settings';
import { ALARM_SOUNDS, DEFAULT_SOUND_ID } from '../constants/sounds';
import * as ScreenOrientation from 'expo-screen-orientation';
import * as Notifications from 'expo-notifications';
import { useTranslation } from 'react-i18next';
import { InterstitialAd, AdEventType, TestIds } from 'react-native-google-mobile-ads';
import AdBanner from '../components/AdBanner';
import { usePurchase } from '../context/PurchaseContext';

// PROD IDs kept for restoration after verification build
// iOS: ca-app-pub-3043284478228309/6510839159
// Android: ca-app-pub-3043284478228309/6667370376
const INTERSTITIAL_UNIT_ID = TestIds.INTERSTITIAL;
const interstitial = InterstitialAd.createForAdRequest(INTERSTITIAL_UNIT_ID, {
  requestNonPersonalizedAdsOnly: true,
});

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Alarm'>;
  route: RouteProp<RootStackParamList, 'Alarm'>;
};

type ResultState = 'idle' | 'success' | 'fail';

const MISSION_LABELS: Record<string, string[]> = {
  'tv':               ['Television', 'Television set'],
  'bathtub':          ['Bathtub', 'Shower'],
  'menu-book':        ['Paper'],
  'school':           ['Paper'],
  'toys':             ['Toy', 'Play'],
  'sports-esports':   ['Game controller', 'Joystick', 'Mobile phone'],
  'outdoor-grill':    ['Food', 'Meal'],
  'fitness-center':   ['Gym', 'Exercise equipment'],
  'directions-run':   ['Footwear', 'Road'],
  'self-improvement': ['Person', 'Face', 'Human face'],
  'music-note':       ['Musical instrument'],
  'brush':            ['Painting', 'Paint'],
  'pets':             ['Dog', 'Cat', 'Animal'],
  'local-cafe':       ['Cup'],
  'restaurant':       ['Food', 'Meal'],
  'shopping-cart':    ['Shopping cart'],
  'work':             ['Computer', 'Document'],
  'computer':         ['Computer', 'Laptop'],
  'phone-android':    ['Mobile phone'],
  'camera-alt':       ['Camera'],
  'directions-bike':  ['Bicycle'],
  'spa':              ['Bathtub', 'Bathroom'],
  'nightlight':       ['Bed', 'Pillow'],
  'clean-hands':      ['Sink'],
};

// 1차 검증: 신뢰도 높은 5개만 랜덤 출제 (검증 후 순차 확대)
const VERIFIED_ICONS = ['tv', 'toys', 'clean-hands', 'pets', 'local-cafe'];
const RANDOM_TARGETS = VERIFIED_ICONS.map(icon => ({
  icon,
  labels: MISSION_LABELS[icon],
  guideKey: `alarm.guide_${icon}`,
}));

const SHAKE_THRESHOLD = 1.8;
const SHAKE_COUNT_REQUIRED = 3;
const SHAKE_COOLDOWN_MS = 500;
const VIBRATION_PATTERN = [0, 500, 300, 500, 300, 500];
const AUTO_DISMISS_MS: Record<string, number> = {
  camera: 5 * 60 * 1000,
  tap: 3 * 60 * 1000,
  shake: 3 * 60 * 1000,
};
const RESULT_AUTO_CONFIRM_MS = 30 * 1000;
const RESULT_BG = {
  success: '#2e7d32',
  fail: '#c62828',
};

export default function AlarmScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const { isAdFree } = usePurchase();
  const [flash, setFlash] = useState<'off' | 'on'>('off');
  const [facing, setFacing] = useState<'back' | 'front'>('back');
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);

  const randomTarget = useMemo(() => {
    return RANDOM_TARGETS[Math.floor(Math.random() * RANDOM_TARGETS.length)];
  }, []);

  const activeLabels = randomTarget.labels;
  const guideKey = randomTarget.guideKey;
  const activeIcon = randomTarget.icon;

  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [dismissMethod, setDismissMethod] = useState<DismissMethod>(DEFAULT_SETTINGS.dismissMethod);
  const [vibrationEnabled, setVibrationEnabled] = useState(DEFAULT_SETTINGS.vibrationEnabled);
  const soundRef = useRef<Audio.Sound | null>(null);
  const [failCount, setFailCount] = useState(0);
  const [failMessage, setFailMessage] = useState(false);
  const [resultState, setResultState] = useState<ResultState>('idle');

  const hasCameraPermission = permission?.granted === true;
  const shakeCountRef = useRef(0);
  const lastShakeTimeRef = useRef(0);

  const adLoadedRef = useRef(false);
  const dismissedRef = useRef(false);
  const resultEnteredRef = useRef(false);
  const pendingResultRef = useRef<'success' | 'fail' | null>(null);
  const autoResultTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoDismissTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const accelSubRef = useRef<{ remove: () => void } | null>(null);
  const handleConfirmRef = useRef<() => void>(() => {});

  const stopAudioAndVibration = useCallback(() => {
    Vibration.cancel();
    Notifications.cancelAllScheduledNotificationsAsync();
    soundRef.current?.stopAsync().catch(() => {});
    soundRef.current?.unloadAsync().catch(() => {});
    soundRef.current = null;
    accelSubRef.current?.remove();
    accelSubRef.current = null;
  }, []);

  const handleConfirm = useCallback(() => {
    if (dismissedRef.current) return;
    dismissedRef.current = true;
    if (autoResultTimeoutRef.current) {
      clearTimeout(autoResultTimeoutRef.current);
      autoResultTimeoutRef.current = null;
    }
    navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
  }, [navigation]);

  useEffect(() => {
    handleConfirmRef.current = handleConfirm;
  }, [handleConfirm]);

  const showResultScreen = useCallback((result: 'success' | 'fail') => {
    setResultState(result);
    autoResultTimeoutRef.current = setTimeout(() => {
      handleConfirmRef.current();
    }, RESULT_AUTO_CONFIRM_MS);
  }, []);

  const enterResult = useCallback((result: 'success' | 'fail') => {
    if (resultEnteredRef.current) return;
    resultEnteredRef.current = true;
    // AUTO_DISMISS_MS 타이머 즉시 해제 (광고 재생 중 발사 방지)
    if (autoDismissTimeoutRef.current) {
      clearTimeout(autoDismissTimeoutRef.current);
      autoDismissTimeoutRef.current = null;
    }
    stopAudioAndVibration();
    pendingResultRef.current = result;
    // 광고 로드됐고 비구매자면 즉시 광고 → CLOSED이 결과화면 전환
    if (!isAdFree && adLoadedRef.current) {
      interstitial.show().catch(() => {
        // show 실패 시 결과화면 바로
        pendingResultRef.current = null;
        showResultScreen(result);
      });
    } else {
      // 구매자 또는 광고 미로드 → 결과화면 바로
      pendingResultRef.current = null;
      showResultScreen(result);
    }
  }, [stopAudioAndVibration, isAdFree, showResultScreen]);

  const autoDismissNoResult = useCallback(() => {
    if (dismissedRef.current) return;
    dismissedRef.current = true;
    stopAudioAndVibration();
    navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
  }, [navigation, stopAudioAndVibration]);

  // 전면 광고 로드
  useEffect(() => {
    adLoadedRef.current = false;
    dismissedRef.current = false;
    resultEnteredRef.current = false;
    pendingResultRef.current = null;

    if (isAdFree) return;

    const unsubLoaded = interstitial.addAdEventListener(AdEventType.LOADED, () => {
      adLoadedRef.current = true;
    });
    const unsubClosed = interstitial.addAdEventListener(AdEventType.CLOSED, () => {
      // enterResult 경로: 광고 본 후 결과화면 전환
      if (pendingResultRef.current) {
        const pending = pendingResultRef.current;
        pendingResultRef.current = null;
        showResultScreen(pending);
      } else {
        // 방어: pendingResultRef 없으면 홈 (비정상 경로)
        navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
      }
    });
    const unsubError = interstitial.addAdEventListener(AdEventType.ERROR, (error: any) => {
      console.warn('Interstitial ad failed:', error?.code, error?.message, error);
    });

    interstitial.load();

    return () => {
      unsubLoaded();
      unsubClosed();
      unsubError();
    };
  }, [navigation, isAdFree, showResultScreen]);

  // 자동 종료 타이머 (결과 화면 미진입 시에만)
  useEffect(() => {
    if (!settingsLoaded || resultState !== 'idle') return;
    autoDismissTimeoutRef.current = setTimeout(autoDismissNoResult, AUTO_DISMISS_MS[dismissMethod] ?? 3 * 60 * 1000);
    return () => {
      if (autoDismissTimeoutRef.current) {
        clearTimeout(autoDismissTimeoutRef.current);
        autoDismissTimeoutRef.current = null;
      }
    };
  }, [dismissMethod, settingsLoaded, autoDismissNoResult, resultState]);

  // 컴포넌트 언마운트 시 30초 타이머 정리
  useEffect(() => {
    return () => {
      if (autoResultTimeoutRef.current) {
        clearTimeout(autoResultTimeoutRef.current);
        autoResultTimeoutRef.current = null;
      }
    };
  }, []);

  // portrait 잠금 + 예약 알림 전부 취소 (안전장치)
  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
    Notifications.cancelAllScheduledNotificationsAsync();
  }, []);

  useEffect(() => {
    AsyncStorage.multiGet([SETTINGS_KEY.DISMISS_METHOD, SETTINGS_KEY.VIBRATION_ENABLED, SETTINGS_KEY.ALARM_SOUND, SETTINGS_KEY.ALARM_ENABLED]).then(pairs => {
      const method = pairs[0][1] as DismissMethod | null;
      const vibration = pairs[1][1];
      const soundId = pairs[2][1] ?? DEFAULT_SOUND_ID;
      const alarmRaw = pairs[3][1];
      const alarmEnabled = alarmRaw !== 'false';
      if (method) setDismissMethod(method);
      if (vibration !== null) setVibrationEnabled(vibration === 'true');
      setSettingsLoaded(true);

      if (!alarmEnabled) return;

      // 알람 사운드 재생
      const soundItem = ALARM_SOUNDS.find(s => s.id === soundId) ?? ALARM_SOUNDS[0];
      Audio.setAudioModeAsync({ playsInSilentModeIOS: true, staysActiveInBackground: true }).then(() => {
        Audio.Sound.createAsync(soundItem.source, { isLooping: true }).then(({ sound }) => {
          // 로드 완료 시점에 이미 dismiss/결과 진입됐으면 재생하지 않고 언로드
          if (resultEnteredRef.current || dismissedRef.current) {
            sound.unloadAsync().catch(() => {});
            return;
          }
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

  // 진동 + 백그라운드 복귀 시 재시작 (결과 화면에선 중단)
  useEffect(() => {
    if (!vibrationEnabled || resultState !== 'idle') return;
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
  }, [vibrationEnabled, resultState]);

  // 흔들기 감지 (결과 화면 진입 시 자동 해제)
  useEffect(() => {
    if (dismissMethod !== 'shake' || resultState !== 'idle') return;

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
          accelSubRef.current = null;
          enterResult('success');
        }
      }
    });
    accelSubRef.current = sub;
    return () => {
      sub.remove();
      accelSubRef.current = null;
    };
  }, [dismissMethod, resultState, enterResult]);

  // Shake 애니메이션 — 훅은 항상 최상단
  const pulse = useRef(new Animated.Value(1)).current;
  const ripple1 = useRef(new Animated.Value(0)).current;
  const ripple2 = useRef(new Animated.Value(0)).current;
  const rotate = useRef(new Animated.Value(0)).current;

  const tapRipple1 = useRef(new Animated.Value(0)).current;
  const tapRipple2 = useRef(new Animated.Value(0)).current;
  const tapFingerScale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (dismissMethod !== 'shake' || resultState !== 'idle') return;

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
  }, [dismissMethod, resultState]);

  useEffect(() => {
    if (dismissMethod !== 'tap' || resultState !== 'idle') return;

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
  }, [dismissMethod, resultState]);

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

      if (activeLabels.length === 0 || !ImageLabeling) {
        enterResult('success');
        return;
      }

      const result = await ImageLabeling.label(photo.uri);
      const matched = result.some(
        (item: { text: string; confidence: number }) =>
          item.confidence >= 0.3 &&
          activeLabels.some(l => item.text.toLowerCase().includes(l.toLowerCase()))
      );

      if (matched) {
        enterResult('success');
      } else {
        const newCount = failCount + 1;
        setFailCount(newCount);
        if (newCount >= 3) {
          enterResult('fail');
          return;
        }
        Vibration.vibrate(200);
        setFailMessage(true);
        setTimeout(() => setFailMessage(false), 1500);
      }
    } catch {
      enterResult('success');
    }
  };

  // 설정 로드 전 빈 화면
  if (!settingsLoaded) {
    return <SafeAreaView style={styles.container} />;
  }

  // 결과 화면 (최우선 렌더)
  if (resultState !== 'idle') {
    const bgColor = RESULT_BG[resultState];
    const iconName = resultState === 'success' ? 'check-circle' : 'cancel';
    const titleKey = resultState === 'success' ? 'alarm.resultSuccess' : 'alarm.resultFail';
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: bgColor }]}>
        <View style={styles.header}>
          <View>
            <Text style={styles.headerTitle}>ShutTimer</Text>
          </View>
        </View>

        <View style={styles.centerSection}>
          <View style={styles.resultIconWrapper}>
            <MaterialIcons name={iconName} size={140} color={colors.onPrimary} />
          </View>
          <Text style={[styles.resultTitle]}>{t(titleKey)}</Text>
        </View>

        <View style={styles.tapSection}>
          <TouchableOpacity style={styles.tapButton} onPress={handleConfirm} activeOpacity={0.8}>
            <Text style={[styles.tapButtonText, { color: bgColor }]}>{t('alarm.resultConfirm')}</Text>
          </TouchableOpacity>
        </View>
        <AdBanner />
      </SafeAreaView>
    );
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
              <>
                <CameraView
                  ref={cameraRef}
                  style={StyleSheet.absoluteFill}
                  facing={facing}
                  flash={flash}
                />
                {guideKey && (
                  <View style={{ ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' }}>
                    {!failMessage && activeIcon && (
                      <MaterialIcons
                        name={activeIcon as React.ComponentProps<typeof MaterialIcons>['name']}
                        size={120}
                        color="rgba(255,255,255,0.6)"
                        style={{ marginBottom: 16 }}
                      />
                    )}
                    <Text style={{ fontSize: 22, fontWeight: '800', color: 'rgba(255,255,255,0.6)', textAlign: 'center', textShadowColor: 'rgba(0,0,0,0.4)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 }}>
                      {failMessage ? t('alarm.retakePhoto', { defaultValue: '다시 찍어주세요' }) : t(guideKey)}
                    </Text>
                  </View>
                )}
              </>
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
        <AdBanner />
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
          <TouchableOpacity style={styles.tapButton} onPress={() => enterResult('success')} activeOpacity={0.8}>
            <Text style={styles.tapButtonText}>{t('alarm.tapButton')}</Text>
          </TouchableOpacity>
        </View>
        <AdBanner />
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
      <AdBanner />
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
  guideText: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.onPrimary,
    textAlign: 'center',
    opacity: 0.9,
    marginBottom: 12,
    paddingHorizontal: 24,
  },
  // 결과 화면
  resultIconWrapper: {
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 40,
  },
  resultTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: colors.onPrimary,
    textAlign: 'center',
    letterSpacing: -0.3,
    paddingHorizontal: 24,
  },
});
