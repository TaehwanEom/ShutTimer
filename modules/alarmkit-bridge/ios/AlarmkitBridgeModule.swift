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
      // v1.6 hotfix — timer_main 에 stopIntent: OpenAppDismissIntent 결합. slide-to-stop 시
      //   앱 자동 foreground 진입 → AlarmScreen → 사용자 dismiss method (탭/흔들기/카메라) 정공.
      // v1.6 옵션 C 통합 — 모든 alarm 분기 .timer(duration:) 통합 (countdown state → pause 호환).
      // AlarmManager.pause(id:) = countdown state alarm 만 호환 (Apple 공식). fixed schedule = scheduled state = throw.
      // 모든 분기 .timer(duration:) + Countdown/Paused presentation 통일.
      let nowMsAll = Date().timeIntervalSince1970 * 1000.0
      let durationSecAll = max(0.001, (params.fireAt - nowMsAll) / 1000.0)
      let pauseButtonAll = AlarmButton(
        text: LocalizedStringResource(stringLiteral: "일시정지"),
        textColor: .white,
        systemImageName: "pause.fill"
      )
      let resumeButtonAll = AlarmButton(
        text: LocalizedStringResource(stringLiteral: "재개"),
        textColor: .white,
        systemImageName: "play.fill"
      )
      let countdownAll = AlarmPresentation.Countdown(
        title: LocalizedStringResource(stringLiteral: params.title),
        pauseButton: pauseButtonAll
      )
      let pausedAll = AlarmPresentation.Paused(
        title: LocalizedStringResource(stringLiteral: "일시정지됨"),
        resumeButton: resumeButtonAll
      )
      let timerPresentationAll = AlarmPresentation(
        alert: alert,
        countdown: countdownAll,
        paused: pausedAll
      )
      let timerAttributesAll = AlarmAttributes<ShutTimerAlarmMetadata>(
        presentation: timerPresentationAll,
        tintColor: Color.red
      )

      let id = UUID()

      // v1.6+ — recurrence 옵션 (= type='alarm_main' 측) → .alarm(schedule:) factory 분기.
      // OS 자동 반복 (= .relative(.weekly([...]))). 재예약 listener 불필요.
      if let recurrence = params.recurrence, recurrence.mode != "never" {
        let fireDate = Date(timeIntervalSince1970: params.fireAt / 1000.0)
        let cal = Calendar.current
        let comp = cal.dateComponents([.hour, .minute], from: fireDate)
        guard let hour = comp.hour, let minute = comp.minute else {
          throw NSError(
            domain: "AlarmkitBridge",
            code: 2,
            userInfo: [NSLocalizedDescriptionKey: "recurrence: invalid fireAt"]
          )
        }

        let time = Alarm.Schedule.Relative.Time(hour: hour, minute: minute)

        // JS days[] (0=일~6=토) → Locale.Weekday 변환.
        let dayMap: [Int: Locale.Weekday] = [
          0: .sunday, 1: .monday, 2: .tuesday, 3: .wednesday,
          4: .thursday, 5: .friday, 6: .saturday
        ]
        let weekdays: [Locale.Weekday]
        if recurrence.mode == "daily" {
          weekdays = [.sunday, .monday, .tuesday, .wednesday, .thursday, .friday, .saturday]
        } else { // "weekly"
          let candidates = (recurrence.days ?? []).compactMap { dayMap[$0] }
          if candidates.isEmpty {
            throw NSError(
              domain: "AlarmkitBridge",
              code: 3,
              userInfo: [NSLocalizedDescriptionKey: "recurrence: weekly requires days"]
            )
          }
          weekdays = candidates
        }

        let recurrenceObj = Alarm.Schedule.Relative.Recurrence.weekly(weekdays)
        let schedule = Alarm.Schedule.relative(.init(time: time, repeats: recurrenceObj))

        // .alarm(schedule:) presentation = alert 만 사용 (= countdown / paused 영역 ❌).
        let alarmPresentation = AlarmPresentation(alert: alert)
        let alarmAttributes = AlarmAttributes<ShutTimerAlarmMetadata>(
          presentation: alarmPresentation,
          tintColor: Color.red
        )

        let alarmConfig: AlarmManager.AlarmConfiguration<ShutTimerAlarmMetadata> = .alarm(
          schedule: schedule,
          attributes: alarmAttributes,
          stopIntent: OpenAppDismissIntent(entityId: params.entityId),
          sound: alertSound
        )
        _ = try await AlarmManager.shared.schedule(id: id, configuration: alarmConfig)
        return id.uuidString
      }

      let config: AlarmManager.AlarmConfiguration<ShutTimerAlarmMetadata>
      if params.type == "chain" {
        config = .timer(
          duration: durationSecAll,
          attributes: timerAttributesAll,
          stopIntent: NextStepIntent(),
          sound: alertSound
        )
      } else if params.type == "timer_main" {
        config = .timer(
          duration: durationSecAll,
          attributes: timerAttributesAll,
          stopIntent: OpenAppDismissIntent(entityId: params.entityId),
          sound: alertSound
        )
      } else if hasSecondary {
        config = .timer(
          duration: durationSecAll,
          attributes: timerAttributesAll,
          stopIntent: OpenAppDismissIntent(entityId: params.entityId),
          secondaryIntent: AdvanceNextStepIntent(entityId: params.entityId),
          sound: alertSound
        )
      } else if params.type == "confirm_prompt" {
        config = .timer(
          duration: durationSecAll,
          attributes: timerAttributesAll,
          stopIntent: OpenAppDismissIntent(entityId: params.entityId),
          sound: alertSound
        )
      } else {
        config = .timer(
          duration: durationSecAll,
          attributes: timerAttributesAll,
          stopIntent: OpenAppDismissIntent(entityId: params.entityId),
          sound: alertSound
        )
      }
      _ = try await AlarmManager.shared.schedule(id: id, configuration: config)
      return id.uuidString
    }

    AsyncFunction("cancelAlarm") { (alarmId: String) async throws in
      guard #available(iOS 26.0, *) else { return }
      guard let uuid = UUID(uuidString: alarmId) else { return }
      // v1.6 후속 hotfix — alerting 상태 알람 = stop(id:) (= 사운드/진동/UI dismiss).
      // 그 외 (= scheduled / countdown / paused) = cancel(id:) (= 발화 전 cancel).
      let alarms = try AlarmManager.shared.alarms
      if let alarm = alarms.first(where: { $0.id == uuid }), alarm.state == .alerting {
        try await AlarmManager.shared.stop(id: uuid)
      } else {
        try await AlarmManager.shared.cancel(id: uuid)
      }
    }

    AsyncFunction("stopAlarm") { (alarmId: String) async throws in
      guard #available(iOS 26.0, *) else { return }
      guard let uuid = UUID(uuidString: alarmId) else { return }
      try await AlarmManager.shared.stop(id: uuid)
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

// v1.6+ — recurrence 옵션 (= AlarmKit `.relative(.weekly([...]))` 측 OS 자동 반복).
struct RecurrenceParams: Record {
  @Field var mode: String          // 'never' | 'daily' | 'weekly'
  @Field var days: [Int]?          // mode='weekly' 시 0(일)~6(토)
}

struct ScheduleAlarmParams: Record {
  // v1.6+ — entityId (= 카테고리 B 일반화, rename 결정 4-B). 루틴/타이머/알람 식별자 공통.
  @Field var entityId: String
  @Field var title: String
  @Field var fireAt: Double
  @Field var stopLabel: String?
  @Field var soundName: String?
  // v1.6 T1 신규 — chain/confirm_prompt/alarm_main 메타데이터 (JS mapping table 정공이라 Swift 본문 미사용)
  @Field var type: String?              // 'prealert' | 'chain' | 'confirm_prompt' | 'timer_main' | 'alarm_main'
  @Field var nextStepIndex: Int?
  @Field var endMethod: String?         // 'tap' | 'shake' | 'camera' | 'auto'
  // v1.6 hotfix — confirm_prompt 잠금 alerting UI 의 보조 버튼 라벨. 미전달 시 stop 버튼만 노출 (회귀 X)
  @Field var secondaryLabel: String?
  // v1.6+ — recurrence 옵션 (= type='alarm_main' 측 사용). mode='daily'/'weekly' 시 .alarm(schedule:) 분기.
  @Field var recurrence: RecurrenceParams?
}
