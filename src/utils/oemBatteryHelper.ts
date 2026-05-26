/**
 * Phase 3-5 (Android, Samsung) — 배터리 최적화 안내 + deep-link.
 *
 * 목적
 *   - Android 측 OEM (특히 삼성 One UI 측 Device Care = "잠자는 앱" / "심층 잠자는 앱") 가
 *     앱 측 백그라운드 알람 / FGS 측 = 강제 종료 → AlarmManager.setAlarmClock 측 fire 실패.
 *   - 본 helper = 사용자 측 OS 표준 "배터리 최적화 제외" + (가능 시) 삼성 Device Care 측 deep-link.
 *
 * iOS 영향 = 0
 *   - 모든 export 함수 측 첫 줄 = `Platform.OS !== 'android'` 측 즉시 return.
 *   - iOS 측 import = TypeScript 측 안전 (= expo-intent-launcher 측 iOS 측 = no-op stub 반환).
 */
import { Platform } from 'react-native';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Application from 'expo-application';

const ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS =
  'android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS';
const ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS =
  'android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS';
const ACTION_APPLICATION_DETAILS_SETTINGS =
  'android.settings.APPLICATION_DETAILS_SETTINGS';

const SAMSUNG_DEVICE_CARE_PKG = 'com.samsung.android.lool';

function getPackageName(): string {
  return Application.applicationId ?? 'com.shuttimer.app';
}

export function isAndroid(): boolean {
  return Platform.OS === 'android';
}

export function getManufacturer(): string {
  if (!isAndroid()) return '';
  const constants = (Platform as any).constants ?? {};
  const m = constants.Manufacturer ?? constants.manufacturer ?? '';
  return String(m).toLowerCase();
}

export function isSamsung(): boolean {
  return isAndroid() && getManufacturer() === 'samsung';
}

/**
 * 표준 Android 측 "배터리 최적화 제외" 권한 요청 dialog 표시.
 *   - data: `package:<pkgName>` 측 필수 (= 본 앱 측 한정 요청).
 *   - 사용자 측 "허용" 시 = OS 측 본 앱 측 Doze / App Standby 측 제외 → setAlarmClock 측 fire 신뢰성 ↑.
 */
export async function requestIgnoreBatteryOptimization(): Promise<boolean> {
  if (!isAndroid()) return false;
  try {
    await IntentLauncher.startActivityAsync(ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, {
      data: `package:${getPackageName()}`,
    });
    return true;
  } catch {
    return openBatteryOptimizationList();
  }
}

/**
 * Android 측 표준 "배터리 최적화 앱 목록" 화면 열기 (= 위 dialog 측 실패 fallback).
 *   - 사용자 측 직접 본 앱 측 측 "최적화 안 함" 측 선택 필요.
 */
export async function openBatteryOptimizationList(): Promise<boolean> {
  if (!isAndroid()) return false;
  try {
    await IntentLauncher.startActivityAsync(ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
    return true;
  } catch {
    try {
      await IntentLauncher.startActivityAsync(ACTION_APPLICATION_DETAILS_SETTINGS, {
        data: `package:${getPackageName()}`,
      });
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * 삼성 Device Care ("디바이스 케어") 측 = "잠자는 앱" 측 측 화면 시도.
 *   - One UI 버전별 activity 명 측 달라 = 시도 실패 시 = 표준 배터리 최적화 화면 fallback.
 *   - 본 함수 = 삼성 전용 (= 비-삼성 측 = 즉시 표준 경로 fallback).
 */
export async function openSamsungDeviceCare(): Promise<boolean> {
  if (!isAndroid()) return false;
  if (isSamsung()) {
    const candidates = [
      'com.samsung.android.sm.battery.ui.BatteryActivity',
      'com.samsung.android.sm.ui.battery.BatteryActivity',
      'com.samsung.android.sm.ui.cstyleboard.SmartManagerDashBoardActivity',
    ];
    for (const className of candidates) {
      try {
        await IntentLauncher.startActivityAsync('android.intent.action.MAIN', {
          packageName: SAMSUNG_DEVICE_CARE_PKG,
          className,
        } as any);
        return true;
      } catch {
        continue;
      }
    }
  }
  return requestIgnoreBatteryOptimization();
}
