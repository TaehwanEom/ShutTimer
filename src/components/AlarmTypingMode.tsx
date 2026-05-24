// 알람 종료 미션 = 받아쓰기 모드. 3문제 순차 출제, 각 문제 정확 입력 시 다음 문제로 진행. 마지막 정답 시 onSuccess.

import React, { useMemo, useRef, useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  SafeAreaView,
  KeyboardAvoidingView,
  Platform,
  Animated,
  ScrollView,
  Vibration,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { ThemeColors } from '../constants/theme';
import {
  generateTypingProblems,
  checkTypingAnswer,
  TypingProblem,
} from '../utils/typingProblemGenerator';

type Props = {
  colors: ThemeColors;
  t: (key: string, opts?: any) => string;
  locale: string;
  onSuccess: () => void;
  /** 남은 시간 ms. props 없으면 표시 안 함. AlarmScreen 측만 전달. */
  remainingMs?: number;
};

const TOTAL_PROBLEMS = 3;

function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function AlarmTypingMode({ colors, t, locale, onSuccess, remainingMs }: Props) {
  const [problems, setProblems] = useState<TypingProblem[]>(() => generateTypingProblems(locale, TOTAL_PROBLEMS));
  const [currentIdx, setCurrentIdx] = useState(0);
  const [input, setInput] = useState('');
  const [wrongFlash, setWrongFlash] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const shakeAnim = useRef(new Animated.Value(0)).current;

  // v1.8 #SlotMachine — mount 직후 1.2초 슬롯머신 효과.
  const [isShuffling, setIsShuffling] = useState(true);
  const [shuffledPool] = useState<TypingProblem[]>(() => generateTypingProblems(locale, 8));
  const [shuffleIdx, setShuffleIdx] = useState(0);
  const [shuffleTrigger, setShuffleTrigger] = useState(0);
  const shuffleIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const shuffleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // v1.8 — 매 문제 진입 시 슬롯머신 재발동 (= currentIdx 변경마다).
  useEffect(() => {
    setIsShuffling(true);
    setShuffleIdx(0);
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
  }, [currentIdx, shuffleTrigger, shuffledPool.length]);

  const styles = useMemo(() => makeStyles(colors), [colors]);
  const current = problems[currentIdx];
  const displayedProblem = isShuffling ? shuffledPool[shuffleIdx] : current;

  useEffect(() => {
    // 첫 마운트 후 keyboard 자동 영역. 슬롯머신 종료 후 focus.
    if (isShuffling) return;
    const tm = setTimeout(() => inputRef.current?.focus(), 200);
    return () => clearTimeout(tm);
  }, [isShuffling]);

  useEffect(() => {
    if (!wrongFlash) return;
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 1, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -1, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 1, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 60, useNativeDriver: true }),
    ]).start(() => setWrongFlash(false));
  }, [wrongFlash, shakeAnim]);

  const handleSubmit = () => {
    if (isShuffling) return; // v1.8 #SlotMachine — 슬롯머신 진행 중 submit 무시.
    if (!current) return;
    if (checkTypingAnswer(input, current)) {
      // 정답.
      if (currentIdx + 1 >= TOTAL_PROBLEMS) {
        onSuccess();
        return;
      }
      setCurrentIdx(prev => prev + 1);
      setInput('');
      return;
    }
    // 오답 = 새 문제 출제 (= 현재 idx 위치만 교체, 진행도 유지) + 진동 피드백 + 슬롯머신 재발동.
    Vibration.vibrate();
    const replacement = generateTypingProblems(locale, 1)[0];
    setProblems(prev => prev.map((p, i) => (i === currentIdx ? replacement : p)));
    setInput('');
    setWrongFlash(true);
    setShuffleTrigger(c => c + 1);
  };

  const shakeTranslate = shakeAnim.interpolate({
    inputRange: [-1, 1],
    outputRange: [-12, 12],
  });

  // v1.8 — 실시간 피드백. input 글자별 = 정답 측 동일 idx 영역 비교 → 연두 / 빨강.
  // 2026-05-25 사용자 요구 — 대소문자만 무시. 띄어쓰기 포함 정확 일치 (정답 체크 측과 동일).
  const charColors: string[] = (() => {
    if (!input || !current) return [];
    const norm = (c: string) => c.toLowerCase();
    const nTarget = norm(current.text);
    const colors: string[] = [];
    let targetIdx = 0;
    for (let i = 0; i < input.length; i++) {
      const inputCh = input[i];
      const nInputCh = norm(inputCh);
      if (nInputCh === '') {
        colors.push('#ffffff');
        continue;
      }
      if (targetIdx >= nTarget.length) {
        colors.push('#ff6b6b');
        targetIdx += 1;
        continue;
      }
      if (nInputCh === nTarget[targetIdx]) {
        colors.push('#2bf213'); // 연두 = 정확 일치 (= Tailwind green-400)
      } else {
        colors.push('#ff6b6b');
      }
      targetIdx += 1;
    }
    return colors;
  })();

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.topBar}>
        <Text style={styles.brand}>ShutTimer</Text>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ flexGrow: 1 }} bounces={false} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <View style={styles.centerSection}>
            {typeof remainingMs === 'number' && (
              <Text style={styles.timer}>{formatRemaining(remainingMs)}</Text>
            )}
            <Text style={styles.title}>{t('alarm.typingTitle', { defaultValue: '받아쓰기 미션' })}</Text>
            <Text style={styles.subtitle}>
              {t('alarm.typingInstruction', { defaultValue: '화면의 글자를 그대로 입력하세요' })}
            </Text>
            <View style={styles.progressRow}>
              {[0, 1, 2].map(i => (
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
              <Text style={[styles.problemText, wrongFlash && { color: '#ff6b6b' }]} selectable={false}>
                {displayedProblem?.text ?? ''}
              </Text>
            </Animated.View>

            {/* TextInput 측 = 글자별 색 = React Native 측 children 영역 동작 ❌ 영역.
                대안 = TextInput color transparent + 별도 Text overlay = 글자별 색 영역. */}
            <View style={styles.inputWrap}>
              <TextInput
                ref={inputRef}
                style={[styles.input, { color: 'transparent' }]}
                value={input}
                onChangeText={setInput}
                placeholder={input.length === 0 ? t('alarm.typingPlaceholder', { defaultValue: '여기에 입력' }) : ''}
                placeholderTextColor="rgba(255,255,255,0.5)"
                selectionColor={colors.onPrimary}
                autoCorrect={false}
                autoCapitalize="none"
                autoComplete="off"
                spellCheck={false}
                onSubmitEditing={handleSubmit}
                returnKeyType="done"
                blurOnSubmit={false}
              />
              {input.length > 0 && (
                <View pointerEvents="none" style={styles.overlay}>
                  {Array.from(input).map((ch, i) => (
                    <Text key={i} style={[styles.overlayChar, { color: charColors[i] ?? '#ffffff' }]}>
                      {ch}
                    </Text>
                  ))}
                </View>
              )}
            </View>

            <TouchableOpacity style={styles.submitButton} onPress={handleSubmit} activeOpacity={0.8}>
              <Text style={styles.submitText}>{t('alarm.typingSubmit', { defaultValue: '확인' })}</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
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
    paddingTop: 10,
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
    marginTop: 8,
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
    paddingVertical: 22,
    paddingHorizontal: 24,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 16,
    width: '85%',
    alignItems: 'center',
  },
  problemText: {
    fontSize: 28,
    fontWeight: '800',
    color: colors.onPrimary,
    letterSpacing: 1,
    textAlign: 'center',
  },
  inputWrap: {
    marginTop: 8,
    width: '85%',
    position: 'relative',
  },
  input: {
    width: '100%',
    paddingVertical: 14,
    paddingHorizontal: 18,
    fontSize: 22,
    fontWeight: '700',
    color: colors.onPrimary,
    backgroundColor: 'rgba(0,0,0,0.22)',
    borderRadius: 12,
    textAlign: 'center',
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 18,
  },
  overlayChar: {
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: 0,
  },
  submitButton: {
    marginTop: 12,
    paddingVertical: 14,
    paddingHorizontal: 48,
    backgroundColor: 'rgba(255,255,255,0.35)',
    borderRadius: 14,
  },
  submitText: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.onPrimary,
  },
});
