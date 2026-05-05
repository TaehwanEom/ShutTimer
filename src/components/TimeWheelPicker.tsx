// 시작 시간 입력용 wheel picker. iPhone Clock 알람 다이얼 구조 (오전/오후 + 시 + 분).
// DurationWheelPicker 의 Wheel 컴포넌트 재사용 (props 확장으로 loop / formatLabel 제어).

import React, { useEffect, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
} from 'react-native';
import { Wheel, WHEEL_CONSTANTS } from './DurationWheelPicker';

const { ITEM_HEIGHT, PICKER_HEIGHT } = WHEEL_CONSTANTS;

type Props = {
  isVisible: boolean;
  /** 0~23 */
  initialHour: number;
  /** 0~59 */
  initialMinute: number;
  onConfirm: (hour24: number, minute: number) => void;
  onCancel: () => void;
  amLabel: string;
  pmLabel: string;
  hourUnitLabel: string;
  minuteUnitLabel: string;
  confirmLabel: string;
  cancelLabel: string;
  textColor: string;
  dimColor: string;
  bgColor: string;
  accentColor: string;
  /**
   * v1.6+ 인라인 모드 (= 모달 wrap ❌, 화면 상단 직접 노출).
   * iOS 시스템 알람 측 패턴. 값 변경 시 즉시 onConfirm 호출 (= 확인/취소 버튼 미노출).
   */
  inline?: boolean;
};

function hour24To12(h: number): { ampm: 0 | 1; hour12: number } {
  const ampm = h >= 12 ? 1 : 0;
  let hour12 = h % 12;
  if (hour12 === 0) hour12 = 12;
  return { ampm: ampm as 0 | 1, hour12 };
}

function hour12To24(ampm: 0 | 1, hour12: number): number {
  if (ampm === 0) return hour12 === 12 ? 0 : hour12;
  return hour12 === 12 ? 12 : hour12 + 12;
}

export default function TimeWheelPicker(props: Props) {
  const {
    isVisible,
    initialHour,
    initialMinute,
    onConfirm,
    onCancel,
    amLabel,
    pmLabel,
    confirmLabel,
    cancelLabel,
    textColor,
    dimColor,
    bgColor,
    accentColor,
    inline,
  } = props;

  const initialAmPm = hour24To12(initialHour).ampm;
  const initialHour12 = hour24To12(initialHour).hour12;

  const [ampm, setAmpm] = useState<0 | 1>(initialAmPm);
  const [hour12, setHour12] = useState<number>(initialHour12);
  const [minute, setMinute] = useState<number>(initialMinute);
  const [seedKey, setSeedKey] = useState(0);

  useEffect(() => {
    if (isVisible || inline) {
      const { ampm: a, hour12: h } = hour24To12(initialHour);
      setAmpm(a);
      setHour12(h);
      setMinute(initialMinute);
      setSeedKey(k => k + 1);
    }
    // inline 모드 측 = mount 시 1회 seed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVisible]);

  const handleConfirm = () => {
    onConfirm(hour12To24(ampm, hour12), minute);
  };

  const ampmLabel = (v: number) => (v === 0 ? amLabel : pmLabel);

  // v1.6+ 인라인 모드 — 값 변경 시 즉시 onConfirm 호출 (= 확인 버튼 미노출).
  // iOS 시스템 알람 측 패턴.
  const handleInlineChange = (a: 0 | 1, h: number, m: number) => {
    onConfirm(hour12To24(a, h), m);
  };

  const wheels = (
    <View style={[styles.row, inline && styles.rowInline]}>
      <View style={styles.column}>
        <Wheel
          key={`ampm-${seedKey}`}
          count={2}
          initial={ampm}
          onChange={(v) => {
            const next = v as 0 | 1;
            setAmpm(next);
            if (inline) handleInlineChange(next, hour12, minute);
          }}
          textColor={textColor}
          dimColor={dimColor}
          formatLabel={ampmLabel}
          loop={false}
          width={48}
          align="center"
        />
      </View>
      <View style={styles.column}>
        <Wheel
          key={`h-${seedKey}`}
          count={12}
          initial={hour12 - 1}
          onChange={(v) => {
            const next = v + 1;
            setHour12(next);
            if (inline) handleInlineChange(ampm, next, minute);
          }}
          textColor={textColor}
          dimColor={dimColor}
          formatLabel={(v) => String(v + 1)}
          width={48}
          align="center"
        />
      </View>
      <View style={styles.column}>
        <Wheel
          key={`m-${seedKey}`}
          count={60}
          initial={minute}
          onChange={(v) => {
            setMinute(v);
            if (inline) handleInlineChange(ampm, hour12, v);
          }}
          width={48}
          align="center"
          textColor={textColor}
          dimColor={dimColor}
          formatLabel={(v) => String(v).padStart(2, '0')}
        />
      </View>
    </View>
  );

  if (inline) {
    return (
      <View style={[styles.inlineWrap, { backgroundColor: bgColor }]}>
        {wheels}
      </View>
    );
  }

  return (
    <Modal visible={isVisible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { backgroundColor: bgColor }]}>
          {wheels}

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
  row: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    height: PICKER_HEIGHT,
  },
  rowInline: {
    paddingVertical: 8,
  },
  inlineWrap: {
    paddingVertical: 8,
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(0,0,0,0.1)',
  },
  column: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: 80,
    marginHorizontal: 10,
  },
  unitColumn: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 4,
  },
  unit: {
    fontSize: 14,
    marginLeft: 2,
    minWidth: 20,
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
