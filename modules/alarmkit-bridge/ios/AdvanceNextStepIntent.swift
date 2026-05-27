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
import SharedAlarmTypes
import SwiftUI
#endif

#if canImport(ActivityKit)
import ActivityKit
#endif

private let APP_GROUP = "group.com.shuttimer.app"
private let KEY_SIGNAL = "la_control_signal"
private let KEY_ROUTINE_SNAPSHOT = "routine_snapshot"

// v1.7 hotfix #DBG — App Group UserDefaults 측 native log 저장 helper.
fileprivate let NATIVE_DBG_KEY_ADV = "native_debug_log_v1"
fileprivate let NATIVE_DBG_MAX_ADV = 300

fileprivate func appendNativeDbg(_ tag: String, _ msg: String) {
    NSLog("[\(tag)] \(msg)")
    guard let d = UserDefaults(suiteName: APP_GROUP) else { return }
    let ts = ISO8601DateFormatter().string(from: Date())
    let proc = ProcessInfo.processInfo.processName
    let line = "\(ts) [\(proc)][\(tag)] \(msg)"
    let existing = d.string(forKey: NATIVE_DBG_KEY_ADV) ?? ""
    var lines = existing.isEmpty ? [] : existing.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
    lines.append(line)
    if lines.count > NATIVE_DBG_MAX_ADV { lines = Array(lines.suffix(NATIVE_DBG_MAX_ADV)) }
    d.set(lines.joined(separator: "\n"), forKey: NATIVE_DBG_KEY_ADV)
}

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
    // v1.6 — 마지막 step alerting UI title. optional = 이전 snapshot 호환.
    var i18nRoutineCompleteTitle: String?
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
    let durationSec = max(0.001, nextStep.durationSec)

    // v1.6 hotfix B1 — alerting UI title 에 다음 step name 추가 ("다음 루틴 조깅" 형식).
    // 본 alarm 종료 시 alerting → 다음 진행 step = nextStepIdx+1. 마지막 시 nil.
    // v1.6 #13 — 본 alarm 자체가 마지막 step (nextStepIdx == totalSteps - 1) 이면 secondary "다음 진행" 제거.
    let isLastStep = nextStepIdx + 1 >= snapshot.totalSteps
    // v1.6 — 마지막 step alerting = "루틴 완료" (snapshot.i18nRoutineCompleteTitle), 일반 = "다음 루틴 [step name]"
    let alertTitle: String
    if isLastStep {
        alertTitle = snapshot.i18nRoutineCompleteTitle ?? "루틴 완료"
    } else {
        alertTitle = snapshot.i18nConfirmPromptTitle + " " + snapshot.steps[nextStepIdx + 1].name
    }

    // v1.6 #13 — 마지막 step alerting UI = "밀어서 중단" 만 (secondary 제거). 일반 = stopButton + secondary 결합.
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

    // v1.6 옵션 C 통합 — .timer(duration:) + Countdown/Paused presentation (pause API 호환).
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
    // v1.7 hotfix #LAUnify Phase 4 — metadata 측 step 데이터 명시 영역.
    // v1.8 #LARelevanceMatch — alarmId 측 = updateActivityRelevance 측 매칭 키 영역.
    let id = UUID()
    let metadata = ShutTimerAlarmMetadata(
        currentStepName: nextStep.name,
        currentStepIndex: nextStepIdx,
        totalSteps: snapshot.totalSteps,
        stage: "step",
        paused: false,
        pausedAt: nil,
        routineId: snapshot.routineId,
        routineName: snapshot.routineName,
        alarmId: id.uuidString
    )
    let attributes = AlarmAttributes<ShutTimerAlarmMetadata>(
        presentation: presentation,
        metadata: metadata,
        tintColor: Color.red
    )

    let alertSound: AlertConfiguration.AlertSound
    if !nextStep.soundName.isEmpty {
        alertSound = .named(nextStep.soundName)
    } else {
        alertSound = .default
    }
    // v1.8 #LARelevanceMatch — id 측 = metadata 측 이전 영역 이동 (= 위 영역).
    // v1.6 #13 — 마지막 step = secondaryIntent 제거. stopIntent: OpenAppDismissIntent 만 (밀어서 중단 → 앱 진입 + routine 정지).
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
            secondaryIntent: AdvanceNextStepIntent(entityId: snapshot.routineId),
            sound: alertSound
        )
    }
    _ = try await AlarmManager.shared.schedule(id: id, configuration: config)
    return id
}

#endif

// MARK: - Intent

// v2.0 #AdvanceDebounce (2026-05-28) — 동일 routineId 측 1.5초 내 중복 perform 차단.
//   직전 = confirm_prompt 중복 / 다중 alerting / 다중 press 시 = AdvanceNextStepIntent 다중 발화 →
//   각 호출이 snapshot.currentStepIndex 증가 → 마지막 step 도달 시 routineEnded=true 강제 → step skip + 조기 종료.
//   정정 = static dictionary 측 [entityId: lastPerformAt] 측 lookup → 1.5초 이내 = skip + return (= 멱등 처리).
fileprivate let ADVANCE_DEBOUNCE_MS: Double = 1500.0
fileprivate let advanceDebounceLock = NSLock()
fileprivate var lastAdvancePerformAt: [String: Double] = [:]

fileprivate func shouldDebounceAdvance(entityId: String) -> Bool {
    let nowMs = Date().timeIntervalSince1970 * 1000.0
    advanceDebounceLock.lock()
    defer { advanceDebounceLock.unlock() }
    if let last = lastAdvancePerformAt[entityId], nowMs - last < ADVANCE_DEBOUNCE_MS {
        return true
    }
    lastAdvancePerformAt[entityId] = nowMs
    return false
}

@available(iOS 26.0, *)
struct AdvanceNextStepIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "다음 진행"
    static var authenticationPolicy: IntentAuthenticationPolicy = .alwaysAllowed

    @Parameter(title: "Entity ID")
    var entityId: String

    init() { self.entityId = "" }
    init(entityId: String) { self.entityId = entityId }

    func perform() async throws -> some IntentResult {
        // v1.7 hotfix #DBG — Advance Intent perform 진입 (= alarmkit module = AlarmKit secondary button 측).
        appendNativeDbg("Intent-DBG-AlarmKit", "AdvanceNextStepIntent.perform entityId=\(entityId)")
        // v2.0 #AdvanceDebounce (2026-05-28) — 1.5초 내 중복 perform 차단.
        //   debounce key = entityId. 빈 entityId 측 = snapshot.routineId 측 fallback 전이라 임시 키 사용 (= 너무 보수적이지 X).
        let debounceKey = entityId.isEmpty ? "__empty__" : entityId
        if shouldDebounceAdvance(entityId: debounceKey) {
            appendNativeDbg("Intent-DBG-AlarmKit", "AdvanceNextStepIntent debounce SKIP entityId=\(entityId)")
            return .result()
        }
        // 1. snapshot 로드.
        // v1.7 hotfix #11 — entityId 측 snapshot 측 fallback (= AppIntent @Parameter setting 측 race / fail 회피).
        // Apple AppIntents 측 = perform() 시 시스템 측 새 instance 생성 → init() 호출 → @Parameter setting.
        // setting 측 fail 시 init() default entityId='' 잔존 → snapshot 매칭 ❌ → fallback signal 측 routineId='' write.
        // → snapshot.routineId 측 신뢰 (= 활성 routine 측 단일 가정 정합).
        guard var snapshot = readSnapshot() else {
            writeAdvanceFallbackSignal(routineId: entityId)
            return .result()
        }
        let effectiveEntityId = !entityId.isEmpty ? entityId : snapshot.routineId
        if !entityId.isEmpty && snapshot.routineId != entityId {
            writeAdvanceFallbackSignal(routineId: entityId)
            return .result()
        }

        // 2. 현재 alerting alarm stop (사운드 + 진동 + alerting UI dismiss).
        // v1.7 hotfix — stop + cancel 둘 다 시도 (= state transition race 시 silent fail 회피).
        if let currentUuid = UUID(uuidString: snapshot.currentAlarmId) {
            try? await AlarmManager.shared.stop(id: currentUuid)
            try? await AlarmManager.shared.cancel(id: currentUuid)
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
            // v1.7 hotfix #LAUnify Phase 10-G1 — Activity<ShutTimerActivityAttributes> manual end 제거.
            // 마지막 step alerting → AlarmKit framework가 LA Activity 자동 종료.
            writeAdvanceDoneSignal(routineId: effectiveEntityId)
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
            // v1.6 — 5초 대기 제거. 다음 step 종료 시점 = duration 후.
            let nowMs = Date().timeIntervalSince1970 * 1000.0
            snapshot.stepEndAt = nowMs + snapshot.steps[nextIdx].durationSec * 1000.0
            snapshot.savedAt = nowMs
            writeSnapshot(snapshot)

            // v1.7 hotfix #LAUnify Phase 10-G1 — Activity<ShutTimerActivityAttributes> manual update 제거.
            // 새 alarm schedule (= scheduleNextStepAlarm) → AlarmKit framework가 새 LA Activity 자동 시작.
            // 새 metadata (= ShutTimerAlarmMetadata) → AlarmKitLiveActivity widget 자동 갱신.

            // 6. RN polling 측 'advance_done' 신호 (active 시 ar/LA 동기화)
            writeAdvanceDoneSignal(routineId: effectiveEntityId)
        } catch {
            // schedule 실패 — RN polling fallback
            writeAdvanceFallbackSignal(routineId: effectiveEntityId)
        }
        return .result()
    }
}
