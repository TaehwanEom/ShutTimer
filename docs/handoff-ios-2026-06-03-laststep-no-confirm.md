# iOS 전달 — 마지막 단계 완료 시 확인 모달 제거 (routine_complete 분리) 2026-06-03

발신: Android 구현창. 대상: iOS 구현창.

## 1. 문제
루틴 **마지막 단계 "루틴 완료"** 버튼을 누르면 "루틴 종료하시겠습니까?" 확인 모달이 뜸. 마지막 단계 완료는 그냥 끝나야 하는데, 위젯 정지용 확인 모달이 같이 떠서 **이중 확인**이 됨.

원인: 마지막 단계 완료와 위젯 "정지"가 **둘 다 `stop_action` 이벤트**를 emit → JS가 구분 못 함 → 둘 다 확인 모달(+일시정지) 표시.

## 2. Android 수정 (공통 JS + Android 네이티브)
- **공통 App.tsx (`onAlarmStateChange`)**: 새 이벤트 **`routine_complete`** 핸들러 추가 → 확인 모달·일시정지 없이 바로 종료(`stopRoutine` + `dispatch Stop` + cleanup). **`stop_action` 핸들러는 그대로**(위젯 정지=확인 모달+일시정지).
- **Android 네이티브 (`AlarmActionReceiver.handleStop`)**: 마지막 단계 `ACTION_STOP`(= AlarmAlertActivity `isLastStep`) 경로의 emit을 `"stop_action"` → `"routine_complete"`로 변경.

→ Android에선 마지막 단계 = `routine_complete`(바로 종료), 위젯 정지 = `stop_action`(확인 모달)로 분리됨.

## 3. iOS 확인/조치 필요
- **공통 App.tsx의 `routine_complete` 핸들러는 이미 추가됨** (iOS도 이 이벤트 받으면 바로 종료). `stop_action`은 안 건드렸으니 **iOS 위젯/LA 정지 확인 모달은 영향 없음.**
- **단, iOS도 같은 이중 확인 버그가 있다면** — iOS의 마지막 단계 완료 경로가 현재 `stop_action`을 emit한다면, iOS에서도 마지막 단계만 **`routine_complete`로 분리 emit**하도록 네이티브(Swift) 수정 필요. 그래야 iOS 마지막 단계도 확인 모달 없이 완료됨.
- iOS가 마지막 단계를 어떤 이벤트로 처리하는지 확인 후, 필요 시 `routine_complete`로 맞추면 됨.

## 4. 검증 시나리오 (실기기)
1. 루틴 마지막 단계 "루틴 완료" 버튼 → **확인 모달 없이 바로 종료**되는지.
2. 루틴 중간에 위젯 "정지" → **확인 모달 + 일시정지** 그대로 뜨는지(회귀 없음).
