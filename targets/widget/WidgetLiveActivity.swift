import ActivityKit
import WidgetKit
import SwiftUI
import AppIntents
import AlarmKit
import SharedAlarmTypes

// v1.6 Phase 10 — ShutTimer 기본 색상 (#ff2424). app.json color 와 일관성.
private extension Color {
    static let brand = Color(red: 1.0, green: 36.0 / 255.0, blue: 36.0 / 255.0)
}

// v1.7 hotfix #DBG — App Group UserDefaults 측 native log 저장 helper. (= AlarmkitBridgeModule.swift 정합)
// 다중 기기 (= iPhone + Apple Watch Smart Stack) 측 = process 측 자체 storage → 각 device 측 앱 내 공유.
// throttle 측 = 1초 (= compactView/WatchView render 폭주 회피).
fileprivate let NATIVE_DBG_GROUP = "group.com.shuttimer.app"
fileprivate let NATIVE_DBG_KEY = "native_debug_log_v1"
fileprivate let NATIVE_DBG_MAX = 300
fileprivate let NATIVE_DBG_THROTTLE_KEY = "native_debug_lastwrite_widget"
fileprivate let NATIVE_DBG_THROTTLE_MS: Double = 1000

fileprivate func appendNativeDbgWidget(_ tag: String, _ msg: String, throttle: Bool = false) {
    NSLog("[\(tag)] \(msg)")
    guard let d = UserDefaults(suiteName: NATIVE_DBG_GROUP) else { return }
    if throttle {
        let nowMs = Date().timeIntervalSince1970 * 1000
        let lastKey = "\(NATIVE_DBG_THROTTLE_KEY)_\(tag)"
        let last = d.double(forKey: lastKey)
        if nowMs - last < NATIVE_DBG_THROTTLE_MS { return }
        d.set(nowMs, forKey: lastKey)
    }
    let ts = ISO8601DateFormatter().string(from: Date())
    let proc = ProcessInfo.processInfo.processName
    let line = "\(ts) [\(proc)][\(tag)] \(msg)"
    let existing = d.string(forKey: NATIVE_DBG_KEY) ?? ""
    var lines = existing.isEmpty ? [] : existing.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
    lines.append(line)
    if lines.count > NATIVE_DBG_MAX { lines = Array(lines.suffix(NATIVE_DBG_MAX)) }
    d.set(lines.joined(separator: "\n"), forKey: NATIVE_DBG_KEY)
}

// v1.7 hotfix #LAUnify Phase 9-A 진단 — AlarmPresentationState.Mode 측 String 변환 helper.
// dbg log 측 mode 분기 + associated value 핵심 데이터 명시용.
@available(iOS 26.0, *)
fileprivate func akModeString(_ mode: AlarmPresentationState.Mode) -> String {
    switch mode {
    case .countdown(let c):
        return "countdown(fire=\(Int(c.fireDate.timeIntervalSince1970 * 1000)))"
    case .paused(let p):
        return "paused(total=\(p.totalCountdownDuration) elapsed=\(p.previouslyElapsedDuration))"
    case .alert:
        return "alert"
    }
}

// v1.7 hotfix #LAUnify Phase 6 — AlarmKit framework 자동 LA Activity 전용 widget.
//   AlarmkitBridge / AdvanceNextStepIntent / RoutineControlIntents 측 = .timer(duration:attributes:)
//   factory 호출 → Activity<AlarmAttributes<ShutTimerAlarmMetadata>> 자동 시작 영역.
//   직전 = 본 widget 미등록 → system default layout 표시 (= 카운터 ❌ root cause).
//   본 commit = ActivityConfiguration(for: AlarmAttributes<ShutTimerAlarmMetadata>.self) 등록 →
//   Lock Screen + Dynamic Island 측 정합 layout 표시.
@available(iOS 26.0, *)
struct AlarmKitLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: AlarmAttributes<ShutTimerAlarmMetadata>.self) { context in
            // Lock Screen view
            AlarmKitLockScreenView(context: context)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(context.attributes.metadata?.routineName ?? "타이머")
                            .font(.caption)
                            .foregroundColor(.brand)
                            .lineLimit(1)
                        AlarmKitCountdownText(context: context, fontStyle: .title2.weight(.bold))
                    }
                }
                DynamicIslandExpandedRegion(.trailing) {
                    AlarmKitTrailingButtons(context: context)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    AlarmKitStepBottomLabel(context: context)
                }
            } compactLeading: {
                Text(context.attributes.metadata?.routineName ?? "타이머")
                    .font(.caption2)
                    .foregroundColor(.brand)
                    .lineLimit(1)
            } compactTrailing: {
                AlarmKitCompactTrailingView(context: context)
            } minimal: {
                if case .paused = context.state.mode {
                    Image(systemName: "pause.fill").foregroundColor(.brand)
                } else {
                    Image(systemName: "timer").foregroundColor(.brand)
                }
            }
            .keylineTint(Color.brand)
        }
    }
}

// MARK: - AlarmKit LA helpers (= AlarmPresentationState.Mode 분기 + metadata 사용)

@available(iOS 26.0, *)
struct AlarmKitLockScreenView: View {
    let context: ActivityViewContext<AlarmAttributes<ShutTimerAlarmMetadata>>

    var body: some View {
        // v1.7 hotfix #LAUnify Phase 9-A 진단 — AlarmKit LA widget body 진입 + state.mode 값 native log.
        // 사용자분 보고 = paused 시 "검정 바만 표시" → 본 widget body 호출 여부 + mode 분기 확인용.
        let _ = { appendNativeDbgWidget("LA-DBG-AKLA", "AlarmKitLockScreenView render mode=\(akModeString(context.state.mode)) routineName=\(context.attributes.metadata?.routineName ?? "nil") routineId=\(context.attributes.metadata?.routineId ?? "nil")", throttle: true) }()
        HStack(spacing: 12) {
            HStack(alignment: .center, spacing: 8) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(context.attributes.metadata?.routineName ?? "타이머")
                        .font(.caption)
                        .foregroundColor(.brand)
                        .lineLimit(1)
                    if let total = context.attributes.metadata?.totalSteps, total > 1,
                       let stepName = context.attributes.metadata?.currentStepName, !stepName.isEmpty {
                        let idx = (context.attributes.metadata?.currentStepIndex ?? 0) + 1
                        Text("\(stepName) (\(idx)/\(total))")
                            .font(.caption2)
                            .foregroundColor(.white.opacity(0.75))
                            .lineLimit(1)
                    }
                }
                AlarmKitCountdownText(context: context, fontStyle: .system(size: 56, weight: .bold))
            }
            Spacer()
            Button(intent: StopRoutineIntent(routineId: context.attributes.metadata?.routineId ?? "")) {
                Image(systemName: "xmark")
                    .font(.title3.weight(.bold))
                    .foregroundColor(.white)
                    .frame(width: 44, height: 44)
                    .background(Circle().fill(Color.gray.opacity(0.6)))
            }
            .buttonStyle(.plain)
            AlarmKitPauseResumeButton(context: context)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .frame(minHeight: 76)
        .activityBackgroundTint(Color.black.opacity(0.85))
        .activitySystemActionForegroundColor(Color.white)
    }
}

@available(iOS 26.0, *)
struct AlarmKitCountdownText: View {
    let context: ActivityViewContext<AlarmAttributes<ShutTimerAlarmMetadata>>
    let fontStyle: Font

    var body: some View {
        let _ = { appendNativeDbgWidget("LA-DBG-AKLA", "AlarmKitCountdownText render mode=\(akModeString(context.state.mode))", throttle: true) }()
        switch context.state.mode {
        case .countdown(let countdown):
            Text(timerInterval: countdown.startDate...countdown.fireDate, countsDown: true)
                .monospacedDigit()
                .font(fontStyle)
                .foregroundColor(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
        case .paused:
            Text("일시정지")
                .font(fontStyle)
                .foregroundColor(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.4)
        case .alert:
            Text("알람")
                .font(fontStyle)
                .foregroundColor(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
        }
    }
}

@available(iOS 26.0, *)
struct AlarmKitCompactTrailingView: View {
    let context: ActivityViewContext<AlarmAttributes<ShutTimerAlarmMetadata>>

    var body: some View {
        switch context.state.mode {
        case .countdown(let countdown):
            Text(timerInterval: countdown.startDate...countdown.fireDate, countsDown: true)
                .monospacedDigit()
                .frame(maxWidth: 50)
        case .paused:
            Image(systemName: "pause.fill").foregroundColor(.brand)
        case .alert:
            Image(systemName: "bell.fill").foregroundColor(.brand)
        }
    }
}

@available(iOS 26.0, *)
struct AlarmKitTrailingButtons: View {
    let context: ActivityViewContext<AlarmAttributes<ShutTimerAlarmMetadata>>

    var body: some View {
        HStack(spacing: 6) {
            Button(intent: StopRoutineIntent(routineId: context.attributes.metadata?.routineId ?? "")) {
                Image(systemName: "xmark.circle.fill")
                    .font(.title2)
                    .foregroundColor(.gray)
            }
            .buttonStyle(.plain)
            AlarmKitPauseResumeButton(context: context)
        }
    }
}

@available(iOS 26.0, *)
struct AlarmKitPauseResumeButton: View {
    let context: ActivityViewContext<AlarmAttributes<ShutTimerAlarmMetadata>>

    var body: some View {
        let routineId = context.attributes.metadata?.routineId ?? ""
        let _ = { appendNativeDbgWidget("LA-DBG-AKLA", "AlarmKitPauseResumeButton render mode=\(akModeString(context.state.mode)) routineId=\(routineId)", throttle: true) }()
        switch context.state.mode {
        case .paused:
            Button(intent: ResumeRoutineIntent(routineId: routineId)) {
                Image(systemName: "play.fill")
                    .font(.title3.weight(.bold))
                    .foregroundColor(.white)
                    .frame(width: 44, height: 44)
                    .background(Circle().fill(Color.brand))
            }
            .buttonStyle(.plain)
        case .countdown:
            Button(intent: PauseRoutineIntent(routineId: routineId)) {
                Image(systemName: "pause.fill")
                    .font(.title3.weight(.bold))
                    .foregroundColor(.white)
                    .frame(width: 44, height: 44)
                    .background(Circle().fill(Color.brand))
            }
            .buttonStyle(.plain)
        case .alert:
            EmptyView()
        }
    }
}

@available(iOS 26.0, *)
struct AlarmKitStepBottomLabel: View {
    let context: ActivityViewContext<AlarmAttributes<ShutTimerAlarmMetadata>>

    var body: some View {
        if let stepName = context.attributes.metadata?.currentStepName, !stepName.isEmpty {
            let total = context.attributes.metadata?.totalSteps ?? 1
            if total > 1 {
                let idx = (context.attributes.metadata?.currentStepIndex ?? 0) + 1
                Text("\(stepName) (\(idx)/\(total))")
                    .font(.caption)
                    .foregroundColor(.secondary)
            } else {
                Text(stepName)
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
        }
    }
}
