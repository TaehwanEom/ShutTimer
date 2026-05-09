# Phase 10-G2 Context Notes

**관련 plan.** `plan-2026-05-09-v17-phase10-g2.md`
**관련 checklist.** `checklist-2026-05-09-v17-phase10-g2.md`

---

## 결정 1 — 옵션 δ (= shared framework Pod) 채택

**시점.** 2026-05-09 (= 본 cycle 측 시나리오 C 검증 결과 + 서치 결과 직후)

**결정.** Apple 공식 추천 패턴 = "shared framework" 분리.

**사유.** ActivityKit 측 = `module-level type identity 매칭 필수` (= Codable layout만으로 ❌). 서치 증거:
> "Both the bridge and the widget must refer to the same ActivityKit attributes type. Any mismatch means updates won't flow."

**기각 옵션.**
- 옵션 α (= 자체 정의 양쪽) = 본 cycle 측 직전 commit (= 417979b). 검증 결과 widget body 호출 ❌ → root cause 확정.
- 옵션 β (= podspec ../path glob) = CocoaPods 비표준. 동일 source 두 module 컴파일 → type identity 여전히 mismatch.
- 옵션 γ (= widget 측 AlarmkitBridge Pod link) = ExpoModulesCore 의존 측 widget extension process 한도 (~30MB) 위험.

---

## 결정 2 — 신규 Pod 디렉토리 위치 = `modules/shared-alarm-types/`

**시점.** 2026-05-09

**결정.** 기존 `modules/alarmkit-bridge/` 측 정합 패턴 채택. `modules/` root 직접 배치.

**사유.**
- 기존 module 디렉토리 구조 (= `modules/{name}/ios/`) 정합.
- expo-module.config.json 측 ❌ (= ExpoModulesCore 의존 ❌, JS bridge ❌, 단순 native Pod 영역).
- `targets/` 측 = @bacons/apple-targets 측 widget / app extension 전용. SharedAlarmTypes 측 = framework Pod = `modules/` 측 정합.

**기각.**
- `targets/widget/_shared/` 유지 = type identity 통합 ❌ (= 본 cycle root cause).
- `targets/shared-alarm-types/` = @bacons/apple-targets 측 미지원 패턴. config-plugin.js 검증 ❌.
- `ios/SharedAlarmTypes/` (= main app 측) = expo prebuild --clean 시 wholesale reset → git tracked 측 ❌ → 영구화 ❌.

---

## 결정 3 — Pod platform = iOS 15.1 (= AlarmkitBridge 정합)

**시점.** 2026-05-09

**결정.** `s.platforms = { :ios => '15.1' }` 명시.

**사유.**
- AlarmkitBridge.podspec 측 정합 (= 동일 platform = CocoaPods 측 호환성 정합).
- AlarmKit framework 측 = iOS 26+ 전용. `#if canImport(AlarmKit)` 측 = iOS 25 이하 측 = struct 정의 측 자체 ❌ → SharedAlarmTypes Pod 측 = empty module 측 = 정합 동작.
- iOS 15.1 측 = expo Podfile.properties 측 deploymentTarget 정합.

**기각.**
- iOS 26+ 명시 = AlarmkitBridge.podspec 측 mismatch → CocoaPods integration 측 위험.
- iOS 18.0 명시 (= widget extension 측 expo-target.config.js 정합) = AlarmkitBridge Pod (= 15.1) 측 측 = 측 = main app 측 link 측 mismatch.

---

## 결정 4 — struct + field + init 모두 `public` 명시

**시점.** 2026-05-09

**결정.** ShutTimerAlarmMetadata 측 = `public nonisolated struct`. 8 field 모두 `public var`. explicit `public init(...)` 추가.

**사유.**
- 직전 옵션 α 측 = 동일 module 측 자체 정의 → `public` 측 불필요. 본 옵션 δ 측 = cross-module access → `public` 필수.
- Swift 측 = struct + field 측 = default `internal` access. 다른 module 측 = `internal` symbol 측 lookup ❌.
- explicit init 측 = synthesized memberwise init 측 default `internal` 영역. cross-module 측 explicit `public init` 필수.

**기각.**
- `internal` 명시 = cross-module access ❌ → 빌드 에러.
- `package` 명시 (= Swift 5.9+ 측 access level) = CocoaPods Pod 측 = same package 정의 측 ❌ → 동작 ❌.

---

## 결정 5 — `import SharedAlarmTypes` 위치 = `#if canImport(AlarmKit)` block 안

**시점.** 2026-05-09

**결정.** AlarmkitBridge Pod 측 + widget extension 측 모두 = `#if canImport(AlarmKit)` block 안 측 `import SharedAlarmTypes` 배치.

**사유.**
- ShutTimerAlarmMetadata 측 = `#if canImport(AlarmKit)` block 안 정의. iOS 25 이하 측 = type 측 자체 ❌.
- iOS 25 이하 측 = `import SharedAlarmTypes` 측 = empty module → 정합 동작. 단 = `#if canImport(AlarmKit)` block 안 측 명시 = 의도 명확.

**기각.**
- block 외부 측 unconditional import = iOS 25 이하 측 = empty module import → 측 가능. 단 = 의도 ❌ + 코드 반복 ❌.

---

## 결정 6 — 본 cycle 측 직전 commit (= G0 + G0a) 측 부분 reverse

**시점.** 2026-05-09

**결정.** `git revert` 측 ❌. 본 commit 측 = G0 + G0a 측 추가 file 측 = `git rm` 직접 + 신규 file 측 = 본 cycle 측 추가.

**사유.**
- `git revert 325e6cb 417979b` = 동시 conflict + 다른 영역 (= G0 측 plugin 삭제 + CLAUDE.md rule 11 추가) 측 영향 → revert 부적합.
- 본 commit 측 = 직전 추가 file 측만 명시 제거 + 옵션 δ 측 정합 file 측 신규.
- commit 메시지 측 = "Phase 10-G0 + G0a 측 부분 reverse + 옵션 δ 정정" 측 명시.

**기각.**
- `git revert` 측 = G0 측 추가 영역 (= CLAUDE.md rule 11 + plugins/withSharedAlarmMetadata.js 삭제) 측 = 본 cycle 측 영향 ❌ → revert ❌.

---

## 결정 7 — `npx expo prebuild --clean` 측 책임 영역

**시점.** 2026-05-09

**결정.** 사용자분 사인 분기 영역 = "전부 ㄱㄱ" → 본 창 측 직접. "ㄱㄱ" → 사용자분 직접.

**사유.**
- prebuild --clean 측 = ios/ wholesale reset (= destructive). Build window 영역 외 가능성.
- 단 = 직전 cycle 측 = `pod install` 측 사인 받고 본 창 측 직접 호출 정합. prebuild 측 = pod install 측 + ios/ 측 wholesale 측 = 측정 사인 부탁 영역.

**기각.**
- 본 창 측 무조건 직접 호출 = "Build window: no testing / deployment" 영역 위반 가능성.
- 사용자분 측 무조건 부탁 = 본 cycle 측 Pod 신규 + autolinking 정합 검증 측 본 창 측 직접 호출 측 효율 영역.

---

## 결정 8 — 검증 통과 기준 = LA-DBG-AKLA entry ≥ 1건

**시점.** 2026-05-09

**결정.** 본 cycle 측 핵심 검증 = 시나리오 A 측 `[LA-DBG-AKLA] mode=countdown(...)` entry ≥ 1건.

**사유.**
- WidgetLiveActivity.swift line 110-112 측 = `appendNativeDbgWidget("LA-DBG-AKLA", ...)` throttle 1초.
- 직전 cycle 측 검증 결과 = entry 0건 → widget body 호출 ❌ root cause.
- 본 cycle 측 정합 시 = countdown 시점 (= 1초당 1개 throttle) 측 ≥ 1건 발생 정합.

**기각.**
- "잠금화면 LA 시각 확인" 측만 = 객관 검증 ❌. 사용자분 측 시각 확인 측 = 추가 검증 영역 (= 시나리오 C 정합).

---

## 학습 영역 (= 본 cycle 측 = 미래 영역 적용)

### 학습 1 — ActivityKit 측 type identity = module-level 매칭 필수

ActivityKit + AlarmKit framework 측 = struct layout 일치만으로 ❌. Swift module name 측 일치 필수. 직전 옵션 α 측 = 부정확 가정 → root cause 검증 늦음.

**적용.** 본 cycle 측 + 미래 cycle 측 = ActivityKit / AlarmKit type 측 = 별도 framework Pod 분리 강제.

### 학습 2 — Apple 공식 docs / 추천 패턴 우선

본 cycle 측 = 직전 옵션 α 측 = 추측 + 부정확 분석. Apple 공식 docs (= "shared framework") 측 = 정공.

**적용.** `feedback_search_first.md` + `feedback_latest_tech_first.md` 강제. 새 framework 사용 전 = 공식 docs 직접 확인.

### 학습 3 — type identity 측 = native log 측 직접 검증

직전 cycle 측 = `[LA-DBG-AKLA]` 측 = widget body 진입 native log 측 추가 (= Phase 9-A diag commit). 본 검증 측 = type identity mismatch 측 root cause 확정.

**적용.** type identity / framework integration 측 의문 시 = native log 측 직접 검증 + 측정.

### 학습 4 — CLAUDE.md "7. Plan + Checklist + Context Notes" 측 강제

본 cycle 측 = 직전 = plan 단일 문서 측 패턴. CLAUDE.md 7번 강제 = 3 artifact (= plan + checklist + context-notes).

**적용.** 본 cycle 측 = 처음 적용. 미래 non-trivial cycle 측 = 동일 강제.

---

## Open Questions (= 본 cycle 측 = 사용자분 사인 부탁 영역)

1. 본 plan 측 = 사용자분 측 = 검토 영역 + 변경 부탁 ❓
2. 단계 9 (= prebuild --clean) 측 책임 = "ㄱㄱ" / "전부 ㄱㄱ" ❓
3. `targets/widget/_shared/` 디렉토리 측 = empty 시 = 삭제 / 유지 ❓ (= @bacons/apple-targets 동작 측정 후 결정 영역)

---

## Append-only log (= 본 cycle 측 진행 영역 = 추가 결정 / 변경 영역 측)

| 시점 | 영역 | 결정 |
|------|------|------|
| 2026-05-09 작성 | plan + checklist + context-notes 신규 | 사용자분 사인 대기 |
