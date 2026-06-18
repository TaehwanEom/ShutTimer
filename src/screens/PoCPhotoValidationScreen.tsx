// @v1.5-poc — YOLOv10 Object Detection 검증 화면. 심사 제출 직전까지 유지 + 정식 후 내부 검증 도구로 지속 사용.
// 카테고리 탭 + 미션 직접 선택 그리드 + 진단 로그([Diag] tgtBest/top/targetMatches) + 슬롯머신 효과
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ScrollView,
  Modal,
  AppState,
  Animated,
  Dimensions,
  Image,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
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
  diagnoseYolov10Output,
  type Detection,
} from '../utils/objectDetection';
import {
  MISSION_POOL,
  MISSION_EMOJI,
  MISSION_LABEL,
  MISSION_COCO_LABELS,
  MISSION_CATEGORIES,
  MISSION_CONFIDENCE_OVERRIDE,
} from '../constants/missionIcons';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'PoCPhotoValidation'>;
};

const TARGET_CONFIDENCE = 0.4;
const THROTTLE_MS = 800;
const BLINK_ON_MS = 100;
const BLINK_OFF_MS = 80;
const BLINK_COUNT = 2;
const FEEDBACK_DELAY_MS = 300;
const COMPLETE_ANIM_MS = 1000;
const HITS_REQUIRED = 3; // 3프레임 연속 매칭
const RETRY_BANNER_MS = 1000;

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
  const [cameraPosition, setCameraPosition] = useState<'back' | 'front'>('back');
  const device = useCameraDevice(cameraPosition);
  const toggleCamera = useCallback(() => {
    setCameraPosition((p) => (p === 'back' ? 'front' : 'back'));
  }, []);

  const FOV_MAX = 70;
  const format = useMemo(() => {
    if (!device) return undefined;
    const candidates = device.formats
      .filter((f) => f.fieldOfView != null)
      .filter((f) => f.videoStabilizationModes.includes('off'))
      .filter((f) => f.videoWidth >= 640 && f.videoHeight >= 640)
      .filter((f) => f.fieldOfView <= FOV_MAX)
      .sort((a, b) => b.fieldOfView - a.fieldOfView);
    return candidates[0] ?? device.formats[0];
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
    require('../../assets/models/yolov10s_float16.tflite'),
    Platform.OS === 'ios' ? ['core-ml'] : []
  );
  const model = plugin.state === 'loaded' ? plugin.model : undefined;
  const boxedModel = useMemo(
    () => (model != null ? NitroModules.box(model) : undefined),
    [model]
  );
  const { resize } = useResizePlugin();

  // 미션 타이머 설정값
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

  // @v1.5-poc — 카테고리 탭 (기본 첫 카테고리, null=전체)
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(
    MISSION_CATEGORIES[0]?.id ?? null
  );
  const selectedCategoryIdRef = useRef<string | null>(selectedCategoryId);
  useEffect(() => { selectedCategoryIdRef.current = selectedCategoryId; }, [selectedCategoryId]);
  const getPool = useCallback((): string[] => {
    const id = selectedCategoryIdRef.current;
    if (!id) return MISSION_POOL;
    const cat = MISSION_CATEGORIES.find((c) => c.id === id);
    return cat?.keys ?? MISSION_POOL;
  }, []);

  // 미션 상태
  const [currentMission, setCurrentMission] = useState<string>(() => pickRandom(MISSION_POOL));
  const [cameraOpen, setCameraOpen] = useState(false);
  const [, setLastMatch] = useState<Detection | null>(null);
  const [completed, setCompleted] = useState<Detection | null>(null);
  const [scanPhase, setScanPhase] = useState<'scanning' | 'detected' | 'filling'>('scanning');
  const [error, setError] = useState<string | null>(null);
  const [attemptCount, setAttemptCount] = useState<1 | 2>(1);
  const [remainingMs, setRemainingMs] = useState<number>(DEFAULT_SETTINGS.missionDuration * 1000);
  const [isRetryBannerVisible, setIsRetryBannerVisible] = useState(false);

  const currentMissionRef = useRef(currentMission);
  useEffect(() => { currentMissionRef.current = currentMission; }, [currentMission]);

  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // @v1.5 슬롯머신 효과 (다시 뽑기 시 1.2초 이미지 순환)
  const [isShuffling, setIsShuffling] = useState(false);
  const [shuffledList, setShuffledList] = useState<string[]>([]);
  const [shuffleIdx, setShuffleIdx] = useState(0);
  const shuffleIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const shuffleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearShuffle = useCallback(() => {
    if (shuffleIntervalRef.current) {
      clearInterval(shuffleIntervalRef.current);
      shuffleIntervalRef.current = null;
    }
    if (shuffleTimeoutRef.current) {
      clearTimeout(shuffleTimeoutRef.current);
      shuffleTimeoutRef.current = null;
    }
  }, []);

  const progressAnim = useRef(new Animated.Value(0)).current;
  const blinkAnim = useRef(new Animated.Value(0)).current;

  // Worklet 공유 상태
  const matched = useSharedValue(false);
  const lastRun = useSharedValue(0);
  const targetLabelsSV = useSharedValue<string[]>(MISSION_COCO_LABELS[currentMission] ?? []);
  const thresholdSV = useSharedValue<number>(
    MISSION_CONFIDENCE_OVERRIDE[currentMission] ?? TARGET_CONFIDENCE
  );
  const consecutiveHits = useSharedValue(0);
  const frameLogged = useSharedValue(false);
  const isShufflingSV = useSharedValue(false); // 슬롯머신 중 worklet 스캔 일시 차단

  // 미션 변경 시 SharedValue 동기화
  useEffect(() => {
    targetLabelsSV.value = MISSION_COCO_LABELS[currentMission] ?? [];
    thresholdSV.value = MISSION_CONFIDENCE_OVERRIDE[currentMission] ?? TARGET_CONFIDENCE;
  }, [currentMission, targetLabelsSV, thresholdSV]);

  // 카테고리 탭 변경 시 currentMission이 해당 카테고리에 없으면 첫 미션으로 자동 전환
  useEffect(() => {
    if (!selectedCategoryId) return;
    const cat = MISSION_CATEGORIES.find((c) => c.id === selectedCategoryId);
    if (!cat) return;
    if (!cat.keys.includes(currentMissionRef.current)) {
      const first = cat.keys[0];
      if (first) {
        setCurrentMission(first);
        targetLabelsSV.value = MISSION_COCO_LABELS[first] ?? [];
        thresholdSV.value = MISSION_CONFIDENCE_OVERRIDE[first] ?? TARGET_CONFIDENCE;
      }
    }
  }, [selectedCategoryId, targetLabelsSV, thresholdSV]);

  // 미션 직접 선택 (카드 탭)
  const selectMission = useCallback((key: string) => {
    setCurrentMission(key);
    targetLabelsSV.value = MISSION_COCO_LABELS[key] ?? [];
    thresholdSV.value = MISSION_CONFIDENCE_OVERRIDE[key] ?? TARGET_CONFIDENCE;
  }, [targetLabelsSV, thresholdSV]);

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

  useEffect(() => {
    if (plugin.state === 'error') {
      Alert.alert('모델 로드 실패', String(plugin.error), [
        { text: '확인', onPress: () => navigation.goBack() },
      ]);
    }
  }, [plugin, navigation]);

  // 감지 시퀀스 (JS 스레드)
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

  const onMatchJS = useRunOnJS((match: Detection) => {
    triggerDetectionSequence(match);
  }, [triggerDetectionSequence]);

  // Frame Processor (Worklet) — 3프레임 연속 매칭 시 통과
  const frameProcessor = useFrameProcessor((frame) => {
    'worklet';
    if (matched.value) return;
    if (isShufflingSV.value) return;
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

      // @v1.5-diag — 실기기 검증용. 검증 완료 후 제거 가능.
      const diag = diagnoseYolov10Output(output, targetLabelsSV.value, 0.1);
      console.log(
        '[Diag]',
        'len=', output.length,
        'rows=', diag.total,
        'target=', targetLabelsSV.value.join(','),
        'tgtBest=', diag.targetBestConf.toFixed(3),
        'top=[', diag.topLabels[0], diag.topConfs[0].toFixed(2), '|',
        diag.topLabels[1], diag.topConfs[1].toFixed(2), '|',
        diag.topLabels[2], diag.topConfs[2].toFixed(2), ']',
        'targetMatches=', diag.targetMatches,
      );

      const match = parseYolov10Output(output, targetLabelsSV.value, thresholdSV.value);

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
      // 다음 프레임에 재시도
    }
  }, [boxedModel, resize, onMatchJS]);

  // 카운트다운 (1초 간격, 슬롯머신 중 일시정지)
  useEffect(() => {
    if (!cameraOpen) return;
    if (isRetryBannerVisible) return;
    if (isShuffling) return;
    if (matched.value) return;

    const id = setInterval(() => {
      setRemainingMs((prev) => Math.max(0, prev - 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [cameraOpen, isRetryBannerVisible, isShuffling, matched]);

  // 만료 처리
  useEffect(() => {
    if (!cameraOpen) return;
    if (isRetryBannerVisible) return;
    if (isShuffling) return;
    if (remainingMs > 0) return;
    if (matched.value) return;

    if (attemptCount === 1) {
      setIsRetryBannerVisible(true);
      retryTimeoutRef.current = setTimeout(() => {
        consecutiveHits.value = 0;
        matched.value = false;
        setRemainingMs(missionDurationRef.current * 1000);
        setAttemptCount(2);
        setIsRetryBannerVisible(false);
        retryTimeoutRef.current = null;
      }, RETRY_BANNER_MS);
    } else {
      Alert.alert(
        '2회차 실패',
        '실제 빌드에서는 광고 + 실패 화면',
        [{ text: '확인', onPress: () => setCameraOpen(false) }]
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remainingMs, cameraOpen, isRetryBannerVisible, isShuffling, attemptCount]);

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

  // 언마운트 시 슬롯머신 타이머 정리
  useEffect(() => {
    return () => clearShuffle();
  }, [clearShuffle]);

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
    // 스캔 시작 — 현재 선택된 미션(currentMission) 그대로 사용
    targetLabelsSV.value = MISSION_COCO_LABELS[currentMissionRef.current] ?? [];
    thresholdSV.value = MISSION_CONFIDENCE_OVERRIDE[currentMissionRef.current] ?? TARGET_CONFIDENCE;
    setAttemptCount(1);
    setRemainingMs(missionDurationRef.current * 1000);
    setIsRetryBannerVisible(false);
    setCameraOpen(true);
  };

  // 다시 뽑기 — 슬롯머신 1.2초, 카테고리 범위 내 랜덤
  const reshuffleMission = useCallback(() => {
    if (isRetryBannerVisible) return;
    if (shuffleIntervalRef.current || shuffleTimeoutRef.current) return;

    // 1) worklet 스캔 일시 차단 (matched는 성공 신호 전용)
    isShufflingSV.value = true;
    consecutiveHits.value = 0;

    // 2) 최종 미션 즉시 확정
    const final = pickRandom(getPool(), currentMissionRef.current);
    setCurrentMission(final);
    targetLabelsSV.value = MISSION_COCO_LABELS[final] ?? [];
    thresholdSV.value = MISSION_CONFIDENCE_OVERRIDE[final] ?? TARGET_CONFIDENCE;

    // 3) 비주얼 슬롯머신 — 미리 셔플된 배열 순환
    const visualPool = getPool().filter((k) => k !== final);
    const shuffled = [...visualPool].sort(() => Math.random() - 0.5);
    if (shuffled.length === 0) shuffled.push(final);
    setShuffledList(shuffled);
    setShuffleIdx(0);
    setIsShuffling(true);
    shuffleIntervalRef.current = setInterval(() => {
      setShuffleIdx((i) => (i + 1) % shuffled.length);
    }, 60);

    // 4) 1.2초 후 종료
    shuffleTimeoutRef.current = setTimeout(() => {
      if (shuffleIntervalRef.current) {
        clearInterval(shuffleIntervalRef.current);
        shuffleIntervalRef.current = null;
      }
      shuffleTimeoutRef.current = null;
      setShuffledList([]);
      setShuffleIdx(0);
      setIsShuffling(false);
      isShufflingSV.value = false;
    }, 1200);
  }, [isRetryBannerVisible, consecutiveHits, isShufflingSV, targetLabelsSV, thresholdSV, getPool]);

  // 카메라 수동 종료
  const closeCamera = useCallback(() => {
    matched.value = true;
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
    clearShuffle();
    setIsShuffling(false);
    isShufflingSV.value = false;
    setIsRetryBannerVisible(false);
    setCameraOpen(false);
  }, [matched, clearShuffle, isShufflingSV]);

  useEffect(() => {
    return () => {
      matched.value = true;
    };
  }, [matched]);

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
  const missionLabel = t(`missions.${currentMission}`, { defaultValue: MISSION_LABEL[currentMission] ?? currentMission });
  const currentEmoji = MISSION_EMOJI[currentMission];
  const remainingSeconds = Math.ceil(remainingMs / 1000);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <MaterialIcons name="chevron-left" size={32} color={colors.onBackground} />
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
              ? `모델 준비 완료 (YOLOv10s CoreML) · 미션 타이머 ${missionDuration}초`
              : `모델 로드 중... (${plugin.state})`}
          </Text>
        </View>

        {/* 카테고리 탭 (가로 스크롤) */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>카테고리</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabBar}>
            <TouchableOpacity
              style={[styles.tabBtn, !selectedCategoryId && styles.tabBtnActive]}
              onPress={() => setSelectedCategoryId(null)}
              activeOpacity={0.7}
            >
              <Text style={[styles.tabBtnText, !selectedCategoryId && styles.tabBtnTextActive]}>
                전체 ({MISSION_POOL.length})
              </Text>
            </TouchableOpacity>
            {MISSION_CATEGORIES.map((c) => {
              const active = selectedCategoryId === c.id;
              return (
                <TouchableOpacity
                  key={c.id}
                  style={[styles.tabBtn, active && styles.tabBtnActive]}
                  onPress={() => setSelectedCategoryId(c.id)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.tabBtnText, active && styles.tabBtnTextActive]}>
                    {t(`missionCategories.${c.id}`, { defaultValue: c.label })} ({c.keys.length})
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        {/* 미션 직접 선택 그리드 */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>미션 선택 (탭하여 지정)</Text>
          <View style={styles.missionGrid}>
            {getPool().map((key) => {
              const selected = currentMission === key;
              const emoji = MISSION_EMOJI[key];
              const label = t(`missions.${key}`, { defaultValue: MISSION_LABEL[key] ?? key });
              return (
                <TouchableOpacity
                  key={key}
                  style={[styles.missionCard, selected && styles.missionCardSelected]}
                  onPress={() => selectMission(key)}
                  activeOpacity={0.7}
                >
                  {emoji ? (
                    <Image source={emoji} style={styles.missionCardEmoji} resizeMode="contain" />
                  ) : (
                    <View style={styles.missionCardEmoji} />
                  )}
                  <Text style={[styles.missionCardLabel, selected && styles.missionCardLabelSelected]} numberOfLines={1}>
                    {label}
                  </Text>
                  {selected && (
                    <View style={styles.missionCardCheck}>
                      <MaterialIcons name="check-circle" size={18} color={colors.primary} />
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
          <View style={styles.selectedTargetBox}>
            <Text style={styles.selectedTargetLabel}>선택된 미션</Text>
            <Text style={styles.selectedTargetName}>{missionLabel}</Text>
            <Text style={styles.selectedTargetCoco}>
              COCO: {(MISSION_COCO_LABELS[currentMission] ?? []).join(', ')} · thresh {(MISSION_CONFIDENCE_OVERRIDE[currentMission] ?? TARGET_CONFIDENCE).toFixed(2)}
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

              {/* 상단: 닫기 + 미션 아이콘(이모지) + 이름 + 다시 뽑기 */}
              <SafeAreaView style={styles.cameraTopSafe}>
                <View style={styles.missionHeader}>
                  <TouchableOpacity onPress={closeCamera} style={styles.closeBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <MaterialIcons name="close" size={26} color="#fff" />
                  </TouchableOpacity>
                  {/* 이모지: 슬롯머신 중 pre-mount + opacity swap, 아니면 currentEmoji */}
                  <View style={{ width: 40, height: 40, position: 'relative' }}>
                    {currentEmoji ? (
                      <Image
                        source={currentEmoji}
                        style={{ position: 'absolute', top: 0, left: 0, width: 40, height: 40, opacity: isShuffling ? 0 : 1 }}
                        resizeMode="contain"
                      />
                    ) : (
                      <View style={{ opacity: isShuffling ? 0 : 1 }}>
                        <MaterialIcons name={currentMission as any} size={36} color="#fff" />
                      </View>
                    )}
                    {isShuffling && shuffledList.map((k, i) => (
                      <Image
                        key={k}
                        source={MISSION_EMOJI[k]}
                        style={{ position: 'absolute', top: 0, left: 0, width: 40, height: 40, opacity: i === shuffleIdx ? 1 : 0 }}
                        resizeMode="contain"
                      />
                    ))}
                  </View>
                  <Text style={styles.missionTitle} numberOfLines={1}>
                    {isShuffling ? '' : missionLabel}
                  </Text>
                  <TouchableOpacity
                    style={[styles.reshuffleBtn, (isRetryBannerVisible || isShuffling) && styles.btnDisabled]}
                    onPress={reshuffleMission}
                    disabled={isRetryBannerVisible || isShuffling}
                  >
                    <MaterialIcons name="shuffle" size={18} color="#fff" />
                    <Text style={styles.reshuffleBtnText}>{t('alarm.reshuffle', { defaultValue: '다시 뽑기' })}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.flipBtn, isShuffling && styles.btnDisabled]}
                    onPress={toggleCamera}
                    disabled={isShuffling}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <MaterialIcons name="flip-camera-ios" size={20} color="#fff" />
                  </TouchableOpacity>
                </View>
              </SafeAreaView>

              {/* 재시도 배너 */}
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

              {/* 하단 상태 */}
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

const MISSION_GRID_PADDING_H = 24;
const MISSION_GRID_GAP = 8;
const MISSION_GRID_COL = 3;
const MISSION_CARD_W = Math.floor((SCREEN_W - MISSION_GRID_PADDING_H * 2 - MISSION_GRID_GAP * (MISSION_GRID_COL - 1)) / MISSION_GRID_COL);
const MISSION_CARD_H = Math.floor(MISSION_CARD_W * 1.0);
const MISSION_EMOJI_SIZE = Math.floor(MISSION_CARD_W * 0.55);

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
    content: { paddingHorizontal: 24, paddingBottom: 48, gap: 20 },
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
    // 카테고리 탭 (가로 스크롤)
    tabBar: {
      flexDirection: 'row', gap: 8, paddingVertical: 4, paddingRight: 8,
    },
    tabBtn: {
      paddingHorizontal: 14, paddingVertical: 10,
      borderRadius: 20,
      backgroundColor: colors.surfaceContainerLow,
    },
    tabBtnActive: {
      backgroundColor: colors.primary,
    },
    tabBtnText: {
      color: colors.onBackground, fontSize: 14, fontWeight: '600',
    },
    tabBtnTextActive: {
      color: '#fff', fontWeight: '800',
    },
    // 미션 직접 선택 그리드
    missionGrid: {
      flexDirection: 'row', flexWrap: 'wrap', gap: MISSION_GRID_GAP,
    },
    missionCard: {
      width: MISSION_CARD_W,
      height: MISSION_CARD_H,
      backgroundColor: colors.surfaceContainerLow,
      borderRadius: 12,
      alignItems: 'center', justifyContent: 'center',
      padding: 8,
      borderWidth: 2, borderColor: 'transparent',
    },
    missionCardSelected: {
      borderColor: colors.primary,
      backgroundColor: colors.surfaceContainerLow,
    },
    missionCardEmoji: {
      width: MISSION_EMOJI_SIZE,
      height: MISSION_EMOJI_SIZE,
      marginBottom: 4,
    },
    missionCardLabel: {
      fontSize: 11, color: colors.onBackground, fontWeight: '600', textAlign: 'center',
    },
    missionCardLabelSelected: {
      color: colors.primary, fontWeight: '800',
    },
    missionCardCheck: {
      position: 'absolute', top: 4, right: 4,
    },
    selectedTargetBox: {
      marginTop: 12, padding: 12, borderRadius: 10,
      backgroundColor: colors.surfaceContainerLow,
      alignItems: 'center', gap: 2,
    },
    selectedTargetLabel: {
      fontSize: 10, color: colors.secondary, fontWeight: '700', letterSpacing: 1,
    },
    selectedTargetName: {
      fontSize: 18, fontWeight: '800', color: colors.onBackground,
    },
    selectedTargetCoco: {
      fontSize: 11, color: colors.secondary, fontVariant: ['tabular-nums'],
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
    closeBtn: {
      width: 36, height: 36, borderRadius: 18,
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: 'rgba(0,0,0,0.35)',
    },
    missionTitle: {
      color: '#fff', fontSize: 18, fontWeight: '800', flex: 1, marginLeft: 4,
    },
    reshuffleBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 6,
      paddingHorizontal: 12, paddingVertical: 8,
      borderRadius: 20,
      backgroundColor: 'rgba(255,255,255,0.18)',
    },
    reshuffleBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
    flipBtn: {
      width: 36, height: 36, borderRadius: 18,
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: 'rgba(255,255,255,0.18)',
    },
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
