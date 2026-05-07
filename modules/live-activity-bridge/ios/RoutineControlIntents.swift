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

// v1.7 hotfix #DBG — App Group UserDefaults 측 native log 저장 helper.
// Main app target — Apple 표준 = LA Intent 측 perform() 측 app process 측 실행 영역.
fileprivate let NATIVE_DBG_GROUP_LA = "group.com.shuttimer.app"
fileprivate let NATIVE_DBG_KEY_LA = "native_debug_log_v1"
fileprivate let NATIVE_DBG_MAX_LA = 300

fileprivate func appendNativeDbg(_ tag: String, _ msg: String) {
    NSLog("[\(tag)] \(msg)")
    guard let d = UserDefaults(suiteName: NATIVE_DBG_GROUP_LA) else { return }
    let ts = ISO8601DateFormatter().string(from: Date())
    let proc = ProcessInfo.processInfo.processName
    let line = "\(ts) [\(proc)][\(tag)] \(msg)"
    let existing = d.string(forKey: NATIVE_DBG_KEY_LA) ?? ""
    var lines = existing.isEmpty ? [] : existing.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
    lines.append(line)
    if lines.count > NATIVE_DBG_MAX_LA { lines = Array(lines.suffix(NATIVE_DBG_MAX_LA)) }
    d.set(lines.joined(separator: "\n"), forKey: NATIVE_DBG_KEY_LA)
}

#if canImport(AlarmKit)
import AlarmKit
import SwiftUI
#endif

// v1.7 hotfix #20 — 외부 symbol 정의 추가 (= AlarmkitBridge module + Widget target 동등 정의).
// AdvanceNextStepIntent 동기화 측 scheduleNextStepAlarmLA + stopIntent 측 사용.
@available(iOS 26.0, *)
nonisolated struct ShutTimerAlarmMetadata: AlarmMetadata {
    // ShutTimer 측 = routineId 로 매칭. metadata 자체는 비움.
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
        // v1.7 hotfix #DBG — OpenAppDismiss Intent perform 진입 (= main app target 영역).
        appendNativeDbg("Intent-DBG-LA", "OpenAppDismissIntent.perform entityId=\(entityId)")
        guard let defaults = UserDefaults(suiteName: APP_GROUP) else { return .result() }
        let signal: [String: Any] = [
            "action": "open_app_dismiss",
            "timestamp": Date().timeIntervalSince1970 * 1000,
            "routineId": entityId
        ]
        if let data = try? JSONSerialization.data(withJSONObject: signal),
           let str = String(data: data, encoding: .utf8) {
            defaults.set(str, forKey: KEY_SIGNAL)
        }
        return .result()
    }
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

// v1.6 #4-A — snapshot read 헬퍼 (chain_alarms 미사용 영역 fallback. 위젯 측과 동일 패턴).
private struct LARoutineSnapshot: Codable {
    let routineId: String
    var currentAlarmId: String
}

private func readSnapshotCurrentAlarmId(routineId: String) -> String? {
    guard let defaults = UserDefaults(suiteName: APP_GROUP) else { return nil }
    guard let raw = defaults.string(forKey: KEY_ROUTINE_SNAPSHOT),
          let data = raw.data(using: .utf8),
          let snapshot = try? JSONDecoder().decode(LARoutineSnapshot.self, from: data),
          snapshot.routineId == routineId else { return nil }
    return snapshot.currentAlarmId
}

private func clearRoutineSnapshot() {
    guard let defaults = UserDefaults(suiteName: APP_GROUP) else { return }
    defaults.removeObject(forKey: KEY_ROUTINE_SNAPSHOT)
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
        // v1.7 hotfix #DBG — Pause Intent perform 진입 (= main app target = LA Apple Watch / iPhone Button 측 영역).
        appendNativeDbg("Intent-DBG-LA", "PauseRoutineIntent.perform routineId=\(routineId)")
        // v1.7 hotfix #28 — debug log: 진입 시점.
        NSLog("[LA Pause] 진입 routineId=\(routineId)")

        // v1.6 #4-A — chain_alarms (옵션 A 폐기 후 미사용) + snapshot.currentAlarmId 둘 다 pause.
        let alarmIds = readAlarmIds(routineId: routineId)
        // v1.7 hotfix #28 — debug log: chain_alarms lookup 결과 (옵션 A 폐기 후 = 보통 빈 array).
        NSLog("[LA Pause] chain_alarms count=\(alarmIds.count) ids=\(alarmIds.joined(separator: ","))")

        // v1.7 hotfix #28 — try? silent fail 추적용. do/catch 분기 + state log.
        for idStr in alarmIds {
            if let id = UUID(uuidString: idStr) {
                let stateBefore = (try? AlarmManager.shared.alarms.first(where: { $0.id == id })?.state).flatMap { $0 }
                do {
                    try AlarmManager.shared.pause(id: id)
                    NSLog("[LA Pause] chain pause OK id=\(idStr) stateBefore=\(String(describing: stateBefore))")
                } catch {
                    NSLog("[LA Pause] chain pause THROW id=\(idStr) stateBefore=\(String(describing: stateBefore)) error=\(error)")
                }
            }
        }

        if let currentAlarmId = readSnapshotCurrentAlarmId(routineId: routineId),
           let currentUuid = UUID(uuidString: currentAlarmId) {
            // v1.7 hotfix #28 — snapshot 측 currentAlarmId pause 호출 + state log.
            let stateBefore = (try? AlarmManager.shared.alarms.first(where: { $0.id == currentUuid })?.state).flatMap { $0 }
            do {
                try AlarmManager.shared.pause(id: currentUuid)
                NSLog("[LA Pause] snapshot pause OK id=\(currentAlarmId) stateBefore=\(String(describing: stateBefore))")
            } catch {
                NSLog("[LA Pause] snapshot pause THROW id=\(currentAlarmId) stateBefore=\(String(describing: stateBefore)) error=\(error)")
            }
        } else {
            // v1.7 hotfix #28 — snapshot lookup 실패 영역 추적.
            NSLog("[LA Pause] snapshot lookup ❌ (= currentAlarmId nil 또는 routineId 불일치)")
        }

        var laUpdateCount = 0
        for activity in Activity<ShutTimerActivityAttributes>.activities {
            if activity.attributes.routineId == routineId {
                var newState = activity.content.state
                newState.paused = true
                await activity.update(.init(state: newState, staleDate: nil))
                laUpdateCount += 1
            }
        }
        NSLog("[LA Pause] LA update count=\(laUpdateCount)")

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
        // v1.7 hotfix #DBG — Resume Intent perform 진입 (= main app target).
        appendNativeDbg("Intent-DBG-LA", "ResumeRoutineIntent.perform routineId=\(routineId)")
        // v1.7 hotfix #28 — debug log: 진입 시점.
        NSLog("[LA Resume] 진입 routineId=\(routineId)")

        // v1.6 #4-A — chain_alarms + snapshot.currentAlarmId 둘 다 resume.
        let alarmIds = readAlarmIds(routineId: routineId)
        NSLog("[LA Resume] chain_alarms count=\(alarmIds.count) ids=\(alarmIds.joined(separator: ","))")

        for idStr in alarmIds {
            if let id = UUID(uuidString: idStr) {
                let stateBefore = (try? AlarmManager.shared.alarms.first(where: { $0.id == id })?.state).flatMap { $0 }
                do {
                    try AlarmManager.shared.resume(id: id)
                    NSLog("[LA Resume] chain resume OK id=\(idStr) stateBefore=\(String(describing: stateBefore))")
                } catch {
                    NSLog("[LA Resume] chain resume THROW id=\(idStr) stateBefore=\(String(describing: stateBefore)) error=\(error)")
                }
            }
        }

        if let currentAlarmId = readSnapshotCurrentAlarmId(routineId: routineId),
           let currentUuid = UUID(uuidString: currentAlarmId) {
            let stateBefore = (try? AlarmManager.shared.alarms.first(where: { $0.id == currentUuid })?.state).flatMap { $0 }
            do {
                try AlarmManager.shared.resume(id: currentUuid)
                NSLog("[LA Resume] snapshot resume OK id=\(currentAlarmId) stateBefore=\(String(describing: stateBefore))")
            } catch {
                NSLog("[LA Resume] snapshot resume THROW id=\(currentAlarmId) stateBefore=\(String(describing: stateBefore)) error=\(error)")
            }
        } else {
            NSLog("[LA Resume] snapshot lookup ❌ (= currentAlarmId nil 또는 routineId 불일치)")
        }

        var laUpdateCount = 0
        for activity in Activity<ShutTimerActivityAttributes>.activities {
            if activity.attributes.routineId == routineId {
                var newState = activity.content.state
                newState.paused = false
                await activity.update(.init(state: newState, staleDate: nil))
                laUpdateCount += 1
            }
        }
        NSLog("[LA Resume] LA update count=\(laUpdateCount)")

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
        // v1.7 hotfix #DBG — Stop Intent perform 진입 (= main app target).
        appendNativeDbg("Intent-DBG-LA", "StopRoutineIntent.perform routineId=\(routineId)")
        // v1.6 #4-A — chain_alarms + snapshot.currentAlarmId 둘 다 cancel + snapshot 정리.
        let alarmIds = readAlarmIds(routineId: routineId)
        for idStr in alarmIds {
            if let id = UUID(uuidString: idStr) {
                try? AlarmManager.shared.cancel(id: id)
            }
        }
        if let currentAlarmId = readSnapshotCurrentAlarmId(routineId: routineId),
           let currentUuid = UUID(uuidString: currentAlarmId) {
            try? AlarmManager.shared.cancel(id: currentUuid)
        }

        for activity in Activity<ShutTimerActivityAttributes>.activities {
            if activity.attributes.routineId == routineId {
                await activity.end(nil, dismissalPolicy: .immediate)
            }
        }

        if let defaults = UserDefaults(suiteName: APP_GROUP) {
            defaults.removeObject(forKey: "\(KEY_ALARM_IDS_PREFIX)\(routineId)")
        }
        // v1.6 #4-A — snapshot 정리 (RN polling 대기 없이 즉시 cleanup).
        clearRoutineSnapshot()

        writeControlSignal(action: "stop", routineId: routineId)
        return .result()
    }
}

// v1.7 hotfix #20 — AdvanceNextStepIntent 동기화 (= AlarmkitBridge module 측 + Widget target 측 동등 동작).
// 직전: 본 모듈 측 perform = signal 작성만 → AlarmKit stop / Activity.update 누락 →
// system 측 main app process 측 호출 시 동기화 안 맞음 (= 사용자 보고 = 위젯/Apple Watch 표시 싱크 ❌).
// fix: snapshot 읽기 + AlarmKit stop + 다음 step alarm 등록 + Activity.update + advance_done signal.

private struct LASnapshotStep: Codable {
    let name: String
    let durationSec: Double
    let soundName: String
}

private struct LARoutineSnapshotFull: Codable {
    let routineId: String
    let routineName: String
    var currentStepIndex: Int
    let totalSteps: Int
    let steps: [LASnapshotStep]
    var currentAlarmId: String
    var stepEndAt: Double
    let i18nConfirmPromptTitle: String
    let i18nConfirmPromptStop: String
    let i18nAdvanceLabel: String
    var savedAt: Double
    var autoCountdownSec: Double?
    var completedStepIndices: [Int]?
    var routineEnded: Bool?
    var i18nRoutineCompleteTitle: String?
}

private func readSnapshotFull() -> LARoutineSnapshotFull? {
    guard let defaults = UserDefaults(suiteName: APP_GROUP) else { return nil }
    guard let raw = defaults.string(forKey: KEY_ROUTINE_SNAPSHOT),
          let data = raw.data(using: .utf8) else { return nil }
    return try? JSONDecoder().decode(LARoutineSnapshotFull.self, from: data)
}

private func writeSnapshotFull(_ snapshot: LARoutineSnapshotFull) {
    guard let defaults = UserDefaults(suiteName: APP_GROUP) else { return }
    guard let data = try? JSONEncoder().encode(snapshot),
          let str = String(data: data, encoding: .utf8) else { return }
    defaults.set(str, forKey: KEY_ROUTINE_SNAPSHOT)
}

private func writeAdvanceDoneSignal(routineId: String) {
    guard let defaults = UserDefaults(suiteName: APP_GROUP) else { return }
    let signal: [String: Any] = [
        "action": "advance_done",
        "timestamp": Date().timeIntervalSince1970 * 1000,
        "routineId": routineId
    ]
    if let data = try? JSONSerialization.data(withJSONObject: signal),
       let str = String(data: data, encoding: .utf8) {
        defaults.set(str, forKey: KEY_SIGNAL)
    }
}

#if canImport(AlarmKit)

@available(iOS 26.0, *)
private func scheduleNextStepAlarmLA(snapshot: LARoutineSnapshotFull, nextStepIdx: Int) async throws -> UUID {
    let nextStep = snapshot.steps[nextStepIdx]
    let durationSec = max(0.001, nextStep.durationSec)
    let isLastStep = nextStepIdx + 1 >= snapshot.totalSteps
    let alertTitle: String
    if isLastStep {
        alertTitle = snapshot.i18nRoutineCompleteTitle ?? "루틴 완료"
    } else {
        alertTitle = snapshot.i18nConfirmPromptTitle + " " + snapshot.steps[nextStepIdx + 1].name
    }

    let alert: AlarmPresentation.Alert
    if #available(iOS 26.1, *) {
        if isLastStep {
            alert = AlarmPresentation.Alert(
                title: LocalizedStringResource(stringLiteral: alertTitle)
            )
        } else {
            let secondaryButton = AlarmButton(
                text: LocalizedStringResource(stringLiteral: snapshot.i18nAdvanceLabel),
                textColor: .white,
                systemImageName: "forward.fill"
            )
            alert = AlarmPresentation.Alert(
                title: LocalizedStringResource(stringLiteral: alertTitle),
                secondaryButton: secondaryButton,
                secondaryButtonBehavior: .custom
            )
        }
    } else {
        let stopButton = AlarmButton(
            text: LocalizedStringResource(stringLiteral: snapshot.i18nConfirmPromptStop),
            textColor: .white,
            systemImageName: "stop.fill"
        )
        if isLastStep {
            alert = AlarmPresentation.Alert(
                title: LocalizedStringResource(stringLiteral: alertTitle),
                stopButton: stopButton
            )
        } else {
            let secondaryButton = AlarmButton(
                text: LocalizedStringResource(stringLiteral: snapshot.i18nAdvanceLabel),
                textColor: .white,
                systemImageName: "forward.fill"
            )
            alert = AlarmPresentation.Alert(
                title: LocalizedStringResource(stringLiteral: alertTitle),
                stopButton: stopButton,
                secondaryButton: secondaryButton,
                secondaryButtonBehavior: .custom
            )
        }
    }

    let pauseButton = AlarmButton(
        text: LocalizedStringResource(stringLiteral: "일시정지"),
        textColor: .white,
        systemImageName: "pause.fill"
    )
    let resumeButton = AlarmButton(
        text: LocalizedStringResource(stringLiteral: "재개"),
        textColor: .white,
        systemImageName: "play.fill"
    )
    let countdownContent = AlarmPresentation.Countdown(
        title: LocalizedStringResource(stringLiteral: alertTitle),
        pauseButton: pauseButton
    )
    let pausedContent = AlarmPresentation.Paused(
        title: LocalizedStringResource(stringLiteral: "일시정지됨"),
        resumeButton: resumeButton
    )
    let presentation = AlarmPresentation(
        alert: alert,
        countdown: countdownContent,
        paused: pausedContent
    )
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
    let config: AlarmManager.AlarmConfiguration<ShutTimerAlarmMetadata>
    if isLastStep {
        config = .timer(
            duration: durationSec,
            attributes: attributes,
            stopIntent: OpenAppDismissIntent(entityId: snapshot.routineId),
            sound: alertSound
        )
    } else {
        config = .timer(
            duration: durationSec,
            attributes: attributes,
            stopIntent: OpenAppDismissIntent(entityId: snapshot.routineId),
            secondaryIntent: AdvanceNextStepIntent(routineId: snapshot.routineId),
            sound: alertSound
        )
    }
    _ = try await AlarmManager.shared.schedule(id: id, configuration: config)
    return id
}

#endif

// v1.6 Phase 12 — 위젯 "다음 진행" Button. v1.7 hotfix #20 — AlarmkitBridge module 측 + Widget target 측 동등 동작 동기화.
@available(iOS 26.0, *)
struct AdvanceNextStepIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "다음 진행"
    static var authenticationPolicy: IntentAuthenticationPolicy = .alwaysAllowed

    @Parameter(title: "Routine ID")
    var routineId: String

    init() { self.routineId = "" }
    init(routineId: String) { self.routineId = routineId }

    func perform() async throws -> some IntentResult {
        // v1.7 hotfix #DBG — Advance Intent perform 진입 (= main app target).
        appendNativeDbg("Intent-DBG-LA", "AdvanceNextStepIntent.perform routineId=\(routineId)")
        // v1.7 hotfix #20 — main app process 측 perform 호출 시 = AlarmKit stop / Activity.update 동기화.
        // 직전: signal 작성만 → JS thread background 시 polling 처리 ❌ → 위젯/Apple Watch 표시 싱크 안맞음.
        guard var snapshot = readSnapshotFull() else {
            // snapshot 미존재 fallback — RN active 시 polling 처리.
            writeControlSignal(action: "advance", routineId: routineId)
            return .result()
        }
        let effectiveRoutineId = !routineId.isEmpty ? routineId : snapshot.routineId
        if !routineId.isEmpty && snapshot.routineId != routineId {
            writeControlSignal(action: "advance", routineId: routineId)
            return .result()
        }

        // 1. 현재 alerting alarm stop (사운드 + 진동 + alerting UI dismiss).
        if let currentUuid = UUID(uuidString: snapshot.currentAlarmId) {
            try? await AlarmManager.shared.stop(id: currentUuid)
            try? await AlarmManager.shared.cancel(id: currentUuid)
        }

        let completedIdx = snapshot.currentStepIndex
        let nextIdx = snapshot.currentStepIndex + 1

        // 2. 마지막 step → routineEnded=true + LA end + advance_done signal.
        if nextIdx >= snapshot.totalSteps {
            var prev = snapshot.completedStepIndices ?? []
            prev.append(completedIdx)
            snapshot.completedStepIndices = prev
            snapshot.routineEnded = true
            snapshot.savedAt = Date().timeIntervalSince1970 * 1000.0
            writeSnapshotFull(snapshot)
            for activity in Activity<ShutTimerActivityAttributes>.activities {
                if activity.attributes.routineId == effectiveRoutineId {
                    await activity.end(nil, dismissalPolicy: .immediate)
                }
            }
            writeAdvanceDoneSignal(routineId: effectiveRoutineId)
            return .result()
        }

        // 3. 다음 step alarm 등록 + snapshot 갱신 + LA 즉시 update.
        do {
            let newId = try await scheduleNextStepAlarmLA(snapshot: snapshot, nextStepIdx: nextIdx)
            var prev = snapshot.completedStepIndices ?? []
            prev.append(completedIdx)
            snapshot.completedStepIndices = prev
            snapshot.currentStepIndex = nextIdx
            snapshot.currentAlarmId = newId.uuidString
            let nowMs = Date().timeIntervalSince1970 * 1000.0
            snapshot.stepEndAt = nowMs + snapshot.steps[nextIdx].durationSec * 1000.0
            snapshot.savedAt = nowMs
            writeSnapshotFull(snapshot)

            let nextStepName = snapshot.steps[nextIdx].name
            for activity in Activity<ShutTimerActivityAttributes>.activities {
                if activity.attributes.routineId == effectiveRoutineId {
                    var newState = activity.content.state
                    newState.currentStepName = nextStepName
                    newState.progress = 0
                    newState.paused = false
                    newState.currentStepIndex = nextIdx
                    newState.totalSteps = snapshot.totalSteps
                    newState.stage = "step"
                    newState.stepEndAt = snapshot.stepEndAt
                    await activity.update(.init(state: newState, staleDate: nil))
                }
            }

            writeAdvanceDoneSignal(routineId: effectiveRoutineId)
        } catch {
            // schedule 실패 — RN polling fallback.
            writeControlSignal(action: "advance", routineId: effectiveRoutineId)
        }
        return .result()
    }
}
