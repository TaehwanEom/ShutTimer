// AlarmKit bridge for ShutTimer — iOS 26+ only.
// 64 알림 한도 우회 + 사일런트/Focus 자동 우회.
// iOS 25 이하는 isAvailable=false 반환 → JS 측에서 expo-notifications 폴백.

import ExpoModulesCore
import Foundation

#if canImport(AlarmKit)
import AlarmKit
import SwiftUI
#endif

@available(iOS 26.0, *)
nonisolated struct ShutTimerAlarmMetadata: AlarmMetadata {
  // ShutTimer 측에서 routineId 로 매칭하므로 metadata 자체는 비움
}

public class AlarmkitBridgeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("AlarmkitBridge")

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

      let stopButton = AlarmButton(
        text: LocalizedStringResource(stringLiteral: params.stopLabel ?? "Stop"),
        textColor: .white,
        systemImageName: "stop.fill"
      )
      let alert = AlarmPresentation.Alert(
        title: LocalizedStringResource(stringLiteral: params.title),
        stopButton: stopButton
      )
      let presentation = AlarmPresentation(alert: alert)
      let attributes = AlarmAttributes<ShutTimerAlarmMetadata>(
        presentation: presentation,
        tintColor: Color.red
      )

      let id = UUID()
      _ = try await AlarmManager.shared.schedule(
        id: id,
        configuration: .alarm(schedule: schedule, attributes: attributes)
      )
      return id.uuidString
    }

    AsyncFunction("cancelAlarm") { (alarmId: String) async throws in
      guard #available(iOS 26.0, *) else { return }
      guard let uuid = UUID(uuidString: alarmId) else { return }
      try await AlarmManager.shared.cancel(id: uuid)
    }

    AsyncFunction("listAlarms") { () async throws -> [String] in
      guard #available(iOS 26.0, *) else { return [] }
      let alarms = try AlarmManager.shared.alarms
      return alarms.map { $0.id.uuidString }
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
}
