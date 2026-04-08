export type Mission = {
  id: string;
  label: string;
  icon: string;
  enabled?: boolean;
  defaultMinutes?: number;
};

export const MISSIONS: Mission[] = [
  { id: 'tv', label: 'TV시청', icon: 'tv' },
  { id: 'bath', label: '목욕', icon: 'bathtub' },
  { id: 'read', label: '독서', icon: 'menu-book' },
  { id: 'study', label: '공부', icon: 'school' },
  { id: 'brush', label: '양치', icon: 'clean-hands' },
  { id: 'play', label: '놀이', icon: 'toys' },
  { id: 'game', label: '게임', icon: 'sports-esports' },
];

export const MISSIONS_STORAGE_KEY = 'shutimer_missions';

export const ICON_OPTIONS: string[] = [
  'tv', 'bathtub', 'menu-book', 'school', 'toys', 'sports-esports',
  'outdoor-grill', 'fitness-center', 'directions-run', 'self-improvement',
  'music-note', 'brush', 'palette', 'pets', 'local-cafe', 'restaurant',
  'shopping-cart', 'work', 'computer', 'phone-android',
  'camera-alt', 'directions-bike', 'spa', 'nightlight', 'clean-hands',
];

export const ICON_LABELS: Record<string, string> = {
  'tv': 'TV시청',
  'bathtub': '목욕',
  'menu-book': '독서',
  'school': '공부',
  'toys': '놀이',
  'sports-esports': '게임',
  'outdoor-grill': '요리',
  'fitness-center': '운동',
  'directions-run': '달리기',
  'self-improvement': '명상',
  'music-note': '음악',
  'brush': '그림',
  'palette': '채색',
  'pets': '반려동물',
  'local-cafe': '카페',
  'restaurant': '식사',
  'shopping-cart': '쇼핑',
  'work': '업무',
  'computer': '컴퓨터',
  'phone-android': '스마트폰',
  'camera-alt': '사진',
  'directions-bike': '자전거',
  'spa': '휴식',
  'nightlight': '취침',
  'clean-hands': '양치',
};
