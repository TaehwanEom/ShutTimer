export type Mission = {
  id: string;
  icon: string;
  enabled?: boolean;
  defaultMinutes?: number;
};

export const MISSIONS: Mission[] = [
  { id: 'tv', icon: 'tv', enabled: true },
  { id: 'bath', icon: 'bathtub', enabled: true },
  { id: 'read', icon: 'menu-book', enabled: true },
  { id: 'study', icon: 'school', enabled: true },
  { id: 'brush', icon: 'clean-hands', enabled: true },
  { id: 'play', icon: 'toys', enabled: true },
  { id: 'game', icon: 'sports-esports', enabled: true },
];

export const MISSIONS_STORAGE_KEY = 'shutimer_missions';

export const ICON_OPTIONS: string[] = [
  'tv', 'bathtub', 'menu-book', 'school', 'toys', 'sports-esports',
  'outdoor-grill', 'fitness-center', 'directions-run', 'self-improvement',
  'music-note', 'brush', 'palette', 'pets', 'local-cafe', 'restaurant',
  'shopping-cart', 'work', 'computer', 'phone-android',
  'camera-alt', 'directions-bike', 'spa', 'nightlight', 'clean-hands',
];
