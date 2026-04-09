import React from 'react';
import { View, Animated } from 'react-native';
import Svg, { Polygon } from 'react-native-svg';

const AnimatedPolygon = Animated.createAnimatedComponent(Polygon);

type Props = {
  digit: string;
  size: number;
  color: string;
  dimColor?: string;
  bottomBlink?: Animated.AnimatedInterpolation<string | number>;
};

// a=top, b=topRight, c=bottomRight, d=bottom, e=bottomLeft, f=topLeft, g=middle
const SEGMENTS: Record<string, boolean[]> = {
  '0': [true, true, true, true, true, true, false],
  '1': [false, true, true, false, false, false, false],
  '2': [true, true, false, true, true, false, true],
  '3': [true, true, true, true, false, false, true],
  '4': [false, true, true, false, false, true, true],
  '5': [true, false, true, true, false, true, true],
  '6': [true, false, true, true, true, true, true],
  '7': [true, true, true, false, false, false, false],
  '8': [true, true, true, true, true, true, true],
  '9': [true, true, true, true, false, true, true],
  'A': [true, true, true, false, true, true, true],
  'B': [false, false, true, true, true, true, true],
  'C': [true, false, false, true, true, true, false],
  'D': [false, true, true, true, true, false, true],
  'E': [true, false, false, true, true, true, true],
  'F': [true, false, false, false, true, true, true],
  'G': [true, false, true, true, true, true, false],
  'H': [false, true, true, false, true, true, true],
  'I': [false, false, false, false, true, true, false],
  'J': [false, true, true, true, false, false, false],
  'K': [false, true, true, false, true, true, true],
  'L': [false, false, false, true, true, true, false],
  'M': [true, true, true, false, true, true, false],
  'N': [false, false, true, false, true, false, true],
  'O': [true, true, true, true, true, true, false],
  'P': [true, true, false, false, true, true, true],
  'R': [false, false, false, false, true, false, true],
  'S': [true, false, true, true, false, true, true],
  'T': [true, true, false, false, true, true, false],  // a+b+f+e
  'T2': [true, false, false, false, false, true, false], // a+f
  'U': [false, true, true, true, true, true, false],
  'W': [false, true, true, true, true, true, false],
  ' ': [false, false, false, false, false, false, false],
  '_a': [true, false, false, false, false, false, false],
};

export default function SevenSegment({ digit, size, color, dimColor, bottomBlink }: Props) {
  const dim = dimColor ?? `${color}12`;
  const w = size;
  const h = size * 2.0;
  const t = size * 0.18;   // 세그먼트 두께
  const g = 0.5;           // 최소 간격

  if (digit === ':') {
    const dotSize = t * 1.2;
    return (
      <View style={{ width: w * 0.2, height: h, alignItems: 'center', justifyContent: 'center', gap: h * 0.2 }}>
        <View style={{ width: dotSize, height: dotSize, backgroundColor: color }} />
        <View style={{ width: dotSize, height: dotSize, backgroundColor: color }} />
      </View>
    );
  }

  if (digit === '-') {
    return (
      <View style={{ width: w * 0.5, height: h, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ width: w * 0.4, height: t, backgroundColor: color, borderRadius: t / 4 }} />
      </View>
    );
  }

  const segs = SEGMENTS[digit] ?? SEGMENTS['0'];
  const my = h / 2;
  const ht = t / 2;

  // 가로 세그먼트: 양끝 뾰족, 세로와 맞물림
  const hSeg = (y: number) => [
    `${ht + g},${y + ht}`,       // 좌 꼭짓점
    `${t + g},${y}`,             // 좌상
    `${w - t - g},${y}`,         // 우상
    `${w - ht - g},${y + ht}`,   // 우 꼭짓점
    `${w - t - g},${y + t}`,     // 우하
    `${t + g},${y + t}`,         // 좌하
  ].join(' ');

  // 세로 세그먼트: 상하 뾰족, 가로와 맞물림
  const vSeg = (x: number, y1: number, y2: number) => [
    `${x + ht},${y1}`,          // 상 꼭짓점
    `${x + t},${y1 + ht}`,      // 우상
    `${x + t},${y2 - ht}`,      // 우하
    `${x + ht},${y2}`,          // 하 꼭짓점
    `${x},${y2 - ht}`,          // 좌하
    `${x},${y1 + ht}`,          // 좌상
  ].join(' ');

  // 중간 세그먼트
  const gSeg = [
    `${ht + g},${my}`,           // 좌 꼭짓점
    `${t + g},${my - ht}`,
    `${w - t - g},${my - ht}`,
    `${w - ht - g},${my}`,       // 우 꼭짓점
    `${w - t - g},${my + ht}`,
    `${t + g},${my + ht}`,
  ].join(' ');

  // 세로 세그먼트 Y 좌표 — 가로와 딱 맞닿음
  const vTop1 = t + g;
  const vTop2 = my - g;
  const vBot1 = my + g;
  const vBot2 = h - t - g;

  return (
    <View style={{ width: w, height: h }}>
      <Svg width={w} height={h}>
        {/* a - top */}
        <Polygon points={hSeg(0)} fill={segs[0] ? color : dim} />
        {/* b - top right */}
        <Polygon points={vSeg(w - t, vTop1, vTop2)} fill={segs[1] ? color : dim} />
        {/* c - bottom right */}
        <Polygon points={vSeg(w - t, vBot1, vBot2)} fill={segs[2] ? color : dim} />
        {/* d - bottom */}
        {bottomBlink ? (
          <AnimatedPolygon points={hSeg(h - t)} fill={bottomBlink} />
        ) : (
          <Polygon points={hSeg(h - t)} fill={segs[3] ? color : dim} />
        )}
        {/* e - bottom left */}
        <Polygon points={vSeg(0, vBot1, vBot2)} fill={segs[4] ? color : dim} />
        {/* f - top left */}
        <Polygon points={vSeg(0, vTop1, vTop2)} fill={segs[5] ? color : dim} />
        {/* g - middle */}
        <Polygon points={gSeg} fill={segs[6] ? color : dim} />
      </Svg>
    </View>
  );
}
