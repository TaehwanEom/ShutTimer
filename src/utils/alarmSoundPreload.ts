// 알람 사운드 Pre-load 모듈 (= 타이머 예약 시점 측 사운드 사전 로드 영역).
// v1.5 = HomeScreen.scheduleAlarm에서 타이머 예약 시 createAsync를 미리 실행 →
//   AlarmScreen 마운트 시 consumeAlarmSound()로 즉시 play 가능 (딜레이 단축).
// 콜드 스타트(앱 killed → 알림 탭)나 Settings 사운드 변경 경로는 fallback 필요 (AlarmScreen 기존 경로 유지).
// v1.7 hotfix #ExpoAudio Phase 4-B — expo-av → expo-audio swap (= SDK 55 측 expo-av 제거 강제).
//   API 변경: Audio.Sound.createAsync (= async) → createAudioPlayer (= sync) + looping property + release().

import { createAudioPlayer, type AudioPlayer } from 'expo-audio';

let preloaded: AudioPlayer | null = null;

/**
 * 타이머 예약 시점에 AudioPlayer를 미리 로드.
 * 기존 preload가 있으면 먼저 release 후 새로 생성.
 * createAudioPlayer 측 = sync 영역 → 본 함수 측 = async 잔존 (= 호출 site 측 호환 영역 보존).
 */
export async function preloadAlarmSound(source: any): Promise<void> {
  await clearPreloadedSound();
  try {
    const player = createAudioPlayer(source);
    player.loop = true;
    preloaded = player;
  } catch {
    preloaded = null;
  }
}

/**
 * AlarmScreen 마운트 시 호출. 소유권을 호출자에게 이전하고 내부 참조 비움.
 * null 반환 시 호출자는 직접 createAudioPlayer fallback 수행.
 */
export function consumeAlarmSound(): AudioPlayer | null {
  const s = preloaded;
  preloaded = null;
  return s;
}

/**
 * 타이머 취소/설정 변경 시 호출. 메모리 누수 방지.
 * v1.7 hotfix — release() 측 = stopAsync + unloadAsync 통합 영역.
 */
export async function clearPreloadedSound(): Promise<void> {
  const s = preloaded;
  preloaded = null;
  if (s) {
    try {
      s.release();
    } catch {
      // release 실패 무시
    }
  }
}
