// 평가 모달 + 친구 추천 모달 트리거 영역 관리.
// 평가 = 첫 실행 후 3일 + 알람 미션 성공 5회 + 30일 간격 (= 월 1회).
// 추천 = 평가 직후 표시 + 15일 간격 (= 월 2회).
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as StoreReview from 'expo-store-review';
import { Logger } from './logger';

const KEY_INSTALL_DATE = 'app_install_date';
const KEY_ALARM_SUCCESS_COUNT = 'alarm_success_count';
// v1.8 — KEY_REVIEW_PROMPT_SHOWN (= 1회 flag) 폐기. KEY_REVIEW_LAST_SHOWN_AT (= timestamp) 사용 = 월 1회.
const KEY_REVIEW_LAST_SHOWN_AT = 'review_last_shown_at';
// v1.8 #RecommendModal — 추천 모달 측 마지막 표시 timestamp. 15일 간격 = 월 2회.
const KEY_RECOMMEND_LAST_SHOWN_AT = 'recommend_last_shown_at';

const TRIGGER_DAYS = 3;
const TRIGGER_SUCCESS_COUNT = 5;
const REVIEW_INTERVAL_DAYS = 30; // 월 1회
const RECOMMEND_INTERVAL_DAYS = 15; // 월 2회
const DAY_MS = 1000 * 60 * 60 * 24;

export async function recordInstallDateIfNeeded(): Promise<void> {
  try {
    const existing = await AsyncStorage.getItem(KEY_INSTALL_DATE);
    if (!existing) {
      await AsyncStorage.setItem(KEY_INSTALL_DATE, new Date().toISOString());
      Logger.info('StoreReview', `installDate recorded`);
    }
  } catch (e) {
    Logger.warn('StoreReview', `recordInstallDate failed: ${String(e)}`);
  }
}

export async function incrementAlarmSuccessCount(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(KEY_ALARM_SUCCESS_COUNT);
    const count = (raw ? parseInt(raw, 10) : 0) + 1;
    await AsyncStorage.setItem(KEY_ALARM_SUCCESS_COUNT, String(count));
  } catch (e) {
    Logger.warn('StoreReview', `incrementAlarmSuccess failed: ${String(e)}`);
  }
}

export async function maybeRequestReview(): Promise<void> {
  try {
    const installDateRaw = await AsyncStorage.getItem(KEY_INSTALL_DATE);
    if (!installDateRaw) return;
    const daysSinceInstall = (Date.now() - new Date(installDateRaw).getTime()) / DAY_MS;
    if (daysSinceInstall < TRIGGER_DAYS) return;

    const countRaw = await AsyncStorage.getItem(KEY_ALARM_SUCCESS_COUNT);
    const count = countRaw ? parseInt(countRaw, 10) : 0;
    if (count < TRIGGER_SUCCESS_COUNT) return;

    // v1.8 — 월 1회 측 = 30일 간격 검사.
    const lastShownRaw = await AsyncStorage.getItem(KEY_REVIEW_LAST_SHOWN_AT);
    if (lastShownRaw) {
      const daysSinceLastShown = (Date.now() - parseInt(lastShownRaw, 10)) / DAY_MS;
      if (daysSinceLastShown < REVIEW_INTERVAL_DAYS) return;
    }

    const isAvailable = await StoreReview.isAvailableAsync();
    if (!isAvailable) {
      Logger.warn('StoreReview', `isAvailableAsync=false → skip`);
      return;
    }

    await StoreReview.requestReview();
    await AsyncStorage.setItem(KEY_REVIEW_LAST_SHOWN_AT, String(Date.now()));
    Logger.info('StoreReview', `requestReview 호출 days=${daysSinceInstall.toFixed(1)} count=${count}`);
  } catch (e) {
    Logger.warn('StoreReview', `maybeRequestReview failed: ${String(e)}`);
  }
}

// v1.8 #RecommendModal — 친구 추천 모달 표시 검사.
// 평가 모달 표시 조건 (= 3일 + 5회 성공) + 15일 간격 (= 월 2회). 표시 가능 시 true 반환.
// caller (= AlarmScreen) 측 = true 반환 시 = RecommendModal state 측 true 전환.
export async function shouldShowRecommend(): Promise<boolean> {
  try {
    const installDateRaw = await AsyncStorage.getItem(KEY_INSTALL_DATE);
    if (!installDateRaw) return false;
    const daysSinceInstall = (Date.now() - new Date(installDateRaw).getTime()) / DAY_MS;
    if (daysSinceInstall < TRIGGER_DAYS) return false;

    const countRaw = await AsyncStorage.getItem(KEY_ALARM_SUCCESS_COUNT);
    const count = countRaw ? parseInt(countRaw, 10) : 0;
    if (count < TRIGGER_SUCCESS_COUNT) return false;

    const lastShownRaw = await AsyncStorage.getItem(KEY_RECOMMEND_LAST_SHOWN_AT);
    if (lastShownRaw) {
      const daysSinceLastShown = (Date.now() - parseInt(lastShownRaw, 10)) / DAY_MS;
      if (daysSinceLastShown < RECOMMEND_INTERVAL_DAYS) return false;
    }
    return true;
  } catch (e) {
    Logger.warn('Recommend', `shouldShowRecommend failed: ${String(e)}`);
    return false;
  }
}

export async function markRecommendShown(): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY_RECOMMEND_LAST_SHOWN_AT, String(Date.now()));
    Logger.info('Recommend', `markRecommendShown`);
  } catch (e) {
    Logger.warn('Recommend', `markRecommendShown failed: ${String(e)}`);
  }
}
