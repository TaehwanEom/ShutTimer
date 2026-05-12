// 알람 종료 미션 = 간단 산수 문제 풀이 모드. AlarmScreen 측 dismissMethod='math' 분기에서 사용.
// 정답 입력 시 onSuccess 호출. 오답 시 새 문제 출제 + 시각 피드백.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  Animated,
  ScrollView,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { ThemeColors } from '../constants/theme';
import { generateMathProblem, MathProblem } from '../utils/mathProblemGenerator';

type Props = {
  colors: ThemeColors;
  t: (key: string, opts?: any) => string;
  onSuccess: () => void;
};

const KEYPAD: (string | null)[] = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'submit'];

export default function AlarmMathMode({ colors, t, onSuccess }: Props) {
  const [problem, setProblem] = useState<MathProblem>(() => generateMathProblem());
  const [input, setInput] = useState('');
  const [wrongFlash, setWrongFlash] = useState(false);
  const shakeAnim = useRef(new Animated.Value(0)).current;

  const styles = useMemo(() => makeStyles(colors), [colors]);

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
    if (key === 'clear') {
      setInput('');
      return;
    }
    if (key === 'submit') {
      const parsed = parseInt(input, 10);
      if (!isNaN(parsed) && parsed === problem.answer) {
        onSuccess();
        return;
      }
      // 오답 = 새 문제 + 흔들기 애니메이션.
      setProblem(generateMathProblem());
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

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>ShutTimer</Text>
      </View>

      <ScrollView contentContainerStyle={{ flexGrow: 1 }} bounces={false} showsVerticalScrollIndicator={false}>
        <View style={styles.centerSection}>
          <View style={styles.iconWrapper}>
            <MaterialIcons name="calculate" size={64} color={colors.onPrimary} style={{ opacity: 0.9 }} />
          </View>
          <Text style={styles.title}>{t('alarm.mathTitle', { defaultValue: '산수 미션' })}</Text>
          <Text style={styles.subtitle}>
            {t('alarm.mathInstruction', { defaultValue: '문제를 풀어 알람을 꺼주세요' })}
          </Text>

          <Animated.View style={[styles.problemBox, { transform: [{ translateX: shakeTranslate }] }]}>
            <Text style={styles.problemText}>{problem.display} = ?</Text>
          </Animated.View>

          <View style={styles.inputBox}>
            <Text style={styles.inputText}>{input || '_'}</Text>
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
    paddingTop: 32,
    paddingHorizontal: 24,
    gap: 16,
  },
  iconWrapper: {
    marginBottom: 4,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.onPrimary,
  },
  subtitle: {
    fontSize: 14,
    color: colors.onPrimary,
    opacity: 0.85,
    textAlign: 'center',
  },
  problemBox: {
    marginTop: 16,
    paddingVertical: 18,
    paddingHorizontal: 32,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 16,
    minWidth: '70%',
    alignItems: 'center',
  },
  problemText: {
    fontSize: 40,
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
    marginTop: 24,
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
