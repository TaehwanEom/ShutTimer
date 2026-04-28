import { NativeModule, requireNativeModule } from 'expo';
import type {
  AuthorizationState,
  ScheduleAlarmParams,
  AlarmStateChangeEvent,
  AlarmInfo,
} from './AlarmkitBridge.types';

type AlarmkitBridgeEvents = {
  onAlarmStateChange: (event: AlarmStateChangeEvent) => void;
};

declare class AlarmkitBridgeModule extends NativeModule<AlarmkitBridgeEvents> {
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
  /** 현재 등록된 알람 목록 (id + state). v1.6 T1 — 콜드스타트 alerting filter 위해 state 포함. */
  listAlarms(): Promise<AlarmInfo[]>;
  /** v1.6 Phase 10-A — App Group UserDefaults write (LA Intent 동기화). value=null 시 삭제. */
  writeAppGroupString(key: string, value: string | null): boolean;
  /** v1.6 Phase 10-A — App Group UserDefaults read. */
  readAppGroupString(key: string): string | null;
  /** v1.6 Phase 10-A — App Group UserDefaults key 삭제. */
  removeAppGroupKey(key: string): boolean;
}

// Native binary 에 모듈 미포함 (구 dev client / Expo Go) → app init throw 회피.
// stub 반환 — isAvailable() false 라서 호출처가 자동으로 expo-notifications 폴백.
let bridge: AlarmkitBridgeModule;
try {
  bridge = requireNativeModule<AlarmkitBridgeModule>('AlarmkitBridge');
} catch {
  bridge = {
    isAvailable: () => false,
    requestAuthorization: async () => 'unavailable' as AuthorizationState,
    getAuthorizationState: async () => 'unavailable' as AuthorizationState,
    scheduleAlarm: async () => '',
    cancelAlarm: async () => {},
    listAlarms: async (): Promise<AlarmInfo[]> => [],
    writeAppGroupString: () => false,
    readAppGroupString: () => null,
    removeAppGroupKey: () => false,
    addListener: () => ({ remove: () => {} }),
    removeListener: () => {},
  } as unknown as AlarmkitBridgeModule;
}
export default bridge;
