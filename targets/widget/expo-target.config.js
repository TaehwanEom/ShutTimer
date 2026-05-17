/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = config => ({
  type: 'widget',
  // v1.6 T3 — LiveActivity (잠금화면 + Dynamic Island) + AlarmKit Opt-B (Phase 5)
  // v1.6 Phase 10 — AlarmKit 추가 (RoutineControlIntents.swift 의 AlarmManager.pause/resume/cancel 호출용)
  frameworks: ['SwiftUI', 'WidgetKit', 'ActivityKit', 'AppIntents', 'AlarmKit'],
  // v1.7 Phase 10-G4 — WidgetBundleBuilder 측 if #available 미지원 root cause 정공 위해 18.0 → 26.0.
  //   본 widget = AlarmKit (iOS 26+) 전용 → iOS 18~25 user 측 widget extension install ❌ 영향 ❌
  //   (= 본 widget AlarmKit 사용 ❌, 직전 18.0 측 = 같은 결과 영역).
  //   supplementalActivityFamilies (= iOS 18+) 측 = 본 코드 사용 site 0건 측정 정합 (= 미래 사용 시
  //   `if #available(iOS 18.0, *)` 별도 wrapping 가능, deployment target 26.0 호환).
  //   증거 = SwiftLee + Apple Forum #762688: WidgetBundleBuilder lacks support for control flow.
  deploymentTarget: '26.0',
  // v1.8 #WatchLAIcon — Apple Watch Smart Stack 측 corner icon 측 = ShutTimer logo 정상 표시 위해 추가.
  //   직전 = widget extension 측 AppIcon 측 ❌ → system default placeholder (= 회색 사각형) 측 표시.
  //   정정 = @bacons/apple-targets 측 icon property 측 → prebuild 시 AppIcon.appiconset 자동 생성.
  icon: '../../assets/icon.png',
  entitlements: {
    // Widget ↔ App 데이터 공유 (App Group)
    'com.apple.security.application-groups': ['group.com.shuttimer.app'],
  },
});
