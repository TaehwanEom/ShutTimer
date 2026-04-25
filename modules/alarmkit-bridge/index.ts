// AlarmKit bridge — iOS 26+ 알람 등록.
// JS 측에서 isAvailable() 체크 후 사용. 미지원 시 expo-notifications 폴백.

import AlarmkitBridge from './src/AlarmkitBridgeModule';

export * from './src/AlarmkitBridge.types';
export default AlarmkitBridge;
