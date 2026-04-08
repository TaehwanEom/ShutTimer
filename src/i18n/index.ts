import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getLocales } from 'expo-localization';
import { I18nManager } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import ko from '../locales/ko.json';
import en from '../locales/en.json';
import ja from '../locales/ja.json';
import zhCN from '../locales/zh-CN.json';
import zhTW from '../locales/zh-TW.json';
import th from '../locales/th.json';
import id from '../locales/id.json';
import de from '../locales/de.json';
import fr from '../locales/fr.json';
import es from '../locales/es.json';
import it from '../locales/it.json';
import ptBR from '../locales/pt-BR.json';
import ar from '../locales/ar.json';
import tr from '../locales/tr.json';

export const SUPPORTED_LANGS = ['ko', 'en', 'ja', 'zh-CN', 'zh-TW', 'th', 'id', 'de', 'fr', 'es', 'it', 'pt-BR', 'ar', 'tr'];

export const LANGUAGE_NAMES: Record<string, string> = {
  'ko': '한국어',
  'en': 'English',
  'ja': '日本語',
  'zh-CN': '简体中文',
  'zh-TW': '繁體中文',
  'th': 'ไทย',
  'id': 'Bahasa Indonesia',
  'de': 'Deutsch',
  'fr': 'Français',
  'es': 'Español',
  'it': 'Italiano',
  'pt-BR': 'Português (BR)',
  'ar': 'العربية',
  'tr': 'Türkçe',
};

export const LANGUAGE_STORAGE_KEY = 'shuttimer_language';

function getDeviceLanguage(): string {
  const locales = getLocales();
  if (!locales || locales.length === 0) return 'en';

  const tag = locales[0].languageTag; // e.g. "ko-KR", "en-US", "zh-Hans-CN"
  const lang = locales[0].languageCode ?? 'en'; // e.g. "ko", "en", "zh"

  // 정확한 태그 매칭 (zh-CN, zh-TW, pt-BR)
  if (SUPPORTED_LANGS.includes(tag)) return tag;

  // 중국어 분기
  if (lang === 'zh') {
    if (tag.includes('Hant') || tag.includes('TW') || tag.includes('HK')) return 'zh-TW';
    return 'zh-CN';
  }

  // 포르투갈어 분기
  if (lang === 'pt') return 'pt-BR';

  // 기본 언어코드 매칭
  if (SUPPORTED_LANGS.includes(lang)) return lang;

  return 'en';
}

const deviceLang = getDeviceLanguage();

// 아랍어 RTL 처리
if (deviceLang === 'ar' && !I18nManager.isRTL) {
  I18nManager.forceRTL(true);
} else if (deviceLang !== 'ar' && I18nManager.isRTL) {
  I18nManager.forceRTL(false);
}

i18n.use(initReactI18next).init({
  resources: {
    ko: { translation: ko },
    en: { translation: en },
    ja: { translation: ja },
    'zh-CN': { translation: zhCN },
    'zh-TW': { translation: zhTW },
    th: { translation: th },
    id: { translation: id },
    de: { translation: de },
    fr: { translation: fr },
    es: { translation: es },
    it: { translation: it },
    'pt-BR': { translation: ptBR },
    ar: { translation: ar },
    tr: { translation: tr },
  },
  lng: deviceLang,
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

// 저장된 언어 설정 로드 (앱 시작 시 호출)
AsyncStorage.getItem(LANGUAGE_STORAGE_KEY).then(saved => {
  if (saved && SUPPORTED_LANGS.includes(saved)) {
    i18n.changeLanguage(saved);
  }
  // saved가 null이면 자동 감지 언어 유지
});

export default i18n;
