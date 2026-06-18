// 하단 탭을 좌우 스와이프로 전환하는 공용 래퍼.
// 자식(카드 삭제 스와이프·다이얼 회전)이 먼저 제스처를 가져가도록 capture 미사용 →
// 카드 위에선 카드 동작 우선, 빈 곳·가장자리에서 민 명확한 가로 스와이프만 탭 전환.
import React, { useMemo } from 'react';
import { View, PanResponder, StyleSheet, ViewStyle } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { isSwipeLocked } from './tabSwipeLock';

// 가로 이동이 이 픽셀 이상 + 세로보다 충분히 우세할 때만 탭 스와이프로 인식 (세로 스크롤 보호).
const MOVE_CLAIM_DX = 24;
const HORIZONTAL_RATIO = 1.5;
const RELEASE_DX = 60;
const RELEASE_VX = 0.3;

type Props = { children: React.ReactNode; style?: ViewStyle };

export default function TabSwipeContainer({ children, style }: Props) {
  const navigation = useNavigation<any>();

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        // capture 미사용 — 자식(카드/다이얼) 우선. 명확한 가로 스와이프만 부모가 claim.
        // 보호 영역(가로 스크롤 등)을 만지는 중이면 탭 스와이프 비활성.
        onMoveShouldSetPanResponder: (_, g) =>
          !isSwipeLocked() &&
          Math.abs(g.dx) > MOVE_CLAIM_DX && Math.abs(g.dx) > Math.abs(g.dy) * HORIZONTAL_RATIO,
        onPanResponderRelease: (_, g) => {
          const decisive = Math.abs(g.dx) > RELEASE_DX || Math.abs(g.vx) > RELEASE_VX;
          if (!decisive) return;
          const state = navigation.getState?.();
          if (!state || !Array.isArray(state.routes)) return;
          // 왼쪽으로 밀기(dx<0) → 다음 탭, 오른쪽(dx>0) → 이전 탭.
          const target = state.index + (g.dx < 0 ? 1 : -1);
          if (target < 0 || target >= state.routes.length) return;
          navigation.navigate(state.routes[target].name);
        },
      }),
    [navigation],
  );

  return (
    <View style={[styles.fill, style]} {...responder.panHandlers}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
