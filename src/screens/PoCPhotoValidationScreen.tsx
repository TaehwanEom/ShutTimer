// @v1.5-poc — YOLOv10n Object Detection 스파이크 검증 화면. PASS 후 제거.
// Phase 1: VisionCamera Frame Processor + Metal/core-ml GPU Delegate
import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../App';
import { useTheme } from '../context/ThemeContext';
import { ThemeColors } from '../constants/theme';
import {
  parseYolov10Output,
  MISSION_COCO_LABELS,
  type Detection,
} from '../utils/objectDetection';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'PoCPhotoValidation'>;
};

// PoC 미션 선택지 (MISSION_COCO_LABELS에서 대표 6개)
const POC_MISSIONS: { id: string; name: string; labels: string[] }[] = [
  { id: 'tv', name: 'TV', labels: MISSION_COCO_LABELS['tv'] },
  { id: 'local-cafe', name: '컵', labels: MISSION_COCO_LABELS['local-cafe'] },
  { id: 'menu-book', name: '책', labels: MISSION_COCO_LABELS['menu-book'] },
  { id: 'computer', name: '노트북', labels: MISSION_COCO_LABELS['computer'] },
  { id: 'phone-android', name: '폰', labels: MISSION_COCO_LABELS['phone-android'] },
  { id: 'pets', name: '반려동물', labels: MISSION_COCO_LABELS['pets'] },
];

const TARGET_CONFIDENCE = 0.4;
const THROTTLE_MS = 800;
const BLINK_ON_MS = 100;
const BLINK_OFF_MS = 80;
const BLINK_COUNT = 2;
const FEEDBACK_DELAY_MS = 300;
const COMPLETE_ANIM_MS = 1000;

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const CENTER_SIZE = SCREEN_W;
const TB_OFFSET = (SCREEN_H - CENTER_SIZE) / 2;

export default function PoCPhotoValidationScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('back');
  // 화각 확대 체감 완화: device.formats 중 fieldOfView ≤ 70° 범위에서 최대값 선택
  // (실기기 튜닝 결과: 70°가 자연스러운 wide-angle — 울트라와이드는 어안 왜곡 유발)
  // 안전망:
  //  1. fieldOfView 값 존재 (Issue #3505 버전 간 차이 방어)
  //  2. videoStabilizationModes 'off' 지원 (Camera prop 유효성 보장)
  //  3. 해상도 ≥ 640 (Frame Processor resize 640×640 upscale 방지)
  //  4. fieldOfView ≤ 70° (wide-angle 유지, 울트라와이드 배제)
  // 전부 걸러지면 undefined → VisionCamera 자동 기본 포맷
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
  // 실측 로그 (스파이크 중 FOV/해상도 확인용)
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
    // YOLOv10 일부 ops가 GPU delegate 미호환 가능성 → 일단 CPU(XNNPACK)로 시작
    []
  );
  const model = plugin.state === 'loaded' ? plugin.model : undefined;
  // 공식 필수 패턴: TfliteModel은 Nitro HybridObject(jsi::NativeState).
  // VisionCamera v4 worklet runtime은 NativeState 직접 접근 불가 → box/unbox 필수.
  // (v5에서 해소 예정)
  const boxedModel = useMemo(
    () => (model != null ? NitroModules.box(model) : undefined),
    [model]
  );
  const { resize } = useResizePlugin();

  const [selectedMission, setSelectedMission] = useState(POC_MISSIONS[0]);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [lastMatch, setLastMatch] = useState<Detection | null>(null);
  const [completed, setCompleted] = useState<Detection | null>(null);
  const [scanPhase, setScanPhase] = useState<'scanning' | 'detected' | 'filling'>('scanning');
  const [error, setError] = useState<string | null>(null);

  const progressAnim = useRef(new Animated.Value(0)).current;
  const blinkAnim = useRef(new Animated.Value(0)).current;

  // Worklet 공유 상태
  const matched = useSharedValue(false);
  const lastRun = useSharedValue(0);
  const targetLabelsSV = useSharedValue<string[]>(POC_MISSIONS[0].labels);
  // Stage A 실측용: 첫 프레임 1회만 크기 로깅
  const frameLogged = useSharedValue(false);

  // 미션 변경 시 SharedValue 동기화
  useEffect(() => {
    targetLabelsSV.value = selectedMission.labels;
  }, [selectedMission, targetLabelsSV]);

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

  // 감지 시퀀스 (JS 스레드)
  const triggerDetectionSequence = (match: Detection) => {
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
  };

  // Worklet → JS 브릿지
  const onMatchJS = useRunOnJS((match: Detection) => {
    triggerDetectionSequence(match);
  }, []);

  // Frame Processor (Worklet) — 공식 패턴: boxedModel.unbox() 내부 사용 필수
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

      // TypedArray가 공유 버퍼일 수 있으므로 slice로 안전 추출
      const inputBuffer = resized.buffer.slice(
        resized.byteOffset,
        resized.byteOffset + resized.byteLength
      ) as ArrayBuffer;
      const outputs = tflite.runSync([inputBuffer]);
      const output = new Float32Array(outputs[0]);
      const match = parseYolov10Output(output, targetLabelsSV.value, TARGET_CONFIDENCE);

      if (match) {
        matched.value = true;
        onMatchJS(match);
      }
    } catch (e) {
      // worklet 에러는 조용히 무시 (다음 프레임에 재시도)
    }
  }, [boxedModel, resize, onMatchJS]);

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
    setCameraOpen(true);
  };

  const closeCamera = () => {
    matched.value = true; // worklet 중단
    setCameraOpen(false);
  };

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
              ? `모델 준비 완료 (YOLOv10n CPU)`
              : `모델 로드 중... (${plugin.state})`}
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>미션 선택</Text>
          <View style={styles.missionGrid}>
            {POC_MISSIONS.map((m) => (
              <TouchableOpacity
                key={m.id}
                style={[
                  styles.missionBtn,
                  selectedMission.id === m.id && styles.missionBtnActive,
                  cameraOpen && styles.btnDisabled,
                ]}
                onPress={() => setSelectedMission(m)}
                disabled={cameraOpen}
              >
                <Text style={[
                  styles.missionBtnText,
                  selectedMission.id === m.id && styles.missionBtnTextActive,
                ]}>
                  {m.name}
                </Text>
                <Text style={styles.missionBtnLabels}>{m.labels.join(', ')}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <TouchableOpacity
          style={[styles.primaryBtn, !modelReady && styles.btnDisabled]}
          onPress={startScan}
          disabled={!modelReady || !device}
        >
          <MaterialIcons name="qr-code-scanner" size={22} color="#fff" />
          <Text style={styles.primaryBtnText}>{selectedMission.name} 스캔 시작</Text>
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

      <Modal visible={cameraOpen} animationType="slide" onRequestClose={closeCamera}>
        <View style={styles.cameraContainer}>
          {device && hasPermission ? (
            <>
              {/* 풀 카메라 (VisionCamera) */}
              {/* - resizeMode="contain": 센서 원본 화각 유지 */}
              {/* - format: device.formats 중 fieldOfView 최대 수동 선택 (센서 활용 최대) */}
              {/* - videoStabilizationMode="off": iOS OIS/EIS crop 10% 회복 (Apple 공식) */}
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

              {/* 상단 X 버튼 */}
              <SafeAreaView style={styles.cameraTopSafe}>
                <TouchableOpacity style={styles.cameraCloseBtn} onPress={closeCamera}>
                  <MaterialIcons name="close" size={28} color="#fff" />
                </TouchableOpacity>
              </SafeAreaView>

              {/* 하단 상태 */}
              <SafeAreaView style={styles.cameraBottomSafe}>
                <View style={styles.scanResultBox}>
                  {scanPhase === 'scanning' && (
                    <>
                      <Text style={styles.scanResultLabel}>{selectedMission.name} 스캔 중</Text>
                      <Text style={[styles.scanResultConf, { color: '#aaa' }]}>감지 중...</Text>
                    </>
                  )}
                  {scanPhase === 'detected' && (
                    <Text style={styles.scanResultLabel}>
                      {selectedMission.name}가 감지되었습니다. 스캔합니다
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
    missionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    missionBtn: {
      paddingHorizontal: 14, paddingVertical: 10,
      borderRadius: 12,
      backgroundColor: colors.surfaceContainerLow,
      minWidth: '30%',
    },
    missionBtnActive: { backgroundColor: colors.primary },
    missionBtnText: { fontSize: 14, fontWeight: '700', color: colors.onBackground },
    missionBtnTextActive: { color: '#fff' },
    missionBtnLabels: { fontSize: 10, color: colors.secondary, marginTop: 2 },
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
    cameraBottomSafe: {
      position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 10,
      alignItems: 'center', paddingBottom: 16,
    },
    cameraCloseBtn: {
      margin: 16,
      width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.5)',
      alignItems: 'center', justifyContent: 'center',
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
    scanResultConf: { color: '#B8E986', fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
    scanResultMs: { color: '#888', fontSize: 11, fontVariant: ['tabular-nums'] },
  });
