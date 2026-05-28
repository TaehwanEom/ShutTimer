// ShutTimer Watch App — Phase 1: 일반 타이머 단독 (= iPhone 연동 X).
// 2026-05-28 신규.
//   - SwiftUI App entry point.
//   - 단일 화면 navigation (= TimerSetupView → CountdownView → AlertView).
//   - 알림 권한 = 앱 launch 시 1회 요청.

import SwiftUI
import UserNotifications

@main
struct ShutTimerWatchApp: App {
    init() {
        // 알람 권한 측 = launch 시 1회 요청. 사용자 측 = 거부 시 = 진동만 (= 워치 기본).
        UNUserNotificationCenter.current().requestAuthorization(
            options: [.alert, .sound]
        ) { _, _ in }
    }

    var body: some Scene {
        WindowGroup {
            TimerRootView()
        }
    }
}
