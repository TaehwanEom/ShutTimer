# Apple Watch 앱 구현 계획 (2026-05-28)

> 본 문서: 계획만. 코드 작성 X. 별도 승인 후 진행.
> 사용자 핵심 의도: 연동 최소화 (= 본 프로젝트 race 경험 학습) + 워치 단독 실행

---

## 1. 한 줄 요약

워치 측 = 일반 타이머 (= 완전 단독) + 루틴 (= iPhone 측 루틴 단방향 sync + 워치 단독 실행) 두 기능 신규 추가.

= **쉽게 말하면**: 워치만으로 타이머도 쓰고, iPhone에 만든 루틴도 워치에서 실행. iPhone과 통신은 루틴 받을 때 1번만.

---

## 2. 기능 정의

### 2-1. 일반 타이머 (= 완전 단독)
- 워치 측 = 시간 설정 (digital crown 또는 +/- 버튼) → 시작 → 카운트다운 → 알람
- iPhone 연동 = **0** (WatchConnectivity 호출 X)
- iPhone 측 = 워치 타이머 인지 X
- = iPhone ShutTimer 측 메인 타이머 측 워치 버전

### 2-2. 루틴 (= 단방향 sync + 단독 실행)
- iPhone 측 = 루틴 저장 시 워치로 자동 push (= WatchConnectivity transferUserInfo)
- 워치 측 = 받은 루틴 목록 표시
- 사용자 = 워치에서 루틴 선택 → 시작 → step 1 카운트다운 → 알람 → "다음 진행" → step 2 → ... → 완료
- 워치 측 실행 = iPhone에 안 알림 (= 일방향)
- 워치에서 루틴 편집/생성 = **불가** (= iPhone 전용)

---

## 3. 기술 결정 (= 2026-05-28 추가 검토 후 갱신)

| 항목 | 선택 | 이유 |
|------|------|------|
| watchOS deployment | 11+ | 최신 SwiftUI 측 호환 |
| 언어 | Swift + SwiftUI | 표준 + 미래성 |
| **알람 출력** | **UNUserNotificationCenter (= Local Notification on watchOS)** | ⚠️ AlarmKit on watchOS standalone = **미지원** (= 2026-05-28 확인). AlarmKit 측 = iOS primary, 워치 측 = paired iPhone 측 mirror만 가능. 워치 단독 측 = Local Notification 측 fallback 필수 |
| 데이터 저장 | UserDefaults (= 단순) | 워치 측 = SwiftData 측 학습 곡선 회피 |
| iPhone ↔ Watch | WatchConnectivity `transferUserInfo` | 단방향 + 백그라운드 안전 + FIFO queue 보장 + 자동 retry (= 검색 확인) |
| **Expo 통합** | **`@bacons/apple-targets` config plugin** | Expo SDK 53+ 측 표준. CocoaPods 1.16.2+ / Xcode 16+ 필수. 본 ShutTimer = SDK 54 → 호환 ✓ |
| UI 패턴 | SwiftUI + digital crown | 표준 워치 패턴 |

### 3-1. ⚠️ 알람 강제력 차이 (= 사용자 인지 필요)

| 환경 | iOS ShutTimer (AlarmKit) | 워치 ShutTimer (Local Notification) |
|------|-------------------------|----------------------------------|
| 일반 모드 | 풀 알람 (= 사운드 + 진동 + FSI) | 풀 알람 (= 사운드 + 진동 + 배너) |
| **무음 모드** | ✅ **강제 통과** (= AlarmKit 특권) | ❌ **차단** (= 진동만) |
| **Focus 모드** | ✅ 강제 통과 | ❌ 차단 (= Critical Alerts entitlement 없음) |
| 잠금 화면 | ✅ 전체 화면 | ✅ 알림 배너 |

= **워치 측 알람 = 일반 사용 시 정상. 단 무음/Focus 모드 측 = 안 울릴 수 있음**. 사용자 안내 측 필요.

---

## 4. Phase별 구현

### Phase 1 — 워치 앱 신설 + 일반 타이머 (1~2주)
- Xcode 측 Watch App target 추가 (= "ShutTimer Watch App")
- watchOS deployment target = 11+ 설정
- SwiftUI 메인 화면 = 탭 2개 (= 타이머 / 루틴)
- 타이머 탭 = 시간 설정 + 시작/중지/리셋 + countdown
- AlarmKit on watchOS 측 종료 알람 (= 사운드 + 진동)
- 단독 동작 검증 (= iPhone 측 무관)

### Phase 2 — 루틴 sync (1~2주)
- iPhone 측 = WatchConnectivity WCSession activate
- iPhone 측 = 루틴 저장 시 (= upsertRoutine) → `transferUserInfo({routines: [...]})` push
- 워치 측 = WCSessionDelegate 측 didReceiveUserInfo → UserDefaults 저장
- 워치 측 = 루틴 탭 = 저장된 루틴 목록 표시
- 검증: iPhone 측 새 루틴 → 워치 측 표시 확인

### Phase 3 — 루틴 실행 (1~2주)
- 워치 측 = 루틴 선택 시 = 화면 진입 (= step 1 표시)
- 시작 → step 1 countdown (= 시간 표시 + digital crown 측 즉시 종료 옵션)
- step 1 완료 → AlarmKit 알람 (= 사운드 + 진동)
- 사용자 = "다음 진행" tap → step 2 countdown
- ... 마지막 step 완료 → "루틴 완료" 화면 → 종료

### Phase 4 — 검증 + 출시 (1주)
- 실 디바이스 테스트 (= Apple Watch + iPhone 페어링)
- 시나리오 검증:
  - 일반 타이머 = iPhone 없이 단독 동작
  - 루틴 sync = iPhone → Watch 정상 전달
  - 루틴 실행 = 워치 단독 단계별 진행
  - 알람 = 워치 측 자체 출력 (= 잠금 상태)
- TestFlight 측 Watch 빌드 측 배포
- App Store 측 = ShutTimer 앱 측 추가 binary 제출

= 총 **4~7주**.

---

## 5. iOS↔Watch 영향 (= 안전성)

| 항목 | iOS (= ShutTimer 본체) | Watch (= 신규) |
|------|----------------------|----------------|
| 일반 타이머 | 영향 0 (= 신규 분리) | 자체 구현 |
| 루틴 저장 | `transferUserInfo` 호출 추가 (= silent + 백그라운드 안전) | 수신 + UserDefaults 저장 |
| 루틴 실행 | 영향 0 (= 워치 측 일방향) | 자체 실행 |
| 알람 | 영향 0 | 자체 AlarmKit |

= **iOS 본체 측 회귀 위험 = 거의 0**. 단 = `transferUserInfo` 호출 측 = 측 = iPhone 측 신규 코드 = 검증 영역.

---

## 6. 안 건드릴 것

- ❌ iPhone 측 ShutTimer 측 알람 로직 (= 본일 fix 들 측 보존)
- ❌ iPhone 측 라우틴 실행 로직 (= 본 기능 X)
- ❌ 안드로이드 측 (= 완전 무관, watchOS 측만)
- ❌ 워치 측 = 루틴 편집/생성 (= 본 plan 측 명시 X)
- ❌ 워치 측 = 미션 알람 (= 영어/수학 등 = 워치 화면 측 부적합)

---

## 7. 위험 평가 (= 2026-05-28 추가 검토 후 갱신)

| 항목 | 위험 | 비고 |
|------|------|------|
| **AlarmKit on watchOS standalone 미지원** | **확정** | 워치 측 단독 알람 = Local Notification 측만. 무음 모드 차단. **사용자 인지 + UI 안내 필수** |
| WatchConnectivity race | 낮음 | `transferUserInfo` 측 = FIFO queue 보장 + 자동 retry (= Apple 공식) |
| **시뮬레이터 측 transferUserInfo 미지원** | 중 | 검증 측 = **실 디바이스 (= Apple Watch + iPhone) 측 필수**. 개발 측 = 시뮬레이터 측 sync 측 테스트 X |
| iOS 본체 회귀 | 낮음 | 신규 코드 = `transferUserInfo` 한 줄 추가만 |
| 워치 측 배터리 | 낮음 | 카운트다운 측 background task 측 짧음 |
| 사용자 페어링 미설정 | 낮음 | 워치 페어링 안 한 사용자 측 = 본 기능 X (= UI 측 안내) |
| **Expo prebuild 측 워치 코드 wipe** | 낮음 | `@bacons/apple-targets` config plugin 측 = 자동 보존. 단 = 빌드 워크플로우 측 측 = 학습 곡선 |

---

## 8. 결정 확정 (= 2026-05-28 사용자 결정)

| # | 결정 | 확정 |
|---|------|------|
| 1 | 루틴 sync 시점 | **보류 (= Phase 2/3 작업, 추후 결정)** |
| 2 | 워치 측 알람 dismiss | **swipe / tap** (= 단순) |
| 3 | 일반 타이머 시간 설정 UI | **digital crown** (= 회전) |
| 4 | watchOS minimum 버전 | **11+** |
| 5 | 출시 단위 | **Phase 1만 우선 출시 → 안정화 후 루틴 확장 (= Phase 2/3)** |
| 6 | 워치 측 알람 한계 안내 | **안내 X** (= 일반 타이머 측 = 자연스러움, 1회 진동 = 워치 표준) |
| 7 | WKExtendedRuntimeSession 측 보강 | **사용 X** (= 복잡 + 짧음 + 무의미) |

### 사용자 결정 핵심
- **Phase 1 (일반 타이머)만 우선 진행** = 안전 + 명확한 가치
- 루틴 측 = Phase 1 안정화 후 (= 실 사용자 + 검증) = 별도 진행
- Phase 2/3 = 본 plan 측 = 보존. 추후 시점 = 별도 확정

---

## 9. 출시 영향

- App Store 측 = ShutTimer 앱 = 단일 앱 (= iPhone + Watch binary 통합 제출)
- 사용자 측 = ShutTimer 앱 받으면 = iPhone + Watch 동시 설치
- 디버그 심사 측 = Watch binary 측 = 별도 측 검토 (= 1~2일 추가)

---

## 10. 다음 단계 (= 사용자 결정 확정 후)

= **Phase 1 (일반 타이머 only) 진행 확정**.

### Phase 1 구체 작업 단위 (= 1~2주 예상)

1. **A. 환경 설정 (= 0.5일)**
   - `@bacons/apple-targets` config plugin 설치
   - 본 ShutTimer 측 app.json 측 config 추가
   - watchOS app target 생성 (= `npx create-target watch`)
   - prebuild 검증

2. **B. UI (= 2~3일)**
   - SwiftUI 측 메인 화면: 시간 설정 + 시작/리셋 버튼
   - digital crown 측 시간 입력 (= rotation event 측 분/초 조정)
   - 카운트다운 화면: 큰 시간 표시 + 일시정지/리셋
   - 종료 화면: "완료" 표시 + dismiss tap

3. **C. 타이머 로직 (= 2~3일)**
   - Timer state machine (= IDLE / RUNNING / FINISHED)
   - 시간 진행 측 = `Timer.scheduledTimer` 측 1초 tick
   - 백그라운드 측 = `WKExtendedRuntimeSession` 측 단기 측 (= 최대 30분 측 = 타이머 측 충분)
   - 종료 시 = Local Notification (= 진동 + 사운드)

4. **D. 검증 (= 2~3일)**
   - 시뮬레이터 측 = UI / 로직 검증
   - **실 Apple Watch 디바이스 측 = 페어링 + 단독 실행 검증** (= 가장 중요)
   - 백그라운드 + 잠금 화면 시 종료 알림 검증
   - 다양한 시간 (1초/30분/5시간) 측 검증

### Phase 1 출시
- 검증 통과 → TestFlight 측 watchOS binary 추가 → 디버그 심사
- iOS ShutTimer + Watch app = 단일 binary
- 사용자 측 = ShutTimer 업데이트 시 = 워치 측 자동 설치

### 안정화 측정 기준 (= Phase 2 진행 trigger)
- 실 사용자 측 = 워치 측 일반 타이머 측 = 1~2주 측 사용 + 큰 이슈 0
- = Phase 2 (= 루틴 sync) 측 = 별도 plan 측 시작

---

## 11. Phase 1 시작 시점 (= 결정 대기)

| 옵션 | 설명 |
|------|------|
| **즉시 시작** (= 본 세션) | A. 환경 설정 측 = 본 세션 측 시작. 단 = 큰 작업 1~2주 = 다음 세션 측 분할 |
| **다음 세션 시작** | iOS daily dismiss fix (= 본일) 측 = 안정화 + TestFlight 검증 후 = 별도 세션 시작 |
| **D+1 검증 후 시작** | iOS 측 b809f2c fix 측 = D+1 실 발화 검증 후 = 워치 시작 (= 안전 우선) |

권장 = **D+1 검증 후 시작** (= iOS fix 측 = 사용자 보고 root cause 측 확정 검증 후 = 워치 신규 작업 진행. 회귀 위험 분리)

---

## 11. 추가 검토 결과 요약 (= 2026-05-28)

| 검토 | 결과 |
|------|------|
| AlarmKit on watchOS standalone | ❌ **미지원** (= iPhone primary, 워치 측 mirror만). 워치 단독 측 = Local Notification fallback |
| Expo + Watch target | ✅ `@bacons/apple-targets` 측 표준. 본 SDK 54 호환 |
| WatchConnectivity transferUserInfo | ✅ FIFO + 자동 retry + 신뢰 가능. 단 = 시뮬레이터 X (= 실 디바이스 필수) |

= **plan 측 = 알람 강제력 측 차이 (= 무음 모드 차단) 명시 + Expo 통합 방식 명시**. 사용자 검토 후 진행 결정.

### 신규 결정 영역 (= 추가 검토 후)

| # | 결정 | 옵션 1 | 옵션 2 |
|---|------|--------|--------|
| 6 | 워치 측 알람 강제력 한계 | UI 측 = "워치 알람 = 무음 모드 시 약함" 측 안내 표시 | UI 측 안내 X (= 일반 사용자 측 = 보통 OK 가정) |
| 7 | 알람 강제력 보강 (= 옵션) | 워치 측 = WKExtendedRuntimeSession 측 = 백그라운드 측 강제 측 보강 (= 복잡 + 짧음) | 사용 X (= Local Notification 표준만) |
