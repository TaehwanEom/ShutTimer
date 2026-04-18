// @v1.5-poc — YOLOv10n Object Detection 스파이크 검증 화면. PASS 후 제거.
// Phase 1: VisionCamera Frame Processor + Metal/core-ml GPU Delegate
// Stream 1: 미션 타이머 설정 + 랜덤 미션 + 다시 뽑기 + 2회 시도 + 3프레임 연속 매칭
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  Alert,
  ScrollView,
  Modal,
  AppState,
  Animated,
  Dimensions,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  useFrameProcessor,
} from 'react-native-vision-camera';
import { useTensorflowModel } from 'react-native-fast-tflite';
import { NitroModules } from 'react-native-nitro-modules';
import { useResizePlugin } from 'vision-camera-resize-plugin';
import { useRunOnJS, useSharedValue } from 'react-native-worklets-core';
import { MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../App';
import { useTheme } from '../context/ThemeContext';
import { ThemeColors } from '../constants/theme';
import { SETTINGS_KEY, DEFAULT_SETTINGS, MissionDuration, MISSION_DURATION_OPTIONS } from '../constants/settings';
import {
  parseYolov10Output,
  MISSION_COCO_LABELS,
  type Detection,
} from '../utils/objectDetection';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'PoCPhotoValidation'>;
};

// 미션 풀 — MISSION_COCO_LABELS 24개 키에서 camera-alt 제외 = 23개
const MISSION_POOL: string[] = Object.keys(MISSION_COCO_LABELS).filter(
  (k) => k !== 'camera-alt' && MISSION_COCO_LABELS[k].length > 0
);

const TARGET_CONFIDENCE = 0.4;
const THROTTLE_MS = 800;
const BLINK_ON_MS = 100;
const BLINK_OFF_MS = 80;
const BLINK_COUNT = 2;
const FEEDBACK_DELAY_MS = 300;
const COMPLETE_ANIM_MS = 1000;
const HITS_REQUIRED = 3; // 3프레임 연속 매칭 (인증 엄밀성 B)
const RETRY_BANNER_MS = 1000; // 재시도 배너 1초

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const CENTER_SIZE = SCREEN_W;
const TB_OFFSET = (SCREEN_H - CENTER_SIZE) / 2;

function pickRandom<T>(arr: T[], exclude?: T): T {
  const pool = exclude != null ? arr.filter((x) => x !== exclude) : arr;
  return pool[Math.floor(Math.random() * pool.length)];
}

export default function PoCPhotoValidationScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('back');
  // 화각 확대 체감 완화: device.formats 중 fieldOfView ≤ 70° 범위에서 최대값 선택
  // (실기기 튜닝 결과: 70°가 자연스러운 wide-angle — 울트라와이드는 어안 왜곡 유발)
  const FOV_MAX = 70;
  const format = useMemo(() => {
    if (!device) return undefined;
    const candidates = device.formats
      .filter((f) => f.fieldOfView != null)
      .filter((f) => f.videoStabilizationModes.includes('off'))
      .filter((f) => f.videoWidth >= 640 && f.videoHeight >= 640)
      .filter((f) => f.fieldOfView <= FOV_MAX)
      .sort((a, b) => b.fieldOfView - a.fieldOfView);
    return candidates[0];
  }, [device]);
  useEffect(() => {
    if (format) {
      console.log('[Camera] format selected', {
        w: format.videoWidth,
        h: format.videoHeight,
        fov: format.fieldOfView,
        maxFps: format.maxFps,
      });
    }
  }, [format]);
  const plugin = useTensorflowModel(
    require('../../assets/models/yolov10n_float16.tflite'),
    []
  );
  const model = plugin.state === 'loaded' ? plugin.model : undefined;
  // 공식 필수 패턴: TfliteModel은 Nitro HybridObject(jsi::NativeState).
  // VisionCamera v4 worklet runtime은 NativeState 직접 접근 불가 → box/unbox 필수.
  const boxedModel = useMemo(
    () => (model != null ? NitroModules.box(model) : undefined),
    [model]
  );
  const { resize } = useResizePlugin();

  // 미션 타이머 설정값 (AsyncStorage)
  const [missionDuration, setMissionDuration] = useState<MissionDuration>(DEFAULT_SETTINGS.missionDuration);
  const missionDurationRef = useRef<number>(DEFAULT_SETTINGS.missionDuration);
  useEffect(() => {
    AsyncStorage.getItem(SETTINGS_KEY.MISSION_DURATION).then((v) => {
      const n = v != null ? parseInt(v, 10) : NaN;
      const valid = (MISSION_DURATION_OPTIONS as readonly number[]).includes(n)
        ? (n as MissionDuration)
        : DEFAULT_SETTINGS.missionDuration;
      setMissionDuration(valid);
      missionDurationRef.current = valid;
    });
  }, []);

  // 미션 상태
  const [currentMission, setCurrentMission] = useState<string>(() => pickRandom(MISSION_POOL));
  const [cameraOpen, setCameraOpen] = useState(false);
  const [lastMatch, setLastMatch] = useState<Detection | null>(null);
  const [completed, setCompleted] = useState<Detection | null>(null);
  const [scanPhase, setScanPhase] = useState<'scanning' | 'detected' | 'filling'>('scanning');
  const [error, setError] = useState<string | null>(null);
  const [attemptCount, setAttemptCount] = useState<1 | 2>(1);
  const [remainingMs, setRemainingMs] = useState<number>(DEFAULT_SETTINGS.missionDuration * 1000);
  const [isRetryBannerVisible, setIsRetryBannerVisible] = useState(false);

  // 현재 미션 ref (worklet 타이밍 이슈 회피)
  const currentMissionRef = useRef(currentMission);
  useEffect(() => {
    currentMissionRef.current = currentMission;
  }, [currentMission]);

  // 재시도 배너 타이머 ref (useEffect cleanup으로 인한 setTimeout 취소 버그 방지)
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const progressAnim = useRef(new Animated.Value(0)).current;
  const blinkAnim = useRef(new Animated.Value(0)).current;

  // Worklet 공유 상태
  const matched = useSharedValue(false);
  const lastRun = useSharedValue(0);
  const targetLabelsSV = useSharedValue<string[]>(MISSION_COCO_LABELS[currentMission] ?? []);
  const consecutiveHits = useSharedValue(0);
  const frameLogged = useSharedValue(false);

  // 미션 변경 시 SharedValue 동기화
  useEffect(() => {
    targetLabelsSV.value = MISSION_COCO_LABELS[currentMission] ?? [];
  }, [currentMission, targetLabelsSV]);

  // 카메라 권한
  useEffect(() => {
    if (!hasPermission) {
      requestPermission().then((granted) => {
        if (!granted) {
          Alert.alert('카메라 권한 필요', '검증을 위해 카메라 권한이 필요합니다.', [
            { text: '확인', onPress: () => navigation.goBack() },
          ]);
        }
      });
    }
  }, [hasPermission, requestPermission, navigation]);

  // 모델 로드 상태
  useEffect(() => {
    if (plugin.state === 'error') {
      Alert.alert('모델 로드 실패', String(plugin.error), [
        { text: '확인', onPress: () => navigation.goBack() },
      ]);
    }
  }, [plugin, navigation]);

  // 감지 시퀀스 (JS 스레드) — 기존 PoC 로직 유지
  const triggerDetectionSequence = useCallback((match: Detection) => {
    setLastMatch(match);
    setScanPhase('detected');

    const blinkSeq: Animated.CompositeAnimation[] = [];
    for (let i = 0; i < BLINK_COUNT; i++) {
      blinkSeq.push(
        Animated.timing(blinkAnim, { toValue: 1, duration: BLINK_ON_MS, useNativeDriver: false }),
        Animated.timing(blinkAnim, { toValue: 0, duration: BLINK_OFF_MS, useNativeDriver: false }),
      );
    }

    Animated.sequence([
      ...blinkSeq,
      Animated.delay(FEEDBACK_DELAY_MS),
    ]).start(() => {
      setScanPhase('filling');
      Animated.timing(progressAnim, {
        toValue: 1,
        duration: COMPLETE_ANIM_MS,
        useNativeDriver: false,
      }).start(() => {
        setCompleted(match);
        setCameraOpen(false);
      });
    });
  }, [blinkAnim, progressAnim]);

  // Worklet → JS 브릿지
  const onMatchJS = useRunOnJS((match: Detection) => {
    triggerDetectionSequence(match);
  }, [triggerDetectionSequence]);

  // Frame Processor (Worklet) — 3프레임 연속 매칭 시 통과
  const frameProcessor = useFrameProcessor((frame) => {
    'worklet';
    if (matched.value) return;
    if (boxedModel == null) return;

    if (!frameLogged.value) {
      console.log('[FrameProcessor] frame', frame.width, 'x', frame.height);
      frameLogged.value = true;
    }

    const now = Date.now();
    if (now - lastRun.value < THROTTLE_MS) return;
    lastRun.value = now;

    try {
      const tflite = boxedModel.unbox();

      const t0 = Date.now();
      const resized = resize(frame, {
        scale: { width: 640, height: 640 },
        pixelFormat: 'rgb',
        dataType: 'float32',
      });
      const resizeMs = Date.now() - t0;
      if (resizeMs > 50) {
        console.log('[FrameProcessor] resize ms', resizeMs);
      }

      const inputBuffer = resized.buffer.slice(
        resized.byteOffset,
        resized.byteOffset + resized.byteLength
      ) as ArrayBuffer;
      const outputs = tflite.runSync([inputBuffer]);
      const output = new Float32Array(outputs[0]);
      const match = parseYolov10Output(output, targetLabelsSV.value, TARGET_CONFIDENCE);

      if (match) {
        consecutiveHits.value += 1;
        if (consecutiveHits.value >= HITS_REQUIRED) {
          matched.value = true;
          onMatchJS(match);
        }
      } else {
        consecutiveHits.value = 0;
      }
    } catch (e) {
      // worklet 에러는 조용히 무시 (다음 프레임에 재시도)
    }
  }, [boxedModel, resize, onMatchJS]);

  // 카운트다운 (1초 간격)
  useEffect(() => {
    if (!cameraOpen) return;
    if (isRetryBannerVisible) return; // 재시도 배너 표시 중엔 타이머 정지
    if (matched.value) return;

    const id = setInterval(() => {
      setRemainingMs((prev) => Math.max(0, prev - 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [cameraOpen, isRetryBannerVisible, matched]);

  // 만료 처리 (cleanup에서 setTimeout 취소하지 않음 — useRef로 관리)
  useEffect(() => {
    if (!cameraOpen) return;
    if (isRetryBannerVisible) return; // 배너 표시 중 재진입 방지
    if (remainingMs > 0) return;
    if (matched.value) return;

    if (attemptCount === 1) {
      // 1회차 만료 → 재시도 배너 1초 → 2회차 시작 (미션 유지, 카운트다운 리셋)
      setIsRetryBannerVisible(true);
      retryTimeoutRef.current = setTimeout(() => {
        consecutiveHits.value = 0;
        matched.value = false;
        setRemainingMs(missionDurationRef.current * 1000);
        setAttemptCount(2);
        setIsRetryBannerVisible(false);
        retryTimeoutRef.current = null;
      }, RETRY_BANNER_MS);
      // cleanup 없음 — state 변경으로 인한 재실행 시 timeout 취소 금지
    } else {
      // 2회차 만료 → 실패 시뮬레이션 (PoC)
      Alert.alert(
        '2회차 실패',
        '실제 빌드에서는 광고 + 실패 화면',
        [{ text: '확인', onPress: () => setCameraOpen(false) }]
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remainingMs, cameraOpen, isRetryBannerVisible, attemptCount]);

  // 언마운트/카메라 닫힘 시 타이머 정리
  useEffect(() => {
    if (!cameraOpen && retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
  }, [cameraOpen]);

  useEffect(() => {
    return () => {
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
    };
  }, []);

  const startScan = () => {
    setError(null);
    setLastMatch(null);
    setCompleted(null);
    setScanPhase('scanning');
    progressAnim.setValue(0);
    blinkAnim.setValue(0);
    matched.value = false;
    lastRun.value = 0;
    frameLogged.value = false;
    consecutiveHits.value = 0;
    // 스캔 시작 시 새 랜덤 미션 선택
    const initialMission = pickRandom(MISSION_POOL);
    setCurrentMission(initialMission);
    targetLabelsSV.value = MISSION_COCO_LABELS[initialMission] ?? [];
    setAttemptCount(1);
    setRemainingMs(missionDurationRef.current * 1000);
    setIsRetryBannerVisible(false);
    setCameraOpen(true);
  };

  // 다시 뽑기 — 바로 이전 미션 제외한 22개 중 랜덤
  // carousel 리셋: currentMission, consecutiveHits, matched만. remainingMs/attemptCount는 유지.
  const reshuffleMission = useCallback(() => {
    if (isRetryBannerVisible) return; // 배너 표시 중엔 비활성
    const next = pickRandom(MISSION_POOL, currentMissionRef.current);
    setCurrentMission(next);
    targetLabelsSV.value = MISSION_COCO_LABELS[next] ?? [];
    consecutiveHits.value = 0;
    matched.value = false;
  }, [isRetryBannerVisible, consecutiveHits, matched, targetLabelsSV]);

  // 언마운트 cleanup
  useEffect(() => {
    return () => {
      matched.value = true;
    };
  }, [matched]);

  // AppState background → 중단
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        matched.value = true;
        setCameraOpen(false);
      }
    });
    return () => sub.remove();
  }, [matched]);

  const fillHeight = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });
  const fillOpacity = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.3, 0.55],
  });

  const modelReady = model != null;
  const missionLabel = t(`icons.${currentMission}`, { defaultValue: currentMission });
  const remainingSeconds = Math.ceil(remainingMs / 1000);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <MaterialIcons name="arrow-back" size={24} color={colors.onBackground} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>PoC: YOLOv10 Frame Scan</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={[styles.statusBanner, modelReady ? styles.statusOk : styles.statusLoading]}>
          <MaterialIcons
            name={modelReady ? 'check-circle' : 'hourglass-empty'}
            size={20}
            color="#fff"
          />
          <Text style={styles.statusText}>
            {modelReady
              ? `모델 준비 완료 (YOLOv10n CPU) · 미션 타이머 ${missionDuration}초`
              : `모델 로드 중... (${plugin.state})`}
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>다음 미션 (랜덤)</Text>
          <View style={styles.currentMissionBox}>
            <MaterialIcons name={currentMission as any} size={48} color={colors.primary} />
            <Text style={styles.currentMissionName}>{missionLabel}</Text>
            <Text style={styles.currentMissionLabels}>
              {(MISSION_COCO_LABELS[currentMission] ?? []).join(', ')}
            </Text>
          </View>
        </View>

        <TouchableOpacity
          style={[styles.primaryBtn, !modelReady && styles.btnDisabled]}
          onPress={startScan}
          disabled={!modelReady || !device}
        >
          <MaterialIcons name="qr-code-scanner" size={22} color="#fff" />
          <Text style={styles.primaryBtnText}>스캔 시작</Text>
        </TouchableOpacity>

        {!device && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>카메라 기기를 찾을 수 없습니다.</Text>
          </View>
        )}

        {error && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {completed && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>✅ 스캔 완료</Text>
            <View style={[styles.resultBox, { backgroundColor: '#dcfce7' }]}>
              <View style={styles.resultRow}>
                <Text style={[styles.resultLabel, { color: '#166534' }]}>{completed.label}</Text>
                <Text style={[styles.resultValue, { color: '#16a34a', fontWeight: '800' }]}>
                  {completed.confidence.toFixed(3)}
                </Text>
              </View>
            </View>
          </View>
        )}
      </ScrollView>

      <Modal visible={cameraOpen} animationType="slide">
        <View style={styles.cameraContainer}>
          {device && hasPermission ? (
            <>
              <Camera
                style={StyleSheet.absoluteFill}
                device={device}
                isActive={cameraOpen}
                frameProcessor={frameProcessor}
                resizeMode="contain"
                videoStabilizationMode="off"
                photo={false}
                video={false}
                {...(format ? { format } : {})}
              />

              {/* 상단 어둠 */}
              <View pointerEvents="none" style={[styles.dimOverlay, { top: 0, height: TB_OFFSET }]} />
              {/* 하단 어둠 */}
              <View pointerEvents="none" style={[styles.dimOverlay, { bottom: 0, height: TB_OFFSET }]} />

              {/* 중앙 1:1 영역 */}
              <View
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  top: TB_OFFSET,
                  left: 0,
                  width: CENTER_SIZE,
                  height: CENTER_SIZE,
                  overflow: 'hidden',
                }}
              >
                <Animated.View style={[StyleSheet.absoluteFill, {
                  backgroundColor: '#32CD32',
                  opacity: blinkAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 0.4] }),
                }]} />
                <Animated.View style={[styles.centerFill, { height: fillHeight, opacity: fillOpacity }]} />
                <View style={styles.crosshairWrap}>
                  <View style={styles.crosshairH} />
                  <View style={styles.crosshairV} />
                </View>
              </View>

              {/* 상단: 미션 아이콘 + 이름 + 다시 뽑기 */}
              <SafeAreaView style={styles.cameraTopSafe}>
                <View style={styles.missionHeader}>
                  <MaterialIcons name={currentMission as any} size={36} color="#fff" />
                  <Text style={styles.missionTitle}>{missionLabel}</Text>
                  <TouchableOpacity
                    style={[styles.reshuffleBtn, isRetryBannerVisible && styles.btnDisabled]}
                    onPress={reshuffleMission}
                    disabled={isRetryBannerVisible}
                  >
                    <MaterialIcons name="shuffle" size={18} color="#fff" />
                    <Text style={styles.reshuffleBtnText}>{t('alarm.reshuffle', { defaultValue: '다시 뽑기' })}</Text>
                  </TouchableOpacity>
                </View>
              </SafeAreaView>

              {/* 재시도 배너 (중앙 상단 오버레이) */}
              {isRetryBannerVisible && (
                <View style={styles.retryBanner} pointerEvents="none">
                  <Text style={styles.retryBannerTitle}>
                    {t('alarm.retrying', { defaultValue: '재시도' })}
                  </Text>
                  <Text style={styles.retryBannerSub}>
                    {t('alarm.missionRetryHint', {
                      mission: missionLabel,
                      defaultValue: `${missionLabel}을 다시 찾아주세요`,
                    })}
                  </Text>
                </View>
              )}

              {/* 하단 상태 — 카운트다운 + 스캔 단계 */}
              <SafeAreaView style={styles.cameraBottomSafe}>
                <View style={styles.scanResultBox}>
                  {scanPhase === 'scanning' && (
                    <>
                      <Text style={styles.scanResultLabel}>
                        {missionLabel} · {attemptCount}/2
                      </Text>
                      <Text style={styles.scanCountdown}>{remainingSeconds}초</Text>
                    </>
                  )}
                  {scanPhase === 'detected' && (
                    <Text style={styles.scanResultLabel}>
                      {missionLabel} 감지됨
                    </Text>
                  )}
                  {scanPhase === 'filling' && (
                    <AnimatedProgressBigText anim={progressAnim} />
                  )}
                </View>
              </SafeAreaView>
            </>
          ) : (
            <View style={styles.permissionDenied}>
              <Text style={{ color: '#fff' }}>카메라 권한이 필요합니다.</Text>
            </View>
          )}
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function AnimatedProgressBigText({ anim }: { anim: Animated.Value }) {
  const [pct, setPct] = useState(0);
  useEffect(() => {
    const id = anim.addListener(({ value }) => setPct(Math.round(value * 100)));
    return () => anim.removeListener(id);
  }, [anim]);
  return (
    <Text style={{ color: '#32CD32', fontSize: 32, fontWeight: '800', fontVariant: ['tabular-nums'] }}>
      {pct}%
    </Text>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: 16, paddingVertical: 16,
    },
    backBtn: { padding: 8, borderRadius: 50, width: 40 },
    headerTitle: {
      fontSize: 18, fontWeight: '800', color: colors.onBackground, letterSpacing: -0.5,
    },
    content: { paddingHorizontal: 24, paddingBottom: 48, gap: 24 },
    statusBanner: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      paddingHorizontal: 16, paddingVertical: 12, borderRadius: 12,
    },
    statusOk: { backgroundColor: '#16a34a' },
    statusLoading: { backgroundColor: '#64748b' },
    statusText: { color: '#fff', fontSize: 13, fontWeight: '600' },
    section: { gap: 8 },
    sectionTitle: {
      fontSize: 11, fontWeight: '800', color: colors.secondary, letterSpacing: 1.5,
    },
    currentMissionBox: {
      padding: 20, borderRadius: 16,
      backgroundColor: colors.surfaceContainerLow,
      alignItems: 'center', gap: 8,
    },
    currentMissionName: {
      fontSize: 20, fontWeight: '800', color: colors.onBackground,
    },
    currentMissionLabels: {
      fontSize: 12, color: colors.secondary,
    },
    primaryBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
      gap: 8, paddingVertical: 14, borderRadius: 12, backgroundColor: colors.primary,
    },
    primaryBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
    btnDisabled: { opacity: 0.4 },
    errorBox: { padding: 16, borderRadius: 12, backgroundColor: '#fef2f2' },
    errorText: { color: '#dc2626', fontSize: 13 },
    resultBox: {
      padding: 16, borderRadius: 12, backgroundColor: colors.surfaceContainerLow, gap: 10,
    },
    resultRow: {
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    },
    resultLabel: { fontSize: 15, color: colors.onBackground, fontWeight: '600' },
    resultValue: { fontSize: 15, color: colors.secondary, fontVariant: ['tabular-nums'] },
    cameraContainer: { flex: 1, backgroundColor: '#000' },
    cameraTopSafe: {
      position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
    },
    missionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingTop: 12,
      gap: 12,
    },
    missionTitle: {
      color: '#fff', fontSize: 20, fontWeight: '800', flex: 1, marginLeft: 8,
    },
    reshuffleBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 6,
      paddingHorizontal: 12, paddingVertical: 8,
      borderRadius: 20,
      backgroundColor: 'rgba(255,255,255,0.18)',
    },
    reshuffleBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
    cameraBottomSafe: {
      position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 10,
      alignItems: 'center', paddingBottom: 16,
    },
    dimOverlay: {
      position: 'absolute', left: 0, right: 0,
      backgroundColor: 'rgba(0,0,0,0.6)',
    },
    centerFill: {
      position: 'absolute', top: 0, left: 0, right: 0,
      backgroundColor: '#32CD32',
    },
    crosshairWrap: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'center',
      justifyContent: 'center',
    },
    crosshairH: {
      position: 'absolute', width: 24, height: 2, backgroundColor: '#B8E986',
    },
    crosshairV: {
      position: 'absolute', width: 2, height: 24, backgroundColor: '#B8E986',
    },
    permissionDenied: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    scanResultBox: {
      paddingHorizontal: 20, paddingVertical: 14, borderRadius: 16,
      backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', gap: 4,
      minWidth: 220,
    },
    scanResultLabel: { color: '#fff', fontSize: 16, fontWeight: '800' },
    scanCountdown: {
      color: '#B8E986', fontSize: 28, fontWeight: '800',
      fontVariant: ['tabular-nums'],
    },
    retryBanner: {
      position: 'absolute',
      top: TB_OFFSET + CENTER_SIZE * 0.25,
      left: 24, right: 24,
      paddingVertical: 16, paddingHorizontal: 20,
      borderRadius: 16,
      backgroundColor: 'rgba(0,0,0,0.7)',
      alignItems: 'center', gap: 6,
      zIndex: 20,
    },
    retryBannerTitle: {
      color: '#fff', fontSize: 28, fontWeight: '900', letterSpacing: 0.5,
    },
    retryBannerSub: {
      color: '#ddd', fontSize: 13, fontWeight: '600', textAlign: 'center',
    },
  });
