import React from 'react';
import { MaterialIcons } from '@expo/vector-icons';
import Svg, { Path } from 'react-native-svg';

type Props = {
  name: string;
  size: number;
  color: string;
};

/**
 * 이빨(어금니) 실루엣 아이콘
 * 100×100 기준으로 설계 후 size로 스케일
 *
 *   꼭지   꼭지
 *   ∩     ∩
 *  [   크라운   ]
 *    |   |   |
 *  [뿌리] [뿌리]
 */
function ToothbrushIcon({ size, color }: { size: number; color: string }) {
  const p = (v: number) => (v / 100) * size;

  // 100×100 기준 path
  // 상단: 2개 꼭지(cusp) — Q로 2번 볼록
  // 측면: 크라운 좌우
  // 하단: 2개 뿌리, 가운데 V자 노치
  const d = [
    `M ${p(22)} ${p(10)}`,
    // 왼쪽 꼭지
    `Q ${p(34)} ${p(2)} ${p(50)} ${p(10)}`,
    // 오른쪽 꼭지
    `Q ${p(66)} ${p(2)} ${p(78)} ${p(10)}`,
    // 오른쪽 상단 모서리
    `Q ${p(88)} ${p(10)} ${p(88)} ${p(20)}`,
    // 크라운 오른쪽 → 오른쪽 뿌리
    `L ${p(88)} ${p(56)}`,
    `L ${p(88)} ${p(88)}`,
    `Q ${p(88)} ${p(96)} ${p(80)} ${p(96)}`,
    `L ${p(64)} ${p(96)}`,
    `Q ${p(56)} ${p(96)} ${p(56)} ${p(88)}`,
    `L ${p(56)} ${p(60)}`,
    // 가운데 V자 노치
    `Q ${p(50)} ${p(52)} ${p(44)} ${p(60)}`,
    // 왼쪽 뿌리
    `L ${p(44)} ${p(88)}`,
    `Q ${p(44)} ${p(96)} ${p(36)} ${p(96)}`,
    `L ${p(20)} ${p(96)}`,
    `Q ${p(12)} ${p(96)} ${p(12)} ${p(88)}`,
    `L ${p(12)} ${p(56)}`,
    // 크라운 왼쪽 위로
    `L ${p(12)} ${p(20)}`,
    `Q ${p(12)} ${p(10)} ${p(22)} ${p(10)}`,
    `Z`,
  ].join(' ');

  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <Path d={d} fill="none" stroke={color} strokeWidth={size * 0.06} strokeLinejoin="round" />
    </Svg>
  );
}

const CUSTOM_ICONS: Record<string, (props: { size: number; color: string }) => React.ReactElement> = {
  toothbrush: ToothbrushIcon,
};

export default function MissionIcon({ name, size, color }: Props) {
  const Custom = CUSTOM_ICONS[name];
  if (Custom) return <Custom size={size} color={color} />;
  return <MaterialIcons name={name as React.ComponentProps<typeof MaterialIcons>['name']} size={size} color={color} />;
}
