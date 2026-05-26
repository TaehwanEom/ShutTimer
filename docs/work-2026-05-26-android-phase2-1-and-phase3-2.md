# 안드로이드 Phase 2-1 (pause/resume) + Phase 3-2 (반복 알람 재예약) 구현

**작성일**: 2026-05-26 (Phase 1 마무리 후 동일 세션)
**브랜치**: `feature/android-support`
**상태**: 코드 작업 완료 (= TS PASS + Kotlin BUILD SUCCESSFUL). 실기기 검증 = 별도.

---

## 작업 배경

[`docs/audit-2026-05-26-alarm-cycle.md`](audit-2026-05-26-alarm-cycle.md) 측 점검 결과 발견된 HIGH 영역 2건 측 = 본 작업 측 마무리.

### 발견된 위험 (audit §7-B / §7-C)

1. **Phase 2-1 silent fail (HIGH)** — `AlarmkitBridge.pauseAlarm` / `resumeAlarm` 측 = Android 측 `return 0.0` no-op.
   - 사용자 측 = 타이머 pause 눌러도 native AlarmManager 측 = 계속 카운트다운 → 시간 도달 시 발화 = "왜 멈췄는데 울려?" 회귀.
   - effectRunner `PauseAlarmNative` / `ResumeAlarmNative` effect 측 = Android 측 호출되어도 silent skip = 사용자 입장 측 = 동작 안 함.

2. **Phase 3-2 반복 알람 재예약 누락 (HIGH, Phase 3 진입 시 critical)** — `AlarmReceiver` 측 = 발화 시 다음 occurrence 측 재예약 X.
   - Module 측 = `AlarmManager.setAlarmClock` 단발 등록. `recurrenceMode` field 측 = persist 만 + 실제 사용 0.
   - Phase 3 진입 시 = `alarm_main` 측 daily/weekly 알람 측 = 1회만 발화 후 다음 날부터 X 회귀.
   - Phase 2-1 (= 본 작업) 측 = timer pause/resume 측 schedule 재호출 path 측에도 동일 정합 필요.

---

## 수정 내용

### 1. `modules/alarmkit-bridge/android/src/main/java/expo/modules/alarmkitbridge/AlarmScheduler.kt`

#### `PausedAlarm` data class 추가
```kotlin
data class PausedAlarm(
  val record: AlarmRecord,
  val remainingMs: Long,
  val pausedAt: Long
)
```

#### `cancel()` 측 paused map 정리 추가
- 사용자 측 pause 후 cancel 호출 시 = paused 영구 잔존 회피.

#### 신규 함수 `pauseAlarm(context, alarmId) → Long`
- `get` 측 record lookup → record 없으면 0 반환.
- `now = System.currentTimeMillis()`, `remainingMs = (record.fireAt - now).coerceAtLeast(0L)`.
- `AlarmManager.cancel` + `persistRemove` (= active 측 제거).
- `pausedUpsert(PausedAlarm)` (= paused map 측 영속).
- 반환 = `now` (= iOS 시그니처 정합 — JS 측 pause 시점 측정용).

#### 신규 함수 `resumeAlarm(context, alarmId) → Long`
- `pausedGet` 측 record + remainingMs lookup → 없으면 0 반환.
- `pausedRemove` + `schedule(record.copy(fireAt = now + remainingMs))` (= active 측 새 fireAt 측 등록).
- 반환 = `now`.

#### 신규 함수 `listPaused(context) → List<PausedAlarm>`
- listAlarms 측 paused state 반환용.

#### 신규 함수 `scheduleNextOccurrenceIfNeeded(context, alarmId)` — Phase 3-2
- `get` 측 record lookup → record 없거나 `recurrenceMode == "never"` 시 no-op.
- `computeNextOccurrence(record)` → nextFireAt.
- `schedule(record.copy(fireAt = nextFireAt))` (= persistUpsert 측 = 같은 id 덮어쓰기 정합).

#### 신규 함수 `computeNextOccurrence(record) → Long?` — Phase 3-2
- `daily` = +1일 (= `Calendar.DAY_OF_YEAR, 1`).
- `weekly` + recurrenceDays 비어 있으면 = +7일.
- `weekly` + recurrenceDays 측 = 정렬 후 = 오늘 이후 첫 요일 (= `nowDow = Calendar.DAY_OF_WEEK - 1`, convention 0=일~6=토).
  - 오늘 이후 없으면 = 다음 주 첫 요일 (= `(7 - nowDow) + sortedDays.first()`).
- `else` = null (= once 측 등 = no-op).

#### `readAllPaused` / `writeAllPaused` / `pausedUpsert` / `pausedRemove` / `pausedToJson` / `pausedFromJson` SharedPreferences 영속 (JSON)
- 키 = `KEY_PAUSED = "paused_alarms"` (= 신규).
- AlarmRecord 측 = 기존 `toJson` / `fromJson` 측 재사용.

### 2. `modules/alarmkit-bridge/android/src/main/java/expo/modules/alarmkitbridge/AlarmkitBridgeModule.kt`

#### `listAlarms` 측 paused 상태 추가
```kotlin
AsyncFunction("listAlarms") {
  val alertingId = AlarmScheduler.getAlertingId(context)
  val active = AlarmScheduler.list(context).map { ... }  // 기존
  val now = System.currentTimeMillis()
  val paused = AlarmScheduler.listPaused(context).map { p ->
    mapOf(
      "id" to p.record.id,
      "state" to "paused",
      "fixedFireMs" to (now + p.remainingMs).toDouble()  // 현 fireAt = now + 잔여
    )
  }
  active + paused
}
```

- iOS AlarmInfo schema 측 `state: 'scheduled' | 'countdown' | 'paused' | 'alerting'` 정합.

#### `pauseAlarm` / `resumeAlarm` no-op 폐기 → 실 호출
```kotlin
AsyncFunction("pauseAlarm") { alarmId: String ->
  val ts = AlarmScheduler.pauseAlarm(context, alarmId)
  if (ts > 0L) AlarmEventBus.emit(alarmId, "paused")
  ts.toDouble()
}

AsyncFunction("resumeAlarm") { alarmId: String ->
  val ts = AlarmScheduler.resumeAlarm(context, alarmId)
  if (ts > 0L) AlarmEventBus.emit(alarmId, "scheduled")
  ts.toDouble()
}
```

- 성공 시 event emit (= iOS `onAlarmStateChange` 측 paused/scheduled state 변경 정합).

### 3. `modules/alarmkit-bridge/android/src/main/java/expo/modules/alarmkitbridge/AlarmReceiver.kt`

#### 발화 직후 다음 occurrence 재예약 추가
```kotlin
override fun onReceive(context: Context, intent: Intent) {
  val alarmId = ...
  // 기존: AlarmService 시작
  ...
  // 신규 (Phase 3-2): 반복 알람 측 다음 occurrence 재예약
  try {
    AlarmScheduler.scheduleNextOccurrenceIfNeeded(context, alarmId)
  } catch (e: Exception) {
    Log.w("AlarmkitBridge", "scheduleNextOccurrenceIfNeeded fail ...")
  }
}
```

- once 측 = no-op. daily/weekly 측 = 자동 다음 occurrence 측 setAlarmClock 재예약.
- Phase 3 진입 시 (= JS 측 isAlarmKitAvailableSync 가드 해제) = 자동으로 alarm_main daily/weekly 측 정상 동작.

---

## 동작 흐름 변화

### timer pause/resume (= Phase 2-1)

```
[직전 — 회귀]
사용자 측 pause 버튼 → dispatch Pause → effectRunner PauseAlarmNative
  → AlarmkitBridge.pauseAlarm(alarmId) → Android Module 측 = return 0.0 (no-op)
  → 시간 도달 → AlarmManager fire → AlarmReceiver → AlarmService → 발화 회귀

[현재 — 정합]
사용자 측 pause 버튼 → dispatch Pause → effectRunner PauseAlarmNative
  → AlarmkitBridge.pauseAlarm(alarmId)
    → AlarmScheduler.pauseAlarm:
        ├── record lookup
        ├── remainingMs 산출
        ├── AlarmManager.cancel (= 발화 차단)
        ├── persistRemove (= active list 측 제거)
        └── pausedUpsert (= paused map 측 영속)
    → AlarmEventBus.emit("paused")
  → 사용자 resume 버튼 → effectRunner ResumeAlarmNative
    → AlarmkitBridge.resumeAlarm(alarmId)
      → AlarmScheduler.resumeAlarm:
          ├── pausedGet (record + remainingMs)
          ├── pausedRemove
          └── schedule(record.copy(fireAt = now + remainingMs))
      → AlarmEventBus.emit("scheduled")
```

### 반복 알람 (= Phase 3-2)

```
[직전 — Phase 3 진입 시 회귀]
daily 알람 등록 (= 미래 Phase 3 시점)
  → AlarmManager.setAlarmClock → 시각 도달 → AlarmReceiver → AlarmService 발화
  → (재예약 path 없음) → 다음 날부터 = 알람 X 회귀

[현재 — 정합]
동일 흐름 → AlarmService 발화 후
  → AlarmReceiver 내부 = scheduleNextOccurrenceIfNeeded
    → record.recurrenceMode == "daily" → +1일 측 새 fireAt 산출
    → schedule(record.copy(fireAt = nextFireAt)) → persistUpsert
  → 다음 날 같은 시각 측 = 자동 재발화 정합
```

---

## 검증

### TypeScript 컴파일 — PASS (exit 0)
```
npx tsc --noEmit
```

### Kotlin 컴파일 — BUILD SUCCESSFUL
```
./gradlew :alarmkit-bridge:compileDebugKotlin
./gradlew :app:assembleDebug
```

- 신규 추가: `Calendar` import, `PausedAlarm` data class, 9개 함수, paused JSON serializer.
- 기존 함수 시그니처 변경 없음 (= 호출처 측 영향 0).
- iOS Swift 측 = 영향 0 (= Android 측 Kotlin만 수정).
- APK 측 신규 심볼 포함 확인 (= dex strings 측 `AlarmScheduler$PausedAlarm` / `pauseAlarm` / `scheduleNextOccurrenceIfNeeded` 검출).

### Android 에뮬레이터 실기 검증 — PASS (2026-05-26 동일 세션)

**환경**: `shuttimer` AVD (Android 16, API 36, 1080x2400). emulator-5554.

#### 1. Phase 1 Timer schedule end-to-end PASS

```
[timer] AlarmKit auth: authorized            ← POST_NOTIFICATIONS 부여 정합
[SessionController] dispatch action=Start currentState=IDLE
[effectRunner] ScheduleAlarmOnce id=main_timer_1779796257906 fireAt=1779796558027
[timer] scheduled via dispatch id=main_timer_1779796257906
```

**dumpsys alarm** 측 native 등록 확인:
```
RTC_WAKEUP #9: Alarm{... origWhen 1779796558027 com.shuttimer.app}
  tag=*walarm*:com.shuttimer.app/expo.modules.alarmkitbridge.AlarmReceiver
  type=RTC_WAKEUP origWhen=2026-05-26 20:55:58.027 (= 5분 후 정확)
  exactAllowReason=policy_permission                ← USE_EXACT_ALARM 부여
  showIntent=PendingIntent{...startActivity}        ← FSI → MainActivity
```

**SharedPreferences (alarmkit_bridge_alarms.xml)** 측 영속:
```json
{
  "alarms": [{
    "id":"main_timer_1779796257906",
    "fireAt":1779796558027,
    "title":"Done\nTap to stop",
    "soundName":"alarm_01.wav",
    "type":"timer_main",
    "entityId":"main_timer_1779796257906",
    "recurrenceMode":"never",
    "recurrenceDays":[],
    "stopLabel":"확인"
  }]
}
```

#### 2. Phase 2-1 Pause PASS

`pause` 버튼 측 사용자 탭 → 직후:

```
[onAlarmStateChange-DBG] alarmId=main_timer_1779796257906 state=paused AppState=active
[CHAIN-MARKER-V18] listener entered state=paused alarmId=main_timer_1779796257906
```

**SharedPreferences** 측 정합:
```json
{
  "alarms": [],                                     ← active 측 제거
  "paused_alarms": [{
    "record": { "id":"main_timer_1779796257906", "fireAt":1779796558027, ... },
    "remainingMs": 223132,                          ← 직전 fireAt - now 정확 산출
    "pausedAt": 1779796334895
  }]
}
```

- **remainingMs 측 정합 검증**: 직전 fireAt(1779796558027) - pausedAt(1779796334895) = 223,132ms (= 3분 43초). `coerceAtLeast(0L)` 정상.

**dumpsys alarm** 측 active alarm 측 = 제거 확인.

#### 3. Phase 2-1 Resume PASS

`resume` 버튼 측 사용자 탭 → 직후:

```
[onAlarmStateChange-DBG] alarmId=main_timer_1779796257906 state=scheduled AppState=active
[CHAIN-MARKER-V18] listener entered state=scheduled alarmId=main_timer_1779796257906
```

**SharedPreferences** 측 정합:
```json
{
  "paused_alarms": [],                              ← paused 측 제거
  "alarms": [{
    "id":"main_timer_1779796257906",                ← 동일 id 유지
    "fireAt":1779796581889,                         ← 새 fireAt = now + remainingMs
    ... (나머지 record 측 보존)
  }]
}
```

- **fireAt 재계산 정합**: 새 fireAt(1779796581889) - 직전 fireAt(1779796558027) = 23,862ms ≈ 24초 (= pause된 시간). resume 시점 측 now + remainingMs 측 정확.

**dumpsys alarm** 측 재등록 확인:
```
origWhen=2026-05-26 20:56:21.889                    ← 새 fireAt
whenElapsed=+3m40s65ms                              ← 잔여 시간 정확
exactAllowReason=policy_permission                  ← USE_EXACT_ALARM 유지
```

#### 4. Phase 3-2 (반복 알람 재예약) — 정적 검증 PASS

- Timer (= recurrence="never") 측 = `scheduleNextOccurrenceIfNeeded` 측 = 즉시 return (no-op). 코드 path 안전.
- daily/weekly 측 실 발화 검증 = Phase 3-0 가드 해제 시 진입 (= 본 작업 범위 외, JS 측 `isAlarmKitAvailableSync` 측 ios-only 가드 잔존).
- APK 측 신규 함수 `scheduleNextOccurrenceIfNeeded` 포함 확인 (= dex strings 검출).

#### 5. Phase 1 Fire end-to-end PASS

Timer pause/resume 후 잔여시간 만료 시점 측 자연 발화 검증:

```
20:56:21.937  AlarmkitBridge: AlarmReceiver fired — alarmId=main_timer_1779796257906 → AlarmService
20:56:22.005  AlarmkitBridge: AlarmService start — alarmId=main_timer_1779796257906 title=Done
20:56:24.613  ReactNativeJS: [onAlarmStateChange-DBG] state=alerting AppState=active
20:56:24.728  ReactNativeJS: [onAlarmStateChange-DBG] 포그라운드 알람 (timer_main) → SESSION_EVENT_NAVIGATE Alarm
20:56:25.243  ReactNativeJS: SplashGate 종료 route=Alarm                  ← AlarmScreen mount
20:56:55      사용자 dismiss → stopAudioAndVibration → cancel cleanup
20:56:55.655  ReactNativeJS: [SessionController] dispatch action=Dismiss currentState=STEP_ALERTING
20:56:56.110  ReactNativeJS: [cancelEntity-DBG] done entityId=main_timer_1779796257906 targets=1 nativeFail=0 finalStale=0
20:56:56.113  ReactNativeJS: [onAlarmStateChange-DBG] state=removed
```

**검증 정합**:
- ✅ Phase 1 `AlarmReceiver` 측 정확 발화 시점 (20:56:21.937 = 등록 fireAt 20:56:21.889 + 48ms)
- ✅ Phase 1 `AlarmService.onStartCommand` 측 정상 진입 + FGS 시작 + alerting persist
- ✅ Phase 1 `AlarmEventBus.emit("alerting")` 측 JS listener 측 정확 전달
- ✅ JS dispatch path: SESSION_EVENT_NAVIGATE → AlarmScreen mount
- ✅ Dismiss → cancelEntity targets=1 / nativeFail=0 / finalStale=0 (= 모든 cleanup path 정상)
- ✅ SharedPreferences 최종 상태: `{alarms: [], paused_alarms: []}` (= 완전 정리)

**미검증 영역 (= 실기기 필요)**:
- 잠금화면 위 FSI 측 화면 점유 (= 에뮬레이터 측 잠금 시뮬레이션 측 한계)
- STREAM_ALARM 측 무음모드 우회 (= 에뮬레이터 측 audio 측 한계)
- 볼륨 버튼 측 음소거 차단 (= 에뮬레이터 측 hardware key 측 한계)
- 재부팅 복원 (= 수동 emulator reboot 필요)
- daily/weekly 측 다음 occurrence 자동 재예약 (= Phase 3 활성화 시점 검증)

### 정적 검증 영역

| 영역 | 상태 |
|---|---|
| `cancel(context, alarmId)` 측 pausedRemove 추가 | ✅ paused 영구 잔존 차단 |
| `pauseAlarm → cancel + paused map` 영속 | ✅ |
| `resumeAlarm → paused map + 새 fireAt schedule` | ✅ |
| `listAlarms` 측 active + paused 결합 반환 | ✅ |
| event emit ("paused" / "scheduled") | ✅ iOS onAlarmStateChange 정합 |
| AlarmReceiver 측 발화 직후 reschedule | ✅ |
| weekly recurrenceDays = 0=일~6=토 convention | ✅ JS chainMemberDayOffset 정합 |
| once 측 reschedule no-op | ✅ |

### 미검증 영역 (= 실기기 필요)

- 실제 pause/resume 측 화면 측 동작 검증.
- 잔여 시간 측 정확도 (= ms 단위 측 schedule race).
- daily/weekly 측 실제 다음 날 측 발화 확인 (= +24h 측 wait).
- 자정 크로스 측 weekly 측 = 다음 요일 측 정합 (= JS dayOffset shift 측 = Android computeNextOccurrence 측 동일 의미인지).

---

## 영향 범위

| 영역 | 영향 |
|---|---|
| iOS | **영향 0** (= Android Kotlin 측 수정만) |
| Android Phase 1 (= timer 단발) | 영향 0 (= once 측 reschedule no-op + cancel 측 paused 정리 추가만) |
| Android Phase 1 + pause/resume UX | **silent fail 차단** (= 본 작업 = effectRunner PauseAlarmNative 측 = 실 동작) |
| Phase 3 alarm_main daily/weekly | **준비 완료** (= 가드 해제 시점 측 자동 정합) |
| JS API 시그니처 | 변경 없음 (= 본체 함수 시그니처 동일) |

---

## 남은 작업 (= 별도)

### Phase 2-2 (= MED) — 진행 중 카운트다운 알림
- 잠금화면 측 남은 시간 표시 (= ongoing notification + chronometer).
- iOS Live Activity 측 Android 대응물.

### Phase 3-0 ~ 3-5 (= 일괄) — 알람 탭 + 루틴 활성화
- Phase 3-0: JS Platform 가드 해제 (alarmScheduler.ts / routineScheduler.ts / AlarmListScreen.tsx).
- Phase 3-1: chain 충돌 정정 (= Android module 측 UUID 발급 또는 JS 측 entityId+chainIndex 패턴).
- Phase 3-3: secondaryLabel ("다음 진행") 측 Android schema + UI.
- Phase 3-4: AlarmListScreen Android 측 unsupported 화면 제거.
- Phase 3-5: OEM 측 배터리 킬러 안내.

### Step 8 — 실기기/에뮬레이터 검증
- Phase 1 (= timer 단발) + Phase 2-1 (= pause/resume) 동시 검증.

---

## 결론

audit 측 발견된 HIGH 영역 2건 측 = 본 작업 측 마무리. **Android pause/resume silent fail = 차단**. Phase 3 진입 시 반복 알람 회귀 = 차단.

남은 = 실기기 검증 (Step 8) + Phase 2-2 (ongoing notification) + Phase 3-0..3-5 (alarm 탭 + 루틴) = 별도 작업.
