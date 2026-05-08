// AlarmKit framework 자동 LA Activity 측 AlarmAttributes<ShutTimerAlarmMetadata> 단일 정의
// v1.7 hotfix #LAUnify Phase 9-B — main app target + widget extension target 측 동일 type identity 보장.
//   직전 = 두 target 측 별도 file 측 별도 정의 → Swift module 측 별도 type → AlarmKit framework lookup mismatch
//   → widget body 호출 ❌ + framework system fallback UI 표시 (= 검정 바 root cause).
//   본 file 측 = 두 target 측 file membership share (= plugins/withSharedAlarmMetadata.js 측 main app target 추가).

import Foundation

#if canImport(AlarmKit)
import AlarmKit

@available(iOS 26.0, *)
nonisolated struct ShutTimerAlarmMetadata: AlarmMetadata {
    var currentStepName: String? = nil
    var currentStepIndex: Int = 0
    var totalSteps: Int = 1
    var stage: String = "step"
    var paused: Bool = false
    var pausedAt: Double? = nil
    var routineId: String? = nil
    var routineName: String? = nil
}
#endif
