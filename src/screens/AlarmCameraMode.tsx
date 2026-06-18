// @v1.5 Phase A — 카메라 모드 child 컴포넌트.
// shake/tap 모드에서 useTensorflowModel(15MB) + Camera 마운트 스킵 → JS thread 부하 제거.
// SharedValue는 부모에서 생성하고 props로 전달 (worklet에서 동일 참조 사용).

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Image,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { TFunction } from 'i18next';
import Svg, { Circle } from 'react-native-svg';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  useFrameProcessor,
} from 'react-native-vision-camera';
import { type TensorflowModel } from 'react-native-fast-tflite';
import { NitroModules } from 'react-native-nitro-modules';
import { useResizePlugin } from 'vision-camera-resize-plugin';
import { useRunOnJS, useSharedValue, type ISharedValue } from 'react-native-worklets-core';
import { parseYolov10Output, type Detection } from '../utils/objectDetection';
import { MISSION_EMOJI } from '../constants/missionIcons';
import { getTfliteModel } from '../utils/tfliteModelCache';
import { Logger } from '../utils/logger';

const THROTTLE_MS = 800;
const HITS_REQUIRED = 3;
const FOV_MAX = 70;

type Props = {
  // SharedValues — 부모에서 생성, props로 전달 (단일 참조 보장)
  matched: ISharedValue<boolean>;
  lastRun: ISharedValue<number>;
  targetLabelsSV: ISharedValue<string[]>;
  thresholdSV: ISharedValue<number>;
  consecutiveHits: ISharedValue<number>;
  isShufflingSV: ISharedValue<boolean>;

  // 미션 정보
  currentMission: string;
  currentEmoji: any;
  missionLabel: string;
  missionSentence: string;

  // 슬롯머신
  isShuffling: boolean;
  shuffledList: string[];
  shuffleIdx: number;

  // UI 상태
  isRetryBannerVisible: boolean;
  successAnimating: boolean;
  resultState: 'idle' | 'success' | 'fail';
  isDanger: boolean;
  remainingSeconds: number;
  // v1.8 — 미션 타이머 제한 없음 (= missionDuration === 0) 측 = 시간 표시 ❌.
  unlimited?: boolean;

  // 애니메이션 값 — 부모에서 생성
  successBlink: Animated.Value;
  successFill: Animated.Value;
  scanLine: Animated.Value;
  dangerBlink: Animated.Value;

  // 레이아웃
  boxWidth: number;
  boxHeight: number;

  // 콜백
  onMatchDetected: (match: Detection) => void;
  onReshuffle: () => void;

  // 권한 버튼 라벨용
  t: TFunction;

  // 권한 요청 fallback UI 색상
  permissionButtonStyle: any;
  permissionButtonTextStyle: any;
};

export default function AlarmCameraMode(props: Props) {
  const {
    matched, lastRun, targetLabelsSV, thresholdSV, consecutiveHits, isShufflingSV,
    currentMission, currentEmoji, missionLabel, missionSentence,
    isShuffling, shuffledList, shuffleIdx,
    isRetryBannerVisible, successAnimating, resultState, isDanger, remainingSeconds, unlimited,
    successBlink, successFill, scanLine, dangerBlink,
    boxWidth, boxHeight,
    onMatchDetected, onReshuffle,
    t,
    permissionButtonStyle, permissionButtonTextStyle,
  } = props;

  // 카메라 권한 + 디바이스
  const { hasPermission: hasCameraPermission, requestPermission } = useCameraPermission();
  const [cameraPosition, setCameraPosition] = useState<'back' | 'front'>('back');
  const device = useCameraDevice(cameraPosition);

  // 카메라 전환 race 방지 — JS ref + worklet SharedValue 이중 가드
  // worklet in-flight frame이 old device로 처리하다 vision-camera AVCaptureSession
  // 재초기화와 충돌해 crash 발생 (known issue #1925, #2657, #3606)
  const [isFlipping, setIsFlipping] = useState(false);
  const isFlippingRef = useRef(false);
  const isFlippingSV = useSharedValue(false);
  const flipTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toggleCamera = useCallback(() => {
    if (isFlippingRef.current) return;
    isFlippingRef.current = true;
    isFlippingSV.value = true; // worklet 즉시 차단
    setIsFlipping(true);
    // 다음 tick에 device 교체 → in-flight frame drain 확보
    requestAnimationFrame(() => {
      setCameraPosition((p) => (p === 'back' ? 'front' : 'back'));
    });
    if (flipTimeoutRef.current) clearTimeout(flipTimeoutRef.current);
    flipTimeoutRef.current = setTimeout(() => {
      isFlippingRef.current = false;
      isFlippingSV.value = false;
      setIsFlipping(false);
    }, 1200);
  }, [isFlippingSV]);
  useEffect(() => {
    return () => {
      if (flipTimeoutRef.current) clearTimeout(flipTimeoutRef.current);
    };
  }, []);

  // Format 선택 (FOV ≤ 70, stab off, ≥640)
  // @v1.5-thermal — 발열 개선용 필터/정렬. 회귀 시 [PREVIOUS CODE] 주석 블록으로 복구.
  // [PREVIOUS CODE]:
  //   const candidates = device.formats
  //     .filter((f) => f.fieldOfView != null)
  //     .filter((f) => f.videoStabilizationModes.includes('off'))
  //     .filter((f) => f.videoWidth >= 640 && f.videoHeight >= 640)
  //     .filter((f) => f.fieldOfView <= FOV_MAX)
  //     .sort((a, b) => b.fieldOfView - a.fieldOfView);
  const format = useMemo(() => {
    if (!device) return undefined;
    const candidates = device.formats
      .filter((f) => f.fieldOfView != null)
      .filter((f) => f.videoStabilizationModes.includes('off'))
      .filter((f) => f.videoWidth >= 640 && f.videoHeight >= 640)
      .filter((f) => f.fieldOfView <= FOV_MAX)
      .filter((f) => f.maxFps >= 15 && f.minFps <= 15) // v1.5-thermal: 15fps 지원 format 우선
      .sort((a, b) => a.maxFps - b.maxFps || b.fieldOfView - a.fieldOfView); // v1.5-thermal: 저fps 우선, 동률 시 광각 우선
    return candidates[0] ?? device.formats[0];
  }, [device]);

  // tflite 모델 로드 — module-level singleton cache (= getTfliteModel) 경유.
  // Android release 빌드 측 useTensorflowModel hook 의 MalformedURLException 회피 위해 cache 경유 필수.
  const [model, setModel] = useState<TensorflowModel | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    getTfliteModel()
      .then((m) => { if (!cancelled) setModel(m); })
      .catch((e: any) => { Logger.warn('TfliteCache', `load fail: ${e?.message || e}`); });
    return () => { cancelled = true; };
  }, []);
  const boxedModel = useMemo(
    () => (model != null ? NitroModules.box(model) : undefined),
    [model]
  );
  const { resize } = useResizePlugin();

  // worklet → JS bridge
  const onMatchJS = useRunOnJS((match: Detection) => {
    onMatchDetected(match);
  }, [onMatchDetected]);

  // Frame processor (worklet)
  const frameProcessor = useFrameProcessor((frame) => {
    'worklet';
    if (isFlippingSV.value) return; // 카메라 전환 중 in-flight frame 차단
    if (matched.value) return;
    if (isShufflingSV.value) return;
    if (boxedModel == null) return;
    // #CameraResizeCrash (2026-06-17) — 무효/0 크기 프레임을 resize 로 넘기면 네이티브 vImage(vImageScale_ARGB8888)
    //   에서 SIGSEGV 로 앱이 죽음(JS try/catch 로 못 잡힘). 카메라 종료/방향 전환 race 대비, resize 전 프레임 유효성 가드.
    if (!frame.isValid || frame.width === 0 || frame.height === 0) return;
    const now = Date.now();
    if (now - lastRun.value < THROTTLE_MS) return;
    lastRun.value = now;
    try {
      const tflite = boxedModel.unbox();
      const resized = resize(frame, {
        scale: { width: 640, height: 640 },
        pixelFormat: 'rgb',
        dataType: 'float32',
      });
      const inputBuffer = resized.buffer.slice(
        resized.byteOffset,
        resized.byteOffset + resized.byteLength
      ) as ArrayBuffer;
      const outputs = tflite.runSync([inputBuffer]);
      const output = new Float32Array(outputs[0]);
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
      // worklet 에러는 다음 프레임에서 재시도
    }
  }, [boxedModel, resize, onMatchJS]);

  return (
    <>
      {/* 카메라 박스 */}
      <View style={[cameraStyles.cameraCard, { width: boxWidth, height: boxHeight }]}>
        {hasCameraPermission && device ? (
          <>
            <Camera
              style={StyleSheet.absoluteFill}
              device={device}
              isActive={resultState === 'idle' && !isFlipping}
              frameProcessor={frameProcessor}
              fps={15} /* @v1.5-thermal — 30→15fps ISP 파이프라인 제한. 회귀 시 제거. */
              resizeMode="cover"
              videoStabilizationMode="off"
              photo={false}
              video={false}
              onStarted={() => {
                if (flipTimeoutRef.current) {
                  clearTimeout(flipTimeoutRef.current);
                  flipTimeoutRef.current = null;
                }
                isFlippingRef.current = false;
                isFlippingSV.value = false;
                setIsFlipping(false);
              }}
              {...(format ? { format } : {})}
            />
            {/* 감지 성공 피드백 — 연두 깜빡 (전면) */}
            <Animated.View pointerEvents="none" style={[
              StyleSheet.absoluteFill,
              {
                backgroundColor: '#22C55E',
                opacity: successBlink.interpolate({ inputRange: [0, 1], outputRange: [0, 0.28] }),
              },
            ]} />
            {/* 감지 성공 피드백 — 연두 채움 (top → bottom) */}
            <Animated.View pointerEvents="none" style={{
              position: 'absolute', top: 0, left: 0, right: 0,
              backgroundColor: '#22C55E',
              height: successFill.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
              opacity: successFill.interpolate({ inputRange: [0, 1], outputRange: [0.22, 0.42] }),
            }} />
            {/* 박스 상단 안내 카드 */}
            <View pointerEvents="none" style={cameraStyles.missionCard}>
              <View style={cameraStyles.emojiFrame}>
                {currentEmoji ? (
                  <Image
                    source={currentEmoji}
                    style={[cameraStyles.emojiImage, { opacity: isShuffling ? 0 : 1 }]}
                    resizeMode="contain"
                  />
                ) : (
                  <View style={{ opacity: isShuffling ? 0 : 1 }}>
                    <MaterialIcons name={currentMission as React.ComponentProps<typeof MaterialIcons>['name']} size={36} color="#111827" />
                  </View>
                )}
                {isShuffling && shuffledList.map((k, i) => (
                  <Image
                    key={k}
                    source={MISSION_EMOJI[k]}
                    style={[cameraStyles.emojiImage, { opacity: i === shuffleIdx ? 1 : 0 }]}
                    resizeMode="contain"
                  />
                ))}
              </View>
              <Text style={cameraStyles.missionText}>
                {isShuffling ? '' : missionSentence}
              </Text>
            </View>
            {/* 남은 초. v1.8 — unlimited 시 = "∞" 표시. */}
            <View pointerEvents="none" style={cameraStyles.timerPill}>
              <Animated.Text style={{
                color: isDanger ? '#EF4444' : '#111827',
                fontSize: 24, fontWeight: '900', fontVariant: ['tabular-nums'],
                opacity: isDanger ? dangerBlink.interpolate({ inputRange: [0, 1], outputRange: [1, 0.25] }) : 1,
              }}>
                {unlimited ? '∞' : `${remainingSeconds}${t('settings.secondsUnit', { defaultValue: '초' })}`}
              </Animated.Text>
            </View>
            {/* 스캔 라인 */}
            <View pointerEvents="none" style={{ position: 'absolute', top: 120, bottom: 50, left: 0, right: 0, overflow: 'hidden', opacity: successAnimating ? 0 : 1 }}>
              <Animated.View style={{
                position: 'absolute',
                top: 0, left: 0, right: 0,
                height: 2,
                backgroundColor: '#A7F3D0',
                transform: [{
                  translateY: scanLine.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, Math.max(0, boxHeight - 120 - 50 - 2)],
                  }),
                }],
                shadowColor: '#34D399',
                shadowOpacity: 0.55,
                shadowRadius: 10,
                shadowOffset: { width: 0, height: 0 },
                elevation: 8,
              }}>
                <View style={{ position: 'absolute', top: -8, left: 0, right: 0, height: 18, backgroundColor: '#A7F3D0', opacity: 0.18 }} />
              </Animated.View>
            </View>
            {/* 중앙 크로스헤어 */}
            <View pointerEvents="none" style={{ position: 'absolute', top: 120, bottom: 50, left: 0, right: 0, alignItems: 'center', justifyContent: 'center' }}>
              <Svg width={48} height={48} style={{ position: 'absolute' }}>
                <Circle cx={24} cy={24} r={22} stroke="#D1FAE5" strokeWidth={2} fill="none" />
              </Svg>
              <View style={{ width: 18, height: 2, backgroundColor: '#D1FAE5', position: 'absolute' }} />
              <View style={{ width: 2, height: 18, backgroundColor: '#D1FAE5', position: 'absolute' }} />
            </View>
            {/* 재시도 배너 */}
            {isRetryBannerVisible && (
              <View style={cameraStyles.retryCard} pointerEvents="none">
                <Text style={cameraStyles.retryTitle}>
                  {t('alarm.retrying', { defaultValue: '재시도' })}
                </Text>
                <Text style={cameraStyles.retryText}>
                  {t('alarm.missionRetryHint', { mission: missionLabel, defaultValue: `${missionLabel}을 다시 찾아주세요` })}
                </Text>
              </View>
            )}
          </>
        ) : (
          <View style={[StyleSheet.absoluteFillObject, cameraStyles.permissionFallback]}>
            <Text style={cameraStyles.permissionTitle}>{t('alarm.takePhoto')}</Text>
            <TouchableOpacity style={permissionButtonStyle} onPress={requestPermission}>
              <Text style={permissionButtonTextStyle}>{t('alarm.allowCamera')}</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* 다시 뽑기 + 카메라 전환 */}
      <View style={cameraStyles.controlRow}>
        <TouchableOpacity
          onPress={onReshuffle}
          disabled={isRetryBannerVisible || isShuffling}
          style={[cameraStyles.controlButton, (isRetryBannerVisible || isShuffling) && { opacity: 0.4 }]}
        >
          <MaterialIcons name="shuffle" size={24} color="#111827" />
          <Text style={cameraStyles.controlLabel}>
            {t('alarm.reshuffle', { defaultValue: '다시 뽑기' })}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={toggleCamera}
          disabled={isShuffling || isFlipping}
          style={[cameraStyles.controlButton, (isShuffling || isFlipping) && { opacity: 0.4 }]}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <MaterialIcons name="flip-camera-ios" size={24} color="#111827" />
          <Text style={cameraStyles.controlLabel}>
            {t('alarm.flipCamera', { defaultValue: '카메라 전환' })}
          </Text>
        </TouchableOpacity>
      </View>
    </>
  );
}

const cameraStyles = StyleSheet.create({
  cameraCard: {
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: '#0B0F19',
    borderWidth: 1,
    borderColor: 'rgba(17,24,39,0.08)',
    shadowColor: '#111827',
    shadowOpacity: 0.16,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 14 },
    elevation: 8,
  },
  missionCard: {
    position: 'absolute',
    top: 14,
    left: 14,
    right: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.88)',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.72)',
  },
  emojiFrame: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  emojiImage: {
    position: 'absolute',
    top: 5,
    left: 5,
    width: 40,
    height: 40,
  },
  missionText: {
    color: '#111827',
    fontSize: 15,
    fontWeight: '800',
    minHeight: 20,
    textAlign: 'center',
  },
  timerPill: {
    position: 'absolute',
    bottom: 14,
    alignSelf: 'center',
    paddingVertical: 8,
    paddingHorizontal: 18,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryCard: {
    position: 'absolute',
    top: '35%',
    left: 18,
    right: 18,
    paddingVertical: 16,
    paddingHorizontal: 18,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.92)',
    alignItems: 'center',
    gap: 4,
  },
  retryTitle: {
    color: '#111827',
    fontSize: 22,
    fontWeight: '900',
  },
  retryText: {
    color: '#4B5563',
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  },
  permissionFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#0B0F19',
  },
  permissionTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 12,
    textAlign: 'center',
  },
  controlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    marginTop: 12,
  },
  controlButton: {
    minWidth: 124,
    alignItems: 'center',
    gap: 6,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  controlLabel: {
    color: '#111827',
    fontSize: 13,
    fontWeight: '800',
  },
});
