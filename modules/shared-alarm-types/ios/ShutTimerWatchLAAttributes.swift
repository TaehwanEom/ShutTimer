// Apple Watch Smart Stack 전용 ActivityKit Live Activity attributes 영역.
// v1.8 #WatchLADirect — AlarmKit framework 자동 LA 측 ActivityKit Activity.activities 등록 측 측정 ❌
//   (= alerting 시점 측 count=0 단서 강력) → WWDC24 자동 워치 mirror 메커니즘 (= Activity.activities 등록 측
//   LA 측만 워치 mirror) 측 전제 fail. 정정 = 별도 ActivityAttributes type 측 ActivityKit `Activity.request`
//   직접 호출 → Activity.activities 등록 ✅ 보장 → 워치 Smart Stack 자동 mirror ✅.
//
// iPhone 측 = framework auto LA (= AlarmAttributes<ShutTimerAlarmMetadata>) 그대로 표시 + 본 widget 측
//   `.medium` 측 EmptyView 측 → iPhone 측 시각 충돌 ❌.
// 워치 측 = 본 widget `.small` 측 ShutTimerWatchLAView 표시.

import Foundation
import ActivityKit

@available(iOS 26.0, *)
public struct ShutTimerWatchLAAttributes: ActivityAttributes {
    public typealias ContentState = State

    public struct State: Codable, Hashable {
        // mode = "countdown" | "paused" | "alert"
        public var mode: String
        public var startDate: Date
        public var fireDate: Date
        public var pausedRemainingSec: Double
        public var routineName: String
        public var stepName: String
        public var stepIndex: Int
        public var totalSteps: Int
        public var routineId: String
        // v1.8 #WatchLAAlarmId — AppIntent 측 AlarmManager.pause/resume/stop 측 직접 호출 위해 alarmId 측 추가.
        //   직전 = AppIntent 측 routineId 측 = chain_alarms / routineSnapshot 측 lookup ❌ (= timer_main 측 = routine ❌)
        //   → AlarmManager 측 호출 ❌ → 워치 측 조작 sync ❌ root cause.
        public var alarmId: String

        public init(
            mode: String,
            startDate: Date,
            fireDate: Date,
            pausedRemainingSec: Double,
            routineName: String,
            stepName: String,
            stepIndex: Int,
            totalSteps: Int,
            routineId: String,
            alarmId: String
        ) {
            self.mode = mode
            self.startDate = startDate
            self.fireDate = fireDate
            self.pausedRemainingSec = pausedRemainingSec
            self.routineName = routineName
            self.stepName = stepName
            self.stepIndex = stepIndex
            self.totalSteps = totalSteps
            self.routineId = routineId
            self.alarmId = alarmId
        }
    }

    // entity 측 (= alarmId 측) Activity 매칭 위해 alarmId 측 attribute 측 보존.
    public var alarmId: String
    public var entityId: String

    public init(alarmId: String, entityId: String) {
        self.alarmId = alarmId
        self.entityId = entityId
    }
}
