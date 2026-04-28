/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = config => ({
  type: 'widget',
  // v1.6 T3 — LiveActivity (잠금화면 + Dynamic Island) + AlarmKit Opt-B (Phase 5)
  // v1.6 Phase 10 — AlarmKit 추가 (RoutineControlIntents.swift 의 AlarmManager.pause/resume/cancel 호출용)
  frameworks: ['SwiftUI', 'WidgetKit', 'ActivityKit', 'AppIntents', 'AlarmKit'],
  // v1.6 Phase 11 — supplementalActivityFamilies API (iOS 18+) 사용 위해 16.2 → 18.0.
  // iOS 17.x 디바이스 = Widget extension disable + LA 자체 손실 (사용자 결정 옵션 A).
  deploymentTarget: '18.0',
  entitlements: {
    // Widget ↔ App 데이터 공유 (App Group)
    'com.apple.security.application-groups': ['group.com.shuttimer.app'],
  },
});
