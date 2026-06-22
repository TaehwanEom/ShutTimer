// 알람 입력 다이얼(시:분 wheel) 행 변경 시 짧은 클릭음 재생. expo-audio 모듈 1회 로드 + 빠른 재시작.
//   전역 setAudioModeAsync는 건드리지 않음(알람 오디오 세션 보호). 재생 실패는 무시(부가 기능).
import { createAudioPlayer, type AudioPlayer } from 'expo-audio';

let tickPlayer: AudioPlayer | null = null;
let initFailed = false;

function getTickPlayer(): AudioPlayer | null {
  if (tickPlayer) return tickPlayer;
  if (initFailed) return null;
  try {
    tickPlayer = createAudioPlayer(require('../../assets/sounds/dial_tick.mp3'));
    return tickPlayer;
  } catch {
    initFailed = true;
    return null;
  }
}

/** 다이얼 행 변경마다 호출. 짧은 사운드를 처음으로 되감아 재생(빠른 스크롤 시 매 틱 재시작). */
export function playDialTick(): void {
  const p = getTickPlayer();
  if (!p) return;
  try {
    p.seekTo(0).catch(() => {});
    p.play();
  } catch {
    // 재생 실패 무시 — 틱 사운드는 부가 기능이라 흐름을 막지 않음.
  }
}
