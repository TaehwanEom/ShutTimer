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
      // v1.7 hotfix #LAUnify Phase 7 — false 강제 영역.
      //   AlarmKit framework 측 .timer(duration:attributes:) factory → Activity<AlarmAttributes<...>>
      //   자동 시작 영역 + 직전 LiveActivityBridge.start 측 별도 LA 시작 = 두 LA 동시 → 시스템 측
      //   한 개만 표시 / 충돌 영역 (= 카운터 시각 ❌ root cause).
      //   본 commit = areActivitiesEnabled false 강제 → JS 측 LiveActivityBridge.start 호출 측 가드 통과 ❌ →
      //   AlarmKit framework 측 자체 LA Activity 측만 단독 활성 → widget extension 측 AlarmAttributes
      //   layout (= Phase 6 등록) 단독 표시 → 카운터 정상.
      //   update / end / endAll 측 = activities 측 빈 영역 → no-op 영역 정합 (= 별도 변경 ❌).
      return false
    }

    AsyncFunction("start") { (params: StartParams) async throws -> String in
      if #available(iOS 16.2, *) {
        // v1.7 hotfix #21 — debug log (= 위젯 0:00 root cause 추적용).
        let nowMs = Date().timeIntervalSince1970 * 1000
        NSLog("[LA start] stepEndAt=%f now=%f delta=%f routineId=%@ stepName=%@", params.stepEndAt, nowMs, params.stepEndAt - nowMs, params.routineId, params.stepName)
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
      // v1.7 hotfix #21 — debug log (= 위젯 0:00 root cause 추적용).
      let nowMs = Date().timeIntervalSince1970 * 1000
      NSLog("[LA update] stepEndAt=%f now=%f delta=%f stepName=%@ stage=%@ paused=%@", params.stepEndAt, nowMs, params.stepEndAt - nowMs, params.stepName, params.stage ?? "step", String(describing: params.paused ?? false))
      // v1.7 hotfix #30 — paused field 영역. JS 측 = ar.pausedAt !== null 검증 후 전달.
      // 누락 시 = false (= 기존 호환 보존).
      let contentState = ShutTimerActivityAttributes.ContentState(
        currentStepName: params.stepName,
        stepEndAt: params.stepEndAt,
        progress: params.progress,
        paused: params.paused ?? false,
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
  /** v1.7 hotfix #30 — paused field. JS 측 ar.pausedAt !== null 시 true 전달. 누락 시 false 보존. */
  @Field var paused: Bool?
}

struct EndParams: Record {
  @Field var activityId: String
  @Field var dismissalPolicy: String?
}
