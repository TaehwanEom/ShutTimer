# 안드로이드 Phase 2-2 (ongoing notification) + Phase 3-0b/3-3 (루틴 + secondaryLabel) 구현

**작성일**: 2026-05-26 (Phase 3 알람 탭 + Phase 2-1 후 동일 세션)
**브랜치**: `feature/android-support`
**상태**: 코드 + Kotlin BUILD SUCCESSFUL (재빌드 진행 중) + TS PASS. 에뮬레이터 검증 = 별도 단계.

---

## 작업 배경

추천 순서 측 Option A (Phase 3 일괄) + Option B (Phase 2-2) 측 잔여 영역 통합 마무리.

직전 단계 (`docs/work-2026-05-26-android-phase3-alarm-tab.md`) 측 완료 후 잔여:
- **Phase 3-0b**: routineScheduler.ts 측 Android 가드 해제 (= 루틴 prealert + confirm_prompt path 활성화)
- **Phase 3-3**: secondaryLabel native action button (= "다음 진행" 측 FSI 측 secondary button + 이벤트 전달)
- **Phase 2-2**: ongoing chronometer notification (= 잠금화면 측 Timer 남은 시간 표시)

---

## 수정 내용

### 1. `src/utils/routineScheduler.ts` (Phase 3-0b)

**`isAlarmKitAvailableSync` Android 허용:**

```diff
- _alarmKitAvailable = Platform.OS === 'ios';
+ _alarmKitAvailable = Platform.OS === 'ios' || Platform.OS === 'android';
```

효과:
- `shouldUseAlarmKit()` Android 측 권한 OK 시 true 반환
- `scheduleRoutinePrealerts` Android 측 진입 → prealert 30분/5분 전 알림 등록 path 활성화
- `scheduleConfirmPromptViaAlarmKit` Android 측 진입 → 루틴 step 종료 시점 confirm_prompt 알람 등록 path 활성화
- `requestAlarmKitAuthorizationIfNeeded` Android 측 = 이미 Phase 1 측 POST_NOTIFICATIONS 정합

### 2. `modules/alarmkit-bridge/android/src/main/java/expo/modules/alarmkitbridge/AlarmScheduler.kt` (Phase 2-2)

**Imports 추가**:
```kotlin
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build
```

**상수 추가**: `ONGOING_CHANNEL_ID = "alarmkit_timer_progress"` (= 카운트다운 알림 채널)

**`schedule()` 측 timer_main 측 ongoing notification 시작 호출:**
```kotlin
fun schedule(context: Context, record: AlarmRecord) {
  persistUpsert(context, record)
  ...setAlarmClock...
  if (record.type == "timer_main") {
    startOngoingTimerNotification(context, record)
  }
}
```

**`cancel()` 측 ongoing 정리 호출:**
```kotlin
fun cancel(context: Context, alarmId: String) {
  ...cancel + persistRemove + pausedRemove...
  stopOngoingTimerNotification(context, alarmId)
}
```

**`pauseAlarm()` 측 ongoing 제거 호출:**
```kotlin
fun pauseAlarm(context: Context, alarmId: String): Long {
  ...persist paused...
  stopOngoingTimerNotification(context, alarmId)
  return now
}
```

**신규 함수 `startOngoingTimerNotification()`**:
- IMPORTANCE_LOW NotificationChannel 측 1회 생성 (= 소리 X, 진동 X, 잠금화면 측 표시)
- `Notification.Builder` 측:
  - `setUsesChronometer(true)` + `setWhen(record.fireAt)` + `setChronometerCountDown(true)` (API 24+)
  - `setCategory(CATEGORY_STOPWATCH)`
  - `setOngoing(true)` + `setAutoCancel(false)` (= 사용자 측 swipe 측 제거 불가)
  - `setVisibility(VISIBILITY_PUBLIC)` (= 잠금화면 측 내용 표시)
  - `setContentIntent` 측 = MainActivity launch intent
- `nm.notify(ongoingNotifId(record.id), notif)` 측 표시

**신규 함수 `stopOngoingTimerNotification()`**: `nm.cancel(ongoingNotifId(alarmId))`.

**ongoing notification ID 측 = alarmId.hashCode() 측 짝수화** (= FSI NOTIF_ID=0xA1A2 측 충돌 회피).

### 3. `modules/alarmkit-bridge/android/src/main/java/expo/modules/alarmkitbridge/AlarmService.kt` (Phase 2-2 + Phase 3-3)

**Phase 2-2: 발화 시 ongoing notification 측 제거:**
```kotlin
override fun onStartCommand(...) {
  ...
  if (alarmId != null) {
    AlarmScheduler.stopOngoingTimerNotification(this, alarmId)  // ← 신규
  }
  val notif = buildNotification(record)
  ...
}
```

**Phase 3-3: `buildNotification` 측 secondary action button 측 추가:**
```kotlin
val secondaryLabel = record?.secondaryLabel
if (!secondaryLabel.isNullOrBlank() && record != null) {
  val secondaryIntent = Intent(this, AlarmActionReceiver::class.java).apply {
    action = AlarmActionReceiver.ACTION_SECONDARY
    putExtra(AlarmScheduler.EXTRA_ALARM_ID, record.id)
  }
  val secondaryPending = PendingIntent.getBroadcast(
    this, record.id.hashCode() xor 0x1, secondaryIntent,
    PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
  )
  builder.addAction(0, secondaryLabel, secondaryPending)
}
```

### 4. `modules/alarmkit-bridge/android/src/main/java/expo/modules/alarmkitbridge/AlarmActionReceiver.kt` (Phase 3-3, 신규 파일)

```kotlin
class AlarmActionReceiver : BroadcastReceiver() {
  companion object {
    const val ACTION_SECONDARY = "expo.modules.alarmkitbridge.SECONDARY_ACTION"
  }
  override fun onReceive(context: Context, intent: Intent) {
    val alarmId = intent.getStringExtra(AlarmScheduler.EXTRA_ALARM_ID) ?: return
    if (intent.action == ACTION_SECONDARY) {
      AlarmEventBus.emit(alarmId, "secondary_action")
      AlarmScheduler.cancel(context, alarmId)
      context.stopService(Intent(context, AlarmService::class.java))
    }
  }
}
```

### 5. `modules/alarmkit-bridge/android/src/main/AndroidManifest.xml` (Phase 3-3)

```xml
<receiver
    android:name="expo.modules.alarmkitbridge.AlarmActionReceiver"
    android:exported="false"/>
```

### 6. `modules/alarmkit-bridge/android/src/main/java/expo/modules/alarmkitbridge/AlarmkitBridgeModule.kt` (Phase 3-3)

**`ScheduleAlarmParams` 측 `secondaryLabel` 필드 추가:**
```kotlin
class ScheduleAlarmParams(
  ...
  @Field val secondaryLabel: String? = null,
  ...
)
```

**`scheduleAlarm` 측 record 생성 시 secondaryLabel 전달.**

### 7. `modules/alarmkit-bridge/src/AlarmkitBridge.types.ts` (Phase 3-3)

**`AlarmStateChangeEvent.state` 측 `'secondary_action'` 추가:**
```typescript
state: AlarmKitAlarmState | 'removed' | 'secondary_action';
```

### 8. `App.tsx` 측 listener 분기 (Phase 3-3)

```typescript
import { dispatch as sessionDispatch } from './src/state/SessionController';

// onAlarmStateChange listener 진입 직후:
if (event.state === 'secondary_action') {
  const sMeta = await loadAlarmMetadata(event.alarmId).catch(() => null);
  if (sMeta?.type === 'confirm_prompt') {
    await sessionDispatch({ type: 'Advance' }).catch(() => {});
  }
  await deleteAlarmMetadata(event.alarmId).catch(() => {});
  return;
}
```

---

## 동작 흐름

### A. Timer ongoing notification (Phase 2-2)

```
사용자 측 Timer 시작 → ScheduleAlarmOnce effect → AlarmkitBridge.scheduleAlarm({type:'timer_main'})
  → AlarmScheduler.schedule:
      ├── persistUpsert + setAlarmClock (= 발화 예약)
      └── startOngoingTimerNotification (= 잠금화면 측 카운트다운 표시)

사용자 측 잠금화면 측 = "타이머 완료\n탭하여 종료" 측 chronometer (= 03:42 → 03:41 → ... → 00:00)

사용자 측 pause 측 = pauseAlarm:
  ├── cancel + paused map 저장
  └── stopOngoingTimerNotification (= 카운트다운 측 제거)

사용자 측 resume 측 = resumeAlarm → schedule (= ongoing 측 재시작)

발화 시점 측 = AlarmReceiver → AlarmService.onStartCommand:
  ├── stopOngoingTimerNotification (= countdown 측 = alerting 측 전환)
  └── FSI notification 측 startForeground (= 알람 화면 측 표시)
```

### B. Routine 측 "다음 진행" 측 (Phase 3-0b + 3-3)

```
사용자 측 routine 시작 → step 1 → confirm_prompt 측 scheduleAlarmAt:
  → AlarmkitBridge.scheduleAlarm({type:'confirm_prompt', stopLabel:'확인', secondaryLabel:'다음 진행'})
  → AlarmScheduler.schedule (= setAlarmClock)

발화 시점 → AlarmReceiver → AlarmService → FSI notification:
  ├── 본문 = 다음 step 이름
  ├── content tap → MainActivity (= AlarmScreen 진입)
  └── secondary action button = "다음 진행" (= Phase 3-3 신규)

사용자 측 잠금화면 측 = "다음 진행" 탭 → AlarmActionReceiver.onReceive:
  ├── AlarmEventBus.emit("secondary_action") → JS sendEvent
  ├── AlarmScheduler.cancel (= 알람 예약 + ongoing + alerting 정리)
  └── stopService(AlarmService) (= 사운드/진동/볼륨 정리)

JS App.tsx onAlarmStateChange listener:
  ├── state === 'secondary_action' 감지
  ├── meta.type === 'confirm_prompt' → sessionDispatch({type:'Advance'})
  └── deleteAlarmMetadata (= mapping table 정리)

SessionController.transition('Advance'):
  ├── 다음 step 측 schedule (= 다음 confirm_prompt 등록)
  └── 마지막 step 측 = COMPLETED (= 루틴 종료)
```

---

## 검증

### TypeScript 컴파일 — PASS (exit 0)
- `AlarmStateChangeEvent.state` 측 'secondary_action' 추가 후 App.tsx 측 비교 정합.

### Kotlin 컴파일 — BUILD SUCCESSFUL (`:app:assembleDebug` 3m 32s)

### APK Dex deployment 검증 — PASS

**Phase 2-2 ongoing notification 측 symbols:**
```
$ strings classes*.dex | grep -iE "ongoing|chronometer|alarmkit_timer_progress"
startOngoingTimerNotification
stopOngoingTimerNotification
ongoingNotifId
ONGOING_CHANNEL_ID
alarmkit_timer_progress
setUsesChronometer
setChronometerCountDown
setOngoing
android.chronometerCountDown   # ← Notification platform constant
$this$startOngoingTimerNotification_u24lambda_u2416
$this$startOngoingTimerNotification_u24lambda_u2417
AlarmScheduler$startOngoingTimerNotification$channel$1
AlarmScheduler$startOngoingTimerNotification$launch$1
```

**Phase 3-3 secondaryLabel + AlarmActionReceiver 측 symbols:**
```
$ strings classes*.dex | grep -E "secondaryLabel|AlarmActionReceiver|SECONDARY_ACTION|secondary_action"
Lexpo/modules/alarmkitbridge/AlarmActionReceiver;
Lexpo/modules/alarmkitbridge/AlarmActionReceiver$Companion;
AlarmActionReceiver.kt
secondaryLabel
secondary_action
expo.modules.alarmkitbridge.SECONDARY_ACTION
```

= 모든 Phase 2-2 + Phase 3-3 Kotlin 코드 측 APK 측 deployed 정합.

### 정적 검증 영역

| 영역 | 상태 |
|---|---|
| ongoing chronometer channel | API 26+ 측 NotificationChannel + IMPORTANCE_LOW 정합 |
| ongoing chronometer countdown | API 24+ 측 setChronometerCountDown(true) + setWhen(fireAt) |
| AlarmScheduler.schedule 측 timer_main 분기 | type 검사만, alarm_main 측 영향 0 |
| AlarmScheduler.cancel 측 ongoing 정리 | 무조건 호출 (= notify ID 없을 시 no-op) |
| AlarmService.onStartCommand 측 ongoing 정리 | 발화 시점 = alerting 측 단일 source 측 보장 |
| AlarmActionReceiver 측 broadcast | exported=false, ACTION_SECONDARY 측 분기 |
| secondary PendingIntent request code | `record.id.hashCode() xor 0x1` (= primary request code 측 충돌 회피) |
| ScheduleAlarmParams 측 secondaryLabel field | iOS Module 측 = 이미 정의됨 (= types.ts:52), Android 측 추가 정합 |
| App.tsx listener 분기 | `state === 'secondary_action'` 분기 측 = 'alerting' 측 filter 측 위 위치 |

### 미검증 영역 (= 실기 검증 필요, 별도)

- Timer 측 잠금화면 chronometer countdown 측 실제 표시 (= 에뮬레이터 측 가능, 별도 단계).
- 루틴 측 step 1 → step 2 → step 3 측 진행 측 "다음 진행" 버튼 측 실제 동작 (= 사용자 측 routine 등록 필요).
- ongoing notification 측 pause 시 제거 / resume 시 재시작 측 실제 표시.
- 발화 시 ongoing → alerting 측 전환 측 (= 동시 표시 회피 정합).

---

## 영향 범위

| 영역 | 영향 |
|---|---|
| iOS | **영향 0** (= Android Kotlin 측 신규 + 'secondary_action' state 측 = iOS 측 emit X) |
| Android Phase 1 (Timer) | **이득** — ongoing chronometer 측 표시 (= UX 보강) |
| Android Phase 2-1 (Pause/Resume) | **이득** — pause 시 ongoing 측 자동 제거, resume 시 재시작 |
| Android Phase 3 (alarm 탭) | 영향 0 — alarm_main 측 secondaryLabel 측 = JS 측 전달 X → AlarmService 측 분기 측 = 미진입 |
| Android Phase 3 (routine) | **활성화** — 루틴 prealert + confirm_prompt + step 진행 path 측 정합 |
| JS API 시그니처 | `AlarmStateChangeEvent.state` 측 union 확장만 (= 호환) |

---

## 남은 작업 (= 별도)

- **E2E 에뮬레이터 검증**:
  1. Timer 측 잠금화면 ongoing 표시 + pause/resume 측 cleanup/재시작
  2. 루틴 등록 + step 1 시작 + 잠금화면 측 "다음 진행" 버튼 측 표시 + 탭 측 step 2 advance
- **Phase 3-5** (OEM 측 배터리 킬러 안내) — 사용자 측 OEM 측 자동 시작 허용 설정 deep-link
- **실기기 검증** (FSI 잠금화면 / 무음모드 / 볼륨 차단 / 재부팅)
- **git commit** (= 사용자 승인 대기)

---

## 결론

추천 순서 측 Option A (Phase 3 일괄) 측 완성. iOS 영향 0. Android Timer + 알람 탭 + 루틴 측 = 모두 정상 동작 path 정합.

**Phase 3 마무리 완료 (= 3-0a + 3-0b + 3-1 + 3-2 + 3-3 + 3-4 모두 마무리)**. Phase 3-5 + 실기기 + git commit = 별도 단계.
