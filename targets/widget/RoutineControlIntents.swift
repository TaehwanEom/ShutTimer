// v1.6 Phase 10-B — LiveActivity 안 사용자 입력 컨트롤 (정지 / 일시정지 / 재개).
// Widget Extension target — Button(intent:) 호출 대상.
//
// 가드 분기:
//   Intent struct  = unconditional (= widget extension deployment target 26.0, Phase 10-G4 정합)
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

// v1.7 hotfix #DBG — App Group UserDefaults 측 native log 저장 helper.
// Widget target — LA Button perform() 측 = iPhone + Apple Watch Smart Stack 양쪽 호출 영역.
fileprivate let NATIVE_DBG_GROUP_W = "group.com.shuttimer.app"
fileprivate let NATIVE_DBG_KEY_W = "native_debug_log_v1"
fileprivate let NATIVE_DBG_MAX_W = 300

fileprivate func appendNativeDbg(_ tag: String, _ msg: String) {
    NSLog("[\(tag)] \(msg)")
    guard let d = UserDefaults(suiteName: NATIVE_DBG_GROUP_W) else { return }
    let ts = ISO8601DateFormatter().string(from: Date())
    let proc = ProcessInfo.processInfo.processName
    let line = "\(ts) [\(proc)][\(tag)] \(msg)"
    let existing = d.string(forKey: NATIVE_DBG_KEY_W) ?? ""
    var lines = existing.isEmpty ? [] : existing.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
    lines.append(line)
    if lines.count > NATIVE_DBG_MAX_W { lines = Array(lines.suffix(NATIVE_DBG_MAX_W)) }
    d.set(lines.joined(separator: "\n"), forKey: NATIVE_DBG_KEY_W)
}

#if canImport(AlarmKit)
import AlarmKit
import SharedAlarmTypes
import SwiftUI
#endif

// v1.7 hotfix #LAUnify Phase 10-G2 — ShutTimerAlarmMetadata struct 단일 정의 = `modules/shared-alarm-types/ios/ShutTimerAlarmMetadata.swift`.
// `import SharedAlarmTypes` 측 = ActivityKit framework 측 widget lookup 정합 위해 단일 Swift module identity 보장.

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
    // v1.6 hotfix — "다음 루틴 진행" 후 다음 step 시작 전 대기 시간 (초). 0~60 clamp.
    // optional = 이전 snapshot 디코딩 호환. nil 시 default 5 사용.
    var autoCountdownSec: Double?
    // v1.6 hotfix B2-2 — RN syncRoutineFromSnapshot flush 대상. optional = 기존 디코딩 호환.
    var completedStepIndices: [Int]?
    var routineEnded: Bool?
    // v1.6 — 마지막 step alerting UI title. optional = 이전 snapshot 호환.
    var i18nRoutineCompleteTitle: String?
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

struct PauseRoutineIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "일시정지"
    // 잠금 상태에서 비번/Face ID 해제 없이 perform 가능. iPhone 기본 타이머 동급.
    static var authenticationPolicy: IntentAuthenticationPolicy = .alwaysAllowed

    @Parameter(title: "Routine ID")
    var routineId: String

    init() { self.routineId = "" }
    init(routineId: String) { self.routineId = routineId }

    func perform() async throws -> some IntentResult {
        // v1.7 hotfix #DBG — Pause Intent perform 진입 (= LA Button = iPhone + Apple Watch 양쪽).
        appendNativeDbg("Intent-DBG-Widget", "PauseRoutineIntent.perform routineId=\(routineId)")
        // v1.7 hotfix #LAUnify Phase 10-G4dbg5 — widget extension process 측 type fully qualified name 측정.
        // main app process 측 (= AlarmkitBridgeModule schedule 측) 같은 측정 → 직접 비교.
        // 두 process 측 type name 같음 = static_framework 측 cause 아님 → 다른 cause 측정 필요
        // 두 process 측 type name 다름 = static_framework 측 별도 instance build 확정 → 정정 진입
        let typeName = String(describing: AlarmAttributes<ShutTimerAlarmMetadata>.self)
        let metadataTypeName = String(describing: ShutTimerAlarmMetadata.self)
        appendNativeDbg("LA-DBG-AKLA-Type", "widget process AlarmAttributes type=\(typeName) metadata type=\(metadataTypeName)")
        // v1.7 hotfix #LAUnify Phase 10-G4dbg4 — widget extension process 측 Activity.activities 측정.
        // main app 측 active 1건 ✅ 측정. widget extension process 측 = active count + ID 측정 →
        // 0건 시 = type identity mismatch (= main app 측 SharedAlarmTypes vs widget 측 SharedAlarmTypes 측 다른 module identity)
        // 1건 시 = type identity 정합 + widget body 측 = 다른 cause (= ActivityConfiguration registration level)
        let activities = Activity<AlarmAttributes<ShutTimerAlarmMetadata>>.activities
        let activitiesDesc = activities.map { "\($0.id):\($0.activityState)" }.joined(separator: ",")
        appendNativeDbg("LA-DBG-AKLA-WidgetActivity", "PauseIntent widget process Activity.activities.count=\(activities.count) [\(activitiesDesc)] routineId=\(routineId)")
        // v1.6 #4-A — chain_alarms 영역 (옵션 A 폐기 후 미사용) + snapshot.currentAlarmId 둘 다 처리.
        let alarmIds = readAlarmIds(routineId: routineId)
        for idStr in alarmIds {
            if let id = UUID(uuidString: idStr) {
                try? AlarmManager.shared.pause(id: id)
            }
        }
        if let snapshot = readRoutineSnapshot(),
           snapshot.routineId == routineId,
           let currentUuid = UUID(uuidString: snapshot.currentAlarmId) {
            try? AlarmManager.shared.pause(id: currentUuid)
        }

        // v1.7 hotfix #LAUnify Phase 10-G1 — Activity<ShutTimerActivityAttributes> manual update 제거.
        // AlarmKit framework `.pause(id:)` API가 자동으로 mode=.paused 전이 + AlarmKitLiveActivity widget 자동 갱신.

        writeControlSignal(action: "pause", routineId: routineId)
        return .result()
    }
}

struct ResumeRoutineIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "재개"
    static var authenticationPolicy: IntentAuthenticationPolicy = .alwaysAllowed

    @Parameter(title: "Routine ID")
    var routineId: String

    init() { self.routineId = "" }
    init(routineId: String) { self.routineId = routineId }

    func perform() async throws -> some IntentResult {
        // v1.7 hotfix #DBG — Resume Intent perform 진입.
        appendNativeDbg("Intent-DBG-Widget", "ResumeRoutineIntent.perform routineId=\(routineId)")
        // v1.6 #4-A — chain_alarms 영역 + snapshot.currentAlarmId 둘 다 처리.
        let alarmIds = readAlarmIds(routineId: routineId)
        for idStr in alarmIds {
            if let id = UUID(uuidString: idStr) {
                try? AlarmManager.shared.resume(id: id)
            }
        }
        if let snapshot = readRoutineSnapshot(),
           snapshot.routineId == routineId,
           let currentUuid = UUID(uuidString: snapshot.currentAlarmId) {
            try? AlarmManager.shared.resume(id: currentUuid)
        }

        // v1.7 hotfix — Resume 시 native 측 stepEndAt 직접 shift (= RN polling 의존 ❌ 영역).
        // 이전 = paused=false 만 토글 → stepEndAt = 일시정지 직전 시각 잔존 → 위젯 = safeStepEndDate (= max(end, now+0.01))
        // v1.7 hotfix #LAUnify Phase 10-G1 — Activity<ShutTimerActivityAttributes> manual update 제거.
        // AlarmKit framework `.resume(id:)` API가 자동으로 mode=.countdown 전이 + 시간 누적 + AlarmKitLiveActivity widget 자동 갱신.

        writeControlSignal(action: "resume", routineId: routineId)
        return .result()
    }
}

struct StopRoutineIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "정지"
    static var authenticationPolicy: IntentAuthenticationPolicy = .alwaysAllowed

    @Parameter(title: "Routine ID")
    var routineId: String

    init() { self.routineId = "" }
    init(routineId: String) { self.routineId = routineId }

    func perform() async throws -> some IntentResult {
        // v1.7 hotfix #DBG — Stop Intent perform 진입.
        appendNativeDbg("Intent-DBG-Widget", "StopRoutineIntent.perform routineId=\(routineId)")
        // v1.6 #4-A — chain_alarms 영역 + snapshot.currentAlarmId 둘 다 cancel.
        // (chain_alarms 미사용 케이스 = snapshot 만 cancel → 다음 step alerting fire 차단)
        let alarmIds = readAlarmIds(routineId: routineId)
        for idStr in alarmIds {
            if let id = UUID(uuidString: idStr) {
                try? AlarmManager.shared.cancel(id: id)
            }
        }
        if let snapshot = readRoutineSnapshot(),
           snapshot.routineId == routineId,
           let currentUuid = UUID(uuidString: snapshot.currentAlarmId) {
            try? AlarmManager.shared.cancel(id: currentUuid)
        }

        // v1.7 hotfix #LAUnify Phase 10-G1 — Activity<ShutTimerActivityAttributes> manual end 제거.
        // AlarmKit framework `.cancel(id:)` API가 자동으로 LA Activity 종료.

        if let defaults = UserDefaults(suiteName: APP_GROUP) {
            defaults.removeObject(forKey: "\(KEY_ALARM_IDS_PREFIX)\(routineId)")
        }
        // v1.6 #4-A — snapshot 정리 (RN polling 대기 없이 위젯 측 즉시 cleanup).
        clearRoutineSnapshot()

        writeControlSignal(action: "stop", routineId: routineId)
        return .result()
    }
}

// v1.6 hotfix — LA Button "다음 진행" (잠금화면 / Dynamic Island).
// AlarmKit alerting UI secondary button (modules/alarmkit-bridge/ios/AdvanceNextStepIntent.swift) 와 동일 native 처리.
// RN setInterval 백그라운드 정지 우회 — perform() 안에서 직접 alarm stop + 다음 step schedule.
private func scheduleNextStepAlarm(snapshot: WidgetRoutineSnapshot, nextStepIdx: Int) async throws -> UUID {
    let nextStep = snapshot.steps[nextStepIdx]
    let durationSec = max(0.001, nextStep.durationSec)

    // v1.6 — 마지막 step alerting = "루틴 완료" (snapshot.i18nRoutineCompleteTitle), 일반 = "다음 루틴 [step name]"
    let alertTitle: String
    if nextStepIdx + 1 < snapshot.totalSteps {
        alertTitle = snapshot.i18nConfirmPromptTitle + " " + snapshot.steps[nextStepIdx + 1].name
    } else {
        alertTitle = snapshot.i18nRoutineCompleteTitle ?? "루틴 완료"
    }

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
    let metadata = ShutTimerAlarmMetadata(
        currentStepName: nextStep.name,
        currentStepIndex: nextStepIdx,
        totalSteps: snapshot.totalSteps,
        stage: "step",
        paused: false,
        pausedAt: nil,
        routineId: snapshot.routineId,
        routineName: snapshot.routineName
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

    let id = UUID()
    let config: AlarmManager.AlarmConfiguration<ShutTimerAlarmMetadata> = .timer(
        duration: durationSec,
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
struct AdvanceNextStepIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "다음 진행"
    static var authenticationPolicy: IntentAuthenticationPolicy = .alwaysAllowed

    @Parameter(title: "Routine ID")
    var routineId: String

    init() { self.routineId = "" }
    init(routineId: String) { self.routineId = routineId }

    func perform() async throws -> some IntentResult {
        // v1.7 hotfix #DBG — Advance Intent perform 진입 (= 위젯 "다음 진행" Button 측 = iPhone + Apple Watch).
        appendNativeDbg("Intent-DBG-Widget", "AdvanceNextStepIntent.perform routineId=\(routineId) emptyEntry=\(routineId.isEmpty)")
        // v1.7 hotfix #11 — routineId 측 snapshot 측 fallback (= AppIntent @Parameter setting 측 race / fail 회피).
        // Apple AppIntents 측 = perform() 시 시스템 측 새 instance 생성 → init() 호출 → @Parameter setting.
        // 만약 setting 측 fail (= deserialize race) → init() default routineId='' 잔존 → snapshot 매칭 ❌.
        // → snapshot.routineId 측 신뢰 (= 활성 routine 측 단일 가정 정합).
        guard var snapshot = readRoutineSnapshot() else {
            // snapshot 미존재 — fallback: 'advance' signal (RN active 시 advanceRoutineFromLA)
            appendNativeDbg("Intent-DBG-Widget", "AdvanceNextStepIntent.perform — snapshot nil → signal fallback routineId=\(routineId)")
            writeControlSignal(action: "advance", routineId: routineId)
            return .result()
        }
        let effectiveRoutineId = !routineId.isEmpty ? routineId : snapshot.routineId
        // v1.7 hotfix #AdvanceIntentDbg — entryRoutineId / snapshotRoutineId / effective 추적 (= 빈 entryRoutineId root cause 식별용).
        appendNativeDbg("Intent-DBG-Widget", "AdvanceNextStepIntent.perform — entryRoutineId=\(routineId) snapshotRoutineId=\(snapshot.routineId) effective=\(effectiveRoutineId) fallback=\(routineId.isEmpty ? "yes" : "no")")
        // routineId 명시 + snapshot mismatch 시 = 별 routine 측 의도 → fallback.
        if !routineId.isEmpty && snapshot.routineId != routineId {
            appendNativeDbg("Intent-DBG-Widget", "AdvanceNextStepIntent.perform — routineId mismatch → signal fallback routineId=\(routineId) snapshot=\(snapshot.routineId)")
            writeControlSignal(action: "advance", routineId: routineId)
            return .result()
        }

        // 1. 현재 alerting alarm stop (사운드/진동/UI dismiss).
        // v1.7 hotfix — stop + cancel 둘 다 시도 (= state transition race 시 silent fail 회피).
        if let currentUuid = UUID(uuidString: snapshot.currentAlarmId) {
            try? await AlarmManager.shared.stop(id: currentUuid)
            try? await AlarmManager.shared.cancel(id: currentUuid)
        }

        let completedIdx = snapshot.currentStepIndex
        let nextIdx = snapshot.currentStepIndex + 1

        // 2. 마지막 step → routineEnded + completed push + snapshot 보존 (RN sync 가 cleanup)
        if nextIdx >= snapshot.totalSteps {
            var prev = snapshot.completedStepIndices ?? []
            prev.append(completedIdx)
            snapshot.completedStepIndices = prev
            snapshot.routineEnded = true
            snapshot.savedAt = Date().timeIntervalSince1970 * 1000.0
            writeRoutineSnapshot(snapshot)
            // v1.7 hotfix #LAUnify Phase 10-G1 — Activity<ShutTimerActivityAttributes> manual end 제거.
            // 마지막 step alerting → AlarmKit framework가 alarm cancel/stop 시 LA Activity 자동 종료.
            writeControlSignal(action: "advance_done", routineId: effectiveRoutineId)
            return .result()
        }

        // 3. 다음 step alarm 등록
        do {
            let newId = try await scheduleNextStepAlarm(snapshot: snapshot, nextStepIdx: nextIdx)
            var prev = snapshot.completedStepIndices ?? []
            prev.append(completedIdx)
            snapshot.completedStepIndices = prev
            snapshot.currentStepIndex = nextIdx
            snapshot.currentAlarmId = newId.uuidString
            // v1.6 — 5초 대기 제거. 다음 step 종료 = duration 후.
            let nowMs = Date().timeIntervalSince1970 * 1000.0
            snapshot.stepEndAt = nowMs + snapshot.steps[nextIdx].durationSec * 1000.0
            snapshot.savedAt = nowMs
            writeRoutineSnapshot(snapshot)

            // v1.7 hotfix #LAUnify Phase 10-G1 — Activity<ShutTimerActivityAttributes> manual update 제거.
            // 새 alarm schedule (= scheduleNextStepAlarm) → AlarmKit framework가 새 LA Activity 자동 시작.
            // 새 metadata (= ShutTimerAlarmMetadata) → AlarmKitLiveActivity widget 자동 갱신.

            writeControlSignal(action: "advance_done", routineId: effectiveRoutineId)
        } catch {
            // schedule 실패 — RN polling fallback
            writeControlSignal(action: "advance", routineId: effectiveRoutineId)
        }
        return .result()
    }
}
