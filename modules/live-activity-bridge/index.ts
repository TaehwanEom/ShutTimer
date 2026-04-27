// Live Activity bridge — iOS 16.2+ ActivityKit. Android = stub.
// JS 측에서 areActivitiesEnabled() 체크 후 사용. 미지원 시 silent skip.

import LiveActivityBridge from './src/LiveActivityBridgeModule';

export * from './src/LiveActivityBridge.types';
export default LiveActivityBridge;
