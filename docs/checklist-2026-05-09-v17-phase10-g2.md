# Phase 10-G2 Checklist

**관련 plan.** `plan-2026-05-09-v17-phase10-g2.md`
**관련 context-notes.** `context-notes-2026-05-09-v17-phase10-g2.md`

---

## 사용자분 사인 (= 진입 조건)

- [ ] 사용자분 측 = `plan-2026-05-09-v17-phase10-g2.md` 검토 완료
- [ ] 사용자분 측 = "ㄱㄱ" / "전부 ㄱㄱ" 측 명시 사인

---

## Phase 1 — SharedAlarmTypes Pod 신규

- [ ] 1.1 `modules/shared-alarm-types/` 디렉토리 생성
- [ ] 1.2 `modules/shared-alarm-types/ios/` 디렉토리 생성
- [ ] 1.3 `modules/shared-alarm-types/ios/SharedAlarmTypes.podspec` 신규 작성
  - ExpoModulesCore 의존 ❌
  - `static_framework = true`
  - `DEFINES_MODULE = YES`
  - `source_files = '*.swift'`
  - `platforms = { :ios => '15.1' }` (= AlarmkitBridge.podspec 정합)
- [ ] 1.4 `modules/shared-alarm-types/ios/ShutTimerAlarmMetadata.swift` 신규 작성
  - 헤더 코멘트 (= 한국어 1줄 + 본 cycle 사유)
  - `import Foundation`
  - `#if canImport(AlarmKit)` block
  - `public nonisolated struct ShutTimerAlarmMetadata: AlarmMetadata`
  - 8 field 모두 `public`
  - explicit `public init(...)` 메서드 (= cross-module access 위해 필수)

---

## Phase 2 — AlarmkitBridge Pod 정정

- [ ] 2.1 `modules/alarmkit-bridge/ios/AlarmkitBridge.podspec` 측 = `s.dependency 'SharedAlarmTypes'` 추가
- [ ] 2.2 `modules/alarmkit-bridge/ios/AlarmkitBridgeModule.swift` 측 = `import SharedAlarmTypes` 추가
  - 위치: `#if canImport(AlarmKit)` block 안 (= AlarmKit import 다음 line)
- [ ] 2.3 `modules/alarmkit-bridge/ios/AdvanceNextStepIntent.swift` 측 = `import SharedAlarmTypes` 추가
  - 위치: `#if canImport(AlarmKit)` block 안
- [ ] 2.4 `modules/alarmkit-bridge/ios/ShutTimerAlarmMetadata.swift` 측 = **삭제** (= 옵션 α reverse)

---

## Phase 3 — widget extension target 정정

- [ ] 3.1 `targets/widget/pods.rb` 신규 작성
  - 내용: `pod 'SharedAlarmTypes', :path => '../../modules/shared-alarm-types'`
- [ ] 3.2 `targets/widget/WidgetLiveActivity.swift` 측 = `import SharedAlarmTypes` 추가
  - 위치: 기존 import block (= line 1-5) 측 마지막 line 후
- [ ] 3.3 `targets/widget/RoutineControlIntents.swift` 측 = `import SharedAlarmTypes` 추가
  - 위치: 기존 import block 측 마지막 line 후
- [ ] 3.4 `targets/widget/_shared/ShutTimerAlarmMetadata.swift` 측 = **삭제** (= G0 측 추가 file 측 제거)
- [ ] 3.5 `targets/widget/_shared/` 디렉토리 측 empty 시 = 삭제 또는 유지 영역 결정 (= @bacons/apple-targets 동작 검증 후)

---

## Phase 4 — prebuild + pod install (= 사용자분 사인 분기)

- [ ] 4.1 사용자분 사인 = "전부 ㄱㄱ" → 본 창 측 직접 진행. "ㄱㄱ" → 사용자분 직접 부탁.
- [ ] 4.2 `npx expo prebuild --clean --platform ios` 실행
  - 콘솔 에러 0 검증
  - modules/shared-alarm-types/ 측 자동 detect 검증
- [ ] 4.3 `cd ios && pod install` (= prebuild 측 자동 호출 영역, 추가 검증 차)
  - 에러 0 검증
  - SharedAlarmTypes Pod 측 install 검증

---

## Phase 5 — Pods.xcodeproj 검증 (= 본 창 측 직접)

- [ ] 5.1 SharedAlarmTypes target 등록 검증
  - `grep "SharedAlarmTypes" ios/Pods/Pods.xcodeproj/project.pbxproj` ≥ 1 라인
- [ ] 5.2 SharedAlarmTypes target 측 ShutTimerAlarmMetadata.swift 측 PBXBuildFile 등록 검증
- [ ] 5.3 AlarmkitBridge Pod 측 SharedAlarmTypes 측 dependency 등록 검증
- [ ] 5.4 widget extension target 측 SharedAlarmTypes 측 link 등록 검증

---

## Phase 6 — git commit (= 본 창 측 직접)

- [ ] 6.1 `git status` 검증 (= 신규 + 삭제 + 수정 모두 정합)
- [ ] 6.2 `git add` 신규 + 수정 + 삭제 file 모두 stage
- [ ] 6.3 commit 메시지 작성:
  - title: `fix: v1.7 hotfix #LAUnify Phase 10-G2 — SharedAlarmTypes Pod 분리 측 type identity 통합`
  - body: root cause + 옵션 비교 + 변경 영역 + 검증 부탁 + Apple docs URL
  - Phase 10-G0 + G0a 측 부분 reverse 명시
- [ ] 6.4 `git commit` 실행 + working tree clean 검증

---

## Phase 7 — 사용자분 검증 (= 사용자분 측)

- [ ] 7.1 Xcode 측 = ShutTimer.xcworkspace 닫고 다시 열기
- [ ] 7.2 ⇧⌘K (Clean Build Folder)
- [ ] 7.3 ⌘R 빌드 → 컴파일 에러 0 검증
- [ ] 7.4 디바이스 시나리오 A — countdown widget body 호출
  - 단일 타이머 5분 시작
  - 잠금화면 → 5~10초 대기
  - 잠금 풀고 native log dump
  - 기대: `[LA-DBG-AKLA] mode=countdown(...)` entry ≥ 1건 (= 본 cycle 측 핵심 검증)
- [ ] 7.5 디바이스 시나리오 B — 잠금 widget 일시정지
  - 단일 타이머 시작 → 잠금화면 → 일시정지 버튼 → 5~10초 → log dump
  - 기대: `mode=paused(...)` entry + 잠금화면 LA "일시정지" 텍스트
- [ ] 7.6 디바이스 시나리오 C — 앱 내 일시정지 + 백그라운드 (= 직전 cycle 측 fail 영역)
  - 단일 타이머 시작 → 앱 내 일시정지 → 백그라운드 → 잠금화면 → 5~10초 → log dump
  - 기대: paused LA 표시 정상 (= 사용자분 보고 "위젯 안 보임" 해소)

---

## Phase 8 — 검증 결과 분기

- [ ] 8.1 시나리오 A/B/C 모두 ✅ → G3 또는 G4 plan 작성 (= 본 창 측 다음 cycle 진입)
- [ ] 8.2 시나리오 A ❌ (= LA-DBG-AKLA entry 0건 잔존) → 옵션 δ 측 = 추가 분석 + 정정 (= type identity 측 추가 escalate)
- [ ] 8.3 컴파일 에러 잔존 → 에러 dump 부탁 → 즉시 분석 + 정정
- [ ] 8.4 빌드 ❌ (= prebuild / pod install fail) → 에러 dump 부탁 → 즉시 분석 + 정정

---

## 잔존 영역 (= 본 cycle 측 = 처리 ❌, 별도 cycle 후보)

- widget 측 6 warning + AlarmkitBridge 측 잔존 warning (= 별도 cycle 영역)
- G3 (= JS cancelAlarms() → AlarmKit pauseAlarm/resumeAlarm)
- G4 (= expo-notifications 폐기)
- G5~G7
- libexec 측 xcodeproj patch (= 본 cycle 측 직전 진행 영역, brew managed 측 brew upgrade 시 reset 위험 영역)
