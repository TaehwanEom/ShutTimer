// v1.5: 알람 사운드 Pre-load 모듈.
// HomeScreen.scheduleAlarm에서 타이머 예약 시 createAsync를 미리 실행 →
// AlarmScreen 마운트 시 consumeAlarmSound()로 즉시 playAsync 가능 (딜레이 단축).
// 콜드 스타트(앱 killed → 알림 탭)나 Settings 사운드 변경 경로는 fallback 필요 (AlarmScreen 기존 경로 유지).

import { Audio } from 'expo-av';

let preloaded: Audio.Sound | null = null;

/**
 * 타이머 예약 시점에 Audio.Sound를 미리 로드.
 * 기존 preload가 있으면 먼저 언로드 후 새로 생성.
 */
export async function preloadAlarmSound(source: any): Promise<void> {
  await clearPreloadedSound();
  try {
    const { sound } = await Audio.Sound.createAsync(source, { isLooping: true });
    preloaded = sound;
  } catch {
    preloaded = null;
  }
}

/**
 * AlarmScreen 마운트 시 호출. 소유권을 호출자에게 이전하고 내부 참조 비움.
 * null 반환 시 호출자는 직접 createAsync fallback 수행.
 */
export function consumeAlarmSound(): Audio.Sound | null {
  const s = preloaded;
  preloaded = null;
  return s;
}

/**
 * 타이머 취소/설정 변경 시 호출. 메모리 누수 방지.
 */
export async function clearPreloadedSound(): Promise<void> {
  const s = preloaded;
  preloaded = null;
  if (s) {
    try {
      await s.stopAsync();
    } catch {
      // stop 실패 무시 (이미 중단 상태)
    }
    try {
      await s.unloadAsync();
    } catch {
      // unload 실패 무시
    }
  }
}
