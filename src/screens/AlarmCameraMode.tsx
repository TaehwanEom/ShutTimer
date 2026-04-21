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
  Platform,
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
import { useTensorflowModel } from 'react-native-fast-tflite';
import { NitroModules } from 'react-native-nitro-modules';
import { useResizePlugin } from 'vision-camera-resize-plugin';
import { useRunOnJS, type ISharedValue } from 'react-native-worklets-core';
import { parseYolov10Output, type Detection } from '../utils/objectDetection';
import { MISSION_EMOJI } from '../constants/missionIcons';

const TARGET_CONFIDENCE = 0.4;
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
    isRetryBannerVisible, successAnimating, resultState, isDanger, remainingSeconds,
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

  // 카메라 전환 race 방지 — ref로 동기 차단 (state는 stale closure 위험)
  const [isFlipping, setIsFlipping] = useState(false);
  const isFlippingRef = useRef(false);
  const flipTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toggleCamera = useCallback(() => {
    if (isFlippingRef.current) return;
    isFlippingRef.current = true;
    setIsFlipping(true);
    setCameraPosition((p) => (p === 'back' ? 'front' : 'back'));
    if (flipTimeoutRef.current) clearTimeout(flipTimeoutRef.current);
    flipTimeoutRef.current = setTimeout(() => {
      isFlippingRef.current = false;
      setIsFlipping(false);
    }, 1000);
  }, []);
  useEffect(() => {
    return () => {
      if (flipTimeoutRef.current) clearTimeout(flipTimeoutRef.current);
    };
  }, []);

  // Format 선택 (FOV ≤ 70, stab off, ≥640)
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

  // tflite 모델 로드 (heavy — 이 컴포넌트가 마운트될 때만 로드)
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

  // worklet → JS bridge
  const onMatchJS = useRunOnJS((match: Detection) => {
    onMatchDetected(match);
  }, [onMatchDetected]);

  // Frame processor (worklet)
  const frameProcessor = useFrameProcessor((frame) => {
    'worklet';
    if (matched.value) return;
    if (isShufflingSV.value) return;
    if (boxedModel == null) return;
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
      <View style={{ width: boxWidth, height: boxHeight, borderRadius: 16, overflow: 'hidden', backgroundColor: '#111' }}>
        {hasCameraPermission && device ? (
          <>
            <Camera
              style={StyleSheet.absoluteFill}
              device={device}
              isActive={resultState === 'idle' && !isFlipping}
              frameProcessor={frameProcessor}
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
                setIsFlipping(false);
              }}
              {...(format ? { format } : {})}
            />
            {/* 감지 성공 피드백 — 연두 깜빡 (전면) */}
            <Animated.View pointerEvents="none" style={[
              StyleSheet.absoluteFill,
              {
                backgroundColor: '#32CD32',
                opacity: successBlink.interpolate({ inputRange: [0, 1], outputRange: [0, 0.4] }),
              },
            ]} />
            {/* 감지 성공 피드백 — 연두 채움 (top → bottom) */}
            <Animated.View pointerEvents="none" style={{
              position: 'absolute', top: 0, left: 0, right: 0,
              backgroundColor: '#32CD32',
              height: successFill.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
              opacity: successFill.interpolate({ inputRange: [0, 1], outputRange: [0.3, 0.55] }),
            }} />
            {/* 박스 상단 어둠 + 이모지 + 풀 문장 */}
            <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, paddingVertical: 16, paddingHorizontal: 12, backgroundColor: 'rgba(0,0,0,0.65)', alignItems: 'center', gap: 8 }}>
              <View style={{ width: 60, height: 60, position: 'relative' }}>
                {currentEmoji ? (
                  <Image
                    source={currentEmoji}
                    style={{ position: 'absolute', top: 0, left: 0, width: 60, height: 60, opacity: isShuffling ? 0 : 1 }}
                    resizeMode="contain"
                  />
                ) : (
                  <View style={{ opacity: isShuffling ? 0 : 1 }}>
                    <MaterialIcons name={currentMission as React.ComponentProps<typeof MaterialIcons>['name']} size={54} color="#fff" />
                  </View>
                )}
                {isShuffling && shuffledList.map((k, i) => (
                  <Image
                    key={k}
                    source={MISSION_EMOJI[k]}
                    style={{ position: 'absolute', top: 0, left: 0, width: 60, height: 60, opacity: i === shuffleIdx ? 1 : 0 }}
                    resizeMode="contain"
                  />
                ))}
              </View>
              <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700', minHeight: 20, textAlign: 'center' }}>
                {isShuffling ? '' : missionSentence}
              </Text>
            </View>
            {/* 박스 하단 어둠 + 남은 초 */}
            <View pointerEvents="none" style={{ position: 'absolute', bottom: 0, left: 0, right: 0, paddingVertical: 10, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' }}>
              <Animated.Text style={{
                color: isDanger ? '#ff3b30' : '#fff',
                fontSize: 28, fontWeight: '900', fontVariant: ['tabular-nums'],
                opacity: isDanger ? dangerBlink.interpolate({ inputRange: [0, 1], outputRange: [1, 0.25] }) : 1,
              }}>
                {remainingSeconds}{t('settings.secondsUnit', { defaultValue: '초' })}
              </Animated.Text>
            </View>
            {/* 스캔 라인 */}
            <View pointerEvents="none" style={{ position: 'absolute', top: 120, bottom: 50, left: 0, right: 0, overflow: 'hidden', opacity: successAnimating ? 0 : 1 }}>
              <Animated.View style={{
                position: 'absolute',
                top: 0, left: 0, right: 0,
                height: 2,
                backgroundColor: '#B8E986',
                transform: [{
                  translateY: scanLine.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, Math.max(0, boxHeight - 120 - 50 - 2)],
                  }),
                }],
                shadowColor: '#B8E986',
                shadowOpacity: 0.9,
                shadowRadius: 12,
                shadowOffset: { width: 0, height: 0 },
                elevation: 8,
              }}>
                <View style={{ position: 'absolute', top: -8, left: 0, right: 0, height: 18, backgroundColor: '#B8E986', opacity: 0.25 }} />
              </Animated.View>
            </View>
            {/* 중앙 크로스헤어 */}
            <View pointerEvents="none" style={{ position: 'absolute', top: 120, bottom: 50, left: 0, right: 0, alignItems: 'center', justifyContent: 'center' }}>
              <Svg width={48} height={48} style={{ position: 'absolute' }}>
                <Circle cx={24} cy={24} r={22} stroke="#B8E986" strokeWidth={2} fill="none" />
              </Svg>
              <View style={{ width: 18, height: 2, backgroundColor: '#B8E986', position: 'absolute' }} />
              <View style={{ width: 2, height: 18, backgroundColor: '#B8E986', position: 'absolute' }} />
            </View>
            {/* 재시도 배너 */}
            {isRetryBannerVisible && (
              <View style={{ position: 'absolute', top: '35%', left: 12, right: 12, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.8)', alignItems: 'center', gap: 4 }} pointerEvents="none">
                <Text style={{ color: '#fff', fontSize: 22, fontWeight: '900' }}>
                  {t('alarm.retrying', { defaultValue: '재시도' })}
                </Text>
                <Text style={{ color: '#ddd', fontSize: 12, fontWeight: '600', textAlign: 'center' }}>
                  {t('alarm.missionRetryHint', { mission: missionLabel, defaultValue: `${missionLabel}을 다시 찾아주세요` })}
                </Text>
              </View>
            )}
          </>
        ) : (
          <View style={[StyleSheet.absoluteFillObject, { alignItems: 'center', justifyContent: 'center', padding: 24 }]}>
            <Text style={{ color: '#fff', fontSize: 14, marginBottom: 12, textAlign: 'center' }}>{t('alarm.takePhoto')}</Text>
            <TouchableOpacity style={permissionButtonStyle} onPress={requestPermission}>
              <Text style={permissionButtonTextStyle}>{t('alarm.allowCamera')}</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* 다시 뽑기 + 카메라 전환 */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 32, marginTop: 8 }}>
        <TouchableOpacity
          onPress={onReshuffle}
          disabled={isRetryBannerVisible || isShuffling}
          style={[{ alignItems: 'center', gap: 4, paddingVertical: 10 }, (isRetryBannerVisible || isShuffling) && { opacity: 0.4 }]}
        >
          <MaterialIcons name="shuffle" size={26} color="#fff" style={{ opacity: 0.9 }} />
          <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600', opacity: 0.85 }}>
            {t('alarm.reshuffle', { defaultValue: '다시 뽑기' })}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={toggleCamera}
          disabled={isShuffling || isFlipping}
          style={[{ alignItems: 'center', gap: 4, paddingVertical: 10 }, (isShuffling || isFlipping) && { opacity: 0.4 }]}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <MaterialIcons name="flip-camera-ios" size={26} color="#fff" style={{ opacity: 0.9 }} />
          <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600', opacity: 0.85 }}>
            {t('alarm.flipCamera', { defaultValue: '카메라 전환' })}
          </Text>
        </TouchableOpacity>
      </View>
    </>
  );
}
