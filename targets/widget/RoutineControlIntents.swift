// v1.6 Phase 10-B — LiveActivity 안 사용자 입력 컨트롤 (정지 / 일시정지 / 재개).
// Widget Extension target — Button(intent:) 호출 대상.
//
// 가드 분기:
//   Intent struct  = @available(iOS 26.0, *)  — LiveActivityIntent + Button(intent:) 사용 영역
//   AlarmKit 호출 = if #available(iOS 26.0, *) — AlarmManager.shared.pause/resume/cancel
//   Activity API  = iOS 16.2+ (LiveActivity 자체)
//
// LiveActivityIntent.perform() 안에서:
//   1. App Group 의 alarmIds[] read
//   2. (iOS 26+) AlarmKit pause/resume/cancel — Apple 표준 API
//   3. Activity.update / end (paused 토글 또는 종료)
//   4. App Group 의 control signal write (RN polling 동기화)

import AppIntents
import Foundation

#if canImport(ActivityKit)
import ActivityKit
#endif

#if canImport(AlarmKit)
import AlarmKit
import SwiftUI
#endif

// v1.6 hotfix — main app target 의 ShutTimerAlarmMetadata (AlarmkitBridgeModule.swift) 와 동일 정의.
// metadata 자체가 비어있어 두 target 정의 동일 = Codable 호환.
@available(iOS 26.0, *)
nonisolated struct ShutTimerAlarmMetadata: AlarmMetadata {
    // 비어있음 — main app target 정의와 정합
}

private let APP_GROUP = "group.com.shuttimer.app"
private let KEY_SIGNAL = "la_control_signal"
private let KEY_ALARM_IDS_PREFIX = "chain_alarms_"
private let KEY_ROUTINE_SNAPSHOT = "routine_snapshot"

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

// MARK: - v1.6 hotfix — routine_snapshot Codable (LA Button "다음 진행" native 처리용)

private struct WidgetSnapshotStep: Codable {
    let name: String
    let durationSec: Double
    let soundName: String
}

private struct WidgetRoutineSnapshot: Codable {
    let routineId: String
    let routineName: String
    var currentStepIndex: Int
    let totalSteps: Int
    let steps: [WidgetSnapshotStep]
    var currentAlarmId: String
    var stepEndAt: Double
    let i18nConfirmPromptTitle: String
    let i18nConfirmPromptStop: String
    let i18nAdvanceLabel: String
    var savedAt: Double
}

private func readRoutineSnapshot() -> WidgetRoutineSnapshot? {
    guard let defaults = UserDefaults(suiteName: APP_GROUP) else { return nil }
    guard let raw = defaults.string(forKey: KEY_ROUTINE_SNAPSHOT),
          let data = raw.data(using: .utf8) else { return nil }
    return try? JSONDecoder().decode(WidgetRoutineSnapshot.self, from: data)
}

private func writeRoutineSnapshot(_ snapshot: WidgetRoutineSnapshot) {
    guard let defaults = UserDefaults(suiteName: APP_GROUP) else { return }
    guard let data = try? JSONEncoder().encode(snapshot),
          let str = String(data: data, encoding: .utf8) else { return }
    defaults.set(str, forKey: KEY_ROUTINE_SNAPSHOT)
}

private func clearRoutineSnapshot() {
    guard let defaults = UserDefaults(suiteName: APP_GROUP) else { return }
    defaults.removeObject(forKey: KEY_ROUTINE_SNAPSHOT)
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

// v1.6 hotfix — LA Button "다음 진행" (잠금화면 / Dynamic Island).
// AlarmKit alerting UI secondary button (modules/alarmkit-bridge/ios/AdvanceNextStepIntent.swift) 와 동일 native 처리.
// RN setInterval 백그라운드 정지 우회 — perform() 안에서 직접 alarm stop + 다음 step schedule.
@available(iOS 26.0, *)
private func scheduleNextStepAlarm(snapshot: WidgetRoutineSnapshot, nextStepIdx: Int) async throws -> UUID {
    let nextStep = snapshot.steps[nextStepIdx]
    let durationMs = nextStep.durationSec * 1000.0
    let nextFireAtMs = Date().timeIntervalSince1970 * 1000.0 + durationMs
    let nextFireDate = Date(timeIntervalSince1970: nextFireAtMs / 1000.0)
    let schedule = Alarm.Schedule.fixed(nextFireDate)

    let alert: AlarmPresentation.Alert
    if #available(iOS 26.1, *) {
        let secondaryButton = AlarmButton(
            text: LocalizedStringResource(stringLiteral: snapshot.i18nAdvanceLabel),
            textColor: .white,
            systemImageName: "forward.fill"
        )
        alert = AlarmPresentation.Alert(
            title: LocalizedStringResource(stringLiteral: snapshot.i18nConfirmPromptTitle),
            secondaryButton: secondaryButton,
            secondaryButtonBehavior: .custom
        )
    } else {
        let stopButton = AlarmButton(
            text: LocalizedStringResource(stringLiteral: snapshot.i18nConfirmPromptStop),
            textColor: .white,
            systemImageName: "stop.fill"
        )
        let secondaryButton = AlarmButton(
            text: LocalizedStringResource(stringLiteral: snapshot.i18nAdvanceLabel),
            textColor: .white,
            systemImageName: "forward.fill"
        )
        alert = AlarmPresentation.Alert(
            title: LocalizedStringResource(stringLiteral: snapshot.i18nConfirmPromptTitle),
            stopButton: stopButton,
            secondaryButton: secondaryButton,
            secondaryButtonBehavior: .custom
        )
    }
    let presentation = AlarmPresentation(alert: alert)
    let attributes = AlarmAttributes<ShutTimerAlarmMetadata>(
        presentation: presentation,
        tintColor: Color.red
    )

    let alertSound: AlertConfiguration.AlertSound
    if !nextStep.soundName.isEmpty {
        alertSound = .named(nextStep.soundName)
    } else {
        alertSound = .default
    }

    let id = UUID()
    let config: AlarmManager.AlarmConfiguration<ShutTimerAlarmMetadata> = .alarm(
        schedule: schedule,
        attributes: attributes,
        stopIntent: AdvanceNextStepIntent(routineId: snapshot.routineId),
        secondaryIntent: AdvanceNextStepIntent(routineId: snapshot.routineId),
        sound: alertSound
    )
    _ = try await AlarmManager.shared.schedule(id: id, configuration: config)
    return id
}

// v1.6 Phase 12 + hotfix — 위젯 "다음 진행" Button. 수동 모드 alerting 후 사용자 누름 = 다음 step 진행.
// native 측 직접 처리 (RN setInterval 백그라운드 정지 우회):
//   1. snapshot 읽기 → 2. 현재 alarm stop → 3. 마지막 step ? cleanup : 다음 step schedule
//   4. snapshot 갱신 → 5. 'advance_done' signal write (RN active 시 ar/LA 동기화)
@available(iOS 26.0, *)
struct AdvanceNextStepIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "다음 진행"
    static var authenticationPolicy: IntentAuthenticationPolicy = .alwaysAllowed

    @Parameter(title: "Routine ID")
    var routineId: String

    init() { self.routineId = "" }
    init(routineId: String) { self.routineId = routineId }

    func perform() async throws -> some IntentResult {
        guard var snapshot = readRoutineSnapshot(),
              snapshot.routineId == routineId else {
            // snapshot 미존재 / mismatch — fallback: 'advance' signal (RN active 시 advanceRoutineFromLA)
            writeControlSignal(action: "advance", routineId: routineId)
            return .result()
        }

        // 1. 현재 alerting alarm stop (사운드/진동/UI dismiss)
        if let currentUuid = UUID(uuidString: snapshot.currentAlarmId) {
            try? AlarmManager.shared.stop(id: currentUuid)
        }

        let nextIdx = snapshot.currentStepIndex + 1

        // 2. 마지막 step → cleanup + 종료 signal
        if nextIdx >= snapshot.totalSteps {
            clearRoutineSnapshot()
            writeControlSignal(action: "advance_done", routineId: routineId)
            return .result()
        }

        // 3. 다음 step alarm 등록
        do {
            let newId = try await scheduleNextStepAlarm(snapshot: snapshot, nextStepIdx: nextIdx)
            snapshot.currentStepIndex = nextIdx
            snapshot.currentAlarmId = newId.uuidString
            snapshot.stepEndAt = Date().timeIntervalSince1970 * 1000.0
                + snapshot.steps[nextIdx].durationSec * 1000.0
            snapshot.savedAt = Date().timeIntervalSince1970 * 1000.0
            writeRoutineSnapshot(snapshot)
            writeControlSignal(action: "advance_done", routineId: routineId)
        } catch {
            // schedule 실패 — RN polling fallback
            writeControlSignal(action: "advance", routineId: routineId)
        }
        return .result()
    }
}
