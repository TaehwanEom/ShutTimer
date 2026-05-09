import WidgetKit
import SwiftUI

@main
struct exportWidgets: WidgetBundle {
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
    }
}
