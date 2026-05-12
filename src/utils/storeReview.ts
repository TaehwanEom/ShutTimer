// 앱 별점 요청 영역 트리거 영역 관리 (= 첫 실행 후 3일 + 알람 미션 성공 5회 동시 만족 시 1회 표시)
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as StoreReview from 'expo-store-review';
import { Logger } from './logger';

const KEY_INSTALL_DATE = 'app_install_date';
const KEY_ALARM_SUCCESS_COUNT = 'alarm_success_count';
const KEY_REVIEW_PROMPT_SHOWN = 'review_prompt_shown';

const TRIGGER_DAYS = 3;
const TRIGGER_SUCCESS_COUNT = 5;
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
    const shown = await AsyncStorage.getItem(KEY_REVIEW_PROMPT_SHOWN);
    if (shown === 'true') return;

    const installDateRaw = await AsyncStorage.getItem(KEY_INSTALL_DATE);
    if (!installDateRaw) return;
    const daysSinceInstall = (Date.now() - new Date(installDateRaw).getTime()) / DAY_MS;
    if (daysSinceInstall < TRIGGER_DAYS) return;

    const countRaw = await AsyncStorage.getItem(KEY_ALARM_SUCCESS_COUNT);
    const count = countRaw ? parseInt(countRaw, 10) : 0;
    if (count < TRIGGER_SUCCESS_COUNT) return;

    const isAvailable = await StoreReview.isAvailableAsync();
    if (!isAvailable) {
      Logger.warn('StoreReview', `isAvailableAsync=false → skip`);
      return;
    }

    await StoreReview.requestReview();
    await AsyncStorage.setItem(KEY_REVIEW_PROMPT_SHOWN, 'true');
    Logger.info('StoreReview', `requestReview 호출 days=${daysSinceInstall.toFixed(1)} count=${count}`);
  } catch (e) {
    Logger.warn('StoreReview', `maybeRequestReview failed: ${String(e)}`);
  }
}
