// 흔들기 미션의 물 — "매끄러운 물 본체"로 그립니다(메타볼 덩어리 X).
// 물리 = 1D 파동방정식(감쇠) + 좌우 기울기 외력. 항상 화면 하단으로 차오르고, 기울이면 쏠리고,
//   흔들면 표면이 출렁이다 멈추면 가라앉습니다. 물 양(fill)은 게이지.
// 비주얼 = Skia Path 물 본체(위 밝고 아래 짙은 깊이 그라데이션) + 표면 밝은 광택선(블러 글로우)로
//   "젖은 액체"처럼 보이게 합니다. (배열 uniform 미지원이라 Path 렌더가 정석 — 조사 확인)

import React, { memo, useEffect, useRef, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';

const N = 64; // 수면 컬럼 수

type Props = {
  fill: number;    // 0~1 물 양 (성공 게이지)
  accelX: number;  // 화면 좌우 가속도 (g) — 기울기 쏠림
  accelY: number;  // 보조(미사용)
  energy: number;
};

// 물리 (파동방정식 + 감쇠)
const WAVE_C2 = 0.28;     // 파동 전파 계수 (<1)
const WAVE_GAMMA = 2.8;   // 감쇠 (높을수록 빨리 잔잔 — 늘어남 억제)
const TILT_FORCE = 0.42;  // 좌우 가속도 → 수면 경사(쏠림). 더 낮춤 = 늘어남 추가 억제
const TILT_SIGN = 1;      // 방향(반대면 -1)
const MAX_DEV = 0.12;     // 수면이 평균 수위에서 벗어나는 최대치 — 더 줄여 찢어짐 강하게 차단
const SUBSTEPS = 2;

let SkiaCanvas: any = null;
let SkiaFill: any = null;
let SkiaPath: any = null;
let SkiaLinearGradient: any = null;
let SkiaBlur: any = null;
let skiaVec: any = null;
let SkiaApi: any = null;
let skiaOk = false;

try {
  const M = require('@shopify/react-native-skia');
  SkiaCanvas = M.Canvas;
  SkiaFill = M.Fill;
  SkiaPath = M.Path;
  SkiaLinearGradient = M.LinearGradient;
  SkiaBlur = M.Blur;
  skiaVec = M.vec;
  SkiaApi = M.Skia;
  skiaOk = !!(SkiaCanvas && SkiaFill && SkiaPath && SkiaLinearGradient && SkiaBlur && skiaVec && SkiaApi);
} catch {
  skiaOk = false;
}

function stepWater(prev: Float32Array, curr: Float32Array, next: Float32Array, accelX: number, fill: number, dt: number) {
  const cdt = Math.min(Math.max(dt, 0.001), 0.033);
  const sdt = cdt / SUBSTEPS;
  const damp = WAVE_GAMMA * sdt;
  const tilt = TILT_SIGN * accelX * TILT_FORCE;
  for (let s = 0; s < SUBSTEPS; s++) {
    for (let i = 0; i < N; i++) {
      const l = curr[i > 0 ? i - 1 : 0];
      const r = curr[i < N - 1 ? i + 1 : N - 1];
      next[i] = (2 * curr[i] - prev[i] * (1 - damp) + WAVE_C2 * (l + r - 2 * curr[i])) / (1 + damp);
    }
    for (let i = 0; i < N; i++) next[i] += tilt * (i / (N - 1) - 0.5) * sdt;
    // 평균을 fill로 (물 양 보존 + 차오름) + 클램프
    let avg = 0;
    for (let i = 0; i < N; i++) avg += next[i];
    avg /= N;
    const shift = fill - avg;
    // 평균 수위 ±MAX_DEV로 제한 → 표면이 찢어지듯 과하게 늘어나는 것 차단.
    const lo = Math.max(0, fill - MAX_DEV);
    const hi = Math.min(1, fill + MAX_DEV);
    for (let i = 0; i < N; i++) {
      let v = next[i] + shift;
      if (v < lo) v = lo;
      else if (v > hi) v = hi;
      next[i] = v;
    }
    prev.set(curr);
    curr.set(next);
  }
}

function ShakeLiquidMission({ fill, accelX, accelY, energy }: Props) {
  const { width, height } = useWindowDimensions();
  const prevRef = useRef<Float32Array>(new Float32Array(N).fill(fill));
  const currRef = useRef<Float32Array>(new Float32Array(N).fill(fill));
  const nextRef = useRef<Float32Array>(new Float32Array(N));
  const pRef = useRef({ accelX, fill });
  pRef.current = { accelX, fill };
  const [heights, setHeights] = useState<number[]>(() => new Array(N).fill(fill));
  const lastRef = useRef(Date.now());
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    lastRef.current = Date.now();
    const loop = () => {
      const now = Date.now();
      const dt = (now - lastRef.current) / 1000;
      lastRef.current = now;
      stepWater(prevRef.current, currRef.current, nextRef.current, pRef.current.accelX, pRef.current.fill, dt);
      setHeights(Array.from(currRef.current));
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  if (!skiaOk) {
    return (
      <View pointerEvents="none" style={styles.fbRoot}>
        <View style={styles.fbBg} />
        <View style={[styles.fbFill, { height: `${Math.round(fill * 100)}%` }]} />
      </View>
    );
  }

  const sy = (i: number) => (1 - heights[i]) * height;
  // 물 본체 (수면 곡선 → 바닥까지 닫음)
  const body = SkiaApi.Path.Make();
  body.moveTo(0, sy(0));
  for (let i = 1; i < N; i++) body.lineTo((i / (N - 1)) * width, sy(i));
  body.lineTo(width, height);
  body.lineTo(0, height);
  body.close();
  // 표면 곡선 (광택선)
  const surface = SkiaApi.Path.Make();
  surface.moveTo(0, sy(0));
  for (let i = 1; i < N; i++) surface.lineTo((i / (N - 1)) * width, sy(i));

  const waterTopY = (1 - Math.min(1, Math.max(0, fill))) * height;

  return (
    <SkiaCanvas style={StyleSheet.absoluteFill as any} pointerEvents="none">
      {/* 배경(빈 공간) */}
      <SkiaFill>
        <SkiaLinearGradient start={skiaVec(0, 0)} end={skiaVec(0, height)} colors={['#FB3A37', '#B91010']} />
      </SkiaFill>
      {/* 물 본체 — 위 밝고 아래 짙은 깊이 그라데이션 */}
      <SkiaPath path={body}>
        <SkiaLinearGradient
          start={skiaVec(0, waterTopY)}
          end={skiaVec(0, height)}
          colors={['#BDEFFF', '#42A5FF', '#0758C9']}
          positions={[0, 0.35, 1]}
        />
      </SkiaPath>
      {/* 표면 광택선 (밝은 stroke + 블러 글로우) */}
      <SkiaPath path={surface} style="stroke" strokeWidth={3} strokeCap="round" color="#E6FFEC">
        <SkiaBlur blur={2} />
      </SkiaPath>
    </SkiaCanvas>
  );
}

export default memo(ShakeLiquidMission);

const styles = StyleSheet.create({
  fbRoot: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
  },
  fbBg: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#D11414',
  },
  fbFill: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#42A5FF',
  },
});
