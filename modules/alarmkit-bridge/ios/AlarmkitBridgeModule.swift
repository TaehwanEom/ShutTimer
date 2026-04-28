// AlarmKit bridge for ShutTimer — iOS 26+ only.
// 64 알림 한도 우회 + 사일런트/Focus 자동 우회.
// iOS 25 이하는 isAvailable=false 반환 → JS 측에서 expo-notifications 폴백.

import ExpoModulesCore
import Foundation

#if canImport(AlarmKit)
import AlarmKit
import SwiftUI
#endif

#if canImport(ActivityKit)
import ActivityKit
#endif

@available(iOS 26.0, *)
nonisolated struct ShutTimerAlarmMetadata: AlarmMetadata {
  // ShutTimer 측에서 routineId 로 매칭하므로 metadata 자체는 비움
}

public class AlarmkitBridgeModule: Module {
  // v1.6 T1 — alarmUpdates AsyncSequence 구독 Task 보관
  private var observerTask: Task<Void, Never>?

  public func definition() -> ModuleDefinition {
    Name("AlarmkitBridge")

    // v1.6 T1 — JS 측 addListener 가능한 이벤트
    Events("onAlarmStateChange")

    // v1.6 T1 — alarmUpdates AsyncSequence 구독 (Opt-A)
    OnStartObserving {
      self.observerTask?.cancel()
      self.observerTask = Task { [weak self] in
        guard #available(iOS 26.0, *) else { return }
        var lastStates: [UUID: Alarm.State] = [:]
        for await alarms in AlarmManager.shared.alarmUpdates {
          guard let self = self else { return }
          let currentIds = Set(alarms.map { $0.id })
          // removed 감지
          for (id, _) in lastStates where !currentIds.contains(id) {
            self.sendEvent("onAlarmStateChange", [
              "alarmId": id.uuidString,
              "state": "removed",
            ])
          }
          // state 변화 감지
          for alarm in alarms {
            let prev = lastStates[alarm.id]
            if prev != alarm.state {
              self.sendEvent("onAlarmStateChange", [
                "alarmId": alarm.id.uuidString,
                "state": Self.alarmStateToString(alarm.state),
              ])
            }
          }
          lastStates = Dictionary(uniqueKeysWithValues: alarms.map { ($0.id, $0.state) })
        }
      }
    }

    OnStopObserving {
      self.observerTask?.cancel()
      self.observerTask = nil
    }

    Function("isAvailable") { () -> Bool in
      if #available(iOS 26.0, *) {
        return true
      }
      return false
    }

    AsyncFunction("requestAuthorization") { () async throws -> String in
      guard #available(iOS 26.0, *) else { return "unsupported" }
      let state = try await AlarmManager.shared.requestAuthorization()
      return Self.stateToString(state)
    }

    AsyncFunction("getAuthorizationState") { () -> String in
      guard #available(iOS 26.0, *) else { return "unsupported" }
      return Self.stateToString(AlarmManager.shared.authorizationState)
    }

    AsyncFunction("scheduleAlarm") { (params: ScheduleAlarmParams) async throws -> String in
      guard #available(iOS 26.0, *) else {
        throw NSError(
          domain: "AlarmkitBridge",
          code: 1,
          userInfo: [NSLocalizedDescriptionKey: "AlarmKit requires iOS 26.0+"]
        )
      }

      let fireDate = Date(timeIntervalSince1970: params.fireAt / 1000.0)
      let schedule = Alarm.Schedule.fixed(fireDate)

      // v1.6 Phase 5 — iOS 26.1+ 에서 stopButton deprecated. #available 분기.
      // v1.6 hotfix — confirm_prompt 타입 + secondaryLabel 전달 시 secondary button 결합.
      // AdvanceNextStepIntent 가 App Group "la_control_signal" 에 advance 작성 → RN polling 처리.
      let hasSecondary = params.type == "confirm_prompt"
        && (params.secondaryLabel?.isEmpty == false)
      let alert: AlarmPresentation.Alert
      if #available(iOS 26.1, *) {
        if hasSecondary, let secLabel = params.secondaryLabel {
          let secondaryButton = AlarmButton(
            text: LocalizedStringResource(stringLiteral: secLabel),
            textColor: .white,
            systemImageName: "forward.fill"
          )
          alert = AlarmPresentation.Alert(
            title: LocalizedStringResource(stringLiteral: params.title),
            secondaryButton: secondaryButton,
            secondaryButtonBehavior: .custom
          )
        } else {
          alert = AlarmPresentation.Alert(
            title: LocalizedStringResource(stringLiteral: params.title)
          )
        }
      } else {
        let stopButton = AlarmButton(
          text: LocalizedStringResource(stringLiteral: params.stopLabel ?? "Stop"),
          textColor: .white,
          systemImageName: "stop.fill"
        )
        if hasSecondary, let secLabel = params.secondaryLabel {
          let secondaryButton = AlarmButton(
            text: LocalizedStringResource(stringLiteral: secLabel),
            textColor: .white,
            systemImageName: "forward.fill"
          )
          alert = AlarmPresentation.Alert(
            title: LocalizedStringResource(stringLiteral: params.title),
            stopButton: stopButton,
            secondaryButton: secondaryButton,
            secondaryButtonBehavior: .custom
          )
        } else {
          alert = AlarmPresentation.Alert(
            title: LocalizedStringResource(stringLiteral: params.title),
            stopButton: stopButton
          )
        }
      }
      let presentation = AlarmPresentation(alert: alert)
      let attributes = AlarmAttributes<ShutTimerAlarmMetadata>(
        presentation: presentation,
        tintColor: Color.red
      )

      // v1.6 Phase 12 — sound 파라미터 명시 (이전: default 미지정 = 사용자 디바이스 매너모드 시 묵음 가능).
      // params.soundName 비어있으면 default system sound 사용.
      let alertSound: AlertConfiguration.AlertSound
      if let name = params.soundName, !name.isEmpty {
        alertSound = .named(name)
      } else {
        alertSound = .default
      }

      // v1.6 Phase 5-Lite — chain alarm 만 stopIntent 전달.
      // v1.6 hotfix — confirm_prompt + secondaryLabel 시 secondaryIntent 결합 (AdvanceNextStepIntent).
      let id = UUID()
      let config: AlarmManager.AlarmConfiguration<ShutTimerAlarmMetadata>
      if params.type == "chain" {
        config = .alarm(
          schedule: schedule,
          attributes: attributes,
          stopIntent: NextStepIntent(),
          sound: alertSound
        )
      } else if hasSecondary {
        config = .alarm(
          schedule: schedule,
          attributes: attributes,
          secondaryIntent: AdvanceNextStepIntent(routineId: params.routineId),
          sound: alertSound
        )
      } else {
        config = .alarm(
          schedule: schedule,
          attributes: attributes,
          sound: alertSound
        )
      }
      _ = try await AlarmManager.shared.schedule(id: id, configuration: config)
      return id.uuidString
    }

    AsyncFunction("cancelAlarm") { (alarmId: String) async throws in
      guard #available(iOS 26.0, *) else { return }
      guard let uuid = UUID(uuidString: alarmId) else { return }
      try await AlarmManager.shared.cancel(id: uuid)
    }

    // v1.6 Phase 10-A — App Group UserDefaults helper (LA Intent 동기화 통로)
    Function("writeAppGroupString") { (key: String, value: String?) -> Bool in
      guard let defaults = UserDefaults(suiteName: "group.com.shuttimer.app") else { return false }
      if let v = value {
        defaults.set(v, forKey: key)
      } else {
        defaults.removeObject(forKey: key)
      }
      return true
    }

    Function("readAppGroupString") { (key: String) -> String? in
      guard let defaults = UserDefaults(suiteName: "group.com.shuttimer.app") else { return nil }
      return defaults.string(forKey: key)
    }

    Function("removeAppGroupKey") { (key: String) -> Bool in
      guard let defaults = UserDefaults(suiteName: "group.com.shuttimer.app") else { return false }
      defaults.removeObject(forKey: key)
      return true
    }

    // v1.6 T1 — listAlarms 반환 형식 변경 ([String] → [{ id, state }]). 콜드스타트 alerting filter.
    AsyncFunction("listAlarms") { () async throws -> [[String: String]] in
      guard #available(iOS 26.0, *) else { return [] }
      let alarms = try AlarmManager.shared.alarms
      return alarms.map { alarm in
        [
          "id": alarm.id.uuidString,
          "state": Self.alarmStateToString(alarm.state),
        ]
      }
    }
  }

  // v1.6 T1 — Alarm.State → String 매핑
  @available(iOS 26.0, *)
  private static func alarmStateToString(_ state: Alarm.State) -> String {
    switch state {
    case .scheduled: return "scheduled"
    case .countdown: return "countdown"
    case .paused: return "paused"
    case .alerting: return "alerting"
    @unknown default: return "scheduled"
    }
  }

  @available(iOS 26.0, *)
  private static func stateToString(_ state: AlarmManager.AuthorizationState) -> String {
    switch state {
    case .notDetermined: return "notDetermined"
    case .denied: return "denied"
    case .authorized: return "authorized"
    @unknown default: return "unknown"
    }
  }
}

struct ScheduleAlarmParams: Record {
  @Field var routineId: String
  @Field var title: String
  @Field var fireAt: Double
  @Field var stopLabel: String?
  @Field var soundName: String?
  // v1.6 T1 신규 — chain/confirm_prompt 메타데이터 (JS mapping table 정공이라 Swift 본문 미사용)
  @Field var type: String?              // 'prealert' | 'chain' | 'confirm_prompt'
  @Field var nextStepIndex: Int?
  @Field var endMethod: String?         // 'tap' | 'shake' | 'camera' | 'auto'
  // v1.6 hotfix — confirm_prompt 잠금 alerting UI 의 보조 버튼 라벨. 미전달 시 stop 버튼만 노출 (회귀 X)
  @Field var secondaryLabel: String?
}
