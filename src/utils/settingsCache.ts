// @v1.5 — 설정 사전 로드 캐시
// AsyncStorage 비동기 지연으로 AlarmScreen 마운트 시 dismissMethod 결정이 늦어 흔들기 애니메이션 1-2초 지연.
// App.tsx 마운트 시 preload → AlarmScreen이 동기적으로 초기값 사용.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { SETTINGS_KEY, DismissMethod, DEFAULT_SETTINGS } from '../constants/settings';

let cachedDismissMethod: DismissMethod | null = null;

export const getCachedDismissMethod = (): DismissMethod | null => cachedDismissMethod;

export const setCachedDismissMethod = (method: DismissMethod): void => {
  cachedDismissMethod = method;
};

// App 시작 시 1회 호출. AsyncStorage에서 dismissMethod 읽어 캐시.
// 실패 시 무시 (AlarmScreen이 자체 fallback 사용).
// v1.8 #DismissMethodCache — 6개 옵션 모두 인정 (이전 = 3개만 → 'random'/'math'/'typing' 측 = 'camera' fallback root cause).
const VALID_METHODS: DismissMethod[] = ['camera', 'tap', 'shake', 'math', 'typing', 'random'];

export const preloadDismissMethod = async (): Promise<void> => {
  try {
    const stored = await AsyncStorage.getItem(SETTINGS_KEY.DISMISS_METHOD);
    if (stored && VALID_METHODS.includes(stored as DismissMethod)) {
      cachedDismissMethod = stored as DismissMethod;
    } else {
      cachedDismissMethod = DEFAULT_SETTINGS.dismissMethod;
    }
  } catch {
    // 무시: AlarmScreen 초기값 fallback 작동
  }
};
