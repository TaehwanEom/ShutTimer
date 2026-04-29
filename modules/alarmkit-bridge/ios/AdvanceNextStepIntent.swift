// v1.6 hotfix — AlarmKit confirm_prompt alerting UI 의 secondary button 결합용 LiveActivityIntent.
// 사용자가 잠금화면 풀스크린 알람 UI 에서 "다음 진행" 누름 → perform() 호출.
//
// v1.6 hotfix2 — native 측 직접 다음 step alarm 등록 (RN setInterval 백그라운드 정지 우회).
//   1. App Group "routine_snapshot" 읽기
//   2. AlarmManager.shared.stop(currentAlarmId) — 사운드/진동 정지 + alerting UI dismiss
//   3. 마지막 step → cleanup signal write + 종료
//   4. 다음 step alarm 등록 (AlarmManager.shared.schedule) — confirm_prompt + secondaryIntent 결합
//   5. routine_snapshot 갱신 (currentStepIndex+1, currentAlarmId, stepEndAt)
//   6. la_control_signal write { action: 'advance_done', routineId } — RN active 시 ar/LA 동기화
//
// modules/live-activity-bridge/ios/RoutineControlIntents.swift 의 AdvanceNextStepIntent 와 동일 패턴.
// 본 모듈 namespace 분리 정의 — 두 모듈이 main app target 에 동시 link 되어도 Swift type system 으로
// 분리 (LiveActivityBridge.AdvanceNextStepIntent vs AlarmkitBridge.AdvanceNextStepIntent).
// AppIntents 가 분리 식별해도 perform() 결과 (App Group write + alarm scheduling) 가 동일해 동작 정합 보장.

import AppIntents
import Foundation

#if canImport(AlarmKit)
import AlarmKit
import SwiftUI
#endif

#if canImport(ActivityKit)
import ActivityKit
#endif

private let APP_GROUP = "group.com.shuttimer.app"
private let KEY_SIGNAL = "la_control_signal"
private let KEY_ROUTINE_SNAPSHOT = "routine_snapshot"

// MARK: - Snapshot decoding (RN 측 RoutineSnapshot 정합)

private struct SnapshotStep: Codable {
    let name: String
    let durationSec: Double
    let soundName: String
}

private struct RoutineSnapshot: Codable {
    let routineId: String
    let routineName: String
    var currentStepIndex: Int
    let totalSteps: Int
    let steps: [SnapshotStep]
    var currentAlarmId: String
    var stepEndAt: Double
    let i18nConfirmPromptTitle: String
    let i18nConfirmPromptStop: String
    let i18nAdvanceLabel: String
    var savedAt: Double
    // v1.6 hotfix — "다음 루틴 진행" 후 다음 step 시작 전 대기 시간 (초). 0~60 clamp.
    // optional = 이전 snapshot 디코딩 호환. nil 시 default 5 사용.
    var autoCountdownSec: Double?
    // v1.6 hotfix B2-2 — RN syncRoutineFromSnapshot flush 대상. optional = 기존 디코딩 호환.
    var completedStepIndices: [Int]?
    var routineEnded: Bool?
}

// MARK: - App Group helpers

private func readSnapshot() -> RoutineSnapshot? {
    guard let defaults = UserDefaults(suiteName: APP_GROUP) else { return nil }
    guard let raw = defaults.string(forKey: KEY_ROUTINE_SNAPSHOT),
          let data = raw.data(using: .utf8) else { return nil }
    return try? JSONDecoder().decode(RoutineSnapshot.self, from: data)
}

private func writeSnapshot(_ snapshot: RoutineSnapshot) {
    guard let defaults = UserDefaults(suiteName: APP_GROUP) else { return }
    guard let data = try? JSONEncoder().encode(snapshot),
          let str = String(data: data, encoding: .utf8) else { return }
    defaults.set(str, forKey: KEY_ROUTINE_SNAPSHOT)
}

private func clearSnapshot() {
    guard let defaults = UserDefaults(suiteName: APP_GROUP) else { return }
    defaults.removeObject(forKey: KEY_ROUTINE_SNAPSHOT)
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

private func writeAdvanceFallbackSignal(routineId: String) {
    // snapshot 미존재 / decode 실패 / iOS<26 fallback — RN active 시 polling 처리하도록 'advance' write
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

// MARK: - Native 측 다음 step alarm 등록

#if canImport(AlarmKit)

@available(iOS 26.0, *)
private func scheduleNextStepAlarm(snapshot: RoutineSnapshot, nextStepIdx: Int) async throws -> UUID {
    let nextStep = snapshot.steps[nextStepIdx]
    let durationMs = nextStep.durationSec * 1000.0
    // v1.6 hotfix — 다음 step 시작 전 대기 시간 (autoCountdownSec). default 5초. 0~60 clamp.
    let countdownSec = max(0.0, min(60.0, snapshot.autoCountdownSec ?? 5.0))
    let nextFireAtMs = Date().timeIntervalSince1970 * 1000.0 + countdownSec * 1000.0 + durationMs
    let nextFireDate = Date(timeIntervalSince1970: nextFireAtMs / 1000.0)
    let schedule = Alarm.Schedule.fixed(nextFireDate)

    // v1.6 hotfix B1 — alerting UI title 에 다음 step name 추가 ("다음 루틴 조깅" 형식).
    // 본 alarm 종료 시 alerting → 다음 진행 step = nextStepIdx+1. 마지막 시 nil.
    let titleSuffix: String
    if nextStepIdx + 1 < snapshot.totalSteps {
        titleSuffix = " " + snapshot.steps[nextStepIdx + 1].name
    } else {
        titleSuffix = ""
    }
    let alertTitle = snapshot.i18nConfirmPromptTitle + titleSuffix

    // confirm_prompt + secondaryButton ("다음 진행") 결합 — 기존 AlarmkitBridgeModule.swift 정합.
    let alert: AlarmPresentation.Alert
    if #available(iOS 26.1, *) {
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
            title: LocalizedStringResource(stringLiteral: alertTitle),
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

#endif

// MARK: - Intent

@available(iOS 26.0, *)
struct AdvanceNextStepIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "다음 진행"
    static var authenticationPolicy: IntentAuthenticationPolicy = .alwaysAllowed

    @Parameter(title: "Routine ID")
    var routineId: String

    init() { self.routineId = "" }
    init(routineId: String) { self.routineId = routineId }

    func perform() async throws -> some IntentResult {
        // 1. snapshot 로드
        guard var snapshot = readSnapshot(),
              snapshot.routineId == routineId else {
            // snapshot 미존재 / mismatch — RN polling fallback (앱 active 시 처리)
            writeAdvanceFallbackSignal(routineId: routineId)
            return .result()
        }

        // 2. 현재 alerting alarm stop (사운드 + 진동 + alerting UI dismiss)
        if let currentUuid = UUID(uuidString: snapshot.currentAlarmId) {
            try? AlarmManager.shared.stop(id: currentUuid)
        }

        let completedIdx = snapshot.currentStepIndex
        let nextIdx = snapshot.currentStepIndex + 1

        // 3. 마지막 step → routineEnded=true + completed push + snapshot 보존 (RN sync 가 cleanup)
        if nextIdx >= snapshot.totalSteps {
            var prev = snapshot.completedStepIndices ?? []
            prev.append(completedIdx)
            snapshot.completedStepIndices = prev
            snapshot.routineEnded = true
            snapshot.savedAt = Date().timeIntervalSince1970 * 1000.0
            writeSnapshot(snapshot)
            writeAdvanceDoneSignal(routineId: routineId)
            return .result()
        }

        // 4. 다음 step alarm 등록
        do {
            let newId = try await scheduleNextStepAlarm(snapshot: snapshot, nextStepIdx: nextIdx)
            // 5. snapshot 갱신 — completedStepIndices 에 이전 step 누적 (RN flush 대상)
            var prev = snapshot.completedStepIndices ?? []
            prev.append(completedIdx)
            snapshot.completedStepIndices = prev
            snapshot.currentStepIndex = nextIdx
            snapshot.currentAlarmId = newId.uuidString
            // v1.6 hotfix — autoCountdownSec 반영. 다음 step 종료 시점 = countdown + duration 후.
            let countdownSec = max(0.0, min(60.0, snapshot.autoCountdownSec ?? 5.0))
            let nowMs = Date().timeIntervalSince1970 * 1000.0
            snapshot.stepEndAt = nowMs + countdownSec * 1000.0 + snapshot.steps[nextIdx].durationSec * 1000.0
            snapshot.savedAt = nowMs
            writeSnapshot(snapshot)
            // 6. RN polling 측 'advance_done' 신호 (active 시 ar/LA 동기화)
            writeAdvanceDoneSignal(routineId: routineId)
        } catch {
            // schedule 실패 — RN polling fallback
            writeAdvanceFallbackSignal(routineId: routineId)
        }
        return .result()
    }
}
