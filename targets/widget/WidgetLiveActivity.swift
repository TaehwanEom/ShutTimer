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
// v1.8 #WatchLA — Apple Watch Smart Stack 측 전용 View 추가 (= supplementalActivityFamilies([.small]) + activityFamily 분기).
//   WWDC24 "Bring your Live Activity to Apple Watch" 패턴 정합.
struct AlarmKitLiveActivity: Widget {
    init() {
        // v1.7 hotfix #LAUnify Phase 10-G4dbg4 — Widget struct init 시점 측정.
        appendNativeDbgWidget("LA-DBG-AKLA-WidgetInit", "AlarmKitLiveActivity.init() called")
        let typeName = String(describing: AlarmAttributes<ShutTimerAlarmMetadata>.self)
        let metadataTypeName = String(describing: ShutTimerAlarmMetadata.self)
        appendNativeDbgWidget("LA-DBG-AKLA-Type", "WidgetInit widget process AlarmAttributes type=\(typeName) metadata type=\(metadataTypeName)")
    }

    var body: some WidgetConfiguration {
        let _ = appendNativeDbgWidget("LA-DBG-AKLA-WidgetBody", "AlarmKitLiveActivity.body accessed")
        return ActivityConfiguration(for: AlarmAttributes<ShutTimerAlarmMetadata>.self) { context in
            // v1.8 #WatchLAFix — @Environment(\.activityFamily) wrapper view 안 선언 정정 (Apple Forum #766878 패턴).
            //   직전 = AlarmKitLiveActivity struct 최상위 @Environment 선언 → iPhone activity 생성 시점 1회 evaluate
            //   → Apple Watch 측 .small 분기 fail (= 항상 LockScreen view 적용 → 워치 reject 가능).
            //   정정 = AlarmKitLiveActivityContent wrapper 측 @Environment 선언 → 각 platform 정확 evaluate.
            AlarmKitLiveActivityContent(context: context)
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
                    Image(systemName: "pause.circle.fill").foregroundColor(.brand)
                } else {
                    Image(systemName: "timer").foregroundColor(.brand)
                }
            }
            .keylineTint(Color.brand)
        }
        .supplementalActivityFamilies([.small])
    }
}

// MARK: - v1.8 #WatchLAFix — activityFamily 분기 wrapper view (Apple Forum #766878 패턴)
// @Environment(\.activityFamily) 측 widget configuration body가 아닌 view body 안에서 선언해야 각 platform
// (iPhone Dynamic Island = .medium, Apple Watch Smart Stack = .small) 측 정확 evaluate.

struct AlarmKitLiveActivityContent: View {
    @Environment(\.activityFamily) var activityFamily
    let context: ActivityViewContext<AlarmAttributes<ShutTimerAlarmMetadata>>

    var body: some View {
        let _ = appendNativeDbgWidget("LA-DBG-AKLA-Family", "AlarmKitLiveActivityContent render activityFamily=\(activityFamily)", throttle: true)
        switch activityFamily {
        case .small:
            AlarmKitWatchView(context: context)
        case .medium:
            AlarmKitLockScreenView(context: context)
        @unknown default:
            AlarmKitLockScreenView(context: context)
        }
    }
}

// MARK: - v1.8 #WatchLA — Apple Watch Smart Stack 전용 View (= ~150x150 pt 정합)

struct AlarmKitWatchView: View {
    let context: ActivityViewContext<AlarmAttributes<ShutTimerAlarmMetadata>>

    init(context: ActivityViewContext<AlarmAttributes<ShutTimerAlarmMetadata>>) {
        self.context = context
        appendNativeDbgWidget("LA-DBG-AKLA-Watch", "AlarmKitWatchView.init() mode=\(akModeString(context.state.mode))")
    }

    var body: some View {
        let routineId = context.attributes.metadata?.routineId ?? ""
        let stepName = context.attributes.metadata?.currentStepName ?? ""
        let total = context.attributes.metadata?.totalSteps ?? 1
        let idx = (context.attributes.metadata?.currentStepIndex ?? 0) + 1

        VStack(spacing: 4) {
            // 루틴 이름 (= 가장 위, 작게)
            Text(context.attributes.metadata?.routineName ?? "타이머")
                .font(.caption2)
                .foregroundColor(.brand)
                .lineLimit(1)

            // step 진행 (= 루틴 측만 표시, 알람 단독 ❌)
            if total > 1 && !stepName.isEmpty {
                Text("\(stepName) (\(idx)/\(total))")
                    .font(.caption2)
                    .foregroundColor(.white.opacity(0.75))
                    .lineLimit(1)
            }

            // 잔여 시간 (= 큰 글자, monospaced)
            AlarmKitCountdownText(context: context, fontStyle: .title3.weight(.bold))

            // 버튼 영역 (= 일시정지/재개 + 다음 step + 종료)
            HStack(spacing: 6) {
                // 일시정지 / 재개
                AlarmKitWatchPauseResumeButton(routineId: routineId, mode: context.state.mode)

                // 다음 step (= 루틴 측만 표시 + countdown 모드만)
                if total > 1 && idx < total {
                    if case .countdown = context.state.mode {
                        Button(intent: AdvanceNextStepIntent(routineId: routineId)) {
                            Image(systemName: "forward.fill")
                                .font(.caption.weight(.bold))
                                .foregroundColor(.white)
                                .frame(width: 32, height: 32)
                                .background(Circle().fill(Color.gray.opacity(0.5)))
                        }
                        .buttonStyle(.plain)
                    }
                }

                // 종료
                Button(intent: StopRoutineIntent(routineId: routineId)) {
                    Image(systemName: "xmark")
                        .font(.caption.weight(.bold))
                        .foregroundColor(.white)
                        .frame(width: 32, height: 32)
                        .background(Circle().fill(Color.gray.opacity(0.5)))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(8)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .activityBackgroundTint(Color.black.opacity(0.85))
        .activitySystemActionForegroundColor(Color.white)
    }
}

struct AlarmKitWatchPauseResumeButton: View {
    let routineId: String
    let mode: AlarmPresentationState.Mode

    var body: some View {
        switch mode {
        case .paused:
            Button(intent: ResumeRoutineIntent(routineId: routineId)) {
                Image(systemName: "play.fill")
                    .font(.caption.weight(.bold))
                    .foregroundColor(.white)
                    .frame(width: 32, height: 32)
                    .background(Circle().fill(Color.brand))
            }
            .buttonStyle(.plain)
        case .countdown:
            Button(intent: PauseRoutineIntent(routineId: routineId)) {
                Image(systemName: "pause.fill")
                    .font(.caption.weight(.bold))
                    .foregroundColor(.white)
                    .frame(width: 32, height: 32)
                    .background(Circle().fill(Color.brand))
            }
            .buttonStyle(.plain)
        case .alert:
            EmptyView()
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
                    // v1.8 #LACountdownTitle — routineName 측 2줄 허용 (= "다음 알람\n남은 시간" 측 wrap 정합).
                    Text(context.attributes.metadata?.routineName ?? "타이머")
                        .font(.caption)
                        .foregroundColor(.brand)
                        .lineLimit(2)
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
                .minimumScaleFactor(0.4)
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
                .minimumScaleFactor(0.4)
        case .alert:
            Text("알람")
                .font(fontStyle)
                .foregroundColor(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.4)
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
                .lineLimit(1)
                .minimumScaleFactor(0.5)
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
                    .lineLimit(1)
                    .minimumScaleFactor(0.5)
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

// MARK: - v1.8 #WatchLADirect — Apple Watch Smart Stack 전용 별도 ActivityKit Live Activity

// AlarmKit framework 자동 LA 측 Activity.activities 등록 측 측정 ❌ (= alerting 시점 count=0 단서) →
// WWDC24 자동 워치 mirror 메커니즘 측 전제 fail. 본 widget = 별도 ShutTimerWatchLAAttributes type 측
// 측 ActivityKit `Activity.request` 직접 호출 측 LA 측 등록 → Activity.activities 등록 ✅ →
// 워치 Smart Stack 자동 mirror ✅ 보장.
// iPhone 측 = `.medium` 측 EmptyView 측 → framework auto LA 측 그대로 표시 (= 시각 충돌 ❌).

struct ShutTimerWatchLAWidget: Widget {
    init() {
        appendNativeDbgWidget("LA-DBG-WatchLA-WidgetInit", "ShutTimerWatchLAWidget.init() called")
    }

    var body: some WidgetConfiguration {
        let _ = appendNativeDbgWidget("LA-DBG-WatchLA-WidgetBody", "ShutTimerWatchLAWidget.body accessed")
        return ActivityConfiguration(for: ShutTimerWatchLAAttributes.self) { context in
            ShutTimerWatchLAContent(context: context)
        } dynamicIsland: { _ in
            // iPhone Dynamic Island 측 = framework auto LA 측 사용 → 본 widget DI 측 = 최소 stub (= reject 측 회피).
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) { EmptyView() }
                DynamicIslandExpandedRegion(.trailing) { EmptyView() }
            } compactLeading: {
                EmptyView()
            } compactTrailing: {
                EmptyView()
            } minimal: {
                EmptyView()
            }
        }
        .supplementalActivityFamilies([.small])
    }
}

struct ShutTimerWatchLAContent: View {
    @Environment(\.activityFamily) var activityFamily
    let context: ActivityViewContext<ShutTimerWatchLAAttributes>

    var body: some View {
        let _ = appendNativeDbgWidget("LA-DBG-WatchLA-Family", "ShutTimerWatchLAContent render activityFamily=\(activityFamily) mode=\(context.state.mode)", throttle: true)
        switch activityFamily {
        case .small:
            ShutTimerWatchLAView(context: context)
        case .medium:
            EmptyView()
        @unknown default:
            EmptyView()
        }
    }
}

struct ShutTimerWatchLAView: View {
    let context: ActivityViewContext<ShutTimerWatchLAAttributes>

    init(context: ActivityViewContext<ShutTimerWatchLAAttributes>) {
        self.context = context
        appendNativeDbgWidget("LA-DBG-WatchLA-View", "ShutTimerWatchLAView.init() mode=\(context.state.mode)")
    }

    var body: some View {
        let state = context.state
        let alarmId = state.alarmId

        VStack(spacing: 2) {
            Text(state.routineName)
                .font(.caption2)
                .foregroundColor(.brand)
                .lineLimit(1)

            ShutTimerWatchLATimeText(state: state)

            // v1.8 #WatchLATimerIntent — timer_main 측 = routine ❌ + step 1개 측 → AdvanceNextStepIntent 측 ❌.
            //   pause/resume + stop 측만 사용 + 새 PauseTimerIntent / ResumeTimerIntent / StopTimerIntent 측 alarmId 직접 호출.
            HStack(spacing: 4) {
                ShutTimerWatchLAPauseResumeButton(alarmId: alarmId, mode: state.mode)

                Button(intent: StopTimerIntent(alarmId: alarmId)) {
                    Image(systemName: "xmark")
                        .font(.caption.weight(.bold))
                        .foregroundColor(.white)
                        .frame(width: 24, height: 24)
                        .background(Circle().fill(Color.gray.opacity(0.5)))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(8)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .activityBackgroundTint(Color.black.opacity(0.85))
        .activitySystemActionForegroundColor(Color.white)
    }
}

struct ShutTimerWatchLATimeText: View {
    let state: ShutTimerWatchLAAttributes.ContentState

    var body: some View {
        switch state.mode {
        case "countdown":
            Text(timerInterval: state.startDate...state.fireDate, countsDown: true)
                .monospacedDigit()
                .font(.system(size: 28).weight(.bold))
                .foregroundColor(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        case "paused":
            let remaining = Duration.seconds(state.pausedRemainingSec)
            let pattern: Duration.TimeFormatStyle.Pattern = remaining > .seconds(60 * 60)
                ? .hourMinuteSecond(padHourToLength: 1, fractionalSecondsLength: 0, roundFractionalSeconds: .up)
                : .minuteSecond(padMinuteToLength: 1, fractionalSecondsLength: 0, roundFractionalSeconds: .up)
            Text(remaining.formatted(.time(pattern: pattern)))
                .monospacedDigit()
                .font(.system(size: 28).weight(.bold))
                .foregroundColor(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        default:
            Text("알람")
                .font(.system(size: 28).weight(.bold))
                .foregroundColor(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
    }
}

struct ShutTimerWatchLAPauseResumeButton: View {
    let alarmId: String
    let mode: String

    var body: some View {
        switch mode {
        case "paused":
            Button(intent: ResumeTimerIntent(alarmId: alarmId)) {
                Image(systemName: "play.fill")
                    .font(.caption.weight(.bold))
                    .foregroundColor(.white)
                    .frame(width: 24, height: 24)
                    .background(Circle().fill(Color.brand))
            }
            .buttonStyle(.plain)
        case "countdown":
            Button(intent: PauseTimerIntent(alarmId: alarmId)) {
                Image(systemName: "pause.fill")
                    .font(.caption.weight(.bold))
                    .foregroundColor(.white)
                    .frame(width: 24, height: 24)
                    .background(Circle().fill(Color.brand))
            }
            .buttonStyle(.plain)
        default:
            EmptyView()
        }
    }
}
