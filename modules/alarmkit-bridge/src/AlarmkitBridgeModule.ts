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
  /** alarm UUID 로 취소. v1.6 후속 hotfix — alerting 상태면 stop(id:), 그 외 cancel(id:). */
  cancelAlarm(alarmId: string): Promise<void>;
  /** v1.6 후속 hotfix — alerting 상태 알람 명시적 정지 (= 사운드/진동/UI dismiss). */
  stopAlarm(alarmId: string): Promise<void>;
  /**
   * v1.7 hotfix #G3 — Apple AlarmKitDemo 공식 패턴: countdown state 측만 pause 가능.
   * native 측 = state 검사 후 try AlarmManager.shared.pause(id:) 호출 → LA Activity 자동 paused state.
   * state ❌ countdown 시 = silent skip (= warn log 잔존).
   * v1.7 hotfix #G5 Phase B-2 — return ms timestamp (= native 측 = pause 호출 직전 측 측정 = JS bridge 통신 영역 정확 측정 영역).
   *   skip / error 시 = 0 return (= JS 측 = Date.now() fallback 강제).
   */
  pauseAlarm(alarmId: string): Promise<number>;
  /**
   * v1.7 hotfix #G3 — paused state 측만 resume 가능. native 측 = state 검사 후 try AlarmManager.shared.resume(id:) 호출.
   * v1.7 hotfix #G5 Phase B-2 — return ms timestamp (= native 측 = resume 호출 직전 측 측정).
   */
  resumeAlarm(alarmId: string): Promise<number>;
  /** 현재 등록된 알람 목록 (id + state). v1.6 T1 — 콜드스타트 alerting filter 위해 state 포함. */
  listAlarms(): Promise<AlarmInfo[]>;
  /** v1.6 Phase 10-A — App Group UserDefaults write (LA Intent 동기화). value=null 시 삭제. */
  writeAppGroupString(key: string, value: string | null): boolean;
  /** v1.6 Phase 10-A — App Group UserDefaults read. */
  readAppGroupString(key: string): string | null;
  /** v1.6 Phase 10-A — App Group UserDefaults key 삭제. */
  removeAppGroupKey(key: string): boolean;
  /** #BackupRestore Phase 2 — iCloud KV(NSUbiquitousKeyValueStore) write. value=null 시 삭제. */
  icloudSetString(key: string, value: string | null): boolean;
  /** #BackupRestore Phase 2 — iCloud KV read (캐시값; 최초엔 sync 후 download 지연 가능). */
  icloudGetString(key: string): string | null;
  /** #BackupRestore Phase 2 — iCloud KV 동기화 트리거. */
  icloudSync(): boolean;
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
    stopAlarm: async () => {},
    pauseAlarm: async () => 0,
    resumeAlarm: async () => 0,
    listAlarms: async (): Promise<AlarmInfo[]> => [],
    writeAppGroupString: () => false,
    readAppGroupString: () => null,
    removeAppGroupKey: () => false,
    icloudSetString: () => false,
    icloudGetString: () => null,
    icloudSync: () => false,
    addListener: () => ({ remove: () => {} }),
    removeListener: () => {},
  } as unknown as AlarmkitBridgeModule;
}
export default bridge;
