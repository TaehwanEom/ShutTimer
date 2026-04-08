import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  Switch,
  ScrollView,
  Modal,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MaterialIcons } from '@expo/vector-icons';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../App';
import { ThemeColors } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import { SETTINGS_KEY, DismissMethod, DEFAULT_SETTINGS } from '../constants/settings';
import { useTranslation } from 'react-i18next';
import AdBanner from '../components/AdBanner';
import i18n, { SUPPORTED_LANGS, LANGUAGE_NAMES, LANGUAGE_STORAGE_KEY } from '../i18n';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Settings'>;
};

const DISMISS_OPTIONS: { value: DismissMethod; labelKey: string; icon: string; descKey: string }[] = [
  { value: 'camera', labelKey: 'settings.camera', icon: 'photo-camera', descKey: 'settings.cameraDesc' },
  { value: 'tap', labelKey: 'settings.tap', icon: 'touch-app', descKey: 'settings.tapDesc' },
  { value: 'shake', labelKey: 'settings.shake', icon: 'vibration', descKey: 'settings.shakeDesc' },
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
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  backBtn: {
    padding: 8,
    borderRadius: 50,
    width: 40,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.onBackground,
    letterSpacing: -0.5,
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
  const { colors, isDark, toggleTheme } = useTheme();
  const { t } = useTranslation();
  const styles = makeStyles(colors);

  const [dismissMethod, setDismissMethod] = useState<DismissMethod>(DEFAULT_SETTINGS.dismissMethod);
  const [vibrationEnabled, setVibrationEnabled] = useState(DEFAULT_SETTINGS.vibrationEnabled);
  const [selectedLang, setSelectedLang] = useState<string | null>(null); // null = 자동감지
  const [langModalVisible, setLangModalVisible] = useState(false);

  useEffect(() => {
    AsyncStorage.multiGet([SETTINGS_KEY.DISMISS_METHOD, SETTINGS_KEY.VIBRATION_ENABLED, LANGUAGE_STORAGE_KEY]).then(pairs => {
      const method = pairs[0][1] as DismissMethod | null;
      const vibration = pairs[1][1];
      const lang = pairs[2][1];
      if (method) setDismissMethod(method);
      if (vibration !== null) setVibrationEnabled(vibration === 'true');
      if (lang) setSelectedLang(lang);
    });
  }, []);

  const handleDismissMethod = (value: DismissMethod) => {
    setDismissMethod(value);
    AsyncStorage.setItem(SETTINGS_KEY.DISMISS_METHOD, value);
  };

  const handleVibration = (value: boolean) => {
    setVibrationEnabled(value);
    AsyncStorage.setItem(SETTINGS_KEY.VIBRATION_ENABLED, String(value));
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
      const { getLocales } = require('expo-localization');
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
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <MaterialIcons name="arrow-back" size={24} color={colors.onBackground} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('settings.title')}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
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
                    name={option.icon as any}
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

        {/* 알람 사운드 — v2 */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('settings.alarmSound')}</Text>
          <View style={[styles.toggleRow, styles.disabledRow]}>
            <View style={styles.toggleLeft}>
              <MaterialIcons name="music-note" size={22} color={colors.secondary} style={{ opacity: 0.4 }} />
              <Text style={[styles.toggleLabel, styles.disabledText]}>{t('settings.soundSelect')}</Text>
            </View>
            <View style={styles.comingSoonBadge}>
              <Text style={styles.comingSoonText}>{t('settings.comingSoon')}</Text>
            </View>
          </View>
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

        {/* 구매 — v2 */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('settings.purchase')}</Text>
          <View style={[styles.toggleRow, styles.disabledRow]}>
            <View style={styles.toggleLeft}>
              <MaterialIcons name="stars" size={22} color={colors.secondary} style={{ opacity: 0.4 }} />
              <Text style={[styles.toggleLabel, styles.disabledText]}>{t('settings.removeAds')}</Text>
            </View>
            <View style={styles.comingSoonBadge}>
              <Text style={styles.comingSoonText}>{t('settings.comingSoon')}</Text>
            </View>
          </View>
          <View style={[styles.toggleRow, styles.disabledRow]}>
            <View style={styles.toggleLeft}>
              <MaterialIcons name="restore" size={22} color={colors.secondary} style={{ opacity: 0.4 }} />
              <Text style={[styles.toggleLabel, styles.disabledText]}>{t('settings.restorePurchase')}</Text>
            </View>
            <View style={styles.comingSoonBadge}>
              <Text style={styles.comingSoonText}>{t('settings.comingSoon')}</Text>
            </View>
          </View>
        </View>

        {/* 위젯 — v2 */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('settings.widget')}</Text>
          <View style={[styles.toggleRow, styles.disabledRow]}>
            <View style={styles.toggleLeft}>
              <MaterialIcons name="widgets" size={22} color={colors.secondary} style={{ opacity: 0.4 }} />
              <Text style={[styles.toggleLabel, styles.disabledText]}>{t('settings.homeWidget')}</Text>
            </View>
            <View style={styles.comingSoonBadge}>
              <Text style={styles.comingSoonText}>{t('settings.comingSoon')}</Text>
            </View>
          </View>
        </View>
      </ScrollView>

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
      <AdBanner />
    </SafeAreaView>
  );
}
