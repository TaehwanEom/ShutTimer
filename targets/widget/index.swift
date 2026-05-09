import WidgetKit
import SwiftUI

@main
struct exportWidgets: WidgetBundle {
    var body: some Widget {
        // v1.7 hotfix #LAUnify Phase 10-G1 — 옛 WidgetLiveActivity (ShutTimerActivityAttributes 기반) 등록 제거.
        // AlarmKit framework가 자동 관리하는 LA Activity (= AlarmAttributes<ShutTimerAlarmMetadata>) 전용 widget만 남김.
        if #available(iOS 26.0, *) {
            AlarmKitLiveActivity()
        }
    }
}
