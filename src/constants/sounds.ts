export type SoundItem = {
  id: string;
  source: any;
  pushSound: string;
};

export const ALARM_SOUNDS: SoundItem[] = [
  { id: 'alarm_01', source: require('../../assets/sounds/alarm_01.wav'), pushSound: 'alarm_01.wav' },
  { id: 'alarm_02', source: require('../../assets/sounds/alarm_02.wav'), pushSound: 'alarm_02.wav' },
  { id: 'alarm_03', source: require('../../assets/sounds/alarm_03.wav'), pushSound: 'alarm_03.wav' },
  { id: 'alarm_04', source: require('../../assets/sounds/alarm_04.wav'), pushSound: 'alarm_04.wav' },
  { id: 'ringtone_01', source: require('../../assets/sounds/ringtone_01.wav'), pushSound: 'ringtone_01.wav' },
  { id: 'ringtone_02', source: require('../../assets/sounds/ringtone_02.wav'), pushSound: 'ringtone_02.wav' },
  { id: 'ringtone_03', source: require('../../assets/sounds/ringtone_03.wav'), pushSound: 'ringtone_03.wav' },
  { id: 'ringtone_04', source: require('../../assets/sounds/ringtone_04.wav'), pushSound: 'ringtone_04.wav' },
];

export const DEFAULT_SOUND_ID = 'alarm_01';
