// v1.6 Phase 5-Lite — AlarmKit chain alarm 의 stopIntent 로 사용.
// 사용자가 알람 fire 시 stop 버튼 누름 → perform() 호출.
//
// 5-Lite 정공: perform() no-op.
// 옵션 A 가 다음 chain alarm 을 자동 fire +
// alarmUpdates listener (App.tsx onAlarmStateChange) 가 RN 측 ActiveRoutine 동기화.
//
// 5-Mid/Full 채택 시 App Group UserDefaults flag 신호 추가 가능.

import AppIntents

#if canImport(AlarmKit)
import AlarmKit
#endif

@available(iOS 26.0, *)
struct NextStepIntent: LiveActivityIntent {
  static var title: LocalizedStringResource = "Next Step"

  func perform() async throws -> some IntentResult {
    // 5-Lite: no-op
    return .result()
  }
}
