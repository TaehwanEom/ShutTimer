// v1.6 Phase 10-B — LiveActivityIntent 정의 (App target).
// Apple 표준 패턴: LiveActivityIntent struct = App + Widget target 양쪽 정의 필수.
// 양쪽 정의 시 system 이 app process 에서 perform() 실행 (LiveActivityIntent 의 핵심 동작).
//
// targets/widget/RoutineControlIntents.swift 와 동일 정의. 한쪽 변경 시 양쪽 동기화 필수.

import AppIntents
import Foundation

#if canImport(ActivityKit)
import ActivityKit
#endif

#if canImport(AlarmKit)
import AlarmKit
#endif

private let APP_GROUP = "group.com.shuttimer.app"
private let KEY_SIGNAL = "la_control_signal"
private let KEY_ALARM_IDS_PREFIX = "chain_alarms_"

private func readAlarmIds(routineId: String) -> [String] {
    guard let defaults = UserDefaults(suiteName: APP_GROUP) else { return [] }
    let key = "\(KEY_ALARM_IDS_PREFIX)\(routineId)"
    guard let raw = defaults.string(forKey: key),
          let data = raw.data(using: .utf8),
          let ids = try? JSONDecoder().decode([String].self, from: data) else {
        return []
    }
    return ids
}

private func writeControlSignal(action: String, routineId: String) {
    guard let defaults = UserDefaults(suiteName: APP_GROUP) else { return }
    let signal: [String: Any] = [
        "action": action,
        "timestamp": Date().timeIntervalSince1970 * 1000,
        "routineId": routineId
    ]
    if let data = try? JSONSerialization.data(withJSONObject: signal),
       let str = String(data: data, encoding: .utf8) {
        defaults.set(str, forKey: KEY_SIGNAL)
    }
}

@available(iOS 26.0, *)
struct PauseRoutineIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "일시정지"
    // 잠금 상태에서 비번/Face ID 해제 없이 perform 가능. iPhone 기본 타이머 동급.
    static var authenticationPolicy: IntentAuthenticationPolicy = .alwaysAllowed

    @Parameter(title: "Routine ID")
    var routineId: String

    init() { self.routineId = "" }
    init(routineId: String) { self.routineId = routineId }

    func perform() async throws -> some IntentResult {
        let alarmIds = readAlarmIds(routineId: routineId)
        for idStr in alarmIds {
            if let id = UUID(uuidString: idStr) {
                try? AlarmManager.shared.pause(id: id)
            }
        }

        for activity in Activity<ShutTimerActivityAttributes>.activities {
            if activity.attributes.routineId == routineId {
                var newState = activity.content.state
                newState.paused = true
                await activity.update(.init(state: newState, staleDate: nil))
            }
        }

        writeControlSignal(action: "pause", routineId: routineId)
        return .result()
    }
}

@available(iOS 26.0, *)
struct ResumeRoutineIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "재개"
    static var authenticationPolicy: IntentAuthenticationPolicy = .alwaysAllowed

    @Parameter(title: "Routine ID")
    var routineId: String

    init() { self.routineId = "" }
    init(routineId: String) { self.routineId = routineId }

    func perform() async throws -> some IntentResult {
        let alarmIds = readAlarmIds(routineId: routineId)
        for idStr in alarmIds {
            if let id = UUID(uuidString: idStr) {
                try? AlarmManager.shared.resume(id: id)
            }
        }

        for activity in Activity<ShutTimerActivityAttributes>.activities {
            if activity.attributes.routineId == routineId {
                var newState = activity.content.state
                newState.paused = false
                await activity.update(.init(state: newState, staleDate: nil))
            }
        }

        writeControlSignal(action: "resume", routineId: routineId)
        return .result()
    }
}

@available(iOS 26.0, *)
struct StopRoutineIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "정지"
    static var authenticationPolicy: IntentAuthenticationPolicy = .alwaysAllowed

    @Parameter(title: "Routine ID")
    var routineId: String

    init() { self.routineId = "" }
    init(routineId: String) { self.routineId = routineId }

    func perform() async throws -> some IntentResult {
        let alarmIds = readAlarmIds(routineId: routineId)
        for idStr in alarmIds {
            if let id = UUID(uuidString: idStr) {
                try? AlarmManager.shared.cancel(id: id)
            }
        }

        for activity in Activity<ShutTimerActivityAttributes>.activities {
            if activity.attributes.routineId == routineId {
                await activity.end(nil, dismissalPolicy: .immediate)
            }
        }

        if let defaults = UserDefaults(suiteName: APP_GROUP) {
            defaults.removeObject(forKey: "\(KEY_ALARM_IDS_PREFIX)\(routineId)")
        }

        writeControlSignal(action: "stop", routineId: routineId)
        return .result()
    }
}

// v1.6 Phase 12 — 위젯 "다음 진행" Button. D-3 양쪽 동일 정의.
@available(iOS 26.0, *)
struct AdvanceNextStepIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "다음 진행"
    static var authenticationPolicy: IntentAuthenticationPolicy = .alwaysAllowed

    @Parameter(title: "Routine ID")
    var routineId: String

    init() { self.routineId = "" }
    init(routineId: String) { self.routineId = routineId }

    func perform() async throws -> some IntentResult {
        writeControlSignal(action: "advance", routineId: routineId)
        return .result()
    }
}
