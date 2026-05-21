# 안드로이드 알람 엔진 — 진행 노트 (2026-05-22 세션 일시중단)

> 계획서: `docs/plan-2026-05-22-android-alarm-engine.md`
> 다음 세션 — 이 노트 + 계획서를 읽고 **Step 4부터** 이어가면 됨.

## 진행 상황 (Phase 1)

- ✅ Step 0 — 게이트
- ✅ Step 1 — 모듈 기반 (스텁 제거, manifest 권한 8개)
- ✅ Step 2 — 엔진 코어 (setAlarmClock 예약/취소)
- ✅ Step 3 — 발화 체인 (Receiver→Service, 소리/진동/볼륨)
- ⏭️ **Step 4 — 전체화면 + RN 연결 ← 다음 시작점**
- ⬜ Step 5 — 타이머 연결 (HomeScreen 게이트 개방) — 여기서 첫 end-to-end 기능 테스트
- ⬜ Step 6 — 재부팅 복원 / Step 7 — 해제·정리 / Step 8 — 전체 검증

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
