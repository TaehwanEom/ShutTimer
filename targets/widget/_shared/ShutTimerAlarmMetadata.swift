// AlarmKit 자동 LA Activity 측 AlarmAttributes<ShutTimerAlarmMetadata> 측 widget extension target 정의 영역.
// v1.7 hotfix #LAUnify Phase 10-G0 — @bacons/apple-targets _shared/ 패턴 측 widget + main app target 자동 share.
//
// 위치 = `targets/widget/_shared/` (= @bacons/apple-targets 측 native 지원 패턴)
//   소스: node_modules/@bacons/apple-targets/build/with-xcode-changes.js:298-353
//   동작: prebuild 시 _shared/ 폴더 측 PBXFileSystemSynchronizedRootGroup 자동 생성
//        + widget extension target sync group 자동 포함 + main app target exception set 추가.
//   주의: @bacons/apple-targets 측 _shared/ 패턴 측 = AlarmkitBridge Pod 측 ❌ 도달 (= ExpoModulesCore 의존
//        독립 Swift module). AlarmkitBridge Pod 측 = 자체 ShutTimerAlarmMetadata 정의 별도 보유 영역.
//
// v1.7 hotfix #LAUnify Phase 10-G0a — AlarmkitBridge Pod 측 자체 정의 추가 (= 별도 Swift module 측 자체 type)
//   → AlarmKit framework 측 = ActivityKit Codable serialization 기반 → struct layout 일치 시 widget extension
//     측 metadata 정상 디코딩 + UI rendering 정합.
//
// 동기화 부탁 (= 필드 추가/변경 시 양쪽 동시 갱신 필수).
//   widget extension target 측 = 본 file
//   AlarmkitBridge Pod 측 = `modules/alarmkit-bridge/ios/ShutTimerAlarmMetadata.swift`

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
