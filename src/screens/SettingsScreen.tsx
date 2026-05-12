import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  Switch,
  ScrollView,
  Modal,
  Alert,
  Share,
} from 'react-native';
import { Logger } from '../utils/logger';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MaterialIcons } from '@expo/vector-icons';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../App';
import { ThemeColors } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import { useFocusEffect } from '@react-navigation/native';
import { SETTINGS_KEY, DismissMethod, DEFAULT_SETTINGS, COLOR_PRESETS, MissionDuration, MISSION_DURATION_OPTIONS } from '../constants/settings';
import { MISSION_POOL } from '../constants/missionIcons';
import { ALARM_SOUNDS, DEFAULT_SOUND_ID } from '../constants/sounds';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useTranslation } from 'react-i18next';
import AdBanner from '../components/AdBanner';
// @preserve IAP — Phase 2+ 복원용. 삭제 금지. (TS6133 회피 위해 import 라인 주석)
// import { usePurchase } from '../context/PurchaseContext';
import { getLocales } from 'expo-localization';
import * as ScreenOrientation from 'expo-screen-orientation';
import i18n, { SUPPORTED_LANGS, LANGUAGE_NAMES, LANGUAGE_STORAGE_KEY } from '../i18n';
import { setCachedDismissMethod } from '../utils/settingsCache';
import { clearPreloadedSound } from '../utils/alarmSoundPreload';

// v1.7 hotfix #DebugUIGate — EAS profile env 측 디버그 UI 분기 (production = false / dev + preview = true).
const SHOW_DEBUG_UI = process.env.EXPO_PUBLIC_SHOW_DEBUG_UI === 'true';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Settings'>;
};

const DISMISS_OPTIONS: { value: DismissMethod; labelKey: string; icon: string; descKey: string }[] = [
  { value: 'random', labelKey: 'settings.random', icon: 'shuffle', descKey: 'settings.randomDesc' },
  { value: 'tap', labelKey: 'settings.tap', icon: 'touch-app', descKey: 'settings.tapDesc' },
  { value: 'shake', labelKey: 'settings.shake', icon: 'vibration', descKey: 'settings.shakeDesc' },
  { value: 'camera', labelKey: 'settings.camera', icon: 'photo-camera', descKey: 'settings.cameraDesc' },
  { value: 'math', labelKey: 'settings.math', icon: 'calculate', descKey: 'settings.mathDesc' },
  { value: 'typing', labelKey: 'settings.typing', icon: 'keyboard', descKey: 'settings.typingDesc' },
];

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.outlineVariant,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  backBtn: {
    padding: 8,
    borderRadius: 50,
    width: 40,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '600',
    color: colors.onBackground,
  },
  content: {
    paddingHorizontal: 24,
    paddingBottom: 48,
    gap: 32,
  },
  section: {
    gap: 8,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.secondary,
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: colors.surfaceContainerLow,
  },
  optionRowSelected: {
    backgroundColor: colors.surfaceContainerLowest,
    borderWidth: 1.5,
    borderColor: colors.primary,
  },
  optionIconWrapper: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.surfaceContainerLow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionIconWrapperSelected: {
    backgroundColor: colors.primary,
  },
  optionText: {
    flex: 1,
    gap: 2,
  },
  optionLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.onBackground,
  },
  optionLabelSelected: {
    color: colors.primary,
  },
  optionDescription: {
    fontSize: 12,
    color: colors.secondary,
    opacity: 0.8,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: colors.surfaceContainerLow,
  },
  toggleLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  toggleLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.onBackground,
  },
  disabledRow: {
    opacity: 0.6,
  },
  disabledText: {
    color: colors.secondary,
  },
  comingSoonBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    backgroundColor: colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
  },
  comingSoonText: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.secondary,
    letterSpacing: 0.5,
  },
});

export default function SettingsScreen({ navigation }: Props) {
  const { colors, isDark, toggleTheme, primaryColor, setPrimaryColor } = useTheme();
  const { t } = useTranslation();
  // @preserve IAP — usePurchase 훅 호출. Phase 2+ 복원용. 삭제 금지.
  // const { isAdFree, purchaseAdFree, restorePurchases } = usePurchase();
  const styles = makeStyles(colors);

  const [dismissMethod, setDismissMethod] = useState<DismissMethod>(DEFAULT_SETTINGS.dismissMethod);
  const [alarmEnabled, setAlarmEnabled] = useState(DEFAULT_SETTINGS.alarmEnabled);
  const [vibrationEnabled, setVibrationEnabled] = useState(DEFAULT_SETTINGS.vibrationEnabled);
  const [selectedSoundId, setSelectedSoundId] = useState(DEFAULT_SOUND_ID);
  const [soundModalVisible, setSoundModalVisible] = useState(false);
  const [selectedLang, setSelectedLang] = useState<string | null>(null);
  const [langModalVisible, setLangModalVisible] = useState(false);
  const [missionDuration, setMissionDuration] = useState<MissionDuration>(DEFAULT_SETTINGS.missionDuration);
  const [missionDurationModalVisible, setMissionDurationModalVisible] = useState(false);
  const [selectedMissionsCount, setSelectedMissionsCount] = useState<number>(MISSION_POOL.length);
  const [keepScreenOn, setKeepScreenOn] = useState(DEFAULT_SETTINGS.keepScreenOn);
  const previewSoundRef = React.useRef<AudioPlayer | null>(null);

  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
  }, []);

  // v1.7 hotfix #PreviewUnmountCleanup — screen unmount 시 미리듣기 정지 (= 설정창 빠져나와도 사운드 잔존 정정).
  // 직전 = closeSoundModal 측만 stopPreview 호출 → screen 자체 측 unmount 시 (= 뒤로 가기, tab 이동) 측 잔존.
  useEffect(() => {
    return () => {
      try { previewSoundRef.current?.release(); } catch {}
      previewSoundRef.current = null;
    };
  }, []);

  // 미션 선택 카운트 — 화면 포커스 시 재로드 (MissionSelectScreen 다녀오면 최신값 반영)
  useFocusEffect(
    useCallback(() => {
      AsyncStorage.getItem(SETTINGS_KEY.SELECTED_MISSIONS).then((raw) => {
        if (!raw) {
          setSelectedMissionsCount(MISSION_POOL.length);
          return;
        }
        try {
          const arr = JSON.parse(raw);
          if (Array.isArray(arr)) {
            const valid = arr.filter(
              (k: unknown): k is string => typeof k === 'string' && MISSION_POOL.includes(k)
            );
            setSelectedMissionsCount(valid.length >= 1 ? valid.length : MISSION_POOL.length);
          } else {
            setSelectedMissionsCount(MISSION_POOL.length);
          }
        } catch {
          setSelectedMissionsCount(MISSION_POOL.length);
        }
      });
    }, [])
  );

  useEffect(() => {
    AsyncStorage.multiGet([SETTINGS_KEY.DISMISS_METHOD, SETTINGS_KEY.VIBRATION_ENABLED, LANGUAGE_STORAGE_KEY, SETTINGS_KEY.ALARM_SOUND, SETTINGS_KEY.ALARM_ENABLED, SETTINGS_KEY.MISSION_DURATION, SETTINGS_KEY.KEEP_SCREEN_ON]).then(pairs => {
      const method = pairs[0][1] as DismissMethod | null;
      const vibration = pairs[1][1];
      const lang = pairs[2][1];
      const sound = pairs[3][1];
      const alarm = pairs[4][1];
      const duration = pairs[5][1];
      const keep = pairs[6][1];
      if (method) setDismissMethod(method);
      if (alarm !== null) setAlarmEnabled(alarm === 'true');
      if (vibration !== null) setVibrationEnabled(vibration === 'true');
      if (lang) setSelectedLang(lang);
      if (sound) setSelectedSoundId(sound);
      if (duration !== null) {
        const n = parseInt(duration, 10);
        if ((MISSION_DURATION_OPTIONS as readonly number[]).includes(n)) {
          setMissionDuration(n as MissionDuration);
        }
      }
      if (keep !== null) setKeepScreenOn(keep === 'true');
    });
  }, []);

  const handleDismissMethod = (value: DismissMethod) => {
    setDismissMethod(value);
    AsyncStorage.setItem(SETTINGS_KEY.DISMISS_METHOD, value);
    // 사전 로드 캐시 즉시 동기화 (다음 AlarmScreen 마운트 시 정확한 초기값 사용)
    setCachedDismissMethod(value);
    // 흔들기 선택 시 동작 권한 popup 트리거.
    // iOS CMMotionManager는 권한 함수로 popup 안 뜨고 실 데이터 액세스로만 발화.
    // requestPermissionsAsync는 iOS에서 default granted 반환만 함 (expo GitHub #30571).
    // 해결: addListener 잠깐 등록 → 100ms 후 해제 → iOS 자동 popup.
    if (value === 'shake') {
      try {
        const { Accelerometer } = require('expo-sensors');
        const sub = Accelerometer.addListener(() => {});
        setTimeout(() => sub.remove(), 100);
      } catch (e) {
        // expo-sensors 미지원 환경 무시
      }
    }
  };

  const stopPreview = () => {
    try { previewSoundRef.current?.release(); } catch {}
    previewSoundRef.current = null;
  };

  const closeSoundModal = () => {
    setSoundModalVisible(false);
    stopPreview();
  };

  const handleSoundSelect = (soundId: string) => {
    setSelectedSoundId(soundId);
    AsyncStorage.setItem(SETTINGS_KEY.ALARM_SOUND, soundId);
    // v1.5: preload는 이전 사운드로 로드된 상태 → AlarmScreen에서 최신 선택을 반영하도록 무효화.
    //       HomeScreen이 다음 scheduleAlarm에서 새 사운드로 다시 preload함.
    clearPreloadedSound().catch(() => {});
    // v1.7 hotfix #SoundSelectAutoClose — 선택 즉시 모달 close + 미리듣기 stop.
    closeSoundModal();
  };

  const handlePreview = async (soundId: string) => {
    stopPreview();
    const item = ALARM_SOUNDS.find(s => s.id === soundId);
    if (!item) return;
    // v1.7 hotfix #ExpoAudio Phase 4-E — expo-av → expo-audio swap (= preview 영역).
    await setAudioModeAsync({ playsInSilentMode: true });
    // v1.7 hotfix #PreviewLoopFix — loop: false (= 한 번 재생 후 자동 정지). 직전 = isLooping: true → 무한 루프.
    const player = createAudioPlayer(item.source);
    player.loop = false;
    previewSoundRef.current = player;
    // LoadGate 패턴 = isLoaded event 후 play (= preview 측 단순 영역).
    if (player.isLoaded) {
      try { player.play(); } catch {}
    } else {
      const sub = player.addListener('playbackStatusUpdate', (status) => {
        if (status?.isLoaded) {
          sub.remove();
          if (previewSoundRef.current !== player) return;
          try { player.play(); } catch {}
        }
      });
    }
  };

  const handleAlarmEnabled = (value: boolean) => {
    setAlarmEnabled(value);
    AsyncStorage.setItem(SETTINGS_KEY.ALARM_ENABLED, String(value));
  };

  const handleVibration = (value: boolean) => {
    setVibrationEnabled(value);
    AsyncStorage.setItem(SETTINGS_KEY.VIBRATION_ENABLED, String(value));
  };

  const handleKeepScreenOn = async (value: boolean) => {
    setKeepScreenOn(value);
    AsyncStorage.setItem(SETTINGS_KEY.KEEP_SCREEN_ON, String(value));
    const KEEP_AWAKE_TAG = 'ShutTimer_keepScreenOn';
    try {
      if (value) await activateKeepAwakeAsync(KEEP_AWAKE_TAG);
      else deactivateKeepAwake(KEEP_AWAKE_TAG);
    } catch {}
  };

  const handleMissionDuration = (value: MissionDuration) => {
    setMissionDuration(value);
    AsyncStorage.setItem(SETTINGS_KEY.MISSION_DURATION, String(value));
    setMissionDurationModalVisible(false);
  };

  const handleLanguage = (langCode: string | null) => {
    setSelectedLang(langCode);
    setLangModalVisible(false);
    if (langCode) {
      AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, langCode);
      i18n.changeLanguage(langCode);
    } else {
      AsyncStorage.removeItem(LANGUAGE_STORAGE_KEY);
      // 자동감지로 복원
      const locales = getLocales();
      const deviceLang = locales?.[0]?.languageCode ?? 'en';
      const matched = SUPPORTED_LANGS.find(l => l === deviceLang) ?? 'en';
      i18n.changeLanguage(matched);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <MaterialIcons name="settings" size={24} color={colors.onBackground} />
          <Text style={styles.headerTitle}>{t('settings.title')}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* 컬러 팔레트 */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Colors</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingVertical: 4 }}>
            {COLOR_PRESETS.map(preset => (
              <TouchableOpacity
                key={preset.id}
                onPress={() => setPrimaryColor(preset.color)}
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 22,
                  backgroundColor: preset.color,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderWidth: primaryColor === preset.color ? 3 : 0,
                  borderColor: colors.onBackground,
                }}
              >
                {primaryColor === preset.color && (
                  <MaterialIcons name="check" size={20} color="#ffffff" />
                )}
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {/* 알람 종료 방식 */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('settings.dismissMethod')}</Text>
          {DISMISS_OPTIONS.map(option => {
            const isSelected = dismissMethod === option.value;
            return (
              <TouchableOpacity
                key={option.value}
                style={[styles.optionRow, isSelected && styles.optionRowSelected]}
                onPress={() => handleDismissMethod(option.value)}
                activeOpacity={0.7}
              >
                <View style={[styles.optionIconWrapper, isSelected && styles.optionIconWrapperSelected]}>
                  <MaterialIcons
                    name={option.icon as React.ComponentProps<typeof MaterialIcons>['name']}
                    size={22}
                    color={isSelected ? colors.onPrimary : colors.secondary}
                  />
                </View>
                <View style={styles.optionText}>
                  <Text style={[styles.optionLabel, isSelected && styles.optionLabelSelected]}>
                    {t(option.labelKey)}
                  </Text>
                  <Text style={styles.optionDescription}>{t(option.descKey)}</Text>
                </View>
                {isSelected && (
                  <MaterialIcons name="check-circle" size={22} color={colors.primary} />
                )}
              </TouchableOpacity>
            );
          })}
        </View>

        {/* 알람 */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('settings.alarm')}</Text>
          <View style={styles.toggleRow}>
            <View style={styles.toggleLeft}>
              <MaterialIcons name="notifications-active" size={22} color={colors.onBackground} />
              <Text style={styles.toggleLabel}>{t('settings.alarmEnabled')}</Text>
            </View>
            <Switch
              value={alarmEnabled}
              onValueChange={handleAlarmEnabled}
              trackColor={{ false: colors.outlineVariant, true: colors.primary }}
              thumbColor={colors.onPrimary}
              style={{ transform: [{ scale: 0.85 }] }}
            />
          </View>
          <View style={styles.toggleRow}>
            <View style={styles.toggleLeft}>
              <MaterialIcons name="vibration" size={22} color={colors.onBackground} />
              <Text style={styles.toggleLabel}>{t('settings.vibration')}</Text>
            </View>
            <Switch
              value={vibrationEnabled}
              onValueChange={handleVibration}
              trackColor={{ false: colors.outlineVariant, true: colors.primary }}
              thumbColor={colors.onPrimary}
              style={{ transform: [{ scale: 0.85 }] }}
            />
          </View>
        </View>

        {/* 알람 사운드 */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('settings.alarmSound')}</Text>
          <TouchableOpacity style={styles.toggleRow} onPress={() => setSoundModalVisible(true)}>
            <View style={styles.toggleLeft}>
              <MaterialIcons name="music-note" size={22} color={colors.onBackground} />
              <Text style={styles.toggleLabel}>{t('settings.soundSelect')}</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Text style={{ fontSize: 14, fontWeight: '600', color: colors.secondary }}>
                {(() => { const s = ALARM_SOUNDS.find(s => s.id === selectedSoundId); if (!s) return selectedSoundId; const num = s.id.split('_')[1]; return `${t(s.id.startsWith('alarm_') ? 'sounds.alarm' : 'sounds.ringtone')} ${num}`; })()}
              </Text>
              <MaterialIcons name="chevron-right" size={20} color={colors.secondary} style={{ opacity: 0.5 }} />
            </View>
          </TouchableOpacity>
        </View>

        {/* 미션 타이머 + 미션 선택 */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('settings.missionDuration')}</Text>
          <TouchableOpacity style={styles.toggleRow} onPress={() => setMissionDurationModalVisible(true)}>
            <View style={styles.toggleLeft}>
              <MaterialIcons name="timer" size={22} color={colors.onBackground} />
              <Text style={styles.toggleLabel}>{t('settings.missionDuration')}</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Text style={{ fontSize: 14, fontWeight: '600', color: colors.secondary }}>
                {missionDuration}{t('settings.secondsUnit', { defaultValue: '초' })}
              </Text>
              <MaterialIcons name="chevron-right" size={20} color={colors.secondary} style={{ opacity: 0.5 }} />
            </View>
          </TouchableOpacity>

          <TouchableOpacity style={styles.toggleRow} onPress={() => navigation.navigate('MissionSelect')}>
            <View style={styles.toggleLeft}>
              <MaterialIcons name="grid-view" size={22} color={colors.onBackground} />
              <Text style={styles.toggleLabel}>{t('settings.missionSelect')}</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Text style={{ fontSize: 14, fontWeight: '600', color: colors.secondary }}>
                {selectedMissionsCount} / {MISSION_POOL.length}
              </Text>
              <MaterialIcons name="chevron-right" size={20} color={colors.secondary} style={{ opacity: 0.5 }} />
            </View>
          </TouchableOpacity>
        </View>

        {/* 화면 */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('settings.screen')}</Text>
          <View style={styles.toggleRow}>
            <View style={styles.toggleLeft}>
              <MaterialIcons name="dark-mode" size={22} color={colors.onBackground} />
              <Text style={styles.toggleLabel}>{t('settings.darkMode')}</Text>
            </View>
            <Switch
              value={isDark}
              onValueChange={toggleTheme}
              trackColor={{ false: colors.outlineVariant, true: colors.primary }}
              thumbColor={colors.onPrimary}
              style={{ transform: [{ scale: 0.85 }] }}
            />
          </View>
          <View style={styles.toggleRow}>
            <View style={styles.toggleLeft}>
              <MaterialIcons name="stay-current-portrait" size={22} color={colors.onBackground} />
              <Text style={styles.toggleLabel}>{t('settings.keepScreenOn')}</Text>
            </View>
            <Switch
              value={keepScreenOn}
              onValueChange={handleKeepScreenOn}
              trackColor={{ false: colors.outlineVariant, true: colors.primary }}
              thumbColor={colors.onPrimary}
              style={{ transform: [{ scale: 0.85 }] }}
            />
          </View>
        </View>

        {/* 언어 */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('settings.language')}</Text>
          <TouchableOpacity style={styles.toggleRow} onPress={() => setLangModalVisible(true)}>
            <View style={styles.toggleLeft}>
              <MaterialIcons name="language" size={22} color={colors.onBackground} />
              <Text style={styles.toggleLabel}>{t('settings.language')}</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Text style={{ fontSize: 14, fontWeight: '600', color: colors.secondary }}>
                {selectedLang ? LANGUAGE_NAMES[selectedLang] : t('settings.languageAuto')}
              </Text>
              <MaterialIcons name="chevron-right" size={20} color={colors.secondary} style={{ opacity: 0.5 }} />
            </View>
          </TouchableOpacity>
        </View>

        {/*
          ═══════════════════════════════════════════════════════════
           @preserve IAP (구매 섹션 JSX) — Phase 2+ 재활성화용
           보존 결정일: 2026-04-14
           비활성화 사유: 사업자등록 전까지 IAP 보류 (B안)
           재활성화 조건: 사업자등록 + ASC Paid Apps Agreement 활성화
           ⚠️ 이 블록 삭제 금지. 주석 해제만으로 복원 가능해야 함.

           @preserve-original:
           <View style={styles.section}>
             <Text style={styles.sectionTitle}>{t('settings.purchase')}</Text>
             {isAdFree ? (
               <View style={styles.toggleRow}>
                 <View style={styles.toggleLeft}>
                   <MaterialIcons name="check-circle" size={22} color={colors.primary} />
                   <Text style={[styles.toggleLabel, { color: colors.primary }]}>{t('settings.adFreeActive')}</Text>
                 </View>
               </View>
             ) : (
               <TouchableOpacity
                 style={styles.toggleRow}
                 onPress={async () => {
                   try {
                     await purchaseAdFree();
                   } catch {
                     Alert.alert(t('settings.purchaseFailed'));
                   }
                 }}
                 activeOpacity={0.7}
               >
                 <View style={styles.toggleLeft}>
                   <MaterialIcons name="stars" size={22} color={colors.onBackground} />
                   <View>
                     <Text style={styles.toggleLabel}>{t('settings.removeAds')}</Text>
                     <Text style={{ fontSize: 12, color: colors.secondary }}>{t('settings.removeAdsPrice')}</Text>
                   </View>
                 </View>
                 <MaterialIcons name="chevron-right" size={20} color={colors.secondary} style={{ opacity: 0.5 }} />
               </TouchableOpacity>
             )}
             <TouchableOpacity
               style={styles.toggleRow}
               onPress={async () => {
                 const restored = await restorePurchases();
                 Alert.alert(restored ? t('settings.restoreSuccess') : t('settings.restoreNone'));
               }}
               activeOpacity={0.7}
             >
               <View style={styles.toggleLeft}>
                 <MaterialIcons name="restore" size={22} color={colors.onBackground} />
                 <Text style={styles.toggleLabel}>{t('settings.restorePurchase')}</Text>
               </View>
               <MaterialIcons name="chevron-right" size={20} color={colors.secondary} style={{ opacity: 0.5 }} />
             </TouchableOpacity>
           </View>
          ═══════════════════════════════════════════════════════════
        */}

        {/* v1.7 hotfix — 홈 화면 위젯 섹션 제거 (= v2 미구현 + 사용자 명시 불필요 영역). */}

        {/* v1.7 hotfix #DBG — 17건 버그 추적용 임시 디버그 섹션. TestFlight console 미라우팅 회피.
            JS 로그 (Logger.warn → AsyncStorage) + Native 로그 (NSLog → App Group UserDefaults "native_debug_log_v1") 합쳐 공유.
            다중 기기 + Apple Watch (LA Smart Stack) 측 = 각 process 별 process prefix 로 식별.
            v1.7 hotfix #DebugUIGate — production 빌드 측 = SHOW_DEBUG_UI=false → 미렌더. dev + preview 측 = 렌더. */}
        {SHOW_DEBUG_UI && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>디버그 (v1.7 hotfix 임시)</Text>
            <TouchableOpacity
              style={styles.toggleRow}
              onPress={async () => {
                const jsLogs = await Logger.getLogs();
                // Native 로그 = AlarmkitBridge.readAppGroupString (= App Group UserDefaults).
                let nativeRaw = '';
                try {
                  nativeRaw = (require('../../modules/alarmkit-bridge').default as any).readAppGroupString('native_debug_log_v1') ?? '';
                } catch {}
                const jsText = jsLogs.length === 0
                  ? '(JS 로그 없음)'
                  : jsLogs.map(l => `${l.timestamp.slice(11, 23)} [${l.tag}] ${l.message}`).join('\n');
                const nativeText = nativeRaw || '(Native 로그 없음)';
                const text = `=== JS 로그 (${jsLogs.length}개) ===\n${jsText}\n\n=== Native 로그 ===\n${nativeText}`;
                try {
                  await Share.share({ message: text, title: 'ShutTimer 디버그 로그' });
                } catch (e) {
                  Alert.alert('공유 실패', String(e));
                }
              }}
              activeOpacity={0.7}
            >
              <View style={styles.toggleLeft}>
                <MaterialIcons name="bug-report" size={22} color={colors.onBackground} />
                <Text style={styles.toggleLabel}>최근 로그 공유 (JS + Native, 복사 가능)</Text>
              </View>
              <MaterialIcons name="chevron-right" size={20} color={colors.secondary} style={{ opacity: 0.5 }} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.toggleRow}
              onPress={async () => {
                const jsLogs = await Logger.getLogs();
                let nativeLines = 0;
                try {
                  const raw = (require('../../modules/alarmkit-bridge').default as any).readAppGroupString('native_debug_log_v1') ?? '';
                  nativeLines = raw.length === 0 ? 0 : raw.split('\n').length;
                } catch {}
                Alert.alert('로그 갯수', `JS: ${jsLogs.length}개\nNative: ${nativeLines}줄`);
              }}
              activeOpacity={0.7}
            >
              <View style={styles.toggleLeft}>
                <MaterialIcons name="info-outline" size={22} color={colors.onBackground} />
                <Text style={styles.toggleLabel}>로그 갯수 확인</Text>
              </View>
              <MaterialIcons name="chevron-right" size={20} color={colors.secondary} style={{ opacity: 0.5 }} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.toggleRow}
              onPress={async () => {
                await Logger.clearLogs();
                try {
                  (require('../../modules/alarmkit-bridge').default as any).removeAppGroupKey('native_debug_log_v1');
                } catch {}
                Alert.alert('완료', 'JS + Native 로그 클리어됨');
              }}
              activeOpacity={0.7}
            >
              <View style={styles.toggleLeft}>
                <MaterialIcons name="delete-sweep" size={22} color={colors.onBackground} />
                <Text style={styles.toggleLabel}>로그 클리어 (JS + Native)</Text>
              </View>
              <MaterialIcons name="chevron-right" size={20} color={colors.secondary} style={{ opacity: 0.5 }} />
            </TouchableOpacity>
          </View>
        )}

        {/*
          ═══════════════════════════════════════════════════════════
           @preserve — 디버그 섹션 (로그 공유 / 클리어)
           보존 결정일: 2026-05-03
           비활성화 사유: 사용자 명시 — 본 빌드 노출 ❌, 나중에 재사용
           재활성화: 주석 해제만으로 즉시 복원 가능
           ⚠️ 이 블록 삭제 금지.

           @preserve-original:
           <View style={styles.section}>
             <Text style={styles.sectionTitle}>디버그</Text>
             <TouchableOpacity
               style={styles.toggleRow}
               onPress={async () => {
                 const logs = await Logger.getLogs();
                 const text = logs.length === 0
                   ? '로그 없음'
                   : logs.map(l => `${l.timestamp.slice(11, 23)} [${l.tag}] ${l.message}`).join('\n');
                 try {
                   await Share.share({ message: text, title: 'ShutTimer 디버그 로그' });
                 } catch (e) {
                   Alert.alert('공유 실패', String(e));
                 }
               }}
               activeOpacity={0.7}
             >
               <View style={styles.toggleLeft}>
                 <MaterialIcons name="bug-report" size={22} color={colors.onBackground} />
                 <Text style={styles.toggleLabel}>최근 로그 공유 (복사 가능)</Text>
               </View>
               <MaterialIcons name="chevron-right" size={20} color={colors.secondary} style={{ opacity: 0.5 }} />
             </TouchableOpacity>
             <TouchableOpacity
               style={styles.toggleRow}
               onPress={async () => {
                 await Logger.clearLogs();
                 Alert.alert('완료', '로그 클리어됨');
               }}
               activeOpacity={0.7}
             >
               <View style={styles.toggleLeft}>
                 <MaterialIcons name="delete-sweep" size={22} color={colors.onBackground} />
                 <Text style={styles.toggleLabel}>로그 클리어</Text>
               </View>
               <MaterialIcons name="chevron-right" size={20} color={colors.secondary} style={{ opacity: 0.5 }} />
             </TouchableOpacity>
           </View>
          ═══════════════════════════════════════════════════════════
        */}

        {/*
          ═══════════════════════════════════════════════════════════
           @preserve @v1.5-poc — DEBUG (v1.5 PoC) 사진 인식 진입 버튼
           보존 결정일: 2026-05-03
           비활성화 사유: 사용자 명시 — 본 빌드 노출 ❌, 나중에 재사용
           재활성화: 주석 해제만으로 즉시 복원 가능
           ⚠️ 이 블록 삭제 금지.

           @preserve-original:
           {__DEV__ && (
             <View style={styles.section}>
               <Text style={styles.sectionTitle}>DEBUG (v1.5 PoC)</Text>
               <TouchableOpacity
                 style={styles.toggleRow}
                 onPress={() => navigation.navigate('PoCPhotoValidation')}
                 activeOpacity={0.7}
               >
                 <View style={styles.toggleLeft}>
                   <MaterialIcons name="science" size={22} color={colors.onBackground} />
                   <Text style={styles.toggleLabel}>사진 인식 PoC</Text>
                 </View>
                 <MaterialIcons name="chevron-right" size={20} color={colors.secondary} style={{ opacity: 0.5 }} />
               </TouchableOpacity>
             </View>
           )}
          ═══════════════════════════════════════════════════════════
        */}
      </ScrollView>

      {/* 사운드 선택 모달 */}
      <Modal visible={soundModalVisible} transparent animationType="slide" onRequestClose={closeSoundModal}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={closeSoundModal} />
          <View style={{ backgroundColor: colors.background, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 20, paddingBottom: 48, maxHeight: '70%' }}>
            <Text style={{ fontSize: 16, fontWeight: '800', color: colors.onBackground, paddingHorizontal: 24, marginBottom: 12 }}>{t('settings.soundSelect')}</Text>
            <ScrollView showsVerticalScrollIndicator={false}>
              {/* 경고음 카테고리 */}
              <Text style={{ fontSize: 11, fontWeight: '800', color: colors.secondary, letterSpacing: 1.5, paddingHorizontal: 24, marginBottom: 8, marginTop: 4 }}>{t('sounds.alarm')}</Text>
              {ALARM_SOUNDS.filter(s => s.id.startsWith('alarm_')).map(item => (
                <TouchableOpacity
                  key={item.id}
                  style={[styles.toggleRow, { marginHorizontal: 16, marginBottom: 6 }, selectedSoundId === item.id && styles.optionRowSelected]}
                  onPress={() => handlePreview(item.id)}
                >
                  <View style={styles.toggleLeft}>
                    <MaterialIcons name="play-circle-outline" size={22} color={colors.secondary} style={{ opacity: 0.7 }} />
                    <Text style={[styles.toggleLabel, selectedSoundId === item.id && { color: colors.primary }]}>{`${t('sounds.alarm')} ${item.id.split('_')[1]}`}</Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => handleSoundSelect(item.id)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    style={{
                      paddingHorizontal: 14,
                      paddingVertical: 6,
                      borderRadius: 8,
                      borderWidth: 1,
                      borderColor: colors.primary,
                      backgroundColor: selectedSoundId === item.id ? colors.primary : 'transparent',
                    }}
                  >
                    <Text style={{
                      fontSize: 13,
                      fontWeight: '700',
                      color: selectedSoundId === item.id ? colors.onPrimary : colors.primary,
                    }}>
                      {selectedSoundId === item.id
                        ? t('settings.selected', { defaultValue: '선택됨' })
                        : t('settings.select', { defaultValue: '선택' })}
                    </Text>
                  </TouchableOpacity>
                </TouchableOpacity>
              ))}
              {/* 벨소리 카테고리 */}
              <Text style={{ fontSize: 11, fontWeight: '800', color: colors.secondary, letterSpacing: 1.5, paddingHorizontal: 24, marginBottom: 8, marginTop: 16 }}>{t('sounds.ringtone')}</Text>
              {ALARM_SOUNDS.filter(s => s.id.startsWith('ringtone_')).map(item => (
                <TouchableOpacity
                  key={item.id}
                  style={[styles.toggleRow, { marginHorizontal: 16, marginBottom: 6 }, selectedSoundId === item.id && styles.optionRowSelected]}
                  onPress={() => handlePreview(item.id)}
                >
                  <View style={styles.toggleLeft}>
                    <MaterialIcons name="play-circle-outline" size={22} color={colors.secondary} style={{ opacity: 0.7 }} />
                    <Text style={[styles.toggleLabel, selectedSoundId === item.id && { color: colors.primary }]}>{`${t('sounds.ringtone')} ${item.id.split('_')[1]}`}</Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => handleSoundSelect(item.id)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    style={{
                      paddingHorizontal: 14,
                      paddingVertical: 6,
                      borderRadius: 8,
                      borderWidth: 1,
                      borderColor: colors.primary,
                      backgroundColor: selectedSoundId === item.id ? colors.primary : 'transparent',
                    }}
                  >
                    <Text style={{
                      fontSize: 13,
                      fontWeight: '700',
                      color: selectedSoundId === item.id ? colors.onPrimary : colors.primary,
                    }}>
                      {selectedSoundId === item.id
                        ? t('settings.selected', { defaultValue: '선택됨' })
                        : t('settings.select', { defaultValue: '선택' })}
                    </Text>
                  </TouchableOpacity>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* 언어 선택 모달 */}
      <Modal visible={langModalVisible} transparent animationType="slide" onRequestClose={() => setLangModalVisible(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setLangModalVisible(false)} />
          <View style={{ backgroundColor: colors.background, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 20, paddingBottom: 48, maxHeight: '70%' }}>
            <Text style={{ fontSize: 16, fontWeight: '800', color: colors.onBackground, paddingHorizontal: 24, marginBottom: 12 }}>{t('settings.language')}</Text>
            <ScrollView showsVerticalScrollIndicator={false}>
              <TouchableOpacity
                style={[styles.toggleRow, { marginHorizontal: 16, marginBottom: 6 }, selectedLang === null && styles.optionRowSelected]}
                onPress={() => handleLanguage(null)}
              >
                <View style={styles.toggleLeft}>
                  <MaterialIcons name="auto-awesome" size={22} color={selectedLang === null ? colors.primary : colors.onBackground} />
                  <Text style={[styles.toggleLabel, selectedLang === null && { color: colors.primary }]}>{t('settings.languageAuto')}</Text>
                </View>
                {selectedLang === null && <MaterialIcons name="check-circle" size={22} color={colors.primary} />}
              </TouchableOpacity>
              {SUPPORTED_LANGS.map(code => (
                <TouchableOpacity
                  key={code}
                  style={[styles.toggleRow, { marginHorizontal: 16, marginBottom: 6 }, selectedLang === code && styles.optionRowSelected]}
                  onPress={() => handleLanguage(code)}
                >
                  <Text style={[styles.toggleLabel, selectedLang === code && { color: colors.primary }]}>{LANGUAGE_NAMES[code]}</Text>
                  {selectedLang === code && <MaterialIcons name="check-circle" size={22} color={colors.primary} />}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* 미션 타이머 선택 모달 */}
      <Modal visible={missionDurationModalVisible} transparent animationType="slide" onRequestClose={() => setMissionDurationModalVisible(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setMissionDurationModalVisible(false)} />
          <View style={{ backgroundColor: colors.background, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 20, paddingBottom: 48, maxHeight: '70%' }}>
            <Text style={{ fontSize: 16, fontWeight: '800', color: colors.onBackground, paddingHorizontal: 24, marginBottom: 4 }}>{t('settings.missionDuration')}</Text>
            <Text style={{ fontSize: 12, color: colors.secondary, paddingHorizontal: 24, marginBottom: 12 }}>{t('settings.missionDurationDesc')}</Text>
            <ScrollView showsVerticalScrollIndicator={false}>
              {MISSION_DURATION_OPTIONS.map(opt => (
                <TouchableOpacity
                  key={opt}
                  style={[styles.toggleRow, { marginHorizontal: 16, marginBottom: 6 }, missionDuration === opt && styles.optionRowSelected]}
                  onPress={() => handleMissionDuration(opt)}
                >
                  <View style={styles.toggleLeft}>
                    <MaterialIcons name="timer" size={22} color={missionDuration === opt ? colors.primary : colors.onBackground} />
                    <Text style={[styles.toggleLabel, missionDuration === opt && { color: colors.primary }]}>{opt}{t('settings.secondsUnit', { defaultValue: '초' })}</Text>
                  </View>
                  {missionDuration === opt && <MaterialIcons name="check-circle" size={22} color={colors.primary} />}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <AdBanner />
    </SafeAreaView>
  );
}
