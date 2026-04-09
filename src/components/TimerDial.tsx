import React, { useMemo, useRef, useEffect, useState } from 'react';
import { View, Text, StyleSheet, PanResponder, Animated, Easing } from 'react-native';
import Svg, { Circle, Path, Line, Defs, RadialGradient, Stop } from 'react-native-svg';
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
  gaugeAnim?: Animated.Value;
};

const SIZE = 330;
const cx = 165;
const cy = 165;
const LABEL_RADIUS = 164;
const SECTOR_RADIUS = 141;
const CENTER_RADIUS = 18;
const TICK_OUTER_MAJOR = 134;
const TICK_INNER_MAJOR = 100;
const TICK_OUTER_MINOR = 134;
const TICK_INNER_MINOR = 112;

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
    fontSize: 19,
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

export default function TimerDial({ progress, timeText: _timeText, subText: _subText, variant: _variant = 'classic', onSeek, onSeekStart, onSeekEnd, isWarning = false, gaugeAnim }: Props) {
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
  const progressAnim = useRef(new Animated.Value(progress)).current;
  const [displayProgress, setDisplayProgress] = useState(progress);

  useEffect(() => {
    if (gaugeAnim) {
      const id = gaugeAnim.addListener(({ value }) => setDisplayProgress(value));
      return () => gaugeAnim.removeListener(id);
    }
    const id = progressAnim.addListener(({ value }) => setDisplayProgress(value));
    return () => progressAnim.removeListener(id);
  }, []);

  useEffect(() => {
    if (gaugeAnim) return; // gaugeAnim이 드라이브
    if (isDragging.current) {
      progressAnim.setValue(progress);
      return;
    }
    const anim = Animated.timing(progressAnim, {
      toValue: progress,
      duration: 450,
      useNativeDriver: false,
      easing: Easing.out(Easing.cubic),
    });
    anim.start();
    return () => anim.stop();
  }, [progress, gaugeAnim]);

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
      let minutes = Math.round(normalized / 6);
      minutes = Math.max(0, Math.min(60, minutes));
      prevMinutesRef.current = minutes;
      onSeek(minutes);
    },
    onPanResponderMove: (evt) => {
      if (!onSeek) return;
      const { locationX, locationY } = evt.nativeEvent;
      const angle = Math.atan2(locationY - cy, locationX - cx) * (180 / Math.PI);
      const normalized = (angle + 90 + 360) % 360;
      let minutes = Math.round(normalized / 6);
      minutes = Math.max(0, Math.min(60, minutes));
      if (prevMinutesRef.current !== null && Math.abs(minutes - prevMinutesRef.current) > 30) return;
      prevMinutesRef.current = minutes;
      onSeek(minutes);
    },
    onPanResponderRelease: () => { isDragging.current = false; prevMinutesRef.current = null; onSeekEnd?.(); },
    onPanResponderTerminate: () => { isDragging.current = false; prevMinutesRef.current = null; onSeekEnd?.(); },
  }), [onSeek, onSeekStart, onSeekEnd]);

  return (
    <View style={styles.container} {...(onSeek ? panResponder.panHandlers : {})}>
      <Svg width={SIZE} height={SIZE} style={StyleSheet.absoluteFill}>
        {/* 1. 회색 디스크 */}
        <Circle cx={cx} cy={cy} r={SECTOR_RADIUS} fill={colors.surfaceContainerLow} />

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
            <Stop offset="100%" stopColor={colors.onBackground} stopOpacity={0.15} />
          </RadialGradient>
        </Defs>
        <Circle cx={cx} cy={cy} r={SECTOR_RADIUS} fill="url(#innerShadow)" />

        {/* 6. 바늘 — 동그라미에서 짧게 */}
        {displayProgress > 0 && (() => {
          const needleAngle = displayProgress * 360;
          const tail = polarToCartesian(cx, cy, CENTER_RADIUS - 2, needleAngle);
          const tip = polarToCartesian(cx, cy, CENTER_RADIUS + 14, needleAngle);
          return (
            <Line
              x1={tail.x} y1={tail.y}
              x2={tip.x} y2={tip.y}
              stroke={colors.onBackground}
              strokeWidth={3}
              strokeLinecap="round"
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
