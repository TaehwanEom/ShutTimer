import Foundation

#if canImport(ActivityKit)
import ActivityKit

// v1.6 T3 — App target 측 ShutTimerActivityAttributes.
// Widget target (targets/widget/WidgetLiveActivity.swift) 의 정의와
// Codable 직렬화 호환 (동일 field). 한쪽 변경 시 양쪽 동기화 필수.
@available(iOS 16.2, *)
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
#endif
