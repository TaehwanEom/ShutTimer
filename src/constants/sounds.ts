export type SoundItem = {
  id: string;
  source: any;
};

export const ALARM_SOUNDS: SoundItem[] = [
  { id: 'alarm_01', source: require('../../assets/sounds/alarm_02.mp3') },
];

export const DEFAULT_SOUND_ID = 'alarm_01';
