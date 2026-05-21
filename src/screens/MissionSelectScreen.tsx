// @v1.5 — 미션 선택 화면 (사용자가 알람 미션 풀 커스터마이즈)
// 알라미 유사 3열 그리드. i18n 14개 언어 지원.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Image,
  Alert,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { RootStackParamList } from '../../App';
import { SETTINGS_KEY, MIN_SELECTED_MISSIONS } from '../constants/settings';
import {
  MISSION_POOL,
  MISSION_EMOJI,
  MISSION_LABEL,
  MISSION_CATEGORIES,
} from '../constants/missionIcons';
import { useTheme } from '../context/ThemeContext';
import { ThemeColors } from '../constants/theme';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'MissionSelect'>;
};

const GRID_PADDING_H = 16;
const GRID_GAP = 8;
const COL_COUNT = 3;

// 테마 무관 고정: iOS 표준 액션 컬러 (선택/비활성 표시)
const ACCENT = '#0a84ff';

export default function MissionSelectScreen({ navigation }: Props) {
  const { colors, isDark } = useTheme();
  const { t } = useTranslation();
  // useWindowDimensions 측 = 동적 정합 (= 회전/화면 swap 시 자동 update). iPhone 12 mini 등 작은 화면 측 정합.
  const { width: SCREEN_W } = useWindowDimensions();
  const CARD_W = Math.floor((SCREEN_W - GRID_PADDING_H * 2 - GRID_GAP * (COL_COUNT - 1)) / COL_COUNT);
  const CARD_H = Math.floor(CARD_W * 1.15);
  const EMOJI_SIZE = Math.floor(CARD_W * 0.65);
  const styles = useMemo(
    () => makeStyles(colors, isDark, CARD_W, CARD_H, EMOJI_SIZE),
    [colors, isDark, CARD_W, CARD_H, EMOJI_SIZE],
  );

  const [selected, setSelected] = useState<Set<string>>(() => new Set(MISSION_POOL));
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(SETTINGS_KEY.SELECTED_MISSIONS).then((raw) => {
      if (raw) {
        try {
          const arr = JSON.parse(raw);
          if (Array.isArray(arr)) {
            const valid = arr.filter(
              (k): k is string => typeof k === 'string' && MISSION_POOL.includes(k)
            );
            if (valid.length >= MIN_SELECTED_MISSIONS) {
              setSelected(new Set(valid));
            }
          }
        } catch {}
      }
      setLoaded(true);
    });
  }, []);

  const toggleOne = useCallback((key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const toggleCategory = useCallback((keys: string[]) => {
    setSelected((prev) => {
      const next = new Set(prev);
      const allIn = keys.every((k) => next.has(k));
      if (allIn) keys.forEach((k) => next.delete(k));
      else keys.forEach((k) => next.add(k));
      return next;
    });
  }, []);

  // 뒤로가기 진입점 (헤더 화살표 탭). 실 검증·저장은 beforeRemove에서 단일 처리.
  const handleBack = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  // iOS 스와이프 백 / Android 시스템 백 / 헤더 화살표 — 모두 동일 경로 (자동 저장 + 최소 검증)
  useEffect(() => {
    const unsub = navigation.addListener('beforeRemove', (e) => {
      if (selected.size < MIN_SELECTED_MISSIONS) {
        e.preventDefault();
        Alert.alert(
          t('missionSelect.minWarningTitle'),
          t('missionSelect.minWarningBody', { n: MIN_SELECTED_MISSIONS })
        );
        return;
      }
      AsyncStorage.setItem(
        SETTINGS_KEY.SELECTED_MISSIONS,
        JSON.stringify(Array.from(selected))
      ).catch(() => {});
    });
    return unsub;
  }, [navigation, selected, t]);

  if (!loaded) {
    return <SafeAreaView style={styles.container} />;
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={handleBack}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          style={styles.backBtn}
        >
          <MaterialIcons name="chevron-left" size={32} color={colors.onBackground} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('missionSelect.title')}</Text>
        <View style={styles.headerRightSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {MISSION_CATEGORIES.map((cat) => {
          return (
            <View key={cat.id} style={styles.categoryBlock}>
              <TouchableOpacity
                style={styles.categoryHeader}
                onPress={() => toggleCategory(cat.keys)}
                activeOpacity={0.7}
              >
                <Text style={styles.categoryTitle}>
                  {t(`missionCategories.${cat.id}`, { defaultValue: cat.label })} ({cat.keys.length})
                </Text>
              </TouchableOpacity>

              <View style={styles.grid}>
                {cat.keys.map((k) => {
                  const isSelected = selected.has(k);
                  const emoji = MISSION_EMOJI[k];
                  const label = t(`missions.${k}`, { defaultValue: MISSION_LABEL[k] ?? k });
                  return (
                    <TouchableOpacity
                      key={k}
                      style={styles.card}
                      onPress={() => toggleOne(k)}
                      activeOpacity={0.7}
                    >
                      <View style={styles.cardCheckbox}>
                        <Checkbox checked={isSelected} isDark={isDark} colors={colors} />
                      </View>
                      {emoji ? (
                        <Image source={emoji} style={styles.cardEmoji} resizeMode="contain" />
                      ) : (
                        <View style={styles.cardEmoji} />
                      )}
                      <Text style={styles.cardLabel} numberOfLines={1}>
                        {label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

// 체크박스 — 테마 대응
function Checkbox({
  checked,
  partial,
  size = 16,
  isDark,
  colors,
}: {
  checked: boolean;
  partial?: boolean;
  size?: number;
  isDark: boolean;
  colors: ThemeColors;
}) {
  const borderColor = checked || partial ? ACCENT : isDark ? '#3a3a3c' : '#c7c7cc';
  const bgColor = checked
    ? ACCENT
    : partial
    ? `${ACCENT}33`
    : isDark
    ? '#1c1c1e'
    : '#ffffff';
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: 3,
        borderWidth: 1,
        borderColor,
        backgroundColor: bgColor,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {checked && (
        <View
          style={{
            width: Math.floor(size * 0.3),
            height: Math.floor(size * 0.5),
            borderRightWidth: 2,
            borderBottomWidth: 2,
            borderColor: '#fff',
            transform: [{ rotate: '45deg' }, { translateY: -1 }],
          }}
        />
      )}
      {partial && !checked && (
        <View
          style={{
            width: Math.floor(size * 0.55),
            height: 2,
            backgroundColor: ACCENT,
          }}
        />
      )}
    </View>
  );
}

const makeStyles = (colors: ThemeColors, isDark: boolean, CARD_W: number, CARD_H: number, EMOJI_SIZE: number) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 14,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: isDark ? '#2c2c2e' : '#e5e5ea',
    },
    headerTitle: {
      fontSize: 17,
      fontWeight: '700',
      color: colors.onBackground,
    },
    backBtn: {
      padding: 8,
      borderRadius: 50,
      width: 40,
    },
    headerRightSpacer: {
      width: 40,
    },
    scrollContent: {
      paddingBottom: 32,
    },
    categoryBlock: {
      paddingHorizontal: GRID_PADDING_H,
      paddingTop: 20,
      paddingBottom: 4,
    },
    categoryHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: 12,
      paddingLeft: 4,
    },
    categoryTitle: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.secondary,
      letterSpacing: 0.2,
    },
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: GRID_GAP,
    },
    card: {
      width: CARD_W,
      height: CARD_H,
      backgroundColor: colors.surfaceContainerLow,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      padding: 8,
    },
    cardCheckbox: {
      position: 'absolute',
      top: 8,
      left: 8,
    },
    cardEmoji: {
      width: EMOJI_SIZE,
      height: EMOJI_SIZE,
      marginBottom: 6,
    },
    cardLabel: {
      fontSize: 10.5,
      color: colors.onBackground,
      textAlign: 'center',
      fontWeight: '500',
    },
  });
