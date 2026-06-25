// AlarmKit 자동 LA Activity 측 AlarmAttributes<ShutTimerAlarmMetadata> 단일 정의 영역.
// v1.7 hotfix #LAUnify Phase 10-G2 — 별도 SharedAlarmTypes Pod 측 단일 Swift module identity 보장.
//
// 배경 = ActivityKit framework 측 widget lookup = module-level type identity 매칭 필수.
//   직전 옵션 α (= AlarmkitBridge Pod + widget extension 측 자체 정의) 측 = 별도 module identity
//   → ActivityKit lookup ❌ → widget body 호출 ❌ → 잠금화면 LA 안 보임 root cause.
//
// 본 commit = AlarmkitBridge Pod + widget extension target 측 = 본 Pod 측 import →
//   단일 Swift module identity (= SharedAlarmTypes.ShutTimerAlarmMetadata) 보장 →
//   ActivityKit widget lookup 정합 → widget body 정상 호출.
//
// 사용 site:
//   AlarmkitBridge Pod 측 = AlarmkitBridgeModule.swift + AdvanceNextStepIntent.swift
//   widget extension target 측 = WidgetLiveActivity.swift + RoutineControlIntents.swift
//
// cross-module access 위해 struct + 모든 field + init 측 public 명시 필수.

import Foundation

#if canImport(AlarmKit)
import AlarmKit

@available(iOS 26.0, *)
public nonisolated struct ShutTimerAlarmMetadata: AlarmMetadata {
    public var currentStepName: String? = nil
    public var currentStepIndex: Int = 0
    public var totalSteps: Int = 1
    public var stage: String = "step"
    public var paused: Bool = false
    public var pausedAt: Double? = nil
    public var routineId: String? = nil
    public var routineName: String? = nil
    // 2026-06-25 — 위젯 LA(.alert) 큰 글씨 슬롯 안내 문구. 알람="종료 미션을 진행" / 루틴="다음 루틴을 진행"(JS 현지화 전달).
    //   미전달 시 nil → 위젯 빈 슬롯(회귀 X).
    public var alertMessage: String? = nil
    // v1.8 #LARelevanceMatch — AlarmKit Alarm.id 측 = Activity.id ≠ 영역 → metadata 측 alarmId 매칭 키 영역.
    //   updateActivityRelevance 측 = activities.first(where: { $0.attributes.metadata?.alarmId == alarmId }) 사용.
    public var alarmId: String? = nil

    public init(
        currentStepName: String? = nil,
        currentStepIndex: Int = 0,
        totalSteps: Int = 1,
        stage: String = "step",
        paused: Bool = false,
        pausedAt: Double? = nil,
        routineId: String? = nil,
        routineName: String? = nil,
        alertMessage: String? = nil,
        alarmId: String? = nil
    ) {
        self.currentStepName = currentStepName
        self.currentStepIndex = currentStepIndex
        self.totalSteps = totalSteps
        self.stage = stage
        self.paused = paused
        self.pausedAt = pausedAt
        self.routineId = routineId
        self.routineName = routineName
        self.alertMessage = alertMessage
        self.alarmId = alarmId
    }
}
#endif
