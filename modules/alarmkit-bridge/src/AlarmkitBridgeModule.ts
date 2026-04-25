import { NativeModule, requireNativeModule } from 'expo';
import type { AuthorizationState, ScheduleAlarmParams } from './AlarmkitBridge.types';

declare class AlarmkitBridgeModule extends NativeModule {
  /** iOS 26+ 사용 가능 여부 (sync). false 면 expo-notifications 폴백 필요. */
  isAvailable(): boolean;
  /** 권한 요청. 사용자에게 시스템 다이얼로그 노출. */
  requestAuthorization(): Promise<AuthorizationState>;
  /** 현재 권한 상태 조회 (다이얼로그 미표시). */
  getAuthorizationState(): Promise<AuthorizationState>;
  /** 알람 등록 → alarm UUID 반환. */
  scheduleAlarm(params: ScheduleAlarmParams): Promise<string>;
  /** alarm UUID 로 취소. */
  cancelAlarm(alarmId: string): Promise<void>;
  /** 현재 등록된 알람 UUID 목록. */
  listAlarms(): Promise<string[]>;
}

export default requireNativeModule<AlarmkitBridgeModule>('AlarmkitBridge');
