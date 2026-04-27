/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = config => ({
  type: 'widget',
  // v1.6 T3 — LiveActivity (잠금화면 + Dynamic Island) + AlarmKit Opt-B (Phase 5)
  frameworks: ['SwiftUI', 'WidgetKit', 'ActivityKit', 'AppIntents'],
  // §15.2 #2 — default 18.0 → 명시적 16.2 (ActivityKit iOS 16.1+, AlarmKit Opt-B iOS 26+ 분기)
  deploymentTarget: '16.2',
  entitlements: {
    // Widget ↔ App 데이터 공유 (App Group)
    'com.apple.security.application-groups': ['group.com.shuttimer.app'],
  },
});
