import React, { useMemo, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, PanResponder, Animated, Easing } from 'react-native';
import Svg, { Circle, Path, Line } from 'react-native-svg';
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

const SIZE = 300;
const cx = 150;
const cy = 150;
const LABEL_RADIUS = 140;
const SECTOR_RADIUS = 128;
const CENTER_RADIUS = 75;
const TICK_OUTER_MAJOR = 122;
const TICK_INNER_MAJOR = 102;
const TICK_OUTER_MINOR = 122;
const TICK_INNER_MINOR = 110;

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
    width: 24,
    textAlign: 'center',
  },
  centerCircle: {
    width: CENTER_RADIUS * 2,
    height: CENTER_RADIUS * 2,
    borderRadius: CENTER_RADIUS,
    backgroundColor: colors.surfaceContainerLowest,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#1a1c1f',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 16,
    elevation: 4,
  },
  timeText: {
    fontSize: 35,
    fontWeight: '800',
    color: colors.onBackground,
    letterSpacing: -2,
  },
  subText: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.secondary,
    opacity: 0.6,
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginTop: 4,
  },
});

export default function TimerDial({ progress, timeText, subText, variant: _variant = 'classic', onSeek, onSeekStart, onSeekEnd, isWarning = false }: Props) {
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
      <Text key={label} style={[styles.label, { left: x - 12, top: y - 10 }]}>
        {label}
      </Text>
    );
  }), [colors.secondary]);

  const prevMinutesRef = React.useRef<number | null>(null);
  const isDragging = useRef(false);
  const progressAnim = useRef(new Animated.Value(progress)).current;
  const [displayProgress, setDisplayProgress] = useState(progress);

  useEffect(() => {
    const id = progressAnim.addListener(({ value }) => setDisplayProgress(value));
    return () => progressAnim.removeListener(id);
  }, []);

  useEffect(() => {
    if (isDragging.current) {
      progressAnim.setValue(progress);
      return;
    }
    Animated.timing(progressAnim, {
      toValue: progress,
      duration: 450,
      useNativeDriver: false,
      easing: Easing.out(Easing.cubic),
    }).start();
  }, [progress]);

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
      return dist > CENTER_RADIUS;
    },
    onMoveShouldSetPanResponder: (evt) => {
      if (!onSeek) return false;
      const { locationX, locationY } = evt.nativeEvent;
      const dist = Math.sqrt((locationX - cx) ** 2 + (locationY - cy) ** 2);
      return dist > CENTER_RADIUS;
    },
    onPanResponderGrant: (evt) => {
      if (!onSeek) return;
      isDragging.current = true;
      onSeekStart?.();
      const { locationX, locationY } = evt.nativeEvent;
      const angle = Math.atan2(locationY - cy, locationX - cx) * (180 / Math.PI);
      const normalized = (angle + 90 + 360) % 360;
      let minutes = Math.round(normalized / 6);
      if (minutes === 0) minutes = 60;
      minutes = Math.max(1, Math.min(60, minutes));
      prevMinutesRef.current = minutes;
      onSeek(minutes);
    },
    onPanResponderMove: (evt) => {
      if (!onSeek) return;
      const { locationX, locationY } = evt.nativeEvent;
      const angle = Math.atan2(locationY - cy, locationX - cx) * (180 / Math.PI);
      const normalized = (angle + 90 + 360) % 360;
      let minutes = Math.round(normalized / 6);
      if (minutes === 0) minutes = 60;
      minutes = Math.max(1, Math.min(60, minutes));
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

      </Svg>

      {/* 4. 숫자 레이블 */}
      {labels}

      {/* 중앙 원 */}
      <View style={styles.centerCircle} pointerEvents="none">
        <Text style={styles.timeText}>
          {onSeek ? `${Math.max(1, Math.round(displayProgress * 60))}:00` : timeText}
        </Text>
        <Text style={styles.subText}>{subText}</Text>
      </View>
    </View>
  );
}
