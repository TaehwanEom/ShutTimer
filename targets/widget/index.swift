import WidgetKit
import SwiftUI

// v1.7 hotfix #LAUnify Phase 10-G4dbg — App Group UserDefaults 측 native log helper.
// WidgetBundle init 시점 측정 위해 본 file 측 직접 native log 추가.
fileprivate let DBG_GROUP_BUNDLE = "group.com.shuttimer.app"
fileprivate let DBG_KEY_BUNDLE = "native_debug_log_v1"
fileprivate let DBG_MAX_BUNDLE = 300

fileprivate func appendBundleDbg(_ tag: String, _ msg: String) {
    NSLog("[\(tag)] \(msg)")
    guard let d = UserDefaults(suiteName: DBG_GROUP_BUNDLE) else { return }
    let ts = ISO8601DateFormatter().string(from: Date())
    let proc = ProcessInfo.processInfo.processName
    let line = "\(ts) [\(proc)][\(tag)] \(msg)"
    let existing = d.string(forKey: DBG_KEY_BUNDLE) ?? ""
    var lines = existing.isEmpty ? [] : existing.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
    lines.append(line)
    if lines.count > DBG_MAX_BUNDLE { lines = Array(lines.suffix(DBG_MAX_BUNDLE)) }
    d.set(lines.joined(separator: "\n"), forKey: DBG_KEY_BUNDLE)
}

@main
struct exportWidgets: WidgetBundle {
    init() {
        // v1.7 hotfix #LAUnify Phase 10-G4dbg — WidgetBundle init 측 widget extension process launch 시점 측정.
        // 본 log 측 발생 ❌ 시 = widget extension binary 측 device install ❌ 또는 process launch ❌
        //   → root cause 측 = widget extension install / launch level.
        // 본 log 측 발생 ✅ + LA-DBG-AKLA entry 측 0건 잔존 시 = WidgetBundle init 정합 +
        //   ActivityConfiguration registration / lookup level 측 issue.
        appendBundleDbg("LA-DBG-Bundle", "exportWidgets.init() called")
    }

    // v1.7 hotfix #LAUnify Phase 10-G1 — 옛 WidgetLiveActivity (ShutTimerActivityAttributes 기반) 등록 제거.
    // AlarmKit framework가 자동 관리하는 LA Activity (= AlarmAttributes<ShutTimerAlarmMetadata>) 전용 widget만 남김.
    //
    // v1.7 hotfix #LAUnify Phase 10-G4 — WidgetBundleBuilder 측 control flow (= if #available) 미지원 정정.
    //   직전 = `if #available(iOS 26.0, *) { AlarmKitLiveActivity() }` 패턴 → AlarmKitLiveActivity 측 system
    //   widget registry 등록 ❌ → ActivityConfiguration 등록 ❌ → AlarmKit framework 측 widget body 호출 ❌
    //   → [LA-DBG-AKLA] entry 0건 root cause.
    //   본 cycle = expo-target.config.js 측 deploymentTarget 26.0 변경 + 모든 @available 마크 제거 →
    //   unconditional 등록 정합 (= Apple sample lioneldude83/AlarmKitDemo 정합).
    //   증거 = SwiftLee https://www.avanderlee.com/swiftui/variable-widgetbundle-configuration/
    //         Apple Forum #762688 https://forums.developer.apple.com/forums/thread/762688
    var body: some Widget {
        AlarmKitLiveActivity()
        // v1.8 #WatchLADirect — Apple Watch Smart Stack 전용 별도 LA widget. ActivityKit Activity.request
        //   직접 호출 측 LA 측 등록 → Activity.activities 등록 ✅ → 워치 자동 mirror ✅ 보장.
        ShutTimerWatchLAWidget()
    }
}
