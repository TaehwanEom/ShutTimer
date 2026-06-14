import React, { useMemo, useRef, useEffect, useState } from 'react';
import { View, Text, StyleSheet, PanResponder, Animated, Easing, Dimensions, Platform } from 'react-native';
import Svg, { Circle, Path, Line, Defs, RadialGradient, Stop } from 'react-native-svg';
import * as Haptics from 'expo-haptics';
import { ThemeColors } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

type TimerDialVariant = 'classic';  // v2에서 확장 예정

type Props = {
  progress: number;           // 0.0 ~ 1.0
  timeText: string;           // "60:00"
  subText: string;            // "MINUTES" | "MINUTES LEFT"
  variant?: TimerDialVariant;
  onSeek?: (minutes: number) => void;
  onSeekStart?: () => void;
  onSeekEnd?: () => void;
  isWarning?: boolean;
};

// 2026-05-31 — 반응형 사이즈 (= Galaxy S23 360pt 등 작은 화면 정합).
//   iOS (iPhone 15+ 375pt) = Math.min(330, 315) = 315 ~ 330 (= 큰 화면 = 330 상한 유지, iOS 회귀 X)
//   Android (Galaxy S23 360pt) = Math.min(290, 280) = 280 (= 더 작게 = 즐겨찾기/광고 자리 확보)
//   모든 상수 = SIZE 기준 비율로 동적 계산 (= 디자인 비율 100% 유지).
const SCREEN_W = Dimensions.get('window').width;
const SIZE = Platform.OS === 'android'
  ? Math.min(290, SCREEN_W - 80)
  : Math.min(330, SCREEN_W - 60);
const cx = SIZE / 2;
const cy = SIZE / 2;
const LABEL_RADIUS = SIZE * (176 / 330);
const SECTOR_RADIUS = SIZE * (161 / 330); // 155 × 1.04
const CENTER_RADIUS = SIZE * (15 / 330);
const TICK_OUTER_MAJOR = SIZE * (161 / 330); // SECTOR_RADIUS와 일치
const TICK_INNER_MAJOR = SIZE * (137 / 330); // 길이 30 → 24 (= 추가 20% 축소)
const TICK_OUTER_MINOR = SIZE * (161 / 330); // SECTOR_RADIUS와 일치
const TICK_INNER_MINOR = SIZE * (144 / 330); // 길이 21 → 17 (= 추가 20% 축소)

const LABELS = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

function polarToCartesian(centerX: number, centerY: number, radius: number, angleDeg: number) {
  const angleRad = (angleDeg - 90) * (Math.PI / 180);
  return {
    x: centerX + radius * Math.cos(angleRad),
    y: centerY + radius * Math.sin(angleRad),
  };
}

function sectorPath(progress: number): string {
  const endAngle = progress * 360;
  const start = polarToCartesian(cx, cy, SECTOR_RADIUS, 0);
  const end = polarToCartesian(cx, cy, SECTOR_RADIUS, endAngle);
  const largeArcFlag = endAngle > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${start.x} ${start.y} A ${SECTOR_RADIUS} ${SECTOR_RADIUS} 0 ${largeArcFlag} 1 ${end.x} ${end.y} Z`;
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: {
    width: SIZE,
    height: SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    position: 'absolute',
    fontSize: 13,
    fontWeight: '700',
    color: colors.secondary,
    width: 36,
    textAlign: 'center',
  },
  centerCircle: {
    width: CENTER_RADIUS * 2,
    height: CENTER_RADIUS * 2,
    borderRadius: CENTER_RADIUS,
    backgroundColor: colors.onBackground,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#1a1c1f',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 16,
    elevation: 4,
  },
  timeText: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.onBackground,
    letterSpacing: 1,
  },
  subText: {
    fontSize: 8,
    fontWeight: '600',
    color: colors.secondary,
    opacity: 0.6,
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginTop: 2,
  },
});

export default function TimerDial({ progress, timeText: _timeText, subText: _subText, variant: _variant = 'classic', onSeek, onSeekStart, onSeekEnd, isWarning = false }: Props) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  const ticks = useMemo(() => Array.from({ length: 60 }, (_, i) => {
    const angleDeg = i * 6;
    const isMajor = i % 5 === 0;
    const inner = polarToCartesian(cx, cy, isMajor ? TICK_INNER_MAJOR : TICK_INNER_MINOR, angleDeg);
    const outer = polarToCartesian(cx, cy, isMajor ? TICK_OUTER_MAJOR : TICK_OUTER_MINOR, angleDeg);
    return (
      <Line
        key={i}
        x1={inner.x} y1={inner.y}
        x2={outer.x} y2={outer.y}
        stroke={colors.onBackground}
        strokeWidth={isMajor ? 2 : 1}
        strokeOpacity={isMajor ? 0.8 : 0.4}
      />
    );
  }), [colors.onBackground]);

  const labels = useMemo(() => LABELS.map((label, i) => {
    const angleDeg = i * 30 - 90;
    const angleRad = angleDeg * (Math.PI / 180);
    const x = cx + LABEL_RADIUS * Math.cos(angleRad);
    const y = cy + LABEL_RADIUS * Math.sin(angleRad);
    return (
      <Text key={label} style={[styles.label, { left: x - 18, top: y - 13 }]}>
        {label}
      </Text>
    );
  }), [colors.secondary]);

  const prevMinutesRef = React.useRef<number | null>(null);
  const isDragging = useRef(false);

  // v1.8 #PerfTickStep — 매 frame 측 Animated.timing + addListener + setState 측 폐기 (= 30분 측 86,400회 React re-render 측 root cause).
  //   직전 = useNativeDriver: false + addListener({value}) => setDisplayProgress(value) 측 매 frame 측 React re-render.
  //   정정 = progress props 측 직접 사용 → 매 초 측 1회 측 React re-render.
  //   시각 측 변화 = 부드러운 측 → 짹깍 측 step 측 (= 시계 초침 측). 발열 측 매우 감소.
  // v1.8 #PerfTickStep-ResetSmooth — 정지 시점 (= progress=0 + 직전>0) 측만 500ms 부드러운 animation 추가.
  //   30분 측 누적 = 1회 측만 (= 500ms × 60fps = 30 frame) → 발열 영향 ❌.
  const [animatedProgress, setAnimatedProgress] = useState(progress);
  const animValue = useRef(new Animated.Value(progress)).current;
  const prevProgressRef = useRef(progress);
  useEffect(() => {
    const id = animValue.addListener(({ value }) => setAnimatedProgress(value));
    return () => animValue.removeListener(id);
  }, []);
  useEffect(() => {
    // 큰 jump 감지 (= 정지 시점 측 dial 측 시작 위치 측 reset 또는 측 = 외부 측 progress 측 점프 측).
    //   동작 중 = 매 초 측 0.03% 측 정도 측 작은 측 감소 → step.
    //   정지 시 = 시작 위치 측 (= 30분 측 0.5 측) 측 갑자기 측 jump → 부드러운 animation.
    //   drag 중 = 사용자 측 직접 측 jump → step (= drag 측 정합).
    const delta = Math.abs(progress - prevProgressRef.current);
    const isJump = delta > 0.01 && !isDragging.current;
    prevProgressRef.current = progress;
    if (isJump) {
      // 정지 측 = 500ms 부드러운 animation.
      const anim = Animated.timing(animValue, { toValue: progress, duration: 500, useNativeDriver: false, easing: Easing.linear });
      anim.start();
      return () => anim.stop();
    } else {
      // 일반 측 = step (= 매 초 1회 update).
      animValue.setValue(progress);
      setAnimatedProgress(progress);
    }
  }, [progress]);
  const displayProgress = animatedProgress;

  const blinkAnim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!isWarning) {
      blinkAnim.stopAnimation();
      blinkAnim.setValue(1);
      return;
    }
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(blinkAnim, { toValue: 0.25, duration: 500, useNativeDriver: false }),
        Animated.timing(blinkAnim, { toValue: 1, duration: 500, useNativeDriver: false }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [isWarning]);

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: (evt) => {
      if (!onSeek) return false;
      const { locationX, locationY } = evt.nativeEvent;
      const dist = Math.sqrt((locationX - cx) ** 2 + (locationY - cy) ** 2);
      return dist > CENTER_RADIUS && dist <= SECTOR_RADIUS;
    },
    onMoveShouldSetPanResponder: (evt) => {
      if (!onSeek) return false;
      const { locationX, locationY } = evt.nativeEvent;
      const dist = Math.sqrt((locationX - cx) ** 2 + (locationY - cy) ** 2);
      return dist > CENTER_RADIUS && dist <= SECTOR_RADIUS;
    },
    onPanResponderGrant: (evt) => {
      if (!onSeek) return;
      isDragging.current = true;
      onSeekStart?.();
      const { locationX, locationY } = evt.nativeEvent;
      const angle = Math.atan2(locationY - cy, locationX - cx) * (180 / Math.PI);
      const normalized = (angle + 90 + 360) % 360;
      let minutes = Math.floor(normalized / 6);
      if (normalized >= 354) minutes = 60;
      minutes = Math.max(0, Math.min(60, minutes));
      prevMinutesRef.current = minutes;
      onSeek(minutes);
      // 2026-05-27 — iPhone Clock 다이얼 정합. tap 시점 측 = haptic + 시스템 click sound.
      Haptics.selectionAsync().catch(() => {});
    },
    onPanResponderMove: (evt) => {
      if (!onSeek) return;
      const { locationX, locationY } = evt.nativeEvent;
      const angle = Math.atan2(locationY - cy, locationX - cx) * (180 / Math.PI);
      const normalized = (angle + 90 + 360) % 360;
      let minutes = Math.floor(normalized / 6);
      if (normalized >= 354) minutes = 60;
      minutes = Math.max(0, Math.min(60, minutes));
      if (prevMinutesRef.current !== null && Math.abs(minutes - prevMinutesRef.current) > 30) return;
      // 2026-05-27 — iPhone Clock 다이얼 정합. 분 변경 시점 측만 haptic + 시스템 click sound (= 같은 분 측 매 frame 호출 차단).
      if (prevMinutesRef.current !== minutes) {
        Haptics.selectionAsync().catch(() => {});
      }
      prevMinutesRef.current = minutes;
      onSeek(minutes);
    },
    onPanResponderRelease: () => { isDragging.current = false; prevMinutesRef.current = null; onSeekEnd?.(); },
    onPanResponderTerminate: () => { isDragging.current = false; prevMinutesRef.current = null; onSeekEnd?.(); },
  }), [onSeek, onSeekStart, onSeekEnd]);

  return (
    <View style={styles.container} {...(onSeek ? panResponder.panHandlers : {})}>
      <Svg width={SIZE} height={SIZE} style={StyleSheet.absoluteFill}>
        {/* 1. 디스크 (메뉴바 흰색 기준) */}
        <Circle cx={cx} cy={cy} r={SECTOR_RADIUS} fill={colors.surfaceContainerLowest} />

        {/* 3. 빨간 게이지바 */}
        {displayProgress >= 0.999 ? (
          <AnimatedCircle cx={cx} cy={cy} r={SECTOR_RADIUS} fill={colors.primary} fillOpacity={blinkAnim} />
        ) : displayProgress > 0 ? (
          <AnimatedPath d={sectorPath(displayProgress)} fill={colors.primary} fillOpacity={blinkAnim} />
        ) : null}

        {/* 2. 눈금 60개 — 섹터 위 레이어 (항상 보임) */}
        {ticks}

        {/* 5. 다이얼 테두리 안쪽 그라데이션 */}
        <Defs>
          <RadialGradient id="innerShadow" cx="50%" cy="50%" r="50%">
            <Stop offset="80%" stopColor={colors.onBackground} stopOpacity={0} />
            <Stop offset="100%" stopColor={colors.onBackground} stopOpacity={0.025} />
          </RadialGradient>
        </Defs>
        <Circle cx={cx} cy={cy} r={SECTOR_RADIUS} fill="url(#innerShadow)" />

        {/* 6. 얇은 네모 침 — 다이얼 중간 지점 */}
        {(() => {
          const needleAngle = displayProgress * 360;
          const length = 20 * Math.sqrt(3) / 2;  // 직전 세모 h 측 = 시각 길이 정합
          const width = 3;                        // 얇은 너비
          const rad = (needleAngle - 90) * (Math.PI / 180);
          const perp = rad + Math.PI / 2;
          // 무게중심을 동그라미 테두리에 위치
          const gcx = cx + (CENTER_RADIUS + 4) * Math.cos(rad);
          const gcy = cy + (CENTER_RADIUS + 4) * Math.sin(rad);
          // tip (= 외곽 끝) / base (= 안쪽 시작) 측 그대로 (= 직전 세모 시각 영역 정합)
          const tipX = gcx + (length * 2 / 3) * Math.cos(rad);
          const tipY = gcy + (length * 2 / 3) * Math.sin(rad);
          const bcx = gcx - (length / 3) * Math.cos(rad);
          const bcy = gcy - (length / 3) * Math.sin(rad);
          // 직사각형 4점 = tip 좌/우 + base 좌/우 (= perp × width/2)
          const tipLX = tipX - (width / 2) * Math.cos(perp);
          const tipLY = tipY - (width / 2) * Math.sin(perp);
          const tipRX = tipX + (width / 2) * Math.cos(perp);
          const tipRY = tipY + (width / 2) * Math.sin(perp);
          const baseLX = bcx - (width / 2) * Math.cos(perp);
          const baseLY = bcy - (width / 2) * Math.sin(perp);
          const baseRX = bcx + (width / 2) * Math.cos(perp);
          const baseRY = bcy + (width / 2) * Math.sin(perp);
          return (
            <Path
              d={`M ${tipLX} ${tipLY} L ${tipRX} ${tipRY} L ${baseRX} ${baseRY} L ${baseLX} ${baseLY} Z`}
              fill={colors.onBackground}
            />
          );
        })()}

      </Svg>

      {/* 4. 숫자 레이블 */}
      {labels}

      {/* 중앙 원 */}
      <View style={styles.centerCircle} pointerEvents="none" />

    </View>
  );
}
