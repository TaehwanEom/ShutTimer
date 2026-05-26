# 안드로이드 알람 엔진 — 진행 노트 (2026-05-22 세션 일시중단)

> 계획서: `docs/plan-2026-05-22-android-alarm-engine.md`
> 다음 세션 — 이 노트 + 계획서를 읽고 **Step 4부터** 이어가면 됨.

## 진행 상황 (Phase 1)

- ✅ Step 0 — 게이트
- ✅ Step 1 — 모듈 기반 (스텁 제거, manifest 권한 8개)
- ✅ Step 2 — 엔진 코어 (setAlarmClock 예약/취소)
- ✅ Step 3 — 발화 체인 (Receiver→Service, 소리/진동/볼륨)
- ✅ Step 4 — 전체화면 + RN 연결 (AlarmEventBus emit + manifest MainActivity merge + cold-start listAlarms polling)
- ✅ Step 5 — 타이머 연결 (HomeScreen `shouldUseAlarmKitInTimer` Android 허용 + dispatch Start kind='timer' 경로 정합)
- ✅ Step 6 — 재부팅 복원 (`BootReceiver` + `AlarmScheduler.rescheduleAllFromBoot`)
- ✅ Step 7 — 해제·정리 (`AlarmService.onDestroy` 사운드/진동/볼륨/alerting 일괄)
- ✅ **2026-05-26 추가** — POST_NOTIFICATIONS 런타임 권한 흐름 (`routineScheduler.requestAlarmKitAuthorizationIfNeeded` Android 분기 + AppState invalidate Android 포함). 상세: `docs/work-2026-05-26-android-phase1-complete.md`
- ✅ **2026-05-26 추가 (동일 세션 후속)** — 알람 시스템 사이클 점검 (4종 알람 × iOS/Android 정합). 상세: `docs/audit-2026-05-26-alarm-cycle.md`
- ✅ **2026-05-26 Phase 2-1 마무리** — pauseAlarm/resumeAlarm Kotlin 구현 + paused map 영속 + listAlarms paused state + event emit. 상세: `docs/work-2026-05-26-android-phase2-1-and-phase3-2.md`
- ✅ **2026-05-26 Phase 3-2 마무리** — AlarmReceiver 측 반복 알람 다음 occurrence 재예약 (daily/weekly) + computeNextOccurrence. Phase 3 진입 시 자동 정합.
- ✅ **2026-05-26 Phase 3 부분 마무리 (3-1 + 3-0a + 3-4)** — 알람 탭 측 Android 활성화:
  - Phase 3-1 (Module UUID per schedule, chain 충돌 차단) — 에뮬레이터 측 chain 30개 모두 unique UUID 등록 검증 PASS
  - Phase 3-0a (alarmScheduler.ts Android 허용) — alarm 등록 path 활성화 검증 PASS
  - Phase 3-4 (AlarmListScreen Android 허용) — unsupported 화면 제거 검증 PASS
  - Phase 3-2 deployed 검증 — dex symbols (computeNextOccurrence + nextDayInWeek) 확인. daily/weekly 실 fire = 24h 대기 측 미실행.
  - 상세: `docs/work-2026-05-26-android-phase3-alarm-tab.md`
- ✅ **2026-05-26 Step 8 부분 PASS (에뮬레이터)** — 전체 시나리오 5단계 PASS:
  1. Timer schedule: `dispatch Start → ScheduleAlarmOnce → AlarmkitBridge.scheduleAlarm → setAlarmClock` 측 정확 등록 (`exactAllowReason=policy_permission`).
  2. Phase 2-1 Pause: `pauseAlarm → cancel + paused_alarms 영속` (remainingMs=223,132ms 정확 산출).
  3. Phase 2-1 Resume: `resumeAlarm → 새 fireAt = now + remainingMs + schedule 재등록` (정확).
  4. **Phase 1 Fire**: `AlarmReceiver fired → AlarmService start → AlarmEventBus.emit("alerting") → JS SESSION_EVENT_NAVIGATE → AlarmScreen mount` (정확 시점, 48ms drift).
  5. Dismiss: `cancelEntity done targets=1 nativeFail=0 finalStale=0` + SharedPreferences 완전 정리.

  상세: `docs/work-2026-05-26-android-phase2-1-and-phase3-2.md` §"Android 에뮬레이터 실기 검증". 잔여: 실기기 측 FSI 잠금화면 점유 + 무음모드 우회 + 볼륨 버튼 차단 + 재부팅 복원 = 별도 실기기 세션.
- ⬜ Phase 2-2 — 진행 중 카운트다운 알림 (ongoing notification, MED)
- ⬜ Phase 3-0/3-1/3-3/3-4/3-5 — 알람 탭 + 루틴 활성화 (= JS 가드 해제 + secondaryLabel UI + OEM 안내)
- ✅ **2026-05-26 Phase 3-0b + 2-2 + 3-3 마무리** — 루틴 path 활성화 + ongoing chronometer notification + secondaryLabel native action button + AlarmActionReceiver. Kotlin BUILD SUCCESSFUL + dex deployment 검증 PASS. 상세: `docs/work-2026-05-26-android-phase2-2-and-3-3.md`. 잔여: Phase 3-5 (OEM 안내) + E2E onboarding 통과 측 UI 검증 (= 에뮬레이터 UI swipe 측 신뢰성 한계).

## 만들어진 것 (`modules/alarmkit-bridge/android/`)

- `AlarmkitBridgeModule.kt` — JS 계약 함수 전체 (scheduleAlarm/cancelAlarm/stopAlarm/listAlarms/isAvailable/권한 + Phase2·iOS용 no-op 스텁)
- `AlarmScheduler.kt` — setAlarmClock 예약/취소 + SharedPreferences 영속
- `AlarmReceiver.kt` — 발화 수신 → AlarmService 시작
- `AlarmService.kt` — FGS(mediaPlayback), 알림+FSI, 소리(STREAM_ALARM)/진동/볼륨강제+ContentObserver
- `AndroidManifest.xml` — 권한 8개 + AlarmReceiver + AlarmService(mediaPlayback)
- `AlarmkitBridgeView.kt` — 삭제됨 (WebView 템플릿 스텁)
- 빌드 2회(Step1+2, Step3) 모두 BUILD SUCCESSFUL, Kotlin 에러 0, 앱 모듈 로드 정상

## Step 4 할 일 (파급 보고는 2026-05-22 대화에서 완료)

- **A. config plugin 신규** (`withAndroidManifest`) — `MainActivity`에 `showWhenLocked`/`turnScreenOn`. `app.json` plugins 등록. (계획서 Q1)
- **B. RN 연결** — 발화 시 JS가 알아채고 `AlarmScreen`으로:
  - 앱 살아있을 때 — native가 `onAlarmStateChange('alerting')` emit → 기존 App.tsx 리스너.
  - 앱 죽어있을 때 — FSI가 MainActivity 실행 → App.tsx 콜드스타트 분기가 launch intent의 `alerting_alarm_id` 읽음.
- **설계 미결** — AlarmService(별도 컴포넌트) → 모듈 `sendEvent` 전달 경로 (LocalBroadcast 등).
- 공용 파일 `App.tsx` 분기는 `Platform.OS==='android'`로 격리, 구현 후 iOS 검증.

## 제약 (계속 적용)

- iOS 무회귀 — 공용 파일 Platform 분기, iOS 경로 불변. **파급 보고마다 iOS 영향 명시 체크.**
- 최신 Android 패턴만 (CLAUDE.md #11). 레거시 스택 금지.
- 기술 설명 시 알기 쉬운 자연어 풀이 포함.

## 환경 상태

- Android 에뮬레이터 `emulator-5554` — Step 3 빌드 설치본 실행 중.
- Metro 백그라운드 실행 중.
- Step 4 코드 후 `expo prebuild -p android` + `expo run:android --no-bundler` 재빌드 필요.

## ⚠️ 미커밋 — 이번 세션 작업 전체 미커밋 상태

- `OnboardingScreen.tsx` — 재생버튼 20px 정렬 + favorites 튜토리얼 제거
- `app.json` + `assets/fonts/material.ttf` — MaterialIcons 폰트 Android 임베드
- 14개 화면 `.tsx` — SafeAreaView import를 `react-native-safe-area-context`로 교체
- `modules/alarmkit-bridge/` — Android 알람 엔진 Step 1~3 (Kotlin 4파일 + manifest, View 1파일 삭제)
- `docs/` — 계획서 + 이 진행 노트

→ 커밋 여부는 유저 지시 대기.
