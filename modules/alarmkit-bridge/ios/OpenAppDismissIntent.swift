// v1.6 hotfix — AlarmKit timer_main alarm 의 stopIntent 로 결합.
// iOS 26.1+ slide-to-stop UI 사용자 누름 시 perform() 호출 → supportedModes [.foreground(.immediate)]
// 으로 앱 자동 foreground 진입 → App Group "la_control_signal" 에 open_app_dismiss action 작성.
// RN 측 LAControl polling (App.tsx) 가 1초 안에 읽어 navigate('Alarm') 호출.
// → AlarmScreen 진입 → 사용자 dismiss method (탭/흔들기/카메라) 정공 정합.
//
// supportedModes = [.foreground(.immediate)] 가 iOS 26+ 권장 패턴 (openAppWhenRun deprecated 대체).

import AppIntents
import Foundation

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

    @Parameter(title: "Routine ID")
    var routineId: String

    init() { self.routineId = "" }
    init(routineId: String) { self.routineId = routineId }

    func perform() async throws -> some IntentResult {
        writeOpenAppDismissSignal(routineId: routineId)
        return .result()
    }
}
