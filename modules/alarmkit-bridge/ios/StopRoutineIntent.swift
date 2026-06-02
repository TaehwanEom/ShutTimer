// 2026-06-02 fix #WidgetStopButton — 위젯 잠금화면 "정지" 버튼 앱 타깃 사본.
//
// 근본 원인: 위젯 LA "정지" Button(intent:) 의 StopRoutineIntent 가 위젯 타깃에만 컴파일됨.
//   "앱을 여는" intent(supportedModes foreground)는 앱 + 위젯 양쪽 타깃에 존재해야 시스템이 앱에서 perform 실행 + foreground 진입 가능(Apple).
//   앱 타깃에 없어서 → perform 자체 미발화(log02: StopRoutineIntent.perform 0회). Pause/Resume 는 앱 안 여는 백그라운드라 정상.
//
// 본 파일 = 앱 타깃(alarmkit-bridge Pod)용 StopRoutineIntent 사본.
//   - 위젯 사본: targets/widget/RoutineControlIntents.swift (Button(intent:) 에서 사용).
//   - 앱 사본: 본 파일 (시스템이 foreground 진입 후 앱 프로세스에서 perform 실행).
//   type name + @Parameter 동일 → 시스템이 동일 intent 로 매칭(= 같은 파일을 양쪽 타깃에 넣은 것과 등가).
//   검증된 OpenAppDismissIntent(같은 Pod, supportedModes foreground)와 동일 패턴이라 앱이 본 intent 를 인식.
//
// ⚠️ 위젯 사본(RoutineControlIntents.swift StopRoutineIntent)과 항상 동일하게 유지할 것.

import AppIntents
import Foundation

private let STOP_APP_GROUP = "group.com.shuttimer.app"
private let STOP_KEY_SIGNAL = "la_control_signal"
private let STOP_NATIVE_DBG_KEY = "native_debug_log_v1"
private let STOP_NATIVE_DBG_MAX = 300

private func stopAppendNativeDbg(_ tag: String, _ msg: String) {
    NSLog("[\(tag)] \(msg)")
    guard let d = UserDefaults(suiteName: STOP_APP_GROUP) else { return }
    let ts = ISO8601DateFormatter().string(from: Date())
    let proc = ProcessInfo.processInfo.processName
    let line = "\(ts) [\(proc)][\(tag)] \(msg)"
    let existing = d.string(forKey: STOP_NATIVE_DBG_KEY) ?? ""
    var lines = existing.isEmpty ? [] : existing.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
    lines.append(line)
    if lines.count > STOP_NATIVE_DBG_MAX { lines = Array(lines.suffix(STOP_NATIVE_DBG_MAX)) }
    d.set(lines.joined(separator: "\n"), forKey: STOP_NATIVE_DBG_KEY)
}

private func stopWriteControlSignal(action: String, routineId: String) {
    guard let defaults = UserDefaults(suiteName: STOP_APP_GROUP) else { return }
    let signal: [String: Any] = [
        "action": action,
        "timestamp": Date().timeIntervalSince1970 * 1000,
        "routineId": routineId
    ]
    if let data = try? JSONSerialization.data(withJSONObject: signal),
       let str = String(data: data, encoding: .utf8) {
        defaults.set(str, forKey: STOP_KEY_SIGNAL)
    }
}

@available(iOS 26.0, *)
struct StopRoutineIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "정지"
    static var authenticationPolicy: IntentAuthenticationPolicy = .alwaysAllowed
    static var supportedModes: IntentModes = [.foreground(.immediate)]

    @Parameter(title: "Routine ID")
    var routineId: String

    init() { self.routineId = "" }
    init(routineId: String) { self.routineId = routineId }

    func perform() async throws -> some IntentResult {
        stopAppendNativeDbg("Intent-DBG-Widget", "StopRoutineIntent.perform(app) routineId=\(routineId) — signal write + 앱 진입 (즉시 종료 X)")
        // signal write 만 — alarm/snapshot/LA 그대로 유지. 앱 active 진입 → 기존 la_control_signal polling →
        //   ActionDispatcher 'stop' → "루틴 종료" Alert confirm → "종료" 선택 시에만 cleanup.
        stopWriteControlSignal(action: "stop", routineId: routineId)
        return .result()
    }
}
