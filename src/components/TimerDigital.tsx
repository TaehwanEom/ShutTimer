import React, { useRef, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, PanResponder, Animated, TouchableOpacity, TextInput, Dimensions, Platform, Keyboard } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import Svg, { Rect } from 'react-native-svg';
import { useTheme } from '../context/ThemeContext';
import SevenSegment from './SevenSegment';

type Props = {
  progress: number;
  timeText: string;
  subText: string;
  onSeek?: (minutes: number, seconds?: number) => void;
  onSeekStart?: () => void;
  onSeekEnd?: () => void;
  isWarning?: boolean;
  isRunning?: boolean;
  isPaused?: boolean;
  totalSeconds?: number;
};

// 2026-05-31 — TimerDial과 동일 반응형 사이즈 (Galaxy S23 360pt 등 작은 화면 정합).
//   직전 SIZE = 330 하드코딩 → Android 다이얼(290)과 height 차이 40px → HomeScreen 플레이 버튼 위치 어긋남.
//   iOS = 330 상한 유지 (회귀 X), Android = 290 (= TimerDial과 동일).
//   DIGIT_SIZE / MS_DIGIT_SIZE도 SIZE 비율로 동적 (= 디자인 비율 100% 유지).
const SCREEN_W = Dimensions.get('window').width;
const SIZE = Platform.OS === 'android'
  ? Math.min(290, SCREEN_W - 80)
  : Math.min(330, SCREEN_W - 60);
const DIGIT_SIZE = Math.round(SIZE * (55 / 330));
const MS_DIGIT_SIZE = Math.round(SIZE * (26 / 330));
const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];


export default function TimerDigital({ progress, timeText, subText: _subText, onSeek, onSeekStart, onSeekEnd, isWarning = false, isRunning = false, isPaused = false }: Props) {
  const { colors } = useTheme();
  const isFocused = useIsFocused();
  const now = new Date();
  const [screenSize, setScreenSize] = useState({ w: 0, h: 0 });

  // v1.8 — ring 게이지 제거 후 smoothGauge ref + useEffect 측 dead code 정리.
  const hiddenInputRef = useRef<TextInput>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const cursorBlink = useRef(new Animated.Value(1)).current;

  // 편집 모드 커서 깜빡임
  useEffect(() => {
    if (!isEditing) {
      cursorBlink.stopAnimation();
      cursorBlink.setValue(1);
      return;
    }
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(cursorBlink, { toValue: 0, duration: 400, useNativeDriver: false }),
        Animated.timing(cursorBlink, { toValue: 1, duration: 400, useNativeDriver: false }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [isEditing]);

  // v1.8 #DigitalKeypadTabLeak — 탭 전환(설정 등)으로 화면이 blur 되면 숨겨진 입력칸 focus 가 남아
  //   다른 탭 위로 소프트 키보드가 다시 노출됨 (하단 탭은 화면을 unmount 하지 않음).
  //   화면 blur 시 입력칸 blur + 편집모드 해제 + 키보드 dismiss 로 정리 (iOS/Android 공통 = 올바른 동작).
  useEffect(() => {
    if (!isFocused && isEditing) {
      hiddenInputRef.current?.blur();
      setIsEditing(false);
      Keyboard.dismiss();
    }
  }, [isFocused, isEditing]);

  const handleTap = () => {
    // v1.8 #PausedDialEdit — paused 측 = 키패드 노출 활성. running + !paused 측만 차단.
    if (!onSeek || (isRunning && !isPaused)) return;
    setIsEditing(true);
    setEditValue('');
    setTimeout(() => {
      hiddenInputRef.current?.clear();
      hiddenInputRef.current?.focus();
    }, 50);
  };

  const handleDigitTap = (digitIndex: number) => {
    // v1.8 #PausedDialEdit — paused 측 = 개별 숫자 tap 활성.
    if (!onSeek || (isRunning && !isPaused)) return;
    if (!isEditing) {
      setIsEditing(true);
      setEditValue('');
      setTimeout(() => {
        hiddenInputRef.current?.clear();
        hiddenInputRef.current?.focus();
      }, 50);
    }
    setEditValue(prev => prev.slice(0, digitIndex));
  };

  const handleInput = (text: string) => {
    const digits = text.replace(/[^0-9]/g, '').slice(0, 4);
    setEditValue(digits);

    if (digits.length === 4) {
      const min = Math.min(60, parseInt(digits.slice(0, 2), 10) || 0);
      const sec = Math.min(59, parseInt(digits.slice(2, 4), 10) || 0);
      onSeek?.(min, sec);
      setTimeout(() => {
        setIsEditing(false);
        hiddenInputRef.current?.blur();
      }, 50);
    }
  };

  const handleBlur = () => {
    if (editValue.length > 0) {
      const min = Math.min(60, parseInt(editValue.slice(0, 2).padEnd(2, '0'), 10) || 0);
      const sec = Math.min(59, parseInt(editValue.slice(2, 4).padEnd(2, '0'), 10) || 0);
      onSeek?.(min, sec);
    }
    setIsEditing(false);
  };

  // 밀리초 카운터
  const [msDisplay, setMsDisplay] = useState('00');
  const msRef = useRef(0);

  useEffect(() => {
    if (!isRunning || isPaused) {
      if (!isRunning) setMsDisplay('00');
      return;
    }
    const id = setInterval(() => {
      msRef.current = (msRef.current + 10) % 100;
      setMsDisplay(String(msRef.current).padStart(2, '0'));
    }, 100);
    return () => clearInterval(id);
  }, [isRunning, isPaused]);

  const blinkAnim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!isWarning) {
      // 정지 시 opacity 즉시 1 reset (native driver 의 duration:0 timing 비동기 race 회피).
      blinkAnim.stopAnimation();
      blinkAnim.setValue(1);
      return;
    }
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(blinkAnim, { toValue: 0.25, duration: 500, useNativeDriver: true }),
        Animated.timing(blinkAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [isWarning]);

  // 드래그
  const startX = useRef(0);
  const startMin = useRef(0);
  const isDragging = useRef(false);
  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: () => false,
    onPanResponderGrant: (evt) => {
      isDragging.current = true;
      startX.current = evt.nativeEvent.pageX;
      startMin.current = Math.max(1, Math.round(progress * 60));
      onSeekStart?.();
    },
    onPanResponderMove: (evt) => {
      if (!onSeek) return;
      const dx = evt.nativeEvent.pageX - startX.current;
      const delta = Math.round(dx / 10);
      const newMin = Math.max(1, Math.min(60, startMin.current + delta));
      onSeek(newMin, 0);
    },
    onPanResponderRelease: () => { isDragging.current = false; onSeekEnd?.(); },
    onPanResponderTerminate: () => { isDragging.current = false; onSeekEnd?.(); },
  }), [onSeek, onSeekStart, onSeekEnd, progress, isEditing]);

  // 표시할 분:초
  let displayTime: string;
  if (isEditing) {
    const d0 = editValue.length >= 1 ? editValue[0] : ' ';
    const d1 = editValue.length >= 2 ? editValue[1] : ' ';
    const d2 = editValue.length >= 3 ? editValue[2] : ' ';
    const d3 = editValue.length >= 4 ? editValue[3] : ' ';
    displayTime = `${d0}${d1}:${d2}${d3}`;
  } else {
    displayTime = timeText;
  }

  const mainChars = displayTime.split('');
  const msChars = msDisplay.split('');

  // 현재 입력 커서 위치 (0~3, 콜론 건너뜀)
  const totalDigits = editValue.length;
  // mainChars에서 index: 0,1 = 분, 2 = ':', 3,4 = 초
  const cursorCharIdx = totalDigits < 2 ? totalDigits : totalDigits + 1; // 콜론 건너뜀

  // 편집 중 하단 세그먼트에 깜빡임 색상
  const cursorColor = cursorBlink.interpolate({
    inputRange: [0, 1],
    outputRange: ['transparent', colors.primary],
  });

  return (
    <View style={styles.container} {...(!isEditing && onSeek ? panResponder.panHandlers : {})}>
      {/* v1.8 #DigitalKeypadAndroid — 숨겨진 입력 필드.
          Android는 opacity:0 / 1×1 TextInput 에 focus() 해도 소프트 키보드를 안 띄움 (iOS는 띄움).
          → 화면에 실제 크기로 배치하되 글자·커서·밑줄을 투명 처리 = 눈엔 안 보이지만 Android가 정상 입력칸으로 인식.
          크기·위치는 디스플레이 영역 안쪽 → 위 TouchableOpacity 에 완전히 가려져 직접 탭은 안 받음 (focus()로만 진입). */}
      <TextInput
        ref={hiddenInputRef}
        style={{
          position: 'absolute',
          top: (SIZE - 90) / 2,
          left: (SIZE - 160) / 2,
          width: 160,
          height: 90,
          color: 'transparent',
        }}
        underlineColorAndroid="transparent"
        keyboardType="number-pad"
        maxLength={4}
        onChangeText={handleInput}
        onBlur={handleBlur}
        caretHidden
      />

      <TouchableOpacity activeOpacity={1} onPress={handleTap}>
        <Animated.View style={[styles.display, { opacity: isWarning ? blinkAnim : 1 }]}>
          <View
            style={[styles.screen, { backgroundColor: colors.surfaceContainerLowest, borderRadius: 20 }]}
            onLayout={(e) => setScreenSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
          >
            {/* 아웃라인 — v1.8 측 ring 게이지 제거 (= 사용자분 부탁). 배경 아웃라인만 잔존. */}
            {screenSize.w > 0 && (
              <Svg width={screenSize.w} height={screenSize.h} style={{ position: 'absolute', top: 0, left: 0 }}>
                <Rect x={9} y={9} width={screenSize.w - 18} height={screenSize.h - 18} rx={20} ry={20} fill="none" stroke={colors.outlineVariant} strokeWidth={1} />
              </Svg>
            )}
            {/* 상단: 요일 + 월-일 (작은 세그먼트) */}
            <View style={styles.topRow}>
              <Text style={{ fontSize: 22, fontWeight: '800', color: colors.primary, letterSpacing: 1 }}>
                {WEEKDAYS[now.getDay()]}
              </Text>
              <View style={{ width: 8 }} />
              <View style={styles.topDigits}>
                {`${String(now.getMonth() + 1)}-${String(now.getDate()).padStart(2, '0')}`.split('').map((ch, i) => (
                  <SevenSegment key={`d-${i}`} digit={ch} size={14} color={colors.primary} />
                ))}
              </View>
            </View>

            <View style={{ height: 1, width: '100%', backgroundColor: colors.outlineVariant, marginVertical: 8 }} />

            {/* 중앙: 큰 세그먼트 분:초 */}
            <View style={styles.digits}>
              {mainChars.map((ch, i) => {
                const isCursorHere = isEditing && i === cursorCharIdx && totalDigits < 4;
                const isEditablePos = i === 0 || i === 1 || i === 3 || i === 4;
                const isEmpty = isEditing && isEditablePos && ch === ' ';
                // charIndex → digitIndex 변환 (0,1 → 0,1 / 3,4 → 2,3, 콜론은 건너뜀)
                const digitIndex = i < 2 ? i : i === 2 ? -1 : i - 1;
                return (
                  <TouchableOpacity
                    key={i}
                    activeOpacity={0.7}
                    onPress={() => digitIndex >= 0 && handleDigitTap(digitIndex)}
                    disabled={!isEditablePos}
                  >
                    <SevenSegment
                      digit={isEmpty ? '8' : ch}
                      size={DIGIT_SIZE}
                      color={isEmpty ? `${colors.primary}08` : colors.primary}
                      bottomBlink={isCursorHere ? cursorColor : undefined}
                    />
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={{ height: 1, width: '100%', backgroundColor: colors.outlineVariant, marginVertical: 8 }} />

            {/* 하단: 작은 세그먼트 밀리초 */}
            <View style={styles.bottomRow}>
              {msChars.map((ch, i) => (
                <SevenSegment key={`ms-${i}`} digit={ch} size={MS_DIGIT_SIZE} color={colors.primary} />
              ))}
            </View>

          </View>
        </Animated.View>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: SIZE,
    height: SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  display: {
    alignItems: 'center',
  },
  screen: {
    paddingHorizontal: 32,
    paddingVertical: 36,
    borderRadius: 20,
  },
  digits: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 6,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  topDigits: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  bottomRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 4,
  },
  tickRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    marginBottom: 6,
  },
});
