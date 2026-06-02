/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = config => ({
  type: 'watch',
  // 워치 홈/앱 이름 표기 = "ShutTimer" (없으면 폴더명 'watch'로 표기됨).
  displayName: 'ShutTimer',
  // Apple WatchKit 규칙 정합 (= watch app ID는 메인 com.shuttimer.app extend 필수).
  bundleIdentifier: 'com.shuttimer.app.watchkitapp',
  // ShutTimer 측 메인 icon 측 정합 (= 단일 App Store binary).
  icon: '../../assets/icon.png',
  colors: {
    $accent: '#FF6B35', // ShutTimer 오렌지
  },
  // watchOS 11+ (= 최신 SwiftUI + WKExtendedRuntimeSession + UNUserNotificationCenter).
  deploymentTarget: '11.0',
  entitlements: {
    // Phase 1 = 일반 타이머 측 = 단독 동작 (= iPhone sync X). 추가 entitlements 측 X.
  },
});
