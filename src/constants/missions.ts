export type Mission = {
  id: string;
  icon: string;
  enabled?: boolean;
  defaultMinutes?: number;
};

export const MISSIONS: Mission[] = [];

export const MISSIONS_STORAGE_KEY = 'shutimer_missions';

export const ICON_OPTIONS: string[] = [
  'tv', 'bathtub', 'menu-book', 'school', 'toys', 'sports-esports',
  'outdoor-grill', 'fitness-center', 'directions-run', 'self-improvement',
  'music-note', 'brush', 'pets', 'local-cafe', 'restaurant',
  'shopping-cart', 'work', 'computer', 'phone-android',
  'camera-alt', 'directions-bike', 'spa', 'nightlight', 'clean-hands',
];
