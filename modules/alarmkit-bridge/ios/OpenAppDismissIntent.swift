// v1.6 hotfix — AlarmKit timer_main alarm 의 stopIntent 로 결합.
// iOS 26.1+ slide-to-stop UI 사용자 누름 시 perform() 호출 → supportedModes [.foreground(.immediate)]
// 으로 앱 자동 foreground 진입 → App Group "la_control_signal" 에 open_app_dismiss action 작성.
// RN 측 LAControl polling (App.tsx) 가 1초 안에 읽어 navigate('Alarm') 호출.
// → AlarmScreen 진입 → 사용자 dismiss method (탭/흔들기/카메라) 정공 정합.
//
// supportedModes = [.foreground(.immediate)] 가 iOS 26+ 권장 패턴 (openAppWhenRun deprecated 대체).

import AppIntents
import Foundation
#if canImport(AlarmKit)
import AlarmKit
#endif

private let APP_GROUP = "group.com.shuttimer.app"
private let KEY_SIGNAL = "la_control_signal"

private func writeOpenAppDismissSignal(routineId: String) {
    guard let defaults = UserDefaults(suiteName: APP_GROUP) else { return }
    let signal: [String: Any] = [
        "action": "open_app_dismiss",
        "timestamp": Date().timeIntervalSince1970 * 1000,
        "routineId": routineId
    ]
    if let data = try? JSONSerialization.data(withJSONObject: signal),
       let str = String(data: data, encoding: .utf8) {
        defaults.set(str, forKey: KEY_SIGNAL)
    }
}

@available(iOS 26.0, *)
struct OpenAppDismissIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "앱에서 종료"
    static var supportedModes: IntentModes = [.foreground(.immediate)]
    static var authenticationPolicy: IntentAuthenticationPolicy = .alwaysAllowed

    @Parameter(title: "Entity ID")
    var entityId: String

    init() { self.entityId = "" }
    init(entityId: String) { self.entityId = entityId }

    func perform() async throws -> some IntentResult {
        // (= 카테고리 D 측 signal JSON key "routineId" 보존, 호출 시 값 = entityId)
        writeOpenAppDismissSignal(routineId: entityId)

        // v1.7 hotfix #23 — AlarmKit alerting alarm 명시 stop 호출.
        // 누락 시 = `.foreground(.immediate)` 모드는 앱 foreground 진입만 처리 = AlarmKit alarm 자체는 alerting 잔존
        //   = iOS 시스템 측 alerting banner UI 잔존 (= 사용자 dismiss method 완료 시점까지 베너 안 사라짐).
        // 패턴 = AlarmkitBridgeModule.cancelAlarm 측 동일 (= alerting state filter → stop, Apple AlarmKit 공식).
        #if canImport(AlarmKit)
        if let alarms = try? AlarmManager.shared.alarms {
            for alarm in alarms where alarm.state == .alerting {
                try? await AlarmManager.shared.stop(id: alarm.id)
            }
        }
        #endif

        return .result()
    }
}
