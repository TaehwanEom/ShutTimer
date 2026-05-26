# 안드로이드 Phase 1 마무리 — POST_NOTIFICATIONS 권한 경로 보강

**작성일**: 2026-05-26
**브랜치**: `feature/android-support`
**상태**: 코드 작업 완료 (= TS PASS). 실기기 빌드/검증 = 별도.

---

## 작업 배경

안드로이드 알람 엔진 Phase 1 (Step 1~7) 코드 = 이미 들어가 있는 상태. 마지막 한 단계 (Phase 1을 실기기에서 정상 동작하게 만드는 권한 흐름) 만 빠져 있었다.

직전 상태:
- Kotlin 5 파일 (`AlarmkitBridgeModule`, `AlarmScheduler`, `AlarmReceiver`, `AlarmService`, `BootReceiver`, `AlarmEventBus`) = 완성.
- Module manifest = 권한 8개 + Receiver + Service + MainActivity merge attrs (`showWhenLocked` / `turnScreenOn`) 완료.
- HomeScreen 측 `shouldUseAlarmKitInTimer` = Android 허용 (= getAuthorizationState=authorized 시 진행).

그런데 사용자 측 onboarding 측 알림 권한 슬라이드 측 = **iOS 전용 경로**로만 구현됨:
- `OnboardingScreen.requestPermission('notification')` → `requestAlarmKitAuthorizationIfNeeded()`
- `requestAlarmKitAuthorizationIfNeeded()` 측 `isAlarmKitAvailableSync()` (= `Platform.OS === 'ios'`) 가드로 Android 시 `'unavailable'` 즉시 return.

→ Android 측 = **POST_NOTIFICATIONS 권한 요청 자체가 안 일어나는 상태**. 사용자가 Android 13+ 기기에서 앱 첫 진입 시 = 알림 권한 미부여 → FSI(Full-Screen-Intent) 알람 = 표시 ❌ → Phase 1 핵심 흐름 (잠금화면 전체화면 알람) 동작 ❌.

---

## 수정 내용

### `src/utils/routineScheduler.ts`

#### import 추가
```ts
import { Platform, AppState, PermissionsAndroid } from 'react-native';
```

#### `requestAlarmKitAuthorizationIfNeeded` — Android 분기 추가
- 진입 시 `Platform.OS === 'android'` = `requestAndroidNotificationPermission()` 위임.
- iOS = 기존 AlarmKit `requestAuthorization` 경로 그대로.

#### 신규 함수 `requestAndroidNotificationPermission`
- `PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS` 키 사용.
- Android 12 이하 (API < 33) = 키 미정의 → `'authorized'` 자동 처리 (= 권한 자동 부여 상태).
- 이미 부여 (`PermissionsAndroid.check`) = 즉시 `'authorized'`.
- 미부여 = `PermissionsAndroid.request` → GRANTED 시 `'authorized'`, 그 외 `'denied'`.
- 캐시 (`_alarmKitAuthorized`) 동일하게 갱신 → 후속 `shouldUseAlarmKit` 호출 측 정합.

#### AppState 'active' 캐시 invalidate — Android 포함
- 직전 = `Platform.OS === 'ios'` 단일 가드.
- 정정 = `Platform.OS === 'ios' || Platform.OS === 'android'`.
- 이유 = 사용자가 설정 앱에서 알림 권한 토글 후 앱 복귀 시 = 캐시된 `denied` 잔존 → 권한 받은 후에도 알람 미작동 회귀 차단.

### 영향 없음 (= 손대지 않은 영역)

- `OnboardingScreen.tsx` = 본체 수정 X. `permission === 'notification'` 슬라이드 측 `requestAlarmKitAuthorizationIfNeeded()` 호출 그대로 → 자동으로 Android 경로 분기 동작.
- `HomeScreen.tsx` = 본체 수정 X. `shouldUseAlarmKitInTimer` 측 = 이미 Android 허용 + `getAuthorizationState=authorized` 검증 → POST_NOTIFICATIONS 부여 후 자동 진행.
- `alarmScheduler.ts` / `AlarmListScreen.tsx` / 반복 알람 = Phase 3 영역 → 본 작업 범위 외, 수정 ❌.
- iOS 경로 = **영향 0** (= 분기 진입 조건 `Platform.OS === 'android'` 별도, iOS 분기 코드 변경 X).

---

## 동작 흐름 (Android Phase 1 end-to-end)

### 신규 사용자 (= 첫 설치)
1. 온보딩 진입 → '알림 권한' 슬라이드 도달.
2. '계속' 탭 → `requestPermission('notification')` → `requestAlarmKitAuthorizationIfNeeded()` →
   - Android: `PermissionsAndroid.request(POST_NOTIFICATIONS)` → 시스템 다이얼로그 노출 → 사용자 허용/거부.
3. 허용 시 = `_alarmKitAuthorized = true` 캐시 + `'authorized'` return.

### 타이머 시작
1. HomeScreen 측 `shouldUseAlarmKitInTimer()` → `AlarmkitBridge.getAuthorizationState()` (= Android Module 측 `nm.areNotificationsEnabled()`).
2. 허용 시 = `dispatch Start { kind:'timer' }` → effectRunner `ScheduleAlarmOnce` → `AlarmkitBridge.scheduleAlarm({entityId, fireAt, type:'timer_main', ...})`.
3. Android Module 측 `AlarmScheduler.schedule()` → `setAlarmClock` 예약 + SharedPreferences 영속.

### 종료 시각 발화 (앱 종료 상태)
1. `AlarmManager` 측 = 시각 도달 → `AlarmReceiver.onReceive` (= 시스템이 깨움).
2. `startForegroundService(AlarmService)` (= Android 14 exact-alarm FGS start 면제 정합).
3. `AlarmService.onStartCommand` → FGS startForeground + FSI 알림 + STREAM_ALARM 사운드 + 진동 + 볼륨 강제 + `AlarmScheduler.setAlerting(alarmId)` + `AlarmEventBus.emit("alerting")`.
4. FSI → `MainActivity` 실행 (`showWhenLocked` / `turnScreenOn` = 잠금화면 위 + 화면 ON).
5. RN 부팅 + App.tsx 마운트 → `runAlertingAlarmCheck` (cold start +1.5s) → `AlarmkitBridge.listAlarms()` → `state="alerting"` 발견 → `loadAlarmMetadata` → AlarmScreen navigate.
6. 사용자 미션 완료 → `AlarmScreen` 측 `AlarmkitBridge.stopAlarm` → Android Module 측 = `cancel` + `stopService(AlarmService)` → `Service.onDestroy` → 사운드/진동/볼륨/alerting 일괄 정리.

### 앱 살아있을 때 발화
- `onAlarmStateChange('alerting')` event 측 = JS 자동 emit (= AlarmEventBus.listener 정합).
- App.tsx 측 = `onAlarmStateChange` listener → meta 조회 → `onAlarmFire` dispatch → AlarmScreen navigate.

### 재부팅 복원
- `BOOT_COMPLETED` → `BootReceiver.onReceive` → `AlarmScheduler.rescheduleAllFromBoot()` → SharedPreferences 측 영속 알람 중 `fireAt > now` 만 재등록. 과거 건 = 정리.

---

## 검증 영역

### TypeScript 컴파일 — PASS (exit 0)
```bash
cd /Volumes/SeagateBac/moda/Timer && npx tsc --noEmit
```

### 정적 검증 영역
- iOS 측 = `Platform.OS === 'android'` 분기 별도 → iOS 회귀 위험 0.
- `_alarmKitAuthorized` 캐시 = iOS / Android 둘 다 AppState 'active' 시 invalidate → 둘 다 정합.
- Android 12 이하 = `PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS` 키 미정의 시 = `'authorized'` 자동 처리 (= OS 측 알림 자동 허용 영역 정합).

### 미검증 영역 (= 실기기/에뮬레이터 필요)
- POST_NOTIFICATIONS 시스템 다이얼로그 실제 노출 확인.
- 허용 시 `nm.areNotificationsEnabled() = true` 반환 정합.
- `setAlarmClock` 발화 → FSI → MainActivity 진입 → AlarmScreen 마운트 흐름.
- 잠금화면 위 표시 (showWhenLocked).
- 무음모드 우회 (STREAM_ALARM).
- 볼륨 버튼 음소거 차단 (ContentObserver).
- 재부팅 복원 (BootReceiver).

---

## Phase 1 완료 정의 vs 본 작업 후 상태

| Phase 1 성공 기준 | 본 작업 후 상태 |
|---|---|
| ① 타이머 시작 → 종료 시각에 발화 | 코드 path 완성. 실기기 검증 필요 |
| ② 앱 종료 상태에서도 발화 | manifest receiver + setAlarmClock = 정합. 실기기 검증 필요 |
| ③ 잠금화면 위 전체화면 알람 | **POST_NOTIFICATIONS 요청 추가 = 본 작업 = 마지막 막힌 길**. 사용자 허용 시 정합 |
| ④ 미션/사진 완료로만 해제 | AlarmScreen 측 = 플랫폼 무관 RN 공용 path. 정합 |
| ⑤ 무음모드에서도 울림 + 볼륨 음소거 차단 | STREAM_ALARM + ContentObserver. 실기기 검증 필요 |

본 작업 = **③ 항목 측 사용자 권한 미요청 회귀 차단** (= Phase 1 마무리 막힌 길 풀기).
나머지 ①②④⑤ = 실기기 빌드 후 검증 영역 (= Step 8 영역).

---

## 다음 단계 (= 별도 작업)

### Step 8 — 실기기/에뮬레이터 검증
1. `expo prebuild -p android` + `expo run:android` 빌드.
2. 온보딩 진입 → 알림 권한 다이얼로그 실제 노출 확인.
3. 타이머 시작 → 발화 path 5가지 (①~⑤) 시나리오 검증.

### Phase 2 (= 별도 작업, plan §11)
- `pauseAlarm` / `resumeAlarm` Kotlin 구현 (현재 no-op 스텁).
- 진행 중 카운트다운 알림 (ongoing notification + chronometer).

### Phase 3 (= 별도 작업, plan §11)
- `alarmScheduler.ts` Android 분기 (`isAlarmKitAvailableSync` 측 Android 허용).
- `AlarmListScreen` Android 측 = 알람 등록 UI 허용 (= `isAlarmKitSupported` 분기).
- 반복 알람 = `AlarmReceiver` 측 = 발화 시 다음 occurrence 1개 재예약.
- 보고 시 = `alarmkitMappingTable` 측 = `chainIndex` / `chainBaseFireAt` Android 측 부적합 → 별도 schema 분기 검토 필요.

---

## 결론

Android Phase 1 코드 path = **완성**. 마지막 한 단계 (POST_NOTIFICATIONS 권한 흐름) = 본 작업 측 마무리. TS 컴파일 PASS. iOS 회귀 위험 0.

남은 = Step 8 (실기기 빌드/검증). Phase 2/3 = 별도 작업 범위.
