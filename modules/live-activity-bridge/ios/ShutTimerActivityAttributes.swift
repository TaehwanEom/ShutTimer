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
        /** v1.6 Phase 10 — 일시정지 상태 (UI 토글용). default false = 기존 디코딩 호환 */
        var paused: Bool = false
        /** v1.6 Phase 12 — LA stage. 'step' (현 step 카운트다운) / 'auto_countdown' (대기) / 'manual_prompt' (수동 다음 진행 Button). default = 기존 호환 */
        var stage: String = "step"
        /** v1.6 hotfix — 0-based 현재 step index. default = 기존 LA 디코딩 호환 */
        var currentStepIndex: Int = 0
        /** v1.6 hotfix — 총 step 수. default 1 = 단일 step 표시 폴백 */
        var totalSteps: Int = 1
        /** v1.7 hotfix #20 — pause 시점 ms (paused=false 시 = 0). SwiftUI Text(timerInterval:pauseTime:) 측 = 시간 정지 처리용. */
        var pausedAt: Double = 0
    }

    /** 루틴 이름 (불변) */
    var routineName: String
    /** 루틴 ID (불변) — Intent perform() 시 routine 매칭 */
    var routineId: String
}
#endif
