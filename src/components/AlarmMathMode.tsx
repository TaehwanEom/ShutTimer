// 알람 종료 미션 = 간단 산수 문제 풀이 모드. 3문제 순차 출제, 각 문제 정답 시 다음 문제로 진행.
// 마지막 정답 시 onSuccess. 받아쓰기 미션과 동일 패턴.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  Animated,
  ScrollView,
  Vibration,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { ThemeColors } from '../constants/theme';
import { generateMathProblem, MathProblem } from '../utils/mathProblemGenerator';

type Props = {
  colors: ThemeColors;
  t: (key: string, opts?: any) => string;
  onSuccess: () => void;
  /** 남은 시간 ms. props 없으면 표시 안 함. AlarmScreen 측만 전달. */
  remainingMs?: number;
};

const TOTAL_PROBLEMS = 3;
const KEYPAD: (string | null)[] = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'submit'];

function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function AlarmMathMode({ colors, t, onSuccess, remainingMs }: Props) {
  const [problems, setProblems] = useState<MathProblem[]>(() =>
    Array.from({ length: TOTAL_PROBLEMS }, () => generateMathProblem())
  );
  const [currentIdx, setCurrentIdx] = useState(0);
  const [input, setInput] = useState('');
  const [wrongFlash, setWrongFlash] = useState(false);
  const shakeAnim = useRef(new Animated.Value(0)).current;

  // v1.8 #SlotMachine — mount 직후 1.2초 슬롯머신 효과 (= 카메라 미션 동일 패턴).
  const [isShuffling, setIsShuffling] = useState(true);
  const [shuffledPool] = useState<MathProblem[]>(() =>
    Array.from({ length: 8 }, () => generateMathProblem())
  );
  const [shuffleIdx, setShuffleIdx] = useState(0);
  const shuffleIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const shuffleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    shuffleIntervalRef.current = setInterval(() => {
      setShuffleIdx((i) => (i + 1) % shuffledPool.length);
    }, 60);
    shuffleTimeoutRef.current = setTimeout(() => {
      if (shuffleIntervalRef.current) {
        clearInterval(shuffleIntervalRef.current);
        shuffleIntervalRef.current = null;
      }
      shuffleTimeoutRef.current = null;
      setIsShuffling(false);
    }, 1200);
    return () => {
      if (shuffleIntervalRef.current) clearInterval(shuffleIntervalRef.current);
      if (shuffleTimeoutRef.current) clearTimeout(shuffleTimeoutRef.current);
    };
  }, [shuffledPool.length]);

  const styles = useMemo(() => makeStyles(colors), [colors]);
  const current = problems[currentIdx];
  const displayedProblem = isShuffling ? shuffledPool[shuffleIdx] : current;

  useEffect(() => {
    if (!wrongFlash) return;
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 1, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -1, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 1, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 60, useNativeDriver: true }),
    ]).start(() => setWrongFlash(false));
  }, [wrongFlash, shakeAnim]);

  const handleKeyPress = (key: string) => {
    if (isShuffling) return; // v1.8 #SlotMachine — 슬롯머신 진행 중 입력 무시.
    if (!current) return;
    if (key === 'clear') {
      setInput('');
      return;
    }
    if (key === 'submit') {
      const parsed = parseInt(input, 10);
      if (!isNaN(parsed) && parsed === current.answer) {
        // 정답.
        if (currentIdx + 1 >= TOTAL_PROBLEMS) {
          onSuccess();
          return;
        }
        setCurrentIdx(prev => prev + 1);
        setInput('');
        return;
      }
      // 오답 = 같은 idx 새 문제로 교체 (= 진행도 유지) + 진동 피드백.
      Vibration.vibrate();
      setProblems(prev => prev.map((p, i) => (i === currentIdx ? generateMathProblem() : p)));
      setInput('');
      setWrongFlash(true);
      return;
    }
    // 숫자 입력. 4자리 제한 (= 두 자릿수 × 두 자릿수 최대 영역).
    if (input.length >= 4) return;
    setInput(prev => prev + key);
  };

  const shakeTranslate = shakeAnim.interpolate({
    inputRange: [-1, 1],
    outputRange: [-12, 12],
  });

  // v1.8 — 실시간 피드백. 입력 = 정답 prefix 영역인지 영역 → 연두 / 빨강 (= 전체 색).
  const inputColor = (() => {
    if (!input || !current) return '#ffffff';
    const target = String(current.answer);
    if (target.startsWith(input)) return '#2bf213'; // 연두 = 정답 진행 중
    return '#ff6b6b'; // 빨강 = 오답
  })();

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.topBar}>
        <Text style={styles.brand}>ShutTimer</Text>
      </View>

      <ScrollView contentContainerStyle={{ flexGrow: 1 }} bounces={false} showsVerticalScrollIndicator={false}>
        <View style={styles.centerSection}>
          {typeof remainingMs === 'number' && (
            <Text style={styles.timer}>{formatRemaining(remainingMs)}</Text>
          )}
          <Text style={styles.title}>{t('alarm.mathTitle', { defaultValue: '산수 미션' })}</Text>
          <Text style={styles.subtitle}>
            {t('alarm.mathInstruction', { defaultValue: '문제를 풀어 알람을 꺼주세요' })}
          </Text>
          <View style={styles.progressRow}>
            {Array.from({ length: TOTAL_PROBLEMS }).map((_, i) => (
              <View
                key={i}
                style={[
                  styles.progressDot,
                  i < currentIdx && styles.progressDotDone,
                  i === currentIdx && styles.progressDotActive,
                ]}
              />
            ))}
            <Text style={styles.progressText}>
              {currentIdx + 1} / {TOTAL_PROBLEMS}
            </Text>
          </View>

          <Animated.View style={[styles.problemBox, { transform: [{ translateX: shakeTranslate }] }]}>
            <Text style={styles.problemText}>{displayedProblem?.display ?? ''} = ?</Text>
          </Animated.View>

          <View style={styles.inputBox}>
            <Text style={[styles.inputText, { color: inputColor }]}>{input || '_'}</Text>
          </View>
        </View>

        <View style={styles.keypad}>
          {KEYPAD.map((key, idx) => {
            if (key === null) {
              return <View key={idx} style={styles.keyPlaceholder} />;
            }
            const isAction = key === 'clear' || key === 'submit';
            const buttonStyle = [
              styles.key,
              isAction && (key === 'submit' ? styles.keySubmit : styles.keyClear),
            ];
            const textStyle = [
              styles.keyText,
              isAction && styles.keyActionText,
            ];
            return (
              <TouchableOpacity
                key={idx}
                style={buttonStyle}
                onPress={() => handleKeyPress(key)}
                activeOpacity={0.7}
              >
                {key === 'clear' ? (
                  <MaterialIcons name="backspace" size={28} color={colors.onPrimary} />
                ) : key === 'submit' ? (
                  <MaterialIcons name="check" size={32} color={colors.onPrimary} />
                ) : (
                  <Text style={textStyle}>{key}</Text>
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.primary },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 4,
  },
  brand: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.onPrimary,
    letterSpacing: -0.5,
  },
  timer: {
    fontSize: 64,
    fontWeight: '900',
    color: colors.onPrimary,
    letterSpacing: -1,
    fontVariant: ['tabular-nums'],
    marginBottom: 4,
  },
  centerSection: {
    alignItems: 'center',
    paddingTop: 12,
    paddingHorizontal: 24,
    gap: 8,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.onPrimary,
  },
  subtitle: {
    fontSize: 13,
    color: colors.onPrimary,
    opacity: 0.85,
    textAlign: 'center',
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  progressDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
  progressDotActive: {
    backgroundColor: colors.onPrimary,
    width: 14,
    height: 14,
    borderRadius: 7,
  },
  progressDotDone: {
    backgroundColor: 'rgba(255,255,255,0.7)',
  },
  progressText: {
    marginLeft: 8,
    fontSize: 13,
    fontWeight: '700',
    color: colors.onPrimary,
    opacity: 0.85,
  },
  problemBox: {
    marginTop: 8,
    paddingVertical: 18,
    paddingHorizontal: 32,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 16,
    minWidth: '70%',
    alignItems: 'center',
  },
  problemText: {
    fontSize: 38,
    fontWeight: '800',
    color: colors.onPrimary,
    letterSpacing: 2,
  },
  inputBox: {
    marginTop: 8,
    paddingVertical: 14,
    paddingHorizontal: 24,
    backgroundColor: 'rgba(0,0,0,0.2)',
    borderRadius: 12,
    minWidth: 140,
    alignItems: 'center',
  },
  inputText: {
    fontSize: 32,
    fontWeight: '800',
    color: colors.onPrimary,
    letterSpacing: 4,
  },
  keypad: {
    marginTop: 20,
    paddingHorizontal: 24,
    paddingBottom: 24,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 10,
  },
  key: {
    width: '31%',
    aspectRatio: 1.6,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyClear: {
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  keySubmit: {
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
  keyPlaceholder: {
    width: '31%',
    aspectRatio: 1.6,
  },
  keyText: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.onPrimary,
  },
  keyActionText: {
    fontSize: 22,
  },
});
