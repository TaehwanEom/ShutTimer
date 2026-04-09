export type SoundItem = {
  id: string;
  source: any;
};

export const ALARM_SOUNDS: SoundItem[] = [
  { id: 'alarm_01', source: require('../../assets/sounds/alarm_01.mp3') },
  { id: 'alarm_02', source: require('../../assets/sounds/alarm_02.mp3') },
  { id: 'alarm_03', source: require('../../assets/sounds/alarm_03.mp3') },
  { id: 'alarm_04', source: require('../../assets/sounds/alarm_04.mp3') },
  { id: 'alarm_05', source: require('../../assets/sounds/alarm_05.mp3') },
  { id: 'alarm_06', source: require('../../assets/sounds/alarm_06.mp3') },
  { id: 'alarm_07', source: require('../../assets/sounds/alarm_07.mp3') },
  { id: 'alarm_08', source: require('../../assets/sounds/alarm_08.mp3') },
  { id: 'alarm_09', source: require('../../assets/sounds/alarm_09.mp3') },
  { id: 'alarm_10', source: require('../../assets/sounds/alarm_10.mp3') },
  { id: 'alarm_11', source: require('../../assets/sounds/alarm_11.mp3') },
  { id: 'alarm_12', source: require('../../assets/sounds/alarm_12.mp3') },
  { id: 'ringtone_01', source: require('../../assets/sounds/ringtone_01.mp3') },
  { id: 'ringtone_02', source: require('../../assets/sounds/ringtone_02.mp3') },
  { id: 'ringtone_03', source: require('../../assets/sounds/ringtone_03.mp3') },
  { id: 'ringtone_04', source: require('../../assets/sounds/ringtone_04.mp3') },
  { id: 'ringtone_05', source: require('../../assets/sounds/ringtone_05.mp3') },
  { id: 'ringtone_06', source: require('../../assets/sounds/ringtone_06.mp3') },
  { id: 'ringtone_07', source: require('../../assets/sounds/ringtone_07.mp3') },
  { id: 'ringtone_08', source: require('../../assets/sounds/ringtone_08.mp3') },
  { id: 'ringtone_09', source: require('../../assets/sounds/ringtone_09.mp3') },
  { id: 'ringtone_10', source: require('../../assets/sounds/ringtone_10.mp3') },
  { id: 'ringtone_11', source: require('../../assets/sounds/ringtone_11.mp3') },
  { id: 'ringtone_12', source: require('../../assets/sounds/ringtone_12.mp3') },
  { id: 'ringtone_13', source: require('../../assets/sounds/ringtone_13.mp3') },
  { id: 'ringtone_14', source: require('../../assets/sounds/ringtone_14.mp3') },
  { id: 'ringtone_15', source: require('../../assets/sounds/ringtone_15.mp3') },
];

export const DEFAULT_SOUND_ID = 'alarm_01';
