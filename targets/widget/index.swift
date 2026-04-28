import WidgetKit
import SwiftUI

@main
struct exportWidgets: WidgetBundle {
    var body: some Widget {
        // v1.6 — LiveActivity 만 사용. Home Screen Widget / ControlWidget 은 iOS 17/18+ API
        // (AppIntentTimelineProvider / ControlWidget) 와 deploymentTarget 16.2 충돌로 제거.
        WidgetLiveActivity()
    }
}
