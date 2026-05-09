// AlarmkitBridge Pod 측 ShutTimerAlarmMetadata 자체 정의 영역.
// v1.7 hotfix #LAUnify Phase 10-G0a — Pod 측 별도 Swift module 측 type identity 정합.
//
// 배경 = Phase 10-G0 측 _shared/ 패턴 측 = @bacons/apple-targets PBXFileSystemSynchronizedRootGroup
//   측 widget extension target + main app target 측 file membership 자동 추가.
//   하지만 AlarmkitBridge 측 = 독립 CocoaPod (= ExpoModulesCore 의존) 측 별도 Swift module
//   → _shared/ 측 = AlarmkitBridge Pod 측 ❌ 도달 → "Cannot find 'ShutTimerAlarmMetadata' in scope" 빌드 에러.
//
// 해결 = 두 module 측 자체 정의 + 동일 struct layout 보장.
//   AlarmKit framework 측 = ActivityKit 기반 Codable serialization
//   → struct field 측 동일 시 widget extension 측 metadata 정상 디코딩 + UI rendering 정합.
//   Swift module 단위 type identity 차이 측 = framework 측 무영향 (= type lookup 측 Codable 측 결정).
//
// 동기화 부탁 (= 필드 추가/변경 시 양쪽 동시 갱신 필수).
//   AlarmkitBridge Pod 측 = 본 file
//   widget extension target 측 = `targets/widget/_shared/ShutTimerAlarmMetadata.swift`

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
