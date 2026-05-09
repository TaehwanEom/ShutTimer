# widget extension target 측 SharedAlarmTypes Pod link.
# v1.7 hotfix #LAUnify Phase 10-G2 — ActivityKit type identity 통합 위해 widget extension 측 SharedAlarmTypes Pod 직접 link.
# AlarmkitBridge Pod (= main app target 측 link) 측 동일 SharedAlarmTypes 의존 → 단일 Swift module identity 보장.

pod 'SharedAlarmTypes', :path => '../modules/shared-alarm-types/ios'
