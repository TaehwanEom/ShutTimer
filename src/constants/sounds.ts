export type SoundItem = {
  id: string;
  source: any;
  pushSound: string;
};

export const ALARM_SOUNDS: SoundItem[] = [
  { id: 'alarm_01', source: require('../../assets/sounds/notification_alarm.wav'), pushSound: 'notification_alarm.wav' },
  { id: 'alarm_02', source: require('../../assets/sounds/notification_alarm01.wav'), pushSound: 'notification_alarm01.wav' },
  { id: 'ringtone_01', source: require('../../assets/sounds/notification_ringtone.wav'), pushSound: 'notification_ringtone.wav' },
  { id: 'ringtone_02', source: require('../../assets/sounds/ringtone_05.wav'), pushSound: 'ringtone_05.wav' },
];

export const DEFAULT_SOUND_ID = 'alarm_01';
