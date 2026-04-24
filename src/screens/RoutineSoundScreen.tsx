// v1.6 Phase 4: 알람 사운드 선택 화면.
// ALARM_SOUNDS 전체 풀 노출 (경고음/벨소리 카테고리 분리).
// 미리듣기 = Audio.Sound 재생. 선택 시 RoutineEdit 으로 merge 복귀.

import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  ScrollView,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { Audio } from 'expo-av';
import { RootStackParamList } from '../../App';
import { useTheme } from '../context/ThemeContext';
import { ThemeColors } from '../constants/theme';
import { ALARM_SOUNDS, DEFAULT_SOUND_ID } from '../constants/sounds';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'RoutineSound'>;
  route: RouteProp<RootStackParamList, 'RoutineSound'>;
};

export default function RoutineSoundScreen({ navigation, route }: Props) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = makeStyles(colors);
  const current = route.params?.current ?? DEFAULT_SOUND_ID;

  const [playingId, setPlayingId] = useState<string | null>(null);
  const previewRef = useRef<Audio.Sound | null>(null);

  const stopPreview = async () => {
    try {
      await previewRef.current?.stopAsync();
      await previewRef.current?.unloadAsync();
    } catch {}
    previewRef.current = null;
    setPlayingId(null);
  };

  useEffect(() => {
    return () => {
      stopPreview();
    };
  }, []);

  const handlePreview = async (soundId: string) => {
    const item = ALARM_SOUNDS.find(s => s.id === soundId);
    if (!item) return;
    await stopPreview();
    try {
      await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
      const { sound } = await Audio.Sound.createAsync(item.source, { isLooping: true });
      previewRef.current = sound;
      setPlayingId(soundId);
      await sound.playAsync();
    } catch {
      setPlayingId(null);
    }
  };

  const handleSelect = async (soundId: string) => {
    await stopPreview();
    navigation.navigate({
      name: 'RoutineEdit',
      params: { selectedSound: soundId },
      merge: true,
    });
  };

  const alarmItems = ALARM_SOUNDS.filter(s => s.id.startsWith('alarm_'));
  const ringtoneItems = ALARM_SOUNDS.filter(s => s.id.startsWith('ringtone_'));

  const renderItem = (id: string) => {
    const isSelected = current === id;
    const isPlaying = playingId === id;
    const num = id.split('_')[1] ?? '';
    const label = id.startsWith('alarm_')
      ? `${t('routine.sound.alarm')} ${num}`
      : `${t('routine.sound.ringtone')} ${num}`;
    return (
      <TouchableOpacity
        key={id}
        style={[styles.row, isSelected && styles.rowSelected]}
        onPress={() => handleSelect(id)}
        activeOpacity={0.7}
      >
        <MaterialIcons
          name={isSelected ? 'radio-button-checked' : 'radio-button-unchecked'}
          size={22}
          color={isSelected ? colors.primary : colors.secondary}
        />
        <Text style={[styles.rowLabel, isSelected && styles.rowLabelSelected]}>{label}</Text>
        <TouchableOpacity
          style={[styles.previewBtn, isPlaying && styles.previewBtnActive]}
          onPress={() => (isPlaying ? stopPreview() : handlePreview(id))}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <MaterialIcons
            name={isPlaying ? 'stop' : 'play-arrow'}
            size={18}
            color={isPlaying ? colors.onPrimary : colors.onBackground}
          />
          <Text style={[styles.previewText, isPlaying && { color: colors.onPrimary }]}>
            {t('routine.sound.preview')}
          </Text>
        </TouchableOpacity>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.iconBtn} onPress={() => navigation.goBack()}>
          <MaterialIcons name="chevron-left" size={32} color={colors.onBackground} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('routine.sound.title')}</Text>
        <View style={{ width: 44 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {alarmItems.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>{t('routine.sound.alarm')}</Text>
            {alarmItems.map(s => renderItem(s.id))}
          </>
        )}

        {ringtoneItems.length > 0 && (
          <>
            <Text style={[styles.sectionTitle, { marginTop: 20 }]}>{t('routine.sound.ringtone')}</Text>
            {ringtoneItems.map(s => renderItem(s.id))}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  iconBtn: { padding: 8, borderRadius: 50, width: 44, alignItems: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '800', color: colors.onBackground, letterSpacing: -0.5 },
  content: { paddingHorizontal: 16, paddingBottom: 48 },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.secondary,
    letterSpacing: 1.5,
    marginTop: 12,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: colors.surfaceContainerLow,
    marginBottom: 8,
  },
  rowSelected: {
    backgroundColor: colors.surfaceContainerLowest,
    borderWidth: 1.5,
    borderColor: colors.primary,
  },
  rowLabel: { flex: 1, fontSize: 15, fontWeight: '700', color: colors.onBackground },
  rowLabelSelected: { color: colors.primary },
  previewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
  },
  previewBtnActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  previewText: { fontSize: 12, fontWeight: '700', color: colors.onBackground },
});
