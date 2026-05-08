import WidgetKit
import SwiftUI

@main
struct exportWidgets: WidgetBundle {
    var body: some Widget {
        // v1.6 — LiveActivity 만 사용. Home Screen Widget / ControlWidget 은 iOS 17/18+ API
        // (AppIntentTimelineProvider / ControlWidget) 와 deploymentTarget 16.2 충돌로 제거.
        WidgetLiveActivity()
        // v1.7 hotfix #LAUnify Phase 6 — AlarmKit framework 자동 LA Activity 전용 widget 등록.
        //   Activity<AlarmAttributes<ShutTimerAlarmMetadata>> 측 layout 매칭 영역 (= 카운터 표시 영역).
        if #available(iOS 26.0, *) {
            AlarmKitLiveActivity()
        }
    }
}
