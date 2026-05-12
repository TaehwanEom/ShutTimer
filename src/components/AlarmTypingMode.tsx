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
};

const TOTAL_PROBLEMS = 3;

export default function AlarmTypingMode({ colors, t, locale, onSuccess }: Props) {
  const [problems, setProblems] = useState<TypingProblem[]>(() => generateTypingProblems(locale, TOTAL_PROBLEMS));
  const [currentIdx, setCurrentIdx] = useState(0);
  const [input, setInput] = useState('');
  const [wrongFlash, setWrongFlash] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const shakeAnim = useRef(new Animated.Value(0)).current;

  const styles = useMemo(() => makeStyles(colors), [colors]);
  const current = problems[currentIdx];

  useEffect(() => {
    // 첫 마운트 후 keyboard 자동 영역.
    const tm = setTimeout(() => inputRef.current?.focus(), 200);
    return () => clearTimeout(tm);
  }, []);

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
    // 오답 = 새 문제 출제 (= 현재 idx 위치만 교체, 진행도 유지).
    const replacement = generateTypingProblems(locale, 1)[0];
    setProblems(prev => prev.map((p, i) => (i === currentIdx ? replacement : p)));
    setInput('');
    setWrongFlash(true);
  };

  const shakeTranslate = shakeAnim.interpolate({
    inputRange: [-1, 1],
    outputRange: [-12, 12],
  });

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>ShutTimer</Text>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ flexGrow: 1 }} bounces={false} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <View style={styles.centerSection}>
            <View style={styles.iconWrapper}>
              <MaterialIcons name="keyboard" size={56} color={colors.onPrimary} style={{ opacity: 0.9 }} />
            </View>
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
              <Text style={styles.problemText} selectable={false}>
                {current?.text ?? ''}
              </Text>
            </Animated.View>

            <TextInput
              ref={inputRef}
              style={styles.input}
              value={input}
              onChangeText={setInput}
              placeholder={t('alarm.typingPlaceholder', { defaultValue: '여기에 입력' })}
              placeholderTextColor="rgba(255,255,255,0.5)"
              autoCorrect={false}
              autoCapitalize="none"
              autoComplete="off"
              spellCheck={false}
              onSubmitEditing={handleSubmit}
              returnKeyType="done"
              blurOnSubmit={false}
            />

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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 4,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.onPrimary,
    letterSpacing: -0.5,
  },
  centerSection: {
    alignItems: 'center',
    paddingTop: 24,
    paddingHorizontal: 24,
    gap: 12,
  },
  iconWrapper: { marginBottom: 4 },
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
    minWidth: '85%',
    alignItems: 'center',
  },
  problemText: {
    fontSize: 28,
    fontWeight: '800',
    color: colors.onPrimary,
    letterSpacing: 1,
    textAlign: 'center',
  },
  input: {
    marginTop: 8,
    width: '85%',
    paddingVertical: 14,
    paddingHorizontal: 18,
    fontSize: 22,
    fontWeight: '700',
    color: colors.onPrimary,
    backgroundColor: 'rgba(0,0,0,0.22)',
    borderRadius: 12,
    textAlign: 'center',
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
