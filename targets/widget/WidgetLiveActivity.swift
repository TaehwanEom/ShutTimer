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
// v1.7 hotfix #LAUnify Phase 10-G4 — @available(iOS 26.0, *) 마크 제거 (= widget extension deployment target 26.0 정합).
struct AlarmKitLiveActivity: Widget {
    init() {
        // v1.7 hotfix #LAUnify Phase 10-G4dbg4 — Widget struct init 시점 측정.
        // WidgetBundle 측 등록 시점 = system 측 본 widget instantiate 정합 → init() 호출 정합.
        // 본 log 측 발생 ❌ 시 = WidgetBundle 측 본 widget instantiate ❌ → registration ❌ root cause.
        // 본 log 측 발생 ✅ + AlarmKitLockScreenView.init() 0건 → ActivityConfiguration content closure 측 호출 ❌
        //   → AlarmKit framework 측 ActivityConfiguration<AlarmAttributes<X>> 측 type lookup ❌
        appendNativeDbgWidget("LA-DBG-AKLA-WidgetInit", "AlarmKitLiveActivity.init() called")
    }

    var body: some WidgetConfiguration {
        // v1.7 hotfix #LAUnify Phase 10-G4dbg4 — body evaluation 시점 측정.
        let _ = appendNativeDbgWidget("LA-DBG-AKLA-WidgetBody", "AlarmKitLiveActivity.body accessed")
        return ActivityConfiguration(for: AlarmAttributes<ShutTimerAlarmMetadata>.self) { context in
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
                // v1.7 hotfix #DI-PausedUX — minimal paused 측 = 동그라미 + 일시정지 (= pause.circle.fill).
                //   직전 = pause.fill (= "||" 두 개) → 사용자분 측 직관 ❌.
                //   정정 = pause.circle.fill (= 동그라미 + 일시정지) → 사용자분 직관 정합.
                if case .paused = context.state.mode {
                    Image(systemName: "pause.circle.fill").foregroundColor(.brand)
                } else {
                    Image(systemName: "timer").foregroundColor(.brand)
                }
            }
            .keylineTint(Color.brand)
        }
    }
}

// MARK: - AlarmKit LA helpers (= AlarmPresentationState.Mode 분기 + metadata 사용)

struct AlarmKitLockScreenView: View {
    let context: ActivityViewContext<AlarmAttributes<ShutTimerAlarmMetadata>>

    init(context: ActivityViewContext<AlarmAttributes<ShutTimerAlarmMetadata>>) {
        self.context = context
        // v1.7 hotfix #LAUnify Phase 10-G4dbg3 — struct init 시점 측 widget body 호출 직접 측정.
        // 직전 = view body 측 `let _ = { ... }()` 측 closure compiler dead code elimination 가능성 의심.
        // init() 측 = side effects 보존 정합 → widget body 호출 시 = 본 log 측 정상 발생 정합.
        appendNativeDbgWidget("LA-DBG-AKLA-Init", "AlarmKitLockScreenView.init() mode=\(akModeString(context.state.mode))")
    }

    var body: some View {
        // v1.7 hotfix #LAUnify Phase 9-A 진단 — AlarmKit LA widget body 진입 + state.mode 값 native log.
        // 사용자분 보고 = paused 시 "검정 바만 표시" → 본 widget body 호출 여부 + mode 분기 확인용.
        let _ = { appendNativeDbgWidget("LA-DBG-AKLA", "AlarmKitLockScreenView render mode=\(akModeString(context.state.mode)) routineName=\(context.attributes.metadata?.routineName ?? "nil") routineId=\(context.attributes.metadata?.routineId ?? "nil")", throttle: true) }()
        // v1.7 hotfix #LAUnify Phase 10-G3 — WWDC25 "Wake up to the AlarmKit API" 강제 정합:
        // "You MUST handle all three mode cases (.countdown, .paused, .alert) even if they share views."
        // 직전 = switch 누락 → AlarmKit framework가 widget body 호출 자체 안 함 (= LA-DBG-AKLA 0건 root cause).
        switch context.state.mode {
        case .countdown:
            lockScreenContent
                .onAppear {
                    // v1.7 hotfix #LAUnify Phase 10-G4dbg3 — onAppear 측 widget body 측 SwiftUI evaluation 시점 직접 측정.
                    appendNativeDbgWidget("LA-DBG-AKLA-Appear", "AlarmKitLockScreenView.onAppear(countdown) routineId=\(context.attributes.metadata?.routineId ?? "nil")")
                }
        case .paused:
            lockScreenContent
                .onAppear {
                    appendNativeDbgWidget("LA-DBG-AKLA-Appear", "AlarmKitLockScreenView.onAppear(paused) routineId=\(context.attributes.metadata?.routineId ?? "nil")")
                }
        case .alert:
            lockScreenContent
                .onAppear {
                    appendNativeDbgWidget("LA-DBG-AKLA-Appear", "AlarmKitLockScreenView.onAppear(alert) routineId=\(context.attributes.metadata?.routineId ?? "nil")")
                }
        }
    }

    @ViewBuilder
    private var lockScreenContent: some View {
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
        case .paused(let p):
            // v1.7 hotfix #WidgetPausedRemainingTime — "일시정지" 텍스트 → 남은 시간 static 표시.
            // Apple AlarmKit 공식 sample (= AlarmKitDemo) 패턴 정합:
            //   - Duration.seconds(totalCountdownDuration - previouslyElapsedDuration) 측 = 남은 시간.
            //   - .time(pattern: .minuteSecond / .hourMinuteSecond) 측 = format (= 60분+ 분기 + 다국어 정합).
            // 직전 = SwiftUI Text(timerInterval:pauseTime:) 측 = Apple Developer Forum #756971 보고 bug → 본 패턴 회피.
            // 직전 = String(format:) 측 = 구형 + 다국어 ❌ → Apple 공식 sample 패턴 정합.
            // v1.7 hotfix #WidgetAppPausedAlign — roundFractionalSeconds: .up 명시 (= ceil 정합).
            //   직전 = default truncate (= 50.5초 → 50초) → 앱 측 Math.ceil (= 51초) vs 위젯 50초 = 1초 차이.
            //   정정 = .up 측 = 50.5초 → 51초 (= ceil) → 앱 vs 위젯 일관성 + "남은 시간" 직관 정합.
            let remaining = Duration.seconds(p.totalCountdownDuration - p.previouslyElapsedDuration)
            let pattern: Duration.TimeFormatStyle.Pattern = remaining > .seconds(60 * 60)
                ? .hourMinuteSecond(padHourToLength: 1, fractionalSecondsLength: 0, roundFractionalSeconds: .up)
                : .minuteSecond(padMinuteToLength: 1, fractionalSecondsLength: 0, roundFractionalSeconds: .up)
            Text(remaining.formatted(.time(pattern: pattern)))
                .monospacedDigit()
                .font(fontStyle)
                .foregroundColor(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
        case .alert:
            Text("알람")
                .font(fontStyle)
                .foregroundColor(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
        }
    }
}

struct AlarmKitCompactTrailingView: View {
    let context: ActivityViewContext<AlarmAttributes<ShutTimerAlarmMetadata>>

    var body: some View {
        switch context.state.mode {
        case .countdown(let countdown):
            Text(timerInterval: countdown.startDate...countdown.fireDate, countsDown: true)
                .monospacedDigit()
                .frame(maxWidth: 50)
        case .paused(let p):
            // v1.7 hotfix #DI-PausedUX — compact trailing paused 측 = pause.circle.fill icon + 잔여 시간 동시 표시.
            //   직전 1차 (= HStack + Image + Text + maxWidth:70 + .caption2) 측 = render 영역 부족 → LA UI 표시 ❌ 회귀.
            //   정정 = HStack + spacing 4 + maxWidth ❌ + .font(.caption2) ❌ (= 자동 크기 + render error 회피).
            let remaining = Duration.seconds(p.totalCountdownDuration - p.previouslyElapsedDuration)
            let pattern: Duration.TimeFormatStyle.Pattern = remaining > .seconds(60 * 60)
                ? .hourMinuteSecond(padHourToLength: 1, fractionalSecondsLength: 0, roundFractionalSeconds: .up)
                : .minuteSecond(padMinuteToLength: 1, fractionalSecondsLength: 0, roundFractionalSeconds: .up)
            HStack(spacing: 4) {
                Image(systemName: "pause.circle.fill")
                    .foregroundColor(.brand)
                Text(remaining.formatted(.time(pattern: pattern)))
                    .monospacedDigit()
            }
        case .alert:
            Image(systemName: "bell.fill").foregroundColor(.brand)
        }
    }
}

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
