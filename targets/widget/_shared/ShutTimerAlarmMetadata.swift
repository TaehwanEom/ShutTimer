// AlarmKit 자동 LA Activity 측 AlarmAttributes<ShutTimerAlarmMetadata> 단일 정의
// v1.7 hotfix #LAUnify Phase 10-G0 — main app target + widget extension target 양쪽 동일 type identity 보장
//
// 위치 = `targets/widget/_shared/` (= @bacons/apple-targets 측 native 지원 패턴)
//   소스: node_modules/@bacons/apple-targets/build/with-xcode-changes.js:298-353
//   동작: prebuild 시 _shared/ 폴더 측 PBXFileSystemSynchronizedRootGroup 자동 생성
//        + widget extension target sync group 자동 포함 + main app target exception set 추가
//        → 한 source file이 두 target에서 동시 컴파일 → Swift type identity 통합
//
// 직전 (Phase 9-B) = 두 target 측 별도 file 측 별도 정의 → Swift module 단위 type identity 분리
//   → AlarmKit framework lookup mismatch → widget body 호출 ❌ + system fallback UI ("검정 바") root cause

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
