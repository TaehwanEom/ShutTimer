import { NativeModule, requireNativeModule } from 'expo';
import type {
  LiveActivityStartParams,
  LiveActivityUpdateParams,
  LiveActivityEndParams,
} from './LiveActivityBridge.types';

declare class LiveActivityBridgeModule extends NativeModule {
  /** iOS 16.2+ + 사용자 권한 활성. false 면 호출자가 silent skip. */
  areActivitiesEnabled(): boolean;
  /** 신규 LiveActivity 시작 → activityId 반환. iOS 16.2+ 외 throw. */
  start(params: LiveActivityStartParams): Promise<string>;
  /** ContentState 갱신. 미존재 activityId 면 noop. */
  update(params: LiveActivityUpdateParams): Promise<void>;
  /** 종료. 미존재 activityId 면 noop. */
  end(params: LiveActivityEndParams): Promise<void>;
  /** 모든 ShutTimer LiveActivity 즉시 종료 (강제 cleanup). */
  endAll(): Promise<void>;
}

// Native binary 미포함 (Expo Go / 구 dev client) 환경 → app init throw 회피.
// stub: areActivitiesEnabled() = false 라서 호출처가 자동으로 silent skip.
let bridge: LiveActivityBridgeModule;
try {
  bridge = requireNativeModule<LiveActivityBridgeModule>('LiveActivityBridge');
} catch {
  bridge = {
    areActivitiesEnabled: () => false,
    start: async () => '',
    update: async () => {},
    end: async () => {},
    endAll: async () => {},
    addListener: () => ({ remove: () => {} }),
    removeListener: () => {},
  } as unknown as LiveActivityBridgeModule;
}
export default bridge;
