// 앱 삭제 후 재설치 시 알람·온보딩 복원 (로컬 백업).
//
// iOS: expo-secure-store(= Keychain)는 앱 삭제 후에도 데이터가 잔존함(현재 iOS 동작) →
//      같은 기기에서 삭제→재설치 시 알람·온보딩 복원 가능. (Apple 공식 보장은 아님 = "보험"으로만 사용)
// Android: secure-store가 앱 삭제 시 함께 삭제됨 → 복원 시 백업이 없어 graceful no-op.
//          (안드로이드 복원은 별도 처리 — 안드로이드창 인계)
//
// Phase 2(iCloud KV) 대비: cloud provider 자리(주석)를 mirror/restore 양쪽에 마련해 둠.
//
// 동작:
//  - mirrorToBackup(): 알람 저장/온보딩 완료 시 호출. AsyncStorage의 백업 대상 키를 Keychain에 미러.
//  - restoreIfNeeded(): 앱 부트스트랩 시 1회. "이번 설치에서 온보딩 기록 없음"(= 프레시 설치) +
//                       Keychain에 백업 있음 → 복원. 정상 사용 중에는 절대 복원 X(삭제한 알람 부활 방지).

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import AlarmkitBridge from '../../modules/alarmkit-bridge';
import { Logger } from './logger';

// 백업 대상 AsyncStorage 키 = "사용자 콘텐츠 + 설정"만 (화이트리스트).
//   ⚠️ 런타임/세션/알람매핑/마이그레이션 플래그/로그 키는 절대 포함 금지 (복원 시 stale state 주입 → 오작동).
const BACKUP_KEYS = [
  // 콘텐츠
  'shuttimer_alarms',            // 알람
  'shuttimer_routines',          // 루틴
  'shuttimer_custom_categories', // 커스텀 카테고리
  'shutimer_missions',           // 미션 설정(오타 키 — 실제 저장 키)
  // 온보딩
  'onboardingCompleted',
  // 설정/선호
  'shuttimer_language',
  'shutimer_dismiss_method',
  'shutimer_vibration_enabled',
  'shutimer_dark_mode',
  'shutimer_alarm_sound',
  'shutimer_primary_color',
  'shutimer_dial_type',
  'shutimer_alarm_enabled',
  'shutimer_mission_duration',
  'shutimer_selected_missions',
  'shutimer_keep_screen_on',
] as const;
const BACKUP_STORE_KEY = 'shuttimer_backup_v1';

let restoreAttempted = false;

type BackupBlob = Record<string, string | null>;

/**
 * 현재 저장된 데이터를 백업소(Keychain)에 미러. fire-and-forget(실패해도 앱 정상 동작).
 * 알람 저장 후 / 온보딩 완료 시 호출.
 */
export async function mirrorToBackup(): Promise<void> {
  try {
    const blob: BackupBlob = {};
    for (const k of BACKUP_KEYS) {
      blob[k] = await AsyncStorage.getItem(k);
    }
    const json = JSON.stringify(blob);
    // 주의: expo-secure-store 값 권장 한도(~2KB). 알람이 매우 많아 초과하면 경고/실패 가능 →
    //       그 경우 Phase 2(iCloud KV, 1MB)에서 커버. 일반 사용(소수 알람)은 문제 없음.
    await SecureStore.setItemAsync(BACKUP_STORE_KEY, json);
    // Phase 2: iCloud KV에도 미러 (기기 교체/초기화에도 복원). sync 동작, 실패 무시.
    try { AlarmkitBridge.icloudSetString(BACKUP_STORE_KEY, json); } catch {}
    Logger.info('backupRestore', `mirror ok bytes=${json.length}`);
  } catch (e) {
    Logger.warn('backupRestore', `mirror fail: ${String(e)}`);
  }
}

/**
 * 새 설치 감지 시 백업소에서 복원. 부트스트랩에서 알람 sync 전에 1회 호출.
 * - "이번 설치에서 onboardingCompleted 기록 없음" = 프레시 설치 신호.
 *   → 정상 사용 중(온보딩 완료 상태)에는 복원하지 않음 = 사용자가 지운 알람 부활 방지.
 * - 백업 없으면(진짜 최초 설치) no-op → 온보딩 정상 진행.
 * @returns 복원 수행 여부
 */
export async function restoreIfNeeded(): Promise<boolean> {
  if (restoreAttempted) return false;
  restoreAttempted = true;
  try {
    // 프레시 설치 신호: 이번 설치에서 온보딩 완료 기록이 없음.
    const onboarded = await AsyncStorage.getItem('onboardingCompleted');
    if (onboarded != null) return false; // 이미 이 설치에서 사용 중 → 복원 금지

    // 1) 로컬(Keychain) 먼저 — 같은 기기 삭제→재설치 즉시 복원.
    let raw = await SecureStore.getItemAsync(BACKUP_STORE_KEY);
    // 2) 로컬에 없으면 iCloud KV fallback — 기기 교체/초기화 케이스.
    //    (최초엔 sync 후 download 지연 가능 → 못 받으면 이번엔 skip, 재실행 시 복원될 수 있음.)
    if (!raw) {
      try {
        AlarmkitBridge.icloudSync();
        const cloud = AlarmkitBridge.icloudGetString(BACKUP_STORE_KEY);
        if (cloud) {
          raw = cloud;
          Logger.warn('backupRestore', 'restore source=iCloud');
        }
      } catch {}
    }
    if (!raw) return false; // 로컬·클라우드 둘 다 없음 = 진짜 최초 설치 → 온보딩 진행

    const blob = JSON.parse(raw) as BackupBlob;
    let restored = false;
    for (const k of BACKUP_KEYS) {
      const v = blob[k];
      if (v != null) {
        await AsyncStorage.setItem(k, v);
        restored = true;
      }
    }
    Logger.warn('backupRestore', `restore ${restored ? 'DONE' : 'skip'} (fresh install + local backup)`);
    return restored;
  } catch (e) {
    Logger.warn('backupRestore', `restore fail: ${String(e)}`);
    return false;
  }
}
