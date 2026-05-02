import Foundation

#if canImport(ActivityKit)
import ActivityKit

// v1.6 — alarmkit-bridge module 측 ShutTimerActivityAttributes 정의.
// LiveActivityBridge module + widget extension target 의 정의와 동일 (Codable 직렬화 호환).
// ActivityKit 시스템 측 type name + properties 매칭 — 세 곳 정의 = 같은 Activity 인식.
// 한 곳 변경 시 세 곳 모두 동기화 필수.
@available(iOS 16.2, *)
struct ShutTimerActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        var currentStepName: String
        var stepEndAt: Double
        var progress: Double
        var paused: Bool = false
        var stage: String = "step"
        var currentStepIndex: Int = 0
        var totalSteps: Int = 1
    }

    var routineName: String
    var routineId: String
}
#endif
