// 알람 입력 다이얼(시:분 wheel) 행 변경 시 짧은 클릭음 재생. iOS 다이얼처럼 빠른 스크롤 시 "드드드드" 연속음.
//   단일 플레이어는 틱마다 같은 사운드를 끊어 재시작 → 연속음 불가. → 플레이어 풀(POOL_SIZE)을 round-robin으로
//   돌려 클릭들이 겹쳐 재생되게 함. 전역 setAudioModeAsync는 건드리지 않음(알람 오디오 세션 보호). 실패는 무시.
import { createAudioPlayer, type AudioPlayer } from 'expo-audio';

const POOL_SIZE = 6; // 동시 겹침 가능한 클릭 수 (빠른 스크롤 대응).
let pool: AudioPlayer[] | null = null;
let idx = 0;
let initFailed = false;

function getPool(): AudioPlayer[] | null {
  if (pool) return pool;
  if (initFailed) return null;
  try {
    const src = require('../../assets/sounds/dial_tick.wav');
    pool = Array.from({ length: POOL_SIZE }, () => createAudioPlayer(src));
    return pool;
  } catch {
    initFailed = true;
    return null;
  }
}

/** 다이얼 행 변경마다 호출. 풀의 다음 플레이어를 처음으로 되감아 재생(겹침 허용). */
export function playDialTick(): void {
  const p = getPool();
  if (!p) return;
  const player = p[idx];
  idx = (idx + 1) % p.length;
  try {
    // seekTo(0) 후 play — 재사용 플레이어(이미 끝까지 재생됨)도 처음부터 다시 울리게.
    player.seekTo(0).then(() => player.play()).catch(() => {});
  } catch {
    // 재생 실패 무시 — 틱 사운드는 부가 기능.
  }
}
