// 특정 영역(가로 스크롤 등)을 만지는 동안 하단 탭 좌우 스와이프를 일시 잠그는 전역 플래그.
let locked = false;

export const setSwipeLock = (v: boolean) => {
  locked = v;
};

export const isSwipeLocked = () => locked;
