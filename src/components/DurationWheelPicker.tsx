// 시:분:초 duration 입력용 wheel picker. iOS Clock 앱 타이머 유사 UX.
// ScrollView snapToInterval 패턴. 의존성 0.

import React, { useEffect, useRef, useState } from 'react';
import * as Haptics from 'expo-haptics';
import {
  Modal,
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Platform,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from 'react-native';

const ITEM_HEIGHT = 44;
const VISIBLE_ROWS = 5; // 위 2 + 가운데 1 + 아래 2
const PICKER_HEIGHT = ITEM_HEIGHT * VISIBLE_ROWS;
const SIDE_PADDING = ITEM_HEIGHT * 2; // 가운데 정렬용

type Props = {
  isVisible: boolean;
  initialSeconds: number;
  onConfirm: (seconds: number) => void;
  onCancel: () => void;
  hourLabel: string;   // "시간"
  minuteLabel: string; // "분"
  secondLabel: string; // "초"
  confirmLabel: string;
  cancelLabel: string;
  textColor: string;
  dimColor: string;
  bgColor: string;
  accentColor: string;
};

type WheelProps = {
  count: number;
  initial: number;
  onChange: (n: number) => void;
  textColor: string;
  dimColor: string;
  /** 표시 라벨 변환. 기본: String(value). */
  formatLabel?: (value: number) => string;
  /** 무한 루프 여부. 기본 true. false 면 양 끝 멈춤 (AM/PM 등). */
  loop?: boolean;
  /** 가로 폭. 기본 32. */
  width?: number;
  /** 텍스트 정렬. 기본 'flex-end' (숫자+단위 가까이). 'center' = wheel 가운데. */
  align?: 'center' | 'flex-end';
};

// 무한 루프 wheel — boundary contentOffset reset 패턴.
// items = count × LOOP_REPEAT, 가운데 cycle 에서 시작.
// onMomentumScrollEnd 에서 boundary cycle (0 또는 LOOP_REPEAT-1) 도달 시
// 같은 value 의 가운데 cycle 위치로 silent jump (isJumpingRef 로 재진입 방지).
const LOOP_REPEAT = 5;
const CENTER_CYCLE = 2;

export function Wheel({ count, initial, onChange, textColor, dimColor, formatLabel, loop = true, width, align = 'flex-end' }: WheelProps) {
  const ref = useRef<ScrollView>(null);
  const isJumpingRef = useRef(false);
  const repeat = loop ? LOOP_REPEAT : 1;
  const centerCycle = loop ? CENTER_CYCLE : 0;
  const totalItems = count * repeat;
  const initialIdx = centerCycle * count + initial;
  const [centerIdx, setCenterIdx] = useState(initialIdx);

  useEffect(() => {
    isJumpingRef.current = true;
    setCenterIdx(initialIdx);
    const t = setTimeout(() => {
      ref.current?.scrollTo({ y: initialIdx * ITEM_HEIGHT, animated: false });
      setTimeout(() => { isJumpingRef.current = false; }, 50);
    }, 0);
    return () => clearTimeout(t);
  }, [initialIdx]);

  const valueFromIdx = (rawIdx: number) => {
    if (loop) return ((rawIdx % count) + count) % count;
    return Math.max(0, Math.min(count - 1, rawIdx));
  };

  const handleEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (isJumpingRef.current) return;
    const y = e.nativeEvent.contentOffset.y;
    const rawIdx = Math.round(y / ITEM_HEIGHT);
    const value = valueFromIdx(rawIdx);
    setCenterIdx(rawIdx);
    onChange(value);

    if (loop) {
      const cycle = Math.floor(rawIdx / count);
      if (cycle <= 0 || cycle >= LOOP_REPEAT - 1) {
        isJumpingRef.current = true;
        const targetIdx = CENTER_CYCLE * count + value;
        setCenterIdx(targetIdx);
        ref.current?.scrollTo({ y: targetIdx * ITEM_HEIGHT, animated: false });
        setTimeout(() => { isJumpingRef.current = false; }, 50);
      }
    }
  };

  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (isJumpingRef.current) return;
    const y = e.nativeEvent.contentOffset.y;
    const rawIdx = Math.round(y / ITEM_HEIGHT);
    if (rawIdx !== centerIdx) {
      setCenterIdx(rawIdx);
      // 2026-05-27 — iOS native UIPickerView 정합. row 변경 시점마다 haptic + 시스템 click sound.
      //   TimeWheelPicker (시:분 선택) + DurationWheelPicker (시:분:초 duration) 둘 다 본 Wheel 재사용.
      Haptics.selectionAsync().catch(() => {});
    }
  };

  const scrollStyle = width != null ? { ...wheelStyles.scroll, width } : wheelStyles.scroll;

  return (
    <ScrollView
      ref={ref}
      showsVerticalScrollIndicator={false}
      snapToInterval={ITEM_HEIGHT}
      decelerationRate="fast"
      onMomentumScrollEnd={handleEnd}
      onScroll={handleScroll}
      scrollEventThrottle={32}
      contentContainerStyle={{ paddingVertical: SIDE_PADDING }}
      style={scrollStyle}
    >
      {Array.from({ length: totalItems }, (_, i) => {
        const value = valueFromIdx(i);
        const dist = Math.abs(i - centerIdx);
        let opacity = 1;
        let scale = 1;
        if (dist === 1) { opacity = 0.6; scale = 0.92; }
        else if (dist === 2) { opacity = 0.3; scale = 0.82; }
        else if (dist >= 3) { opacity = 0; scale = 0.7; }
        const label = formatLabel ? formatLabel(value) : String(value);
        return (
          <View key={i} style={[wheelStyles.item, { alignItems: align }]}>
            <Text
              style={[
                wheelStyles.text,
                {
                  color: dist === 0 ? textColor : dimColor,
                  opacity,
                  transform: [{ scale }],
                },
              ]}
            >
              {label}
            </Text>
          </View>
        );
      })}
    </ScrollView>
  );
}

export const WHEEL_CONSTANTS = { ITEM_HEIGHT, PICKER_HEIGHT, SIDE_PADDING };

const wheelStyles = StyleSheet.create({
  scroll: { height: PICKER_HEIGHT, width: 60 },
  item: { height: ITEM_HEIGHT, justifyContent: 'center', alignItems: 'flex-end' },
  text: { fontSize: 18, fontVariant: ['tabular-nums'] },
});

export default function DurationWheelPicker(props: Props) {
  const {
    isVisible,
    initialSeconds,
    onConfirm,
    onCancel,
    hourLabel,
    minuteLabel,
    secondLabel,
    confirmLabel,
    cancelLabel,
    textColor,
    dimColor,
    bgColor,
    accentColor,
  } = props;

  const [hours, setHours] = useState(0);
  const [minutes, setMinutes] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [seedKey, setSeedKey] = useState(0);

  useEffect(() => {
    if (isVisible) {
      const total = Math.max(0, Math.floor(initialSeconds));
      setHours(Math.floor(total / 3600));
      setMinutes(Math.floor((total % 3600) / 60));
      setSeconds(total % 60);
      // ScrollView 의 initial 위치 재적용 트리거
      setSeedKey(k => k + 1);
    }
  }, [isVisible, initialSeconds]);

  const handleConfirm = () => {
    onConfirm(hours * 3600 + minutes * 60 + seconds);
  };

  return (
    <Modal visible={isVisible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { backgroundColor: bgColor }]}>
          <View style={styles.row}>
            <View style={styles.column}>
              <Wheel
                key={`h-${seedKey}`}
                count={24}
                initial={hours}
                onChange={setHours}
                textColor={textColor}
                dimColor={dimColor}
                formatLabel={(v) => `${v}${hourLabel}`}
                align="center"
                width={100}
              />
            </View>
            <View style={styles.column}>
              <Wheel
                key={`m-${seedKey}`}
                count={60}
                initial={minutes}
                onChange={setMinutes}
                textColor={textColor}
                dimColor={dimColor}
                formatLabel={(v) => `${v}${minuteLabel}`}
                align="center"
                width={100}
              />
            </View>
            <View style={styles.column}>
              <Wheel
                key={`s-${seedKey}`}
                count={60}
                initial={seconds}
                onChange={setSeconds}
                textColor={textColor}
                dimColor={dimColor}
                formatLabel={(v) => `${v}${secondLabel}`}
                align="center"
                width={100}
              />
            </View>
          </View>

          <View style={styles.actions}>
            <TouchableOpacity onPress={onCancel} style={styles.actionBtn}>
              <Text style={[styles.actionText, { color: dimColor }]}>{cancelLabel}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleConfirm} style={styles.actionBtn}>
              <Text style={[styles.actionText, { color: accentColor, fontWeight: '600' }]}>{confirmLabel}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    paddingTop: 16,
    paddingBottom: Platform.OS === 'ios' ? 32 : 16,
    paddingHorizontal: 16,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  centerHighlight: {
    position: 'absolute',
    left: 16,
    right: 16,
    top: 16 + ITEM_HEIGHT * 2,
    height: ITEM_HEIGHT,
    borderTopWidth: 1,
    borderBottomWidth: 1,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    height: PICKER_HEIGHT,
  },
  column: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: 100,
    marginHorizontal: 10,
  },
  unit: {
    fontSize: 14,
    marginLeft: 2,
    minWidth: 28,
    textAlign: 'left',
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingTop: 12,
  },
  actionBtn: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    minWidth: 80,
    alignItems: 'center',
  },
  actionText: {
    fontSize: 16,
  },
});
