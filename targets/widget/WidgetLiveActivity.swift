import ActivityKit
import WidgetKit
import SwiftUI
import AppIntents

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

// v1.6 T3 + Phase 10 + Phase 11 — ShutTimer routine/timer 진행 LiveActivity
// (Lock Screen + Dynamic Island + Apple Watch Smart Stack)
// 사용자 명시 디자인: Lock Screen [좌측 라벨+카운트다운(56pt 1줄)] [정지 ✕] [플레이/⏸ 토글]
// Apple Watch (Phase 11): 카운트다운 + Pause/Resume 토글 1개 (Q1b/Q2a/Q3a/Q4)
struct ShutTimerActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        /** 현재 step 이름 */
        var currentStepName: String
        /** 현재 step 종료 timestamp (ms) */
        var stepEndAt: Double
        /** 진행률 0~1 */
        var progress: Double
        /** v1.6 Phase 10 — 일시정지 상태. default false = 기존 디코딩 호환 */
        var paused: Bool = false
        /** v1.6 Phase 12 — LA stage ('step' / 'auto_countdown' / 'manual_prompt'). default = 기존 호환 */
        var stage: String = "step"
        /** v1.6 hotfix — 0-based 현재 step index. default = 기존 LA 디코딩 호환 */
        var currentStepIndex: Int = 0
        /** v1.6 hotfix — 총 step 수. default 1 = 단일 step 표시 폴백 */
        var totalSteps: Int = 1
        /** v1.7 hotfix — 일시정지 시점 timestamp (ms). Resume 시 native 측 stepEndAt shift 직접 계산용.
            optional default nil = 기존 LA 디코딩 호환. */
        var pausedAt: Double? = nil

        /// v1.7 hotfix #10 — invalid range 가드 (= stepEndAt 측 stale 과거 시점 시 invalid range → blank 표시 회피).
        /// active fire → 잠금 시점 측 = stepEndAt 도달 후 시간 경과 → endDate < now → invalid range.
        /// 가드 = max(endDate, now + 0.01) → 항상 유효 range 보장 → "0:00" 표시 (= blank ❌).
        var safeStepEndDate: Date {
            let endDate = Date(timeIntervalSince1970: stepEndAt / 1000)
            let nowPlus = Date().addingTimeInterval(0.01)
            return max(endDate, nowPlus)
        }
    }

    /** 루틴/타이머 이름 (불변) */
    var routineName: String
    /** 루틴/타이머 ID (불변) — Intent perform() 시 routineId 매칭 */
    var routineId: String
}

// v1.6 Phase 11-A — Lock Screen view (기존 영역 추출 — 동작 변경 0, 회귀 격리)
struct LockScreenView: View {
    let context: ActivityViewContext<ShutTimerActivityAttributes>

    var body: some View {
        HStack(spacing: 12) {
            // v1.6 hotfix — VStack 2열 분리 (텍스트 잘림 fix). 1열=routineName / 2열=stepName(N/M).
            // 줄바꿈 시 frame minHeight 고정으로 높이 변동 ❌ (사용자 요청 — 갑작스런 높이 변경 회피).
            HStack(alignment: .center, spacing: 8) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(context.attributes.routineName)
                        .font(.caption)
                        .foregroundColor(.brand)
                        .lineLimit(1)
                    if context.state.totalSteps > 1 && !context.state.currentStepName.isEmpty {
                        Text("\(context.state.currentStepName) (\(context.state.currentStepIndex + 1)/\(context.state.totalSteps))")
                            .font(.caption2)
                            .foregroundColor(.white.opacity(0.75))
                            .lineLimit(1)
                    }
                }
                if context.state.stage == "manual_prompt" {
                    // v1.6 Phase 12 — 수동 모드 alerting 후 stage. "다음 진행 대기" 텍스트.
                    Text("다음 진행")
                        .font(.system(size: 32, weight: .bold))
                        .foregroundColor(.white)
                        .lineLimit(1)
                        .minimumScaleFactor(0.6)
                } else if context.state.stage == "pre_advance" {
                    // v1.6 hotfix — autoCountdownSec 카운트 표시. stepEndAt = 카운트 종료 시점.
                    Text(timerInterval: Date()...context.state.safeStepEndDate, countsDown: true)
                        .monospacedDigit()
                        .font(.system(size: 56, weight: .bold))
                        .foregroundColor(.white)
                        .lineLimit(1)
                        .minimumScaleFactor(0.6)
                } else if context.state.paused {
                    // v1.7 hotfix #14 — paused 측 = "일시정지됨" 텍스트 명시 (= timerInterval ❌, 카운트다운 흘러감 회피).
                    Text("일시정지")
                        .font(.system(size: 56, weight: .bold))
                        .foregroundColor(.white)
                        .lineLimit(1)
                        .minimumScaleFactor(0.4)
                } else {
                    Text(timerInterval: Date()...context.state.safeStepEndDate, countsDown: true)
                        .monospacedDigit()
                        .font(.system(size: 56, weight: .bold))
                        .foregroundColor(.white)
                        .lineLimit(1)
                        .minimumScaleFactor(0.6)
                }
            }
            Spacer()
            // 중간: 정지 (모든 stage 공통)
            if #available(iOS 26.0, *) {
                Button(intent: StopRoutineIntent(routineId: context.attributes.routineId)) {
                    Image(systemName: "xmark")
                        .font(.title3.weight(.bold))
                        .foregroundColor(.white)
                        .frame(width: 44, height: 44)
                        .background(Circle().fill(Color.gray.opacity(0.6)))
                }
                .buttonStyle(.plain)
            }
            // 우측: stage 별 분기
            //   manual_prompt → "다음 진행" Button (▶▶ 아이콘)
            //   step (default) → Pause/Resume 토글
            if #available(iOS 26.0, *) {
                if context.state.stage == "manual_prompt" {
                    Button(intent: AdvanceNextStepIntent(routineId: context.attributes.routineId)) {
                        Image(systemName: "forward.fill")
                            .font(.title3.weight(.bold))
                            .foregroundColor(.white)
                            .frame(width: 44, height: 44)
                            .background(Circle().fill(Color.brand))
                    }
                    .buttonStyle(.plain)
                } else if context.state.paused {
                    Button(intent: ResumeRoutineIntent(routineId: context.attributes.routineId)) {
                        Image(systemName: "play.fill")
                            .font(.title3.weight(.bold))
                            .foregroundColor(.white)
                            .frame(width: 44, height: 44)
                            .background(Circle().fill(Color.brand))
                    }
                    .buttonStyle(.plain)
                } else {
                    Button(intent: PauseRoutineIntent(routineId: context.attributes.routineId)) {
                        Image(systemName: "pause.fill")
                            .font(.title3.weight(.bold))
                            .foregroundColor(.white)
                            .frame(width: 44, height: 44)
                            .background(Circle().fill(Color.brand))
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        // v1.6 hotfix — minHeight 76 (이전 56). VStack 2열 분리 시 갑작스런 높이 변동 회피.
        // 모든 stage (step / paused / manual_prompt / pre_advance) 동일 높이.
        .frame(minHeight: 76)
        .activityBackgroundTint(Color.black.opacity(0.85))
        .activitySystemActionForegroundColor(Color.white)
    }
}

// v1.6 Phase 11-C — Apple Watch Smart Stack 전용 view.
// iOS 측 정의 → iOS system 이 Apple Watch 에 자동 forwarding (별도 watchOS 코드 X).
// 사양: Q1(b) 카운트다운만 / Q2(a) Pause/Resume 토글 1개 / Q3(a) "일시정지" 텍스트 / Q4 brand #ff2424
struct WatchView: View {
    let context: ActivityViewContext<ShutTimerActivityAttributes>

    var body: some View {
        // v1.7 hotfix #DBG-A — Apple Watch WatchView 진입 + 모든 state 영역 (= 사용자분 측 신규 부탁 영역).
        // throttle=true → Smart Stack render 폭주 회피.
        let _ = { appendNativeDbgWidget("LA-DBG-Watch", "WatchView render routineName=\(context.attributes.routineName) stage=\(context.state.stage) paused=\(context.state.paused) stepEndAt=\(context.state.stepEndAt) currentStepIndex=\(context.state.currentStepIndex)/\(context.state.totalSteps)", throttle: true) }()
        // v1.6 Phase 12 — 가로 직사각형 Smart Stack 카드 정합. HStack 가로 layout.
        HStack(spacing: 8) {
            // 좌측: 본 앱 식별 SF Symbol (brand 색). Asset image = grey square 버그 회피.
            Image(systemName: "timer")
                .foregroundColor(.brand)
                .font(.title3)

            // v1.6 Phase 12 — stage='manual_prompt' 분기 (alerting 시점 Apple Watch 도 "다음 진행" Button)
            if context.state.stage == "manual_prompt" {
                Text("다음 진행")
                    .font(.system(size: 18, weight: .bold))
                    .foregroundColor(.white)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
            } else if context.state.paused {
                // v1.7 hotfix #14 — paused 측 = "일시정지됨" 명시 (= timerInterval ❌).
                Text("일시정지")
                    .font(.caption)
                    .foregroundColor(.secondary)
            } else {
                Text(timerInterval: Date()...context.state.safeStepEndDate, countsDown: true)
                    .font(.system(size: 24, weight: .bold))
                    .monospacedDigit()
                    .foregroundColor(.white)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
            }

            Spacer()

            // 우측: stage 별 Button (iOS 26+, 본 앱 Intent struct 정합).
            // ternary ❌ — if-else 분리 (Swift `?:` Intent type 다름).
            if #available(iOS 26.0, *) {
                if context.state.stage == "manual_prompt" {
                    Button(intent: AdvanceNextStepIntent(routineId: context.attributes.routineId)) {
                        Image(systemName: "forward.fill")
                            .foregroundColor(.white)
                    }
                    .tint(Color.brand)
                    .buttonStyle(.borderedProminent)
                } else if context.state.paused {
                    Button(intent: ResumeRoutineIntent(routineId: context.attributes.routineId)) {
                        Image(systemName: "play.fill")
                            .foregroundColor(.white)
                    }
                    .tint(Color.brand)
                    .buttonStyle(.borderedProminent)
                } else {
                    Button(intent: PauseRoutineIntent(routineId: context.attributes.routineId)) {
                        Image(systemName: "pause.fill")
                            .foregroundColor(.white)
                    }
                    .tint(Color.brand)
                    .buttonStyle(.borderedProminent)
                }
            }
        }
        .padding(8)
    }
}

// v1.6 Phase 11-B — family 분기 (Apple Watch 측 .small / iPhone 측 .medium)
struct AdaptiveLiveActivityView: View {
    let context: ActivityViewContext<ShutTimerActivityAttributes>
    @Environment(\.activityFamily) var family

    var body: some View {
        if family == .small {
            WatchView(context: context)
        } else {
            LockScreenView(context: context)
        }
    }
}

struct WidgetLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: ShutTimerActivityAttributes.self) { context in
            AdaptiveLiveActivityView(context: context)
        } dynamicIsland: { context in
            DynamicIsland {
                // Expanded — Lock Screen 동급 (좌측 라벨+카운트다운, 우측 정지+토글)
                DynamicIslandExpandedRegion(.leading) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(context.attributes.routineName)
                            .font(.caption)
                            .foregroundColor(.brand)
                            .lineLimit(1)
                        // v1.6 Phase 12 — stage='manual_prompt' 분기 (Dynamic Island expanded 도 동기)
                        if context.state.stage == "manual_prompt" {
                            Text("다음 진행")
                                .font(.title2.weight(.bold))
                                .foregroundColor(.white)
                        } else if context.state.paused {
                            // v1.7 hotfix #14 — paused 측 = "일시정지됨" 명시 (= Dynamic Island expanded).
                            Text("일시정지")
                                .font(.title2.weight(.bold))
                        } else {
                            Text(timerInterval: Date()...context.state.safeStepEndDate, countsDown: true)
                                .monospacedDigit()
                                .font(.title2.weight(.bold))
                        }
                    }
                }
                DynamicIslandExpandedRegion(.trailing) {
                    HStack(spacing: 6) {
                        if #available(iOS 26.0, *) {
                            Button(intent: StopRoutineIntent(routineId: context.attributes.routineId)) {
                                Image(systemName: "xmark.circle.fill")
                                    .font(.title2)
                                    .foregroundColor(.gray)
                            }
                            .buttonStyle(.plain)
                            // v1.6 Phase 12 — stage='manual_prompt' 시 "다음 진행" Button (▶▶)
                            if context.state.stage == "manual_prompt" {
                                Button(intent: AdvanceNextStepIntent(routineId: context.attributes.routineId)) {
                                    Image(systemName: "forward.circle.fill")
                                        .font(.title2)
                                        .foregroundColor(.brand)
                                }
                                .buttonStyle(.plain)
                            } else if context.state.paused {
                                Button(intent: ResumeRoutineIntent(routineId: context.attributes.routineId)) {
                                    Image(systemName: "play.circle.fill")
                                        .font(.title2)
                                        .foregroundColor(.brand)
                                }
                                .buttonStyle(.plain)
                            } else {
                                Button(intent: PauseRoutineIntent(routineId: context.attributes.routineId)) {
                                    Image(systemName: "pause.circle.fill")
                                        .font(.title2)
                                        .foregroundColor(.brand)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                }
                DynamicIslandExpandedRegion(.bottom) {
                    if !context.state.currentStepName.isEmpty {
                        // v1.6 hotfix — totalSteps>1 시 "stepName (N/M)" 표시
                        if context.state.totalSteps > 1 {
                            Text("\(context.state.currentStepName) (\(context.state.currentStepIndex + 1)/\(context.state.totalSteps))")
                                .font(.caption)
                                .foregroundColor(.secondary)
                        } else {
                            Text(context.state.currentStepName)
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                    }
                }
            } compactLeading: {
                // v1.7 hotfix #DBG-A — compactLeading 진입 + 값 (= LA compact 빈 영역 root cause 추적용).
                // throttle=true → render 폭주 회피 (1초 1회).
                let _ = { appendNativeDbgWidget("LA-DBG", "compactLeading routineName=\(context.attributes.routineName) stage=\(context.state.stage) paused=\(context.state.paused) stepEndAt=\(context.state.stepEndAt)", throttle: true) }()
                Text(context.attributes.routineName)
                    .font(.caption2)
                    .foregroundColor(.brand)
                    .lineLimit(1)
            } compactTrailing: {
                // v1.7 hotfix #DBG-A — compactTrailing 진입 + safeStepEndDate.
                let _ = { appendNativeDbgWidget("LA-DBG", "compactTrailing paused=\(context.state.paused) stepEndAt=\(context.state.stepEndAt) safeEnd=\(context.state.safeStepEndDate.timeIntervalSince1970 * 1000) deltaMs=\(context.state.stepEndAt - Date().timeIntervalSince1970 * 1000)", throttle: true) }()
                if context.state.paused {
                    Image(systemName: "pause.fill").foregroundColor(.brand)
                } else {
                    Text(timerInterval: Date()...context.state.safeStepEndDate, countsDown: true)
                        .monospacedDigit()
                        .frame(maxWidth: 50)
                }
            } minimal: {
                // v1.7 hotfix #DBG-A — minimal 진입 + paused.
                let _ = { appendNativeDbgWidget("LA-DBG", "minimal paused=\(context.state.paused)", throttle: true) }()
                if context.state.paused {
                    Image(systemName: "pause.fill").foregroundColor(.brand)
                } else {
                    Image(systemName: "timer").foregroundColor(.brand)
                }
            }
            .keylineTint(Color.brand)
        }
        .supplementalActivityFamilies([.small])  // v1.6 Phase 11-D — Apple Watch 전용 view 활성화
    }
}
