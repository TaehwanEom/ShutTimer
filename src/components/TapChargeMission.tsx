// 알람 종료 미션 = 연속 탭 100회 게이지(물). 탭 1회 = 게이지 1/100, 100회 도달 시 onSuccess. 시간제한 없음.
//   2026-06-30 — 속도 기반 가속(마찰/중력) 폐기 → 단순 100탭 카운트. 남은 횟수 카운트다운 숫자 표시.
// 채움 = 하단 파랑→연두→상단 노랑 그라데이션(SVG, 화면 고정·차오를수록 드러남). 탭 지점에서 물 파문(가는 동심원 여러 겹).

import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  SafeAreaView,
  Animated,
  Easing,
  useWindowDimensions,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { MaterialIcons } from '@expo/vector-icons';
import Svg, { Defs, LinearGradient as SvgLinearGradient, Stop, Rect } from 'react-native-svg';
import { ThemeColors } from '../constants/theme';

type Props = {
  colors: ThemeColors;
  t: (key: string, opts?: any) => string;
  onSuccess: () => void;
};

// 연속 탭 100회로 클리어.
const TAP_TARGET = 100;

// 물 파문(동심원 링 여러 겹)
const RING_POOL = 42;
const RING_BASE = 60;
const RIPPLE_MS = 950;
const RING_PER_TAP = 3;
const RING_GAP_MS = 130;
const RING_COLOR = 'rgba(255,59,48,0.26)';

export default function TapChargeMission({ colors, t, onSuccess }: Props) {
  const { width: SW, height: SH } = useWindowDimensions();
  const tapCountRef = useRef(0);
  const [remaining, setRemaining] = useState(TAP_TARGET);
  const fill = useRef(new Animated.Value(0)).current;
  const iconScale = useRef(new Animated.Value(1)).current;
  const doneRef = useRef(false);

  const rings = useRef(
    Array.from({ length: RING_POOL }, () => ({
      x: new Animated.Value(0),
      y: new Animated.Value(0),
      p: new Animated.Value(1),
    }))
  ).current;
  const ringIdx = useRef(0);

  const spawnRing = (lx: number, ly: number) => {
    const ring = rings[ringIdx.current];
    ringIdx.current = (ringIdx.current + 1) % RING_POOL;
    ring.x.setValue(lx - RING_BASE / 2);
    ring.y.setValue(ly - RING_BASE / 2);
    ring.p.setValue(0);
    Animated.timing(ring.p, { toValue: 1, duration: RIPPLE_MS, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  };

  const onTap = (e: any) => {
    if (doneRef.current) return;
    // 2026-06-30 — 탭 1회 = 게이지 1/100 + 남은 횟수 카운트다운. 100회 도달 시 클리어.
    const next = tapCountRef.current + 1;
    tapCountRef.current = next;
    setRemaining(Math.max(0, TAP_TARGET - next));
    fill.setValue(Math.min(1, next / TAP_TARGET));
    if (next >= TAP_TARGET) {
      doneRef.current = true;
      fill.setValue(1);
      onSuccess();
    }
    // 탭마다 햅틱 손맛 (Heavy = 가장 강함).
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
    Animated.sequence([
      Animated.timing(iconScale, { toValue: 0.88, duration: 50, useNativeDriver: true }),
      Animated.timing(iconScale, { toValue: 1, duration: 100, easing: Easing.out(Easing.back(2)), useNativeDriver: true }),
    ]).start();
    const lx = e?.nativeEvent?.locationX ?? SW / 2;
    const ly = e?.nativeEvent?.locationY ?? SH / 2;
    for (let r = 0; r < RING_PER_TAP; r++) {
      if (r === 0) spawnRing(lx, ly);
      else setTimeout(() => spawnRing(lx, ly), r * RING_GAP_MS);
    }
  };

  const styles = makeStyles(colors);
  return (
    <Pressable style={styles.container} onPressIn={onTap}>
      {/* 화면 전체 게이지 바 — 화면 고정 그라데이션(하단 파랑→연두→상단 노랑)을 fill 높이로 클립 */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.gaugeClip,
          { height: fill.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) },
        ]}
      >
        <Svg width={SW} height={SH} style={styles.gaugeGradient}>
          <Defs>
            <SvgLinearGradient id="tapchargeGrad" x1="0" y1={SH} x2="0" y2="0" gradientUnits="userSpaceOnUse">
              <Stop offset="0" stopColor="#1E90FF" />
              <Stop offset="0.55" stopColor="#32CD32" />
              <Stop offset="1" stopColor="#FFE800" />
            </SvgLinearGradient>
          </Defs>
          <Rect x="0" y="0" width={SW} height={SH} fill="url(#tapchargeGrad)" />
        </Svg>
      </Animated.View>

      {/* 물 파문 — 누른 지점에서 가는 동심원 링이 여러 겹 퍼지며 사라짐 */}
      <View style={StyleSheet.absoluteFill as any} pointerEvents="none">
        {rings.map((r, i) => (
          <Animated.View
            key={i}
            style={[
              styles.ring,
              {
                opacity: r.p.interpolate({ inputRange: [0, 0.1, 1], outputRange: [0, 0.55, 0] }),
                transform: [
                  { translateX: r.x },
                  { translateY: r.y },
                  { scale: r.p.interpolate({ inputRange: [0, 1], outputRange: [0.15, 3.4] }) },
                ],
              },
            ]}
          />
        ))}
      </View>

      <SafeAreaView style={styles.overlay} pointerEvents="none">
        <View style={styles.header}>
          <Text style={styles.headerTitle}>ShutTimer</Text>
        </View>
        <View style={styles.center}>
          <Animated.View style={[styles.iconShell, { transform: [{ scale: iconScale }] }]}>
            <MaterialIcons name="touch-app" size={76} color={colors.primary} />
          </Animated.View>
          <Text style={styles.title}>{t('alarm.timerDone')}</Text>
          {/* 2026-06-30 — 남은 탭 횟수 카운트다운 */}
          <Text style={styles.countdown}>{remaining}</Text>
          <Text style={styles.subtitle}>
            {t('alarm.tapchargeInstruction')}
          </Text>
        </View>
      </SafeAreaView>
    </Pressable>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: '#DCEFFF', overflow: 'hidden' },
    gaugeClip: { position: 'absolute', left: 0, right: 0, bottom: 0, overflow: 'hidden' },
    gaugeGradient: { position: 'absolute', left: 0, bottom: 0, opacity: 0.92 },
    ring: {
      position: 'absolute',
      left: 0,
      top: 0,
      width: RING_BASE,
      height: RING_BASE,
      borderRadius: RING_BASE / 2,
      borderWidth: 1.2,
      borderColor: RING_COLOR,
      backgroundColor: 'transparent',
    },
    overlay: { ...StyleSheet.absoluteFillObject },
    header: { paddingHorizontal: 24, paddingTop: 12 },
    headerTitle: { fontSize: 30, fontWeight: '900', color: '#111827', letterSpacing: -0.8 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, paddingHorizontal: 40 },
    iconShell: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    title: { fontSize: 28, fontWeight: '900', color: '#111827', letterSpacing: -0.5 },
    // 2026-06-30 — 남은 탭 횟수 카운트다운 (크게)
    countdown: { fontSize: 72, fontWeight: '900', color: '#111827', letterSpacing: -2, fontVariant: ['tabular-nums'] },
    subtitle: { fontSize: 16, fontWeight: '700', color: '#6B7280', textAlign: 'center', lineHeight: 23 },
  });
