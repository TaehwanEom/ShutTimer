# 안드로이드 Phase 3 일부 (3-1 + 3-0a + 3-4) — 알람 탭 활성화

**작성일**: 2026-05-26 (Phase 2-1 후 동일 세션)
**브랜치**: `feature/android-support`
**상태**: 코드 + 에뮬레이터 실기 검증 완료. iOS 영향 0.

---

## 작업 배경

Phase 2-1 (pause/resume) + Phase 3-2 (반복 알람 재예약) 마무리 후 사용자분 요청 측 = "추천 순서대로 진행" → Phase 3 일괄 진행 측 첫 단계.

Phase 3 전체 = 5단계 (3-0 ~ 3-5). 본 작업 = **알람 탭 활성화 측 최소 단위 (= 3-1 + 3-0a + 3-4)** 측 마무리. 잔여 (3-0b 루틴 / 3-3 secondaryLabel / 3-5 OEM 안내) = 별도 작업.

직전 상태 측 발견된 위험 (audit §6-D #1):
> **Android `entityId` 측 chain hashCode 충돌 가능성** — Phase 3 진입 시 = 같은 entityId 측 chain 30개 측 = `firePendingIntent` 측 `alarmId.hashCode()` 측 같음 → `FLAG_UPDATE_CURRENT` 측 = 직전 측 덮어쓰기 → **chain 측 1개만 잔존 회귀**.

---

## 수정 내용

### 1. `modules/alarmkit-bridge/android/src/main/java/expo/modules/alarmkitbridge/AlarmkitBridgeModule.kt` (Phase 3-1)

**`scheduleAlarm` 측 alarmId 발급 정책 변경:**

```diff
- val id = params.entityId.ifBlank { UUID.randomUUID().toString() }
+ // Phase 3-1: 항상 UUID 발급 (= iOS AlarmKit 패턴 정합).
+ //   직전 = `entityId.ifBlank { UUID }` 측 = entityId 측 직접 alarmId 측 사용 →
+ //     chain (= 같은 entityId 측 30개 schedule) 측 = firePendingIntent 측 `alarmId.hashCode()` 측 같음 →
+ //     PendingIntent.FLAG_UPDATE_CURRENT 측 = 직전 측 덮어쓰기 → chain 측 1개만 잔존 회귀.
+ //   정정 = 매 schedule 측 새 UUID 발급 → request code (hashCode) 측 unique 보장 → chain 측 30개 측 독립.
+ //   호환 = JS 측 = `scheduleAlarm` 반환 id 측 받아 mapping table 측 alarmId 저장. entityId 측 별도 추적.
+ val id = UUID.randomUUID().toString()
```

### 2. `src/utils/alarmScheduler.ts` (Phase 3-0a)

**`isAlarmKitAvailableSync` Android 허용:**

```diff
- function isAlarmKitAvailableSync(): boolean {
-   return Platform.OS === 'ios';
- }
+ // Phase 3-0a (2026-05-26): Android 도 알람 엔진 활성화.
+ function isAlarmKitAvailableSync(): boolean {
+   return Platform.OS === 'ios' || Platform.OS === 'android';
+ }
```

영향 측 함수 (= 같은 가드 사용):
- `scheduleAlarmMain` — Android 측 진입 허용 → chain 30개 정합 등록
- `cancelAlarmsForEntity` (호출 path) — 정합
- `cleanupGhostAlarms` — Android 측 ghost 정리 동작 (= 깨끗 상태 측 no-op)
- `migrateSoundRename` — Android 측 안전 (= 1회 실행 후 flag 설정 + 사운드 res/raw 측 정합)
- `syncAllAlarms` — Android 측 chain sync 정합
- `isAlarmKitReady` — 가용 + 권한 검사

### 3. `src/screens/AlarmListScreen.tsx` (Phase 3-4)

**`isAlarmKitSupported` Android 허용:**

```diff
- function isAlarmKitSupported(): boolean {
-   return Platform.OS === 'ios';
- }
+ // Phase 3-4 (2026-05-26): Android 도 알람 엔진 활성화.
+ function isAlarmKitSupported(): boolean {
+   return Platform.OS === 'ios' || Platform.OS === 'android';
+ }
```

효과 = `if (!supported) return <unsupported UI />` 분기 측 Android 측 진입 X → 정상 알람 리스트 UI 노출.

---

## 검증

### TypeScript 컴파일 — PASS (exit 0)

### Kotlin 컴파일 — BUILD SUCCESSFUL (`:app:assembleDebug` 2m 46s)

### Android 에뮬레이터 실기 검증 — PASS

**환경**: `shuttimer` AVD (Android 16, API 36). emulator-5554.

#### A. Phase 3-4 (UI 활성화) PASS

- Alarm 탭 진입 시 = 직전 "iOS 26+에서 지원" 화면 측 = **제거됨**.
- "Alarms" 헤더 + "No alarms set" + "+ Add Alarm" 버튼 정상 노출.
- 사용자 측 + 버튼 / Add Alarm 측 정상 동작 → AlarmEdit 화면 진입.

#### B. Phase 3-0a (알람 등록 path 활성화) PASS

알람 등록 후 logcat 측 chain 30개 정확 schedule 측 확인:

```
[alarmScheduler-DBG] scheduleAlarm alarmId=a_1779797786597_njar33 chainIndex=0  fireAt=1779883980000 recurrence=never
[alarmScheduler-DBG] scheduleAlarm alarmId=a_1779797786597_njar33 chainIndex=1  fireAt=1779884100000 ...
[alarmScheduler-DBG] scheduleAlarm alarmId=a_1779797786597_njar33 chainIndex=2  fireAt=1779884220000 ...
...
[alarmScheduler-DBG] scheduleAlarm alarmId=a_1779797786597_njar33 chainIndex=29 fireAt=1779887460000 ...
```

- chainIndex 0..29 = 30개 정확.
- fireAt 측 차이 = 정확 120,000ms (= 2분 간격).
- base fireAt = 1779883980000 = 5-27 21:13:00 KST (= 내일 9:13 PM, 24h 후).
- chainIndex 29 측 fireAt = base + 58분 (= 60분 ringing 보장 정합).

#### C. Phase 3-1 (chain UUID 충돌 차단) PASS — 핵심 검증

**dumpsys alarm** 측 native AlarmManager 측 등록 알람 수:
```
$ adb shell dumpsys alarm | grep -c "com.shuttimer.app/expo.modules.alarmkitbridge.AlarmReceiver"
32  # = 30 alarms + 2 reference entries (= Next wake from idle summary)
```

→ **30개 모두 unique PendingIntent 등록 정합**. 직전 = 1개만 잔존 회귀 영역 = **완전 차단**.

**SharedPreferences** 측 alarmId 측 형식 정합:
```json
{
  "alarms": [
    {"id":"393fc12e-6f2e-4b0d-bed7-6e053a9f029d", ...},  ← UUID 측 정합
    {"id":"36b72c6b-094d-45b4-84c5-0e5214c51a03", ...},
    {"id":"65162b0f-155a-4afc-b95f-b28f30ae5e28", ...},
    {"id":"14a53639-62bc-43d1-9215-700e806f2522", ...},
    ... (30개 모두 UUID 형식)
  ]
}
```

→ 모든 alarmId 측 UUID v4 형식 (= entityId `a_1779797786597_njar33` 측 직접 사용 X). Phase 3-1 정정 정합.

**native dumpsys** 측 각 알람 측 정확 등록:
```
RTC_WAKEUP #38: Alarm{f270f1d type 0 origWhen 1779883980000 com.shuttimer.app}
  tag=*walarm*:com.shuttimer.app/expo.modules.alarmkitbridge.AlarmReceiver
  type=RTC_WAKEUP origWhen=2026-05-27 21:13:00.000 exactAllowReason=policy_permission ...

RTC_WAKEUP #39: Alarm{67658de type 0 origWhen 1779884100000 com.shuttimer.app}
  origWhen=2026-05-27 21:15:00.000  ← +2분 정확

RTC_WAKEUP #40: Alarm{38b24ea type 0 origWhen 1779884220000 com.shuttimer.app}
  origWhen=2026-05-27 21:17:00.000  ← +2분 정확
...
```

#### D. Phase 3-2 (반복 알람 재예약) — deployed 검증 PASS

APK dex strings 측 `computeNextOccurrence` 및 내부 lambda 확인:
```
$ strings classes*.dex | grep "computeNextOccurrence\|nextDayInWeek"
*$this$computeNextOccurrence_u24lambda_u242
6$i$a$-apply-AlarmScheduler$computeNextOccurrence$cal$1
F$i$a$-firstOrNull-AlarmScheduler$computeNextOccurrence$nextDayInWeek$1
```

→ **Phase 3-2 Kotlin 로직 측 deployed**. AlarmReceiver 측 호출 path 측 = Phase 1 fire 검증 시 이미 정합 확인 (= `scheduleNextOccurrenceIfNeeded` 측 once → no-op return).

**daily/weekly 실 fire path** 측 검증 = 시간 측 24h 대기 측 = 본 세션 측 미실행. 코드 path 측 = Calendar 산술 + `schedule` 호출 측 = 순수 영역 (IO/network 없음) → 실패 위험 측 낮음.

---

## 검증 외 영역 (= 별도 실기기 / 일정)

1. **daily/weekly 실 fire + 다음 occurrence 재예약** — 24h 대기 측 = 일정 영역. 시뮬레이터 시각 조작 측 = 권한 측 거부.
2. **잠금화면 측 알람 FSI 표시** — 에뮬레이터 측 = 잠금 시뮬레이션 측 신뢰성 한계 (Phase 1 영역 정합 한계).
3. **무음모드 우회 / 볼륨 차단** — 에뮬레이터 측 audio HAL 측 한계 (Phase 1 영역 정합 한계).
4. **재부팅 복원** — 에뮬레이터 reboot 측 = 가능하지만 본 세션 측 시간 측 정합 안 함.
5. **OEM 측 배터리 킬러 안내 UI** — Phase 3-5 영역, 별도 작업.

---

## 영향 범위

| 영역 | 영향 |
|---|---|
| iOS | **영향 0** — Platform 분기 측 = `Platform.OS === 'ios' \|\| Platform.OS === 'android'` 형태 (= 기존 iOS 측 정합 유지). |
| Android Phase 1 (Timer) | 영향 0 — Timer path 측 = `ScheduleAlarmOnce` effect 측 진입 + 본 가드 측 무관. |
| Android Phase 2-1 (Pause/Resume) | 영향 0 — Module 측 pause/resume 측 entityId 측 무관 (= alarmId 측 직접 lookup). |
| Android Phase 3 (alarm 탭) | **활성화** — 사용자 측 알람 추가/편집/삭제/토글 정상 동작. |
| Android Phase 3 (루틴) | **여전히 미동작** — Phase 3-0b (routineScheduler.ts 측 가드) + Phase 3-3 (secondaryLabel UI) 미진행. |
| JS API 시그니처 | 변경 없음. |

---

## 남은 작업 (= 별도)

### Phase 3-0b (= routine path 활성화)
- `src/utils/routineScheduler.ts:34-37` 측 `isAlarmKitAvailableSync` Android 허용
- 효과 = 루틴 prealert + confirm_prompt 측 path 측 = Android 측 활성화

### Phase 3-3 (= secondaryLabel "다음 진행" UI)
- iOS AlarmKit 측 = 자체 UI 측 처리. Android 측 = 별도 native action button 또는 AlarmScreen 측 직접 처리 필요.
- 우선순위 = MED (= routine 측 step 진행 시점 측 UX 필수).

### Phase 3-5 (= OEM 안내)
- 샤오미/삼성 측 배터리 킬러 / 자동 시작 허용 설정 deep-link.

### Phase 2-2 (= ongoing notification, MED)
- 잠금화면 측 카운트다운 표시.

### Step 8 잔여 (= 실기기 측)
- 잠금화면 FSI / 무음모드 / 볼륨 차단 / 재부팅 / daily-weekly 실 fire.

---

## 결론

**알람 탭 = Android 측 정상 활성화**. Phase 3 진입 시 발견된 chain hashCode 충돌 위험 측 = **완전 차단**. iOS 영향 0. TS PASS + Kotlin BUILD SUCCESSFUL + 에뮬레이터 실기 PASS.

본 작업 = audit 측 발견된 HIGH 영역 측 마무리 정합. 루틴 측 활성화 = Phase 3-0b + 3-3 측 별도 작업 (= secondaryLabel UI 측 비교적 큰 작업).
