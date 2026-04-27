import ActivityKit
import WidgetKit
import SwiftUI

// v1.6 T3 — ShutTimer routine 진행 중 LiveActivity (Lock Screen + Dynamic Island)
struct ShutTimerActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        /** 현재 step 이름 */
        var currentStepName: String
        /** 현재 step 종료 timestamp (ms) */
        var stepEndAt: Double
        /** 진행률 0~1 */
        var progress: Double
    }

    /** 루틴 이름 (불변) */
    var routineName: String
    /** 루틴 ID (불변) — Intent perform() 시 routine 매칭 */
    var routineId: String
}

struct WidgetLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: ShutTimerActivityAttributes.self) { context in
            // Lock Screen / Banner UI
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Image(systemName: "timer")
                        .foregroundColor(.red)
                    Text(context.attributes.routineName)
                        .font(.headline)
                    Spacer()
                    Text(timerInterval: Date()...Date(timeIntervalSince1970: context.state.stepEndAt / 1000), countsDown: true)
                        .monospacedDigit()
                        .font(.headline)
                }
                Text(context.state.currentStepName)
                    .font(.subheadline)
                    .foregroundColor(.secondary)
                ProgressView(value: context.state.progress)
                    .tint(.red)
            }
            .padding()
            .activityBackgroundTint(Color.black.opacity(0.8))
            .activitySystemActionForegroundColor(Color.white)

        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Image(systemName: "timer")
                        .foregroundColor(.red)
                        .font(.title2)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text(timerInterval: Date()...Date(timeIntervalSince1970: context.state.stepEndAt / 1000), countsDown: true)
                        .monospacedDigit()
                        .font(.title2)
                        .frame(maxWidth: 80)
                }
                DynamicIslandExpandedRegion(.center) {
                    Text(context.attributes.routineName)
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(context.state.currentStepName)
                            .font(.subheadline)
                        ProgressView(value: context.state.progress)
                            .tint(.red)
                    }
                }
            } compactLeading: {
                Image(systemName: "timer").foregroundColor(.red)
            } compactTrailing: {
                Text(timerInterval: Date()...Date(timeIntervalSince1970: context.state.stepEndAt / 1000), countsDown: true)
                    .monospacedDigit()
                    .frame(maxWidth: 50)
            } minimal: {
                Image(systemName: "timer").foregroundColor(.red)
            }
            .keylineTint(Color.red)
        }
    }
}

extension ShutTimerActivityAttributes {
    fileprivate static var preview: ShutTimerActivityAttributes {
        ShutTimerActivityAttributes(routineName: "아침 루틴", routineId: "preview")
    }
}

extension ShutTimerActivityAttributes.ContentState {
    fileprivate static var sample: ShutTimerActivityAttributes.ContentState {
        ShutTimerActivityAttributes.ContentState(
            currentStepName: "양치하기",
            stepEndAt: Date().addingTimeInterval(120).timeIntervalSince1970 * 1000,
            progress: 0.3
        )
    }
}

#Preview("Notification", as: .content, using: ShutTimerActivityAttributes.preview) {
   WidgetLiveActivity()
} contentStates: {
    ShutTimerActivityAttributes.ContentState.sample
}
