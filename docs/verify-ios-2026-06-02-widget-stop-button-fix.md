# 위젯 잠금화면 정지 버튼 먹통 — 원인 + 수정 + 검증 (2026-06-02, 실기기 PASS)

대상 창: iOS 구현(Build)

---

## 1. 증상
잠금화면 Live Activity 위젯의 "정지" 버튼이 **무반응**. 일시정지/재개는 정상.
로그(log02): `PauseRoutineIntent.perform`/`ResumeRoutineIntent.perform`은 찍히는데 **`StopRoutineIntent.perform`은 0회**(perform 자체 미발화).

## 2. 근본 원인 (확정 — 실기기로 검증됨)
**`StopRoutineIntent`가 위젯 타깃에만 컴파일되고 앱 타깃 멤버십이 없었음.**

- 정지 버튼은 "앱을 여는" intent(`supportedModes = [.foreground(.immediate)]`)다.
- Apple: 위젯/LA 버튼에서 앱을 여는 intent는 **앱 + 위젯 양쪽 타깃**에 존재해야 함. 앱 타깃에 없으면 시스템이 앱 프로세스에서 perform을 실행할 수 없어 → 버튼 무반응 + perform 미발화.
- 일시정지/재개는 앱을 안 여는 백그라운드 intent라 위젯 프로세스에서만 돌아 정상이었음.

### 진단 과정에서의 오류 (반복실수 기록)
- 처음에 `openAppWhenRun` deprecated를 **추측**으로 원인 단정 → `supportedModes`로만 교체했으나 안 통함. 속성 문제가 아니라 **타깃 멤버십** 문제였음.
- 교훈: 추측을 원인으로 보고 금지. log 0회 + 타깃 구조까지 확인했어야 함.

## 3. 수정 (최종, 실기기 PASS)
1. `targets/widget/RoutineControlIntents.swift` — `StopRoutineIntent`: `supportedModes = [.foreground(.immediate)]` 유지(앱 여는 표준), perform = `writeControlSignal("stop")`만(즉시 종료 X).
2. `modules/alarmkit-bridge/ios/StopRoutineIntent.swift` (**신규, 핵심**) — 동일한 `StopRoutineIntent` **앱 타깃 사본**. 검증된 `OpenAppDismissIntent`와 같은 Pod/위치. type name + @Parameter 동일 → 앱+위젯 양쪽 바이너리에 intent 존재 = 타깃 멤버십 충족.
3. `pod install` — 신규 파일을 Pods 프로젝트에 등록(빌드 포함).

> ⚠️ 두 사본(위젯/앱)은 항상 동일하게 유지할 것.

## 4. 동작 흐름 (검증됨)
정지 탭 → 시스템이 앱 foreground 진입 + perform 실행 → `writeControlSignal("stop")` → 앱 active → 기존 `la_control_signal` polling(App.tsx) → `ActionDispatcher` 'stop' → `Alert.alert('루틴 종료', [취소, 종료])` → 종료=알람 취소+정리 / 취소=유지.

## 5. 검증 결과 (실기기, 사용자 확인)
| 항목 | 결과 |
|------|------|
| 정지 버튼 탭 → 앱 진입 | ✅ PASS |
| "루틴 종료" 모달 표시 | ✅ PASS |
| 종료 → 루틴 종료 | ✅ PASS |
| 취소 → 루틴·알람 유지 | ✅ PASS |

## 6. 크로스플랫폼
iOS 네이티브(Swift) + Xcode/Pods 변경만. **Android 무관**(공유 JS 미변경). Android 알림 불필요.

## 7. 상태
- 코드 + pod install 완료, **미커밋**(커밋·배포는 별도 승인).
- 폐기된 중간 시도: `openAppWhenRun`, `OpenURLIntent`+커스텀스킴(커스텀 스킴은 OpenURLIntent로 앱 안 열림 — Universal Link 필요). 최종 채택은 supportedModes + 앱 타깃 사본.
