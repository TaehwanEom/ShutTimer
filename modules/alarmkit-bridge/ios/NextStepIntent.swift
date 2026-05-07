// v1.6 Phase 5-Lite — AlarmKit chain alarm 의 stopIntent 로 사용.
// 사용자가 알람 fire 시 stop 버튼 누름 → perform() 호출.
//
// 5-Lite 정공: perform() no-op.
// 옵션 A 가 다음 chain alarm 을 자동 fire +
// alarmUpdates listener (App.tsx onAlarmStateChange) 가 RN 측 ActiveRoutine 동기화.
//
// 5-Mid/Full 채택 시 App Group UserDefaults flag 신호 추가 가능.

import AppIntents
import Foundation

#if canImport(AlarmKit)
import AlarmKit
#endif

// v1.7 hotfix #DBG — App Group UserDefaults 측 native log 저장 helper.
fileprivate let NATIVE_DBG_GROUP_NS = "group.com.shuttimer.app"
fileprivate let NATIVE_DBG_KEY_NS = "native_debug_log_v1"
fileprivate let NATIVE_DBG_MAX_NS = 300

fileprivate func appendNativeDbg(_ tag: String, _ msg: String) {
    NSLog("[\(tag)] \(msg)")
    guard let d = UserDefaults(suiteName: NATIVE_DBG_GROUP_NS) else { return }
    let ts = ISO8601DateFormatter().string(from: Date())
    let proc = ProcessInfo.processInfo.processName
    let line = "\(ts) [\(proc)][\(tag)] \(msg)"
    let existing = d.string(forKey: NATIVE_DBG_KEY_NS) ?? ""
    var lines = existing.isEmpty ? [] : existing.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
    lines.append(line)
    if lines.count > NATIVE_DBG_MAX_NS { lines = Array(lines.suffix(NATIVE_DBG_MAX_NS)) }
    d.set(lines.joined(separator: "\n"), forKey: NATIVE_DBG_KEY_NS)
}

@available(iOS 26.0, *)
struct NextStepIntent: LiveActivityIntent {
  static var title: LocalizedStringResource = "Next Step"

  func perform() async throws -> some IntentResult {
    // v1.7 hotfix #DBG — NextStep Intent perform 진입 (= chain alarm stop button 측).
    appendNativeDbg("Intent-DBG-AlarmKit", "NextStepIntent.perform")
    // 5-Lite: no-op
    return .result()
  }
}
