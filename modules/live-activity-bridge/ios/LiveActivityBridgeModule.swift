// Live Activity bridge for ShutTimer — iOS 16.2+ only.
// routine 진행 중 잠금화면 + 다이내믹 아일랜드 표시.
// iOS 16.1 이하는 areActivitiesEnabled=false 반환 → JS 측에서 silent skip.

import ExpoModulesCore
import Foundation

#if canImport(ActivityKit)
import ActivityKit
#endif

public class LiveActivityBridgeModule: Module {
  // iOS 16.2+ 활동 보관. Any cast 로 iOS 가용성 가드와 무관하게 dictionary 사용.
  private var activities: [String: Any] = [:]

  public func definition() -> ModuleDefinition {
    Name("LiveActivityBridge")

    Function("areActivitiesEnabled") { () -> Bool in
      if #available(iOS 16.2, *) {
        return ActivityAuthorizationInfo().areActivitiesEnabled
      }
      return false
    }

    AsyncFunction("start") { (params: StartParams) async throws -> String in
      if #available(iOS 16.2, *) {
        let attributes = ShutTimerActivityAttributes(
          routineName: params.routineName,
          routineId: params.routineId
        )
        let contentState = ShutTimerActivityAttributes.ContentState(
          currentStepName: params.stepName,
          stepEndAt: params.stepEndAt,
          progress: params.progress,
          paused: false,
          stage: params.stage ?? "step",
          currentStepIndex: params.currentStepIndex ?? 0,
          totalSteps: params.totalSteps ?? 1
        )
        let activity = try Activity<ShutTimerActivityAttributes>.request(
          attributes: attributes,
          content: .init(state: contentState, staleDate: nil)
        )
        let activityId = activity.id
        self.activities[activityId] = activity
        return activityId
      }
      throw NSError(
        domain: "LiveActivityBridge",
        code: 1,
        userInfo: [NSLocalizedDescriptionKey: "LiveActivity requires iOS 16.2+"]
      )
    }

    AsyncFunction("update") { (params: UpdateParams) async throws in
      guard #available(iOS 16.2, *) else { return }
      guard let activity = self.activities[params.activityId] as? Activity<ShutTimerActivityAttributes> else { return }
      let contentState = ShutTimerActivityAttributes.ContentState(
        currentStepName: params.stepName,
        stepEndAt: params.stepEndAt,
        progress: params.progress,
        paused: false,
        stage: params.stage ?? "step",
        currentStepIndex: params.currentStepIndex ?? 0,
        totalSteps: params.totalSteps ?? 1
      )
      await activity.update(.init(state: contentState, staleDate: nil))
    }

    AsyncFunction("end") { (params: EndParams) async throws in
      guard #available(iOS 16.2, *) else { return }
      guard let activity = self.activities[params.activityId] as? Activity<ShutTimerActivityAttributes> else { return }
      let policy: ActivityUIDismissalPolicy = params.dismissalPolicy == "immediate" ? .immediate : .default
      await activity.end(nil, dismissalPolicy: policy)
      self.activities.removeValue(forKey: params.activityId)
    }

    AsyncFunction("endAll") { () async in
      guard #available(iOS 16.2, *) else { return }
      for activity in Activity<ShutTimerActivityAttributes>.activities {
        await activity.end(nil, dismissalPolicy: .immediate)
      }
      self.activities.removeAll()
    }
  }
}

struct StartParams: Record {
  @Field var routineId: String
  @Field var routineName: String
  @Field var stepName: String
  @Field var stepEndAt: Double
  @Field var progress: Double
  /** v1.6 Phase 12 — LA stage. 'step' (default) | 'manual_prompt' */
  @Field var stage: String?
  /** v1.6 hotfix — 0-based 현재 step index */
  @Field var currentStepIndex: Int?
  /** v1.6 hotfix — 총 step 수 */
  @Field var totalSteps: Int?
}

struct UpdateParams: Record {
  @Field var activityId: String
  @Field var stepName: String
  @Field var stepEndAt: Double
  @Field var progress: Double
  @Field var stage: String?
  @Field var currentStepIndex: Int?
  @Field var totalSteps: Int?
}

struct EndParams: Record {
  @Field var activityId: String
  @Field var dismissalPolicy: String?
}
