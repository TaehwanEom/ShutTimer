// AlarmKit bridge for ShutTimer — iOS 26+ only.
// 64 알림 한도 우회 + 사일런트/Focus 자동 우회.
// iOS 25 이하는 isAvailable=false 반환 → JS 측에서 expo-notifications 폴백.

import ExpoModulesCore
import Foundation

// v1.7 hotfix #DBG — App Group UserDefaults 측 native log 저장 helper.
// JS 측 SettingsScreen "최근 로그 공유" → AlarmkitBridge.readAppGroupString("native_debug_log_v1") 합쳐 영역.
// 다중 기기 / Apple Watch 측 = 각 process 측 자체 storage → 각 device 측 앱 내 공유.
fileprivate let NATIVE_DBG_GROUP = "group.com.shuttimer.app"
fileprivate let NATIVE_DBG_KEY = "native_debug_log_v1"
fileprivate let NATIVE_DBG_MAX = 300

fileprivate func appendNativeDbg(_ tag: String, _ msg: String) {
    NSLog("[\(tag)] \(msg)")
    guard let d = UserDefaults(suiteName: NATIVE_DBG_GROUP) else { return }
    let ts = ISO8601DateFormatter().string(from: Date())
    let proc = ProcessInfo.processInfo.processName
    let line = "\(ts) [\(proc)][\(tag)] \(msg)"
    let existing = d.string(forKey: NATIVE_DBG_KEY) ?? ""
    var lines = existing.isEmpty ? [] : existing.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
    lines.append(line)
    if lines.count > NATIVE_DBG_MAX { lines = Array(lines.suffix(NATIVE_DBG_MAX)) }
    d.set(lines.joined(separator: "\n"), forKey: NATIVE_DBG_KEY)
}

#if canImport(AlarmKit)
import AlarmKit
import SharedAlarmTypes
import SwiftUI
#endif

#if canImport(ActivityKit)
import ActivityKit
#endif

// v1.7 hotfix #LAUnify Phase 10-G1 — 옛 Activity.request/update/end manual 호출 제거 (= AlarmKit framework가 LA Activity 자동 관리).
// v1.7 hotfix #LAUnify Phase 10-G1b — ActivityKit import 복원. AlertConfiguration.AlertSound (= AlarmKit alarm sound 측 ActivityKit type 채택 영역) 측 = ActivityKit import 필요.
//   증거 = https://developer.apple.com/documentation/activitykit/alertconfiguration/alertsound (= URL path activitykit/alertconfiguration/alertsound).
//   본 file 측 = 옛 Activity.request/update/end 호출 site 측 추가 ❌ (= CLAUDE.md rule 11 정합).

// v1.7 hotfix #LAUnify Phase 9-B — ShutTimerAlarmMetadata struct 정의 제거.
// 단일 정의 = `targets/widget/ShutTimerAlarmMetadata.swift` 측 두 target 측 file membership share.
// 직전 = 두 target 측 별도 file 측 별도 정의 → Swift module 측 별도 type → AlarmKit framework lookup mismatch
// → widget body 호출 ❌ + framework system fallback UI 표시 (= "검정 바" root cause).

// v1.7 hotfix #5 — alerting 시 native 측 LA stage='manual_prompt' 자동 갱신용.
// JS thread 측 background 정지 시 (= JS listener 측 setLiveActivityStage 호출 ❌) 영역 정합.
// AdvanceNextStepIntent.swift 측 RoutineSnapshot 와 동일 정합 (= 일부 필드만 디코딩).
private struct RoutineSnapshotMini: Codable {
  let routineId: String
  let currentAlarmId: String
}

private func readRoutineSnapshotMini() -> RoutineSnapshotMini? {
  guard let defaults = UserDefaults(suiteName: "group.com.shuttimer.app") else { return nil }
  guard let raw = defaults.string(forKey: "routine_snapshot"),
        let data = raw.data(using: .utf8) else { return nil }
  return try? JSONDecoder().decode(RoutineSnapshotMini.self, from: data)
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
      // v1.7 hotfix #DBG-B — observer 시작 진입 (= JS bridge 측 listener attach 추적용).
      appendNativeDbg("AlarmKit-DBG", "observer OnStartObserving 진입 — alarmUpdates 구독 시작")
      self.observerTask = Task { [weak self] in
        var lastStates: [UUID: Alarm.State] = [:]
        for await alarms in AlarmManager.shared.alarmUpdates {
          guard let self = self else { return }
          let currentIds = Set(alarms.map { $0.id })
          // removed 감지
          for (id, _) in lastStates where !currentIds.contains(id) {
            // v1.7 hotfix #DBG-B — removed 감지.
            appendNativeDbg("AlarmKit-DBG", "observer alarmId=\(id.uuidString) state=removed")
            self.sendEvent("onAlarmStateChange", [
              "alarmId": id.uuidString,
              "state": "removed",
            ])
          }
          // state 변화 감지
          for alarm in alarms {
            let prev = lastStates[alarm.id]
            if prev != alarm.state {
              // v1.7 hotfix #DBG-B — state 변화 (= 진동/banner root cause 추적용).
              appendNativeDbg("AlarmKit-DBG", "observer alarmId=\(alarm.id.uuidString) prev=\(String(describing: prev)) → cur=\(Self.alarmStateToString(alarm.state))")
              // v1.7 hotfix #LAUnify Phase 10-G4dbg2 — observer 측 매 state change 시 Activity.activities 측 active count 측정.
              // schedule 직후 = system sync 시간 부족 가능성. observer 측 = state change 시 = 시간 경과 후 → Activity 측정 정합.
              let activities = Activity<AlarmAttributes<ShutTimerAlarmMetadata>>.activities
              let activitiesDesc = activities.map { "\($0.id):\($0.activityState)" }.joined(separator: ",")
              appendNativeDbg("LA-DBG-AKLA-Activity", "observer alarmId=\(alarm.id.uuidString) state=\(Self.alarmStateToString(alarm.state)) Activity.activities.count=\(activities.count) [\(activitiesDesc)]")
              // v1.7 hotfix #G5 Phase A — preAlertSeconds + fixedFireMs + relativeHour/Minute emit (= JS 측 endAt 측정 단일화 영역).
              var eventPayload: [String: Any] = [
                "alarmId": alarm.id.uuidString,
                "state": Self.alarmStateToString(alarm.state),
              ]
              Self.appendScheduleAndCountdown(&eventPayload, alarm: alarm)
              self.sendEvent("onAlarmStateChange", eventPayload)

              // v1.7 hotfix #DBG-Sound (B4) — alerting 시점 alarm 측 schedule + countdownDuration 추적.
              // Apple 공식 (= AlarmKit Alarm struct 측 = id / state / schedule / countdownDuration 4개 멤버 영역).
              // sound 측 metadata 영역 = AlarmAttributes 측 영역 = Alarm instance 측 미노출 (= internal API).
              // = schedule + countdownDuration 측 출력 = alerting 시점 fire 정보 영역 (= 사운드 fire 시점 + duration root cause 영역).
              if alarm.state == .alerting {
                appendNativeDbg("AlarmKit-DBG", "alerting alarmId=\(alarm.id.uuidString) schedule=\(String(describing: alarm.schedule)) countdownDuration=\(String(describing: alarm.countdownDuration))")
              }

              // v1.7 hotfix #5 — alerting 시점 native 측 LA stage='manual_prompt' 자동 갱신.
              // JS thread 측 background 정지 시도 정합 (= App.tsx onAlarmStateChange listener →
              // setLiveActivityStage 호출 ❌ 영역. JS 측 hotfix #4 = active 시점만 효과).
              // 매칭 = snapshot.currentAlarmId vs alarm.id (= routine confirm_prompt 측 only).
              // v1.7 hotfix #LAUnify Phase 10-G1 — Activity<ShutTimerActivityAttributes> manual stage update 제거.
              // AlarmKit framework가 alerting state 진입 시 mode=.alert 자동 전이 → AlarmKitLiveActivity widget이
              // alert mode 분기에서 "다음 진행" 버튼 자동 표시.
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

    // v1.7 hotfix #G7 Phase 2 — main app deployment target 26.0 강제 정합 → AlarmKit 항상 사용 가능.
    Function("isAvailable") { () -> Bool in
      return true
    }

    AsyncFunction("requestAuthorization") { () async throws -> String in
      let state = try await AlarmManager.shared.requestAuthorization()
      return Self.stateToString(state)
    }

    AsyncFunction("getAuthorizationState") { () -> String in
      return Self.stateToString(AlarmManager.shared.authorizationState)
    }

    AsyncFunction("scheduleAlarm") { (params: ScheduleAlarmParams) async throws -> String in
      // v1.7 hotfix #26 — debug log: scheduleAlarm 진입 시점.
      // 베너 미노출 root cause 추적용. fireAt = 절대 시각 (ms) → 디바이스 측 console 시각 비교.
      // recurrence ❌ = nil log / recurrence ✅ = mode + days log.
      // v1.7 hotfix #DBG-Sound — NSLog → appendNativeDbg 변환 (= App Group 통합 영역 정합).
      let nowDebugMs = Date().timeIntervalSince1970 * 1000.0
      let fireDeltaMs = params.fireAt - nowDebugMs
      let recDebug: String = {
        if let r = params.recurrence {
          return "\(r.mode)/\(r.days?.map(String.init).joined(separator: ",") ?? "-")"
        }
        return "nil"
      }()
      appendNativeDbg("AlarmKit-DBG", "schedule 진입 entity=\(params.entityId) type=\(params.type ?? "?") fireAt=\(params.fireAt) deltaMs=\(Int(fireDeltaMs)) recurrence=\(recDebug) soundName=\(params.soundName ?? "(nil)")")

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
        // v1.7 hotfix #DBG-Sound (B3) — default fallback 진입 측 WARN.
        // soundName 측 nil/empty 도달 시점 = 사용자 측 사운드 선택 측 누락 경로 영역.
        appendNativeDbg("AlarmKit-DBG-WARN", "sound default fallback 진입 entity=\(params.entityId) type=\(params.type ?? "?") soundName=\(params.soundName ?? "(nil)")")
      }
      // v1.7 hotfix #DBG-D — sound 분기 결과 (= 알람 사운드 ❌ / 다른 사운드 root cause 추적용).
      appendNativeDbg("AlarmKit-DBG", "sound entity=\(params.entityId) type=\(params.type ?? "?") soundName=\(params.soundName ?? "(nil)") branch=\((params.soundName?.isEmpty == false) ? "named" : "default")")

      // v1.7 hotfix #DBG-Sound (B2) — sound 분기 직후 bundle path resolve sanity check.
      // .named(name) 측 = OS 측 internal API. bundle 측 동일 stem (= .wav 가정 + 확장자 미포함 영역) path/size 직접 검증.
      // 미존재 시 = OS 측 default fallback 출력 영역 (= 사용자분 측 "알람 01 출력" root cause 후보).
      if let name = params.soundName, !name.isEmpty {
        let stem = (name as NSString).deletingPathExtension
        let ext = ((name as NSString).pathExtension.isEmpty) ? "wav" : (name as NSString).pathExtension
        if let path = Bundle.main.path(forResource: stem, ofType: ext) {
          let size = ((try? FileManager.default.attributesOfItem(atPath: path))?[.size] as? Int) ?? -1
          var first16hex = "(read fail)"
          if let fh = FileHandle(forReadingAtPath: path) {
            let data = fh.readData(ofLength: 16)
            first16hex = data.map { String(format: "%02x", $0) }.joined()
            fh.closeFile()
          }
          appendNativeDbg("AlarmKit-DBG", "sound resolve OK name=\(name) → path=\(path) size=\(size) first16=\(first16hex)")
        } else {
          appendNativeDbg("AlarmKit-DBG-WARN", "sound resolve FAIL name=\(name) stem=\(stem).\(ext) NOT FOUND in bundle (= OS default fallback 가능)")
        }
      }

      // v1.6 Phase 5-Lite — chain alarm 만 stopIntent 전달.
      // v1.6 hotfix — confirm_prompt + secondaryLabel 시 secondaryIntent 결합 (AdvanceNextStepIntent).
      // v1.6 hotfix — timer_main 에 stopIntent: OpenAppDismissIntent 결합. slide-to-stop 시
      //   앱 자동 foreground 진입 → AlarmScreen → 사용자 dismiss method (탭/흔들기/카메라) 정공.
      // v1.6 옵션 C 통합 — 모든 alarm 분기 .timer(duration:) 통합 (countdown state → pause 호환).
      // AlarmManager.pause(id:) = countdown state alarm 만 호환 (Apple 공식). fixed schedule = scheduled state = throw.
      // 모든 분기 .timer(duration:) + Countdown/Paused presentation 통일.
      let nowMsAll = Date().timeIntervalSince1970 * 1000.0
      let durationRawAll = (params.fireAt - nowMsAll) / 1000.0
      // v1.8 #StaleFireAt — stale fireAt 측 silent fail 정정. 직전 = max(0.001, ...) 측 = 과거 fireAt 측 0.001s fallback
      //   → .timer(duration: 0.001) 측 즉시 fire + 사용자분 측 못 들음 (= 가설 B root cause).
      //   정정 = durationRaw ≤ 0 시 = throw + WARN log. JS 측 catch → 다음 occurrence 재계산 또는 silent skip.
      if durationRawAll <= 0 {
        appendNativeDbg("AlarmKit-DBG-WARN", "stale fireAt entityId=\(params.entityId) type=\(params.type ?? "?") durationSec=\(durationRawAll) fireAt=\(params.fireAt) now=\(nowMsAll)")
        throw NSError(
          domain: "AlarmkitBridge",
          code: 5,
          userInfo: [NSLocalizedDescriptionKey: "stale fireAt: durationSec=\(durationRawAll)"]
        )
      }
      let durationSecAll = durationRawAll
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
      // v1.8 #LACountdownTitle — countdown title 측 = params.countdownTitle 우선, 미전달 시 params.title fallback.
      // 직전 = `Optional<Bool> == false` 비교 패턴 → Swift 측 비교 측 부정확 가능. 본 정정 = idiomatic if-let.
      let countdownTitleStr: String
      if let ct = params.countdownTitle, !ct.isEmpty {
        countdownTitleStr = ct
      } else {
        countdownTitleStr = params.title
      }
      // v1.8 #DBG-CountdownTitle — Swift 측 countdownTitle 수신 측정 (= JS bridge 측 @Field 측 동작 확인용).
      appendNativeDbg("AlarmKit-DBG-CTitle", "entity=\(params.entityId) type=\(params.type ?? "?") params.countdownTitle=\(params.countdownTitle ?? "(nil)") chosen=\(countdownTitleStr)")
      let countdownAll = AlarmPresentation.Countdown(
        title: LocalizedStringResource(stringLiteral: countdownTitleStr),
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
      // v1.7 hotfix #LAUnify Phase 3 — metadata 측 step 데이터 명시 영역.
      //   widget extension 측 AlarmAttributes layout (= Phase 6 영역) 측 = 본 metadata 측 사용 → step 표시 영역.
      // v1.8 #LARelevanceMatch — alarmId 측 = updateActivityRelevance 측 매칭 키 영역.
      let id = UUID()
      let metadataAll = ShutTimerAlarmMetadata(
        currentStepName: params.laStepName,
        currentStepIndex: params.laStepIndex ?? 0,
        totalSteps: params.laTotalSteps ?? 1,
        stage: params.laStage ?? "step",
        paused: params.laPaused ?? false,
        pausedAt: params.laPausedAt,
        routineId: params.laRoutineId ?? params.entityId,
        routineName: params.laRoutineName ?? params.title,
        alarmId: id.uuidString
      )
      let timerAttributesAll = AlarmAttributes<ShutTimerAlarmMetadata>(
        presentation: timerPresentationAll,
        metadata: metadataAll,
        tintColor: Color.red
      )

      // v1.8 #LARelevanceMatch — id 측 = metadataAll 측 이전 영역 이동 (= 위 영역).

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
        // v1.7 hotfix #LAUnify Phase 3 — metadata 측 = step 데이터 명시 (= alarm_main 측 단순 영역. routine ❌).
        let alarmPresentation = AlarmPresentation(alert: alert)
        let alarmAttributes = AlarmAttributes<ShutTimerAlarmMetadata>(
          presentation: alarmPresentation,
          metadata: metadataAll,
          tintColor: Color.red
        )

        let alarmConfig: AlarmManager.AlarmConfiguration<ShutTimerAlarmMetadata> = .alarm(
          schedule: schedule,
          attributes: alarmAttributes,
          stopIntent: OpenAppDismissIntent(entityId: params.entityId),
          sound: alertSound
        )

        _ = try await AlarmManager.shared.schedule(id: id, configuration: alarmConfig)
        // v1.7 hotfix #26 — debug log: scheduleAlarm 결과 (recurrence 영역).
        NSLog("[AlarmKit][schedule] 결과 OK alarmId=\(id.uuidString) entity=\(params.entityId) factory=alarm(schedule:)")
        // v1.7 hotfix #LAUnify Phase 10-G4dbg — ActivityKit Activity 측 active count + ID 측 native log.
        // root cause 추적: AlarmKit framework 측 .alarm factory 호출 시 Activity 자동 시작 정합 ❓
        let activities = Activity<AlarmAttributes<ShutTimerAlarmMetadata>>.activities
        let activitiesDesc = activities.map { "\($0.id):\($0.activityState)" }.joined(separator: ",")
        appendNativeDbg("LA-DBG-AKLA-Activity", "post-schedule(alarm) alarmId=\(id.uuidString) Activity.activities.count=\(activities.count) [\(activitiesDesc)]")
        // v1.8 #LARelevance — 발화 시각 가까울수록 relevanceScore 높게 → 잠금화면 LA banner / Dynamic Island 측 우선 표시.
        // 공식 docs 측 = AlarmKit 자동 생성 Activity 측 relevanceScore set 영역 명시 ❌, 실험 영역.
        Self.updateActivityRelevance(alarmId: id.uuidString, fireAtMs: params.fireAt)
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
        // v1.7 hotfix #LADbgTimer — timer_main 측 AlarmPresentation 명시 + LA 자동 표시 추적 영역.
        appendNativeDbg("AlarmKit-DBG", "scheduleAlarm timer_main entity=\(params.entityId) presentation=alert+countdown+paused durationSec=\(durationSecAll) sound=\(params.soundName ?? "default")")
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
      // v1.7 hotfix #26 — debug log: scheduleAlarm 결과 (timer 영역).
      NSLog("[AlarmKit][schedule] 결과 OK alarmId=\(id.uuidString) entity=\(params.entityId) factory=timer(duration:) durationSec=\(durationSecAll)")
      // v1.7 hotfix #LAUnify Phase 10-G4dbg5 — main app process 측 type fully qualified name 측정.
      // widget extension process 측 (= RoutineControlIntents 측 PauseIntent) 측 같은 측정 → 직접 비교.
      // 두 process 측 type name 같음 = static_framework 측 cause 아님 (= 다른 cause 측정 필요).
      // 두 process 측 type name 다름 = static_framework 측 별도 instance build 확정 → 정정 진입.
      let typeName = String(describing: AlarmAttributes<ShutTimerAlarmMetadata>.self)
      let metadataTypeName = String(describing: ShutTimerAlarmMetadata.self)
      appendNativeDbg("LA-DBG-AKLA-Type", "main app process AlarmAttributes type=\(typeName) metadata type=\(metadataTypeName)")
      // v1.7 hotfix #LAUnify Phase 10-G4dbg — ActivityKit Activity 측 active count + ID 측 native log.
      let activities = Activity<AlarmAttributes<ShutTimerAlarmMetadata>>.activities
      let activitiesDesc = activities.map { "\($0.id):\($0.activityState)" }.joined(separator: ",")
      appendNativeDbg("LA-DBG-AKLA-Activity", "post-schedule(timer) alarmId=\(id.uuidString) Activity.activities.count=\(activities.count) [\(activitiesDesc)]")
      // v1.8 #LARelevance — 동일 처리 (= 알람 + 타이머 동시 = 임박한 영역 우선 표시).
      Self.updateActivityRelevance(alarmId: id.uuidString, fireAtMs: params.fireAt)
      // v1.7 hotfix #LAUnify Phase 10-G4dbg2 — system sync 시간 race 가능성 검증.
      // 5초 delay 후 다시 측정 → count 측 변화 ❓.
      Task {
        try? await Task.sleep(nanoseconds: 5_000_000_000)
        let delayed = Activity<AlarmAttributes<ShutTimerAlarmMetadata>>.activities
        let delayedDesc = delayed.map { "\($0.id):\($0.activityState)" }.joined(separator: ",")
        appendNativeDbg("LA-DBG-AKLA-Activity", "post-schedule(timer)+5s alarmId=\(id.uuidString) Activity.activities.count=\(delayed.count) [\(delayedDesc)]")
        // v1.7 hotfix #LAUnify Phase 10-G4dbg2 — AlarmKit authorization 측 측정.
        let authState = Self.stateToString(AlarmManager.shared.authorizationState)
        appendNativeDbg("LA-DBG-AKLA-Auth", "post-schedule(timer)+5s alarmId=\(id.uuidString) authorizationState=\(authState) areActivitiesEnabled=\(ActivityAuthorizationInfo().areActivitiesEnabled)")
      }
      return id.uuidString
    }

    AsyncFunction("cancelAlarm") { (alarmId: String) async throws in
      guard let uuid = UUID(uuidString: alarmId) else { return }
      // v1.7 hotfix #2 — Apple 공식: stop(id:) = alerting 전용, cancel(id:) = scheduled 전용.
      // 정상 영역 = state check 분기. scheduled alarm 측 stop 호출 시 부작용 회피
      //   (= 위젯 ✕ tap 시 cancelAlarm → stop trigger → 'open_app_dismiss' signal → 회귀 차단).
      // alarms throw 시 = state 미상 → stop + cancel 둘 다 try? fallback (= alerting alarm 지속 ring 버그 의도 보존).
      // v1.7 hotfix #DBG-Sound (B5) — cancelAlarm 진입 = state + alarmId 추적 (= 사운드 종료 root cause 영역).
      do {
        let alarms = try AlarmManager.shared.alarms
        if let alarm = alarms.first(where: { $0.id == uuid }), alarm.state == .alerting {
          appendNativeDbg("AlarmKit-DBG", "cancelAlarm 진입 alarmId=\(alarmId) state=alerting → stop()")
          try? await AlarmManager.shared.stop(id: uuid)
        } else {
          let foundState = alarms.first(where: { $0.id == uuid }).map { Self.alarmStateToString($0.state) } ?? "(not in list)"
          appendNativeDbg("AlarmKit-DBG", "cancelAlarm 진입 alarmId=\(alarmId) state=\(foundState) → cancel()")
          try? await AlarmManager.shared.cancel(id: uuid)
        }
      } catch {
        appendNativeDbg("AlarmKit-DBG-WARN", "cancelAlarm 진입 alarmId=\(alarmId) alarms throw=\(error) → stop+cancel fallback")
        try? await AlarmManager.shared.stop(id: uuid)
        try? await AlarmManager.shared.cancel(id: uuid)
      }
    }

    AsyncFunction("stopAlarm") { (alarmId: String) async throws in
      guard let uuid = UUID(uuidString: alarmId) else { return }
      // v1.7 hotfix #DBG-Sound (B6) — stopAlarm 진입 = alarmId 추적.
      appendNativeDbg("AlarmKit-DBG", "stopAlarm 진입 alarmId=\(alarmId)")
      try await AlarmManager.shared.stop(id: uuid)
    }

    // v1.7 hotfix #G3 — Apple AlarmKitDemo 공식 패턴 정합:
    //   guard case .countdown = alarm.state → try AlarmManager.shared.pause(id:)
    //   직전 = JS 측 자체 pauseRoutine() 측 = AsyncStorage 측만 update + AlarmKit framework pause ❌
    //     → LA Activity 측 paused state 진입 ❌ (= 사용자분 측 "앱에서 일시정지하면 LA 안나오는 문제" 회귀).
    //   정정 = AlarmKit framework 측 .pause(id:) 직접 호출 → LA Activity 자동 update.
    // v1.7 hotfix #G5 Phase B-2 — return ms timestamp (= AlarmManager.shared.pause(id:) 호출 직전 측 측정).
    //   JS 측 = pauseDuration 측 = native 측 측정 정합 (= JS bridge 통신 시간 측 1초 미만 오차 ❌ 영역).
    //   skip / error 측 = 0 return (= JS 측 = Date.now() fallback).
    AsyncFunction("pauseAlarm") { (alarmId: String) async throws -> Double in
      guard let uuid = UUID(uuidString: alarmId) else { return 0 }
      do {
        let alarms = try AlarmManager.shared.alarms
        guard let alarm = alarms.first(where: { $0.id == uuid }) else {
          appendNativeDbg("AlarmKit-DBG-WARN", "pauseAlarm 진입 alarmId=\(alarmId) state=(not in list) → skip")
          return 0
        }
        guard case .countdown = alarm.state else {
          appendNativeDbg("AlarmKit-DBG-WARN", "pauseAlarm 진입 alarmId=\(alarmId) state=\(Self.alarmStateToString(alarm.state)) ❌ countdown → skip")
          return 0
        }
        appendNativeDbg("AlarmKit-DBG", "pauseAlarm 진입 alarmId=\(alarmId) state=countdown → pause()")
        let nowMs = Date().timeIntervalSince1970 * 1000.0
        try AlarmManager.shared.pause(id: uuid)
        return nowMs
      } catch {
        appendNativeDbg("AlarmKit-DBG-WARN", "pauseAlarm 진입 alarmId=\(alarmId) error=\(error)")
        return 0
      }
    }

    // v1.7 hotfix #G5 Phase B-2 — return ms timestamp (= AlarmManager.shared.resume(id:) 호출 직전 측 측정).
    AsyncFunction("resumeAlarm") { (alarmId: String) async throws -> Double in
      guard let uuid = UUID(uuidString: alarmId) else { return 0 }
      do {
        let alarms = try AlarmManager.shared.alarms
        guard let alarm = alarms.first(where: { $0.id == uuid }) else {
          appendNativeDbg("AlarmKit-DBG-WARN", "resumeAlarm 진입 alarmId=\(alarmId) state=(not in list) → skip")
          return 0
        }
        guard case .paused = alarm.state else {
          appendNativeDbg("AlarmKit-DBG-WARN", "resumeAlarm 진입 alarmId=\(alarmId) state=\(Self.alarmStateToString(alarm.state)) ❌ paused → skip")
          return 0
        }
        appendNativeDbg("AlarmKit-DBG", "resumeAlarm 진입 alarmId=\(alarmId) state=paused → resume()")
        let nowMs = Date().timeIntervalSince1970 * 1000.0
        try AlarmManager.shared.resume(id: uuid)
        return nowMs
      } catch {
        appendNativeDbg("AlarmKit-DBG-WARN", "resumeAlarm 진입 alarmId=\(alarmId) error=\(error)")
        return 0
      }
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
    // v1.7 hotfix #G5 Phase A — return type 측 = [[String: Any]] 측 swap (= preAlertSeconds Double + fixedFireMs Double + relativeHour/Minute Int 측 추가 영역 정합).
    // v1.7 hotfix #ColdStartLA-2 — Activity<AlarmAttributes<...>>.activities 측 측정 + hasLiveActivity field emit.
    //   Apple Developer Forum #729651 정합 = Activity.activities 측 source of truth.
    //   사용 site = HomeScreen cold start 측 = 잔존 LA 측 측정 + 옛 alarm cancel + 새 schedule 분기.
    AsyncFunction("listAlarms") { () async throws -> [[String: Any]] in
      let alarms = try AlarmManager.shared.alarms
      let activities = Activity<AlarmAttributes<ShutTimerAlarmMetadata>>.activities
      // v1.7 hotfix #DBG-Sound (B7) — listAlarms 진입 = count + state per alarm.
      let stateSummary = alarms.map { "\($0.id.uuidString.prefix(8))=\(Self.alarmStateToString($0.state))" }.joined(separator: ",")
      let activitiesDesc = activities.map { "\($0.id):\($0.activityState)" }.joined(separator: ",")
      appendNativeDbg("AlarmKit-DBG", "listAlarms 진입 count=\(alarms.count) [\(stateSummary)] activities=\(activities.count) [\(activitiesDesc)]")
      // v1.7 hotfix #G5 Phase A — preAlertSeconds + fixedFireMs + relativeHour/Minute emit (= JS 측 endAt 측정 단일화 영역).
      return alarms.map { alarm in
        var dict: [String: Any] = [
          "id": alarm.id.uuidString,
          "state": Self.alarmStateToString(alarm.state),
        ]
        Self.appendScheduleAndCountdown(&dict, alarm: alarm)
        // AlarmKit Alarm instance 측 = attributes 측정 ❌ 영역 (= Apple SDK 한계).
        // 본 앱 측 = 1 alarm = 1 LA 영역 가정 → activities.isEmpty 측 단순 매핑 영역 정합.
        // (= 다중 alarm 영역 = 별도 cycle 측 attributes.metadata.routineId 매칭 영역 강제.)
        dict["hasLiveActivity"] = !activities.isEmpty
        return dict
      }
    }
  }

  // v1.7 hotfix #G5 Phase A — alarm 측 schedule + countdownDuration 측 = dict 측 append (= 단일 source of truth).
  //   AlarmKit framework 측 정합:
  //     - alarm.countdownDuration?.preAlert (= TimeInterval? = Double seconds) → preAlertSeconds emit
  //     - alarm.schedule (= Alarm.Schedule? = enum) → .fixed(Date) → fixedFireMs / .relative(Time) → relativeHour + relativeMinute emit
  //   사용 site = OnStartObserving Task 측 onAlarmStateChange event + listAlarms return.
  private static func appendScheduleAndCountdown(_ dict: inout [String: Any], alarm: Alarm) {
    if let preAlert = alarm.countdownDuration?.preAlert {
      dict["preAlertSeconds"] = preAlert
    }
    if let schedule = alarm.schedule {
      switch schedule {
      case .fixed(let date):
        dict["fixedFireMs"] = date.timeIntervalSince1970 * 1000.0
      case .relative(let relative):
        dict["relativeHour"] = relative.time.hour
        dict["relativeMinute"] = relative.time.minute
      @unknown default:
        break
      }
    }
  }

  // v1.6 T1 — Alarm.State → String 매핑
  private static func alarmStateToString(_ state: Alarm.State) -> String {
    switch state {
    case .scheduled: return "scheduled"
    case .countdown: return "countdown"
    case .paused: return "paused"
    case .alerting: return "alerting"
    @unknown default: return "scheduled"
    }
  }

  private static func stateToString(_ state: AlarmManager.AuthorizationState) -> String {
    switch state {
    case .notDetermined: return "notDetermined"
    case .denied: return "denied"
    case .authorized: return "authorized"
    @unknown default: return "unknown"
    }
  }

  // v1.8 #LARelevance — AlarmKit framework 자동 생성 Activity 측 = relevanceScore 후처리 set 시도.
  // 발화 시각이 가까울수록 score 큼 (= 잠금화면 LA banner + Dynamic Island 측 우선 표시).
  //
  // 공식 docs 측 = AlarmKit + relevanceScore 영역 명시 ❌ → 실험 영역.
  // 실험 결과 = framework 측 update 무시 영역 가능 영역 = 실측 확인 강제.
  //
  // score 계산 = 60.0 / 발화까지초. 1분 안 = 1.0, 60초 = 1.0, 600초 = 0.1, 3600초 = 0.017.
  // 0~1 클램프 영역. AlarmKit framework 측 = 본 update = 다음 state change 시 = 무효 영역 가능.
  fileprivate static func updateActivityRelevance(alarmId: String, fireAtMs: Double) {
    Task { @MainActor in
      // v1.8 #LARelevanceTiming — AlarmKit framework 측 LA 활성 = 비동기 영역.
      //   직전 = 200ms sleep → Activity.activities 측 = activity not found 다수.
      //   정정 = 5초 sleep → log 측 post-schedule(timer)+5s 시점 = Activity.activities.count >= 1 정합.
      try? await Task.sleep(nanoseconds: 5_000_000_000)
      let activities = Activity<AlarmAttributes<ShutTimerAlarmMetadata>>.activities
      // v1.8 #LARelevanceMatch — Activity.id (= system UUID) ≠ Alarm.id (= app UUID) 영역.
      //   직전 = $0.id == alarmId 측 = 항상 nil 영역. 정정 = metadata.alarmId 측 매칭 영역.
      guard let activity = activities.first(where: { $0.attributes.metadata?.alarmId == alarmId }) else {
        appendNativeDbg("LA-DBG-AKLA-Relevance", "skip alarmId=\(alarmId) activity not found")
        return
      }
      let nowMs = Date().timeIntervalSince1970 * 1000
      let secondsUntilFire = max(1.0, (fireAtMs - nowMs) / 1000.0)
      let relevanceScore = max(0.0, min(1.0, 60.0 / secondsUntilFire))
      let currentState = activity.content.state
      let newContent = ActivityContent(state: currentState, staleDate: nil, relevanceScore: relevanceScore)
      await activity.update(newContent)
      appendNativeDbg("LA-DBG-AKLA-Relevance", "set alarmId=\(alarmId) secondsUntilFire=\(Int(secondsUntilFire)) score=\(relevanceScore)")
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
  // v1.8 #LACountdownTitle — countdown presentation 측 별도 title (= lock screen LA 측).
  // 미전달 시 = title fallback (= 기존 호환).
  @Field var countdownTitle: String?
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
  // v1.7 hotfix #LAUnify Phase 3 — AlarmKit framework 자동 LA Activity 측 = AlarmAttributes metadata
  // 측 step 데이터 표시 영역. JS 측 = scheduleAlarm 호출 시 = step 데이터 전달 (= Phase 5 측 영역).
  // 미전달 시 = nil / default → metadata 측 default 값 영역 (= 호환).
  @Field var laStepName: String?
  @Field var laStepIndex: Int?
  @Field var laTotalSteps: Int?
  @Field var laStage: String?
  @Field var laPaused: Bool?
  @Field var laPausedAt: Double?
  @Field var laRoutineId: String?
  @Field var laRoutineName: String?
}
