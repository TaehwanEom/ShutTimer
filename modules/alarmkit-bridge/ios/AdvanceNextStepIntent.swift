// v1.6 hotfix — AlarmKit confirm_prompt alerting UI 의 secondary button 결합용 LiveActivityIntent.
// 사용자가 잠금화면 풀스크린 알람 UI 에서 "다음 진행" 누름 → perform() 호출.
// App Group "la_control_signal" key 에 {action:'advance', routineId} JSON 작성.
// RN 측 LAControl polling (App.tsx) 가 1초 안에 읽어 advanceRoutineFromLA(routineId) 호출.
//
// modules/live-activity-bridge/ios/RoutineControlIntents.swift 의 AdvanceNextStepIntent 와 동일 패턴.
// 본 모듈 namespace 분리 정의 — 두 모듈이 main app target 에 동시 link 되어도 Swift type system 으로
// 분리 (LiveActivityBridge.AdvanceNextStepIntent vs AlarmkitBridge.AdvanceNextStepIntent).
// AppIntents 가 분리 식별해도 perform() 결과 (App Group write) 가 동일해 동작 정합 보장.

import AppIntents
import Foundation

private let APP_GROUP = "group.com.shuttimer.app"
private let KEY_SIGNAL = "la_control_signal"

private func writeAdvanceSignal(routineId: String) {
    guard let defaults = UserDefaults(suiteName: APP_GROUP) else { return }
    let signal: [String: Any] = [
        "action": "advance",
        "timestamp": Date().timeIntervalSince1970 * 1000,
        "routineId": routineId
    ]
    if let data = try? JSONSerialization.data(withJSONObject: signal),
       let str = String(data: data, encoding: .utf8) {
        defaults.set(str, forKey: KEY_SIGNAL)
    }
}

@available(iOS 26.0, *)
struct AdvanceNextStepIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "다음 진행"
    static var authenticationPolicy: IntentAuthenticationPolicy = .alwaysAllowed

    @Parameter(title: "Routine ID")
    var routineId: String

    init() { self.routineId = "" }
    init(routineId: String) { self.routineId = routineId }

    func perform() async throws -> some IntentResult {
        writeAdvanceSignal(routineId: routineId)
        return .result()
    }
}
