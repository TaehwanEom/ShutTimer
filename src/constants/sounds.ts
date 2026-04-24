export type SoundItem = {
  id: string;
  source: any;
  pushSound: string;
};

export const ALARM_SOUNDS: SoundItem[] = [
  { id: 'alarm_01', source: require('../../assets/sounds/alarm_02.mp3'), pushSound: 'notification_alarm.wav' },
  { id: 'alarm_02', source: require('../../assets/sounds/notification_alarm01.wav'), pushSound: 'notification_alarm01.wav' },
  { id: 'alarm_03', source: require('../../assets/sounds/notification_alarm02.wav'), pushSound: 'notification_alarm02.wav' },
  { id: 'ringtone_01', source: require('../../assets/sounds/ringtone_12.mp3'), pushSound: 'notification_ringtone.wav' },
];

export const DEFAULT_SOUND_ID = 'alarm_01';
