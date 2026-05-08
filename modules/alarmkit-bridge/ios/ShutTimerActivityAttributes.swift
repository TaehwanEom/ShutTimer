import Foundation

#if canImport(ActivityKit)
import ActivityKit

// v1.6 — alarmkit-bridge module 측 ShutTimerActivityAttributes 정의.
// LiveActivityBridge module + widget extension target 의 정의와 동일 (Codable 직렬화 호환).
// ActivityKit 시스템 측 type name + properties 매칭 — 세 곳 정의 = 같은 Activity 인식.
// 한 곳 변경 시 세 곳 모두 동기화 필수.
// v1.7 hotfix #ShutTimerActivityAttributesUnify — 본 측 pausedAt 필드 누락 영역 정정.
//   다른 두 측 (live-activity-bridge / widget extension) 측 = pausedAt 필드 보유.
//   AlarmKit framework 측 자동 LA = 본 측 attribute 사용 → widget extension 측 decode 시점 측
//   field mismatch → render 영역 영향 가능성 → 통일 정정.
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
        /** v1.7 hotfix — 일시정지 시점 timestamp (ms). Resume 시 native 측 stepEndAt shift 직접 계산용.
            optional default nil = 기존 LA 디코딩 호환. */
        var pausedAt: Double? = nil
    }

    var routineName: String
    var routineId: String
}
#endif
