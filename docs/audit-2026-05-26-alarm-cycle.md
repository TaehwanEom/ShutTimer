# 알람 시스템 사이클 + 통합 관리 점검 (2026-05-26)

**브랜치**: `feature/android-support`
**범위**: 알람 4종 (alarm_main / timer_main / confirm_prompt / prealert) 각 사이클 + 통합 관리 계층 (mapping table / SessionController / effectRunner / AlarmkitBridge)
**관점**: iOS (AlarmKit) + Android (AlarmManager) 양 플랫폼 정합

> 본 문서 = 작업 진행하며 실시간 갱신.

---

## 점검 대상 알람 4종

| type | 발화 주체 | 사이클 | 핵심 영역 |
|---|---|---|---|
| `alarm_main` | 사용자 알람 탭 (시각 알람) | enable → AlarmKit chain (iOS 30개) / Android setAlarmClock 단발 → fire → AlarmScreen → dismiss | chain 정합 / once 자동 disable |
| `timer_main` | HomeScreen 메인 타이머 | dial 측 사용자 시작 → dispatch Start kind='timer' → schedule → fire → AlarmScreen → dismiss | Session 통합 / pause/resume |
| `confirm_prompt` | 루틴 step 종료 시점 | routine start → step interval → fire (= "확인" 알람) → advance / stop | dual SoT (Session + ar) / advance race |
| `prealert` | 루틴 시작 N분 전 | routine 등록 → 30/5분 전 schedule → fire (= 알림만, navigate ❌) | iOS only (Android 미구현) |

---

## 통합 관리 계층 4단

```
[ UI 컴포넌트 ]                                  ← HomeScreen / AlarmListScreen / AlarmScreen 등
       ▼  dispatch action
[ SessionController (transition) ]               ← single state machine. action → next state + effects
       ▼  effects[]
[ effectRunner ]                                 ← 부수효과 (schedule, navigate, persist)
       ▼  AlarmkitBridge call
[ alarmkit-bridge (JS) → 네이티브 모듈 ]         ← iOS Swift (AlarmKit) / Android Kotlin (AlarmManager)
       ▼  saveAlarmMetadata
[ alarmkitMappingTable (AsyncStorage) ]          ← alarmId ↔ {type, entityId, chainIndex, deleted}
```

발화 역방향:
```
네이티브 fire → onAlarmStateChange event → App.tsx listener → loadAlarmMetadata → dispatch OnAlarmFire → transition → NavigateAlarmScreen effect → SESSION_EVENT_NAVIGATE → App.tsx route handler → AlarmScreen
```

---

## 1. alarm_main 사이클

### 1-A. 등록 (= enable / 신규 / 편집)

```
AlarmListScreen 측 토글 / 저장
  → dispatchEnableAlarm(alarm.id)
  → SessionController.transition('EnableAlarm') = ScheduleAlarmChain effect
  → effectRunner case 'ScheduleAlarmChain' = scheduleAlarmMain(target)
  → alarmScheduler.ts:116 scheduleAlarmMain
      └── isAlarmKitReady() 검사 (= 권한 + 가용성)
      └── nextAlarmOccurrenceTime(alarm) = baseFireAt 산출
      └── activeCount 산출 (= 활성 알람 갯수, chainCount 분배)
      └── 30/activeCount 만큼 chain 멤버 schedule (2분 간격)
      └── for i=0..chainCount: scheduleAlarmAt(alarm, baseFireAt+i*120000, i, baseFireAt)
          └── AlarmkitBridge.scheduleAlarm({entityId, fireAt, recurrence, type:'alarm_main', ...})
          └── saveAlarmMetadata({alarmId, type:'alarm_main', entityId, chainIndex, chainBaseFireAt})
          └── 실패 시 nativeId rollback (v1.9 #ScheduleAtomicity)
```

| 구간 | iOS 동작 | Android 동작 |
|---|---|---|
| `isAlarmKitReady` | AlarmKit framework 가용 + `getAuthorizationState='authorized'` | **isAlarmKitAvailableSync=false 즉시 return null** → 알람 등록 ❌ |
| `scheduleAlarmAt` | AlarmKit `.alarm(schedule:.relative weekly/daily)` 또는 `.fixed` | (호출 안 됨) |
| `recurrence='daily'/'weekly'` | OS 자동 반복 | (호출 안 됨) |
| chain 30개 등록 | OS 측 chain 전체 등록 → 60분 ringing 보장 | (호출 안 됨) |

**결론**: **Android = `alarm_main` 등록 자체 차단**. AlarmListScreen UI도 `isAlarmKitSupported=ios only` 가드로 "iOS 26+에서 지원" 안내 표시. = **Phase 3 영역**.

### 1-B. 발화 (fire)

```
[iOS]
AlarmKit OS → 발화 → onAlarmStateChange('alerting', alarmId) event
  → App.tsx listener (line 343)
      ├── meta.deleted=true → silent cancel + return (v1.9 #SoftDelete)
      ├── SUPPRESS_ALARMKIT_BANNER_IN_FG + active → cancelAlarm (in-app modal 정책)
      ├── meta.type === 'alarm_main' → onAlarmFire(alarmType='main')
      │   └── ⑨ guard: isGhostAlarmFire 시 silent stop+cancel+delete (ghost=true)
      │   └── C-1: simple_alarm Session 자동 생성 (Start dispatch, replaceExisting=true)
      │   └── dispatch OnAlarmFire → transition → STEP_ALERTING + NavigateAlarmScreen effect
      └── App.tsx 측 부수 처리 (alarm_main):
          ├── recordAlarmSession (sessions 히스토리)
          └── chainIndex >= max → disableOnceAlarmIfNeeded (once 자동 disable)

[Android]
AlarmManager.setAlarmClock → AlarmReceiver → startForegroundService(AlarmService)
AlarmService.onStartCommand:
  ├── FGS + FSI 알림 + STREAM_ALARM 사운드 + 진동 + 볼륨 강제
  ├── AlarmScheduler.setAlerting(alarmId)
  └── AlarmEventBus.emit("alerting") → Module listener → JS sendEvent('onAlarmStateChange')
앱 살아있을 때 = iOS 와 동일 listener path 진입 (단 SUPPRESS gate 측 Android 제외 — line 365)
앱 죽어있을 때 = FSI → MainActivity 진입 → RN 부팅 → runAlertingAlarmCheck (cold start +1.5s) →
  AlarmkitBridge.listAlarms() → state='alerting' 발견 → meta lookup → navigate Alarm
```

| 구간 | iOS | Android | 정합 |
|---|---|---|---|
| event emit | AlarmKit framework | AlarmEventBus → module sendEvent | ✅ |
| meta lookup | mapping table | mapping table | ✅ |
| ⑨ guard | isGhostAlarmFire | isGhostAlarmFire | ✅ |
| simple_alarm Session 생성 | alarms.find(id=entityId) | alarms.find(id=entityId) | ✅ |
| 포그라운드 active 시 in-app modal 강제 | SUPPRESS cancel + navigate | **Platform 가드로 SUPPRESS 제외** (= native FSI 그대로 노출) | 차이 — 의도 OK |
| 콜드스타트 alerting 복원 | listAlarms `state='alerting'` polling | listAlarms `state='alerting'` polling | ✅ (Android module 측 state='alerting' 반환 정합) |

### 1-C. 해제 (dismiss) / 취소 (disable)

```
[dismiss — 미션 완료 후]
AlarmScreen 측 stopAlarm path
  → dispatch Dismiss → transition → CancelAlarmChain effect
  → effectRunner case 'CancelAlarmChain' = cancelAlarmsForEntity(entityId)
      ├── F0: markAlarmDeleted (deleted=true, soft delete)
      ├── F1: AlarmkitBridge.cancelAlarm 시도 (nativeFailCount 추적)
      ├── F2: verify retry x3 (listAlarms 측 잔존 확인 + 100ms delay)
      └── F3: stale=0 시 정식 deleteAlarmMetadata. stale>0 시 metadata 잔존 (listener silent skip)
  → disableOnceAlarmIfNeeded (once 알람 자동 disable)

[disable — 사용자 토글 off]
AlarmListScreen 측 토글 / 삭제
  → dispatchDisableAlarm(alarm.id)
  → SessionController.transition('DisableAlarm') = CancelAlarmChain effect
  → 현 session alarm 매칭 시 = Session 도 null + RestorePendingDisabled effect
```

| 구간 | iOS | Android | 정합 |
|---|---|---|---|
| F1 cancel | AlarmKit `cancel(id:)` | `AlarmManager.cancel(PendingIntent)` + persistRemove | ✅ |
| F2 verify | listAlarms 측 잔존 확인 + retry | listAlarms 측 (SharedPreferences read) | ✅ |
| Service 측 alerting stop | (해당 없음, AlarmKit 측 자동) | `stopAlarmService` → onDestroy → 사운드/진동/볼륨/alerting 정리 | ✅ (의도 정합) |
| once 자동 disable | disableOnceAlarmIfNeeded | (alarm_main 등록 안 되므로 무관) | (Phase 3 시 동일 path) |

### 1-D. 발견된 위험 (alarm_main)

- **Android Phase 3 진입 시 chain 충돌**: 현 Android module `firePendingIntent` 측 `alarmId.hashCode()` 측 request code 사용. 같은 `entityId` 측 chain 30개 schedule 시 = 같은 hashCode → 같은 PendingIntent → 후속 schedule 측 직전 schedule 측 덮어쓰기 회귀. = **chain 30개 측 1개만 살아남음**.
  - 대응 = Phase 3 시점 alarm_main 경로 측 chainIndex 측 unique alarmId 필요 (예: `${entityId}_${chainIndex}`).
- **Android `recurrence` 측 misuse**: 현 Module 측 = `recurrence.mode` JSON parse만 + AlarmRecord 저장만 + 실제 `setAlarmClock` 측 = 단발 등록. = **반복 알람 측 1회만 발화 후 끝**.
  - 대응 = Phase 3 시점 `AlarmReceiver.onReceive` 측 = 발화 시 다음 occurrence 1개 재예약 로직 필요. plan §4.3 정합.

---

---

## 2. timer_main 사이클

### 2-A. 등록 (= 타이머 시작)

```
HomeScreen 측 사용자 dial + 시작 버튼
  → shouldUseAlarmKitInTimer() = AlarmkitBridge.getAuthorizationState='authorized' 검사
      ├── iOS: AlarmKit 권한 검사
      └── Android: nm.areNotificationsEnabled() 검사 (= POST_NOTIFICATIONS)
  → checkAlarmConflictAndConfirm(seconds) — 기존 알람과의 갭 충돌 dialog
  → sessionDispatch({type:'Start', kind:'timer', sessionId=routineId, steps=[{...}], alarmBinding={...}})
  → SessionController.transition('Start') = ScheduleAlarmOnce effect (+ SaveActiveRoutine)
  → effectRunner case 'ScheduleAlarmOnce':
      └── AlarmkitBridge.scheduleAlarm({entityId, fireAt, type:'timer_main', soundName, laMeta, ...})
      └── saveAlarmMetadata({alarmId, type:'timer_main', entityId})
  → HomeScreen 후속: mapping lookup → alarmkitIdRef 갱신 → writeChainAlarms (App Group LA Intent sync)
```

| 구간 | iOS 동작 | Android 동작 |
|---|---|---|
| `shouldUseAlarmKitInTimer` | 권한 OK 시 true | **권한 OK 시 true** (= 본 작업으로 POST_NOTIFICATIONS 받음) |
| `AlarmkitBridge.scheduleAlarm` | AlarmKit `.alarm(schedule:.fixed(date))` 단발 | `AlarmScheduler.schedule` → `setAlarmClock` |
| `entityId` = UUID 충돌 | iOS = 새 UUID 발급 | **Android = entityId 그대로 사용 (`id = params.entityId.ifBlank{UUID}`)** — `routineId='main_timer_${Date.now()}'` 측 unique → 충돌 0 |
| writeChainAlarms (LA App Group) | iOS App Group UserDefaults 측 sync | Android = `writeAppGroupString` 측 = no-op (false return) — LA Intent X, 영향 0 |

### 2-B. 발화

```
시각 도달 → 발화 (iOS=AlarmKit, Android=AlarmManager)
  → onAlarmStateChange('alerting', alarmId)
  → App.tsx listener:
      ├── meta.type === 'timer_main' → onAlarmFire(alarmType='main')
      │   └── Sub A-3 fix: timer_main도 alarm_main과 동일 path. Session entityId 매칭 → STEP_ALERTING 전이
      │   └── transition → NavigateAlarmScreen effect → SESSION_EVENT_NAVIGATE Alarm emit → AlarmScreen mount
      └── 옛 timer_main 직접 navigate path 폐기 (Sub A-3 fix 2026-05-25)
```

| 구간 | iOS | Android | 정합 |
|---|---|---|---|
| event emit | AlarmKit alerting | AlarmEventBus emit | ✅ |
| Sub A-3 통합 path | 단일 onAlarmFire → dispatch | 단일 onAlarmFire → dispatch | ✅ |
| 콜드스타트 alerting check | `runAlertingAlarmCheck` (1.5s polling) | **동일 path** — module listAlarms 측 alerting 반환 | ✅ |
| AlarmScreen 측 사운드/dismiss | AlarmKit dismiss + expo-av in-app sound | **Native AlarmService 측 계속 재생** + AlarmScreen 측 in-app sound (이중 재생 회피 = `isTimerActive` 플래그) | 주의 — line 364 측 Android FSI 차단 분기 X 정합 (= 사용자 OS 측 사운드 유지) |

### 2-C. 해제 / 정리

```
[자연 종료]
타이머 0:00 → AlarmScreen mount → 사용자 미션 완료 → dispatch Dismiss
  → transition → CancelAlarmChain effect (timer_main 도 cancelAlarmsForEntity loop 측 포함)
  → cancelAlarmsForEntity:
      ├── targets filter = (type alarm_main OR timer_main) AND entityId 매칭
      ├── F0 soft delete → F1 cancel → F2 verify retry → F3 정식 delete
      └── disableOnceAlarmIfNeeded (timer_main 은 alarm.repeat 없음 → silent skip)

[수동 취소 — 사용자 ✕]
HomeScreen 측 cancelAlarms()
  → AlarmkitBridge.cancelAlarm(alarmkitIdRef) + deleteAlarmMetadata
  → clearChainAlarms (App Group cleanup)
  → 플래그 isTimerActive 해제
```

| 구간 | iOS | Android | 정합 |
|---|---|---|---|
| F1 cancel | AlarmKit `cancel(id:)` | `AlarmManager.cancel` + persistRemove | ✅ |
| Service 측 stop | (해당 없음) | `stopAlarmService` → onDestroy 사운드/진동/볼륨 cleanup | ✅ (의도 정합) |
| alerting cleanup | listAlarms 잔존 검증 | listAlarms 잔존 검증 (SharedPreferences) | ✅ |

### 2-D. Pause / Resume — **Phase 2 영역**

```
[iOS]
LA widget pause 버튼 → PauseRoutineIntent.perform → AlarmKit pause(id:) →
  onAlarmStateChange('paused') → JS listener → 옛 ar.pausedAt 갱신

[Android]
(미구현. AlarmkitBridge.pauseAlarm/resumeAlarm 측 0.0 no-op return)
사용자 측 pause 누를 widget UI 자체 없음 — Phase 2 영역
```

| 구간 | iOS | Android | 정합 |
|---|---|---|---|
| AlarmkitBridge.pauseAlarm | native pause + LA paused state | **no-op (return 0.0)** | ❌ Phase 2 |
| effectRunner PauseAlarmNative | iOS = pauseAlarm 호출 + LA 자동 paused | Android = pauseAlarm 호출 → no-op → silent fail | ⚠️ silent fail 위험 |
| HomeScreen 측 pause 진행 | iOS = AlarmKit pause + JS pausedAt 동시 | Android = JS pausedAt 만 갱신, native = 그대로 계속 카운트다운 → **시간 도달 시 발화** | ❌ Phase 2 critical |

### 2-E. 발견된 위험 (timer_main)

- **Pause/Resume Android no-op = silent fail**: 사용자가 타이머 pause 눌러도 native는 그대로 카운트다운 → 일정 시간 후 발화 = "왜 멈췄는데 울려?" 회귀. Phase 2-1 우선순위 1.
- **이중 재생 위험 (Android)**: `isTimerActive` flag로 in-app sound 측 차단 의도. AlarmScreen mount 시 = native sound (Android AlarmService) + JS sound 동시 재생 가능성 있음. 검증 필요 — 시뮬레이터 X (실기기만).
- **App Group write no-op (Android)**: `writeChainAlarms` = no-op return. LA Intent 자체가 iOS 전용 → 영향 0. **(Android 측 별도 widget 측 추후 = Phase 2/3 시점)**.

---

---

## 3. confirm_prompt 사이클

### 3-A. 등록 (= 루틴 step 진행 중)

```
ActiveRoutineSection 측 step 시작
  → dispatch Start (kind='routine' / 'ad_hoc_routine') → effects[ScheduleConfirmPrompt(...)]
  → effectRunner case 'ScheduleConfirmPrompt':
      ├── DupSched 가드 (key=routineId:stepIndex:fireAt, 1초 dedup)
      ├── 이전 confirm_prompt cancelRoutineConfirmPrompt (currentRunningAlarmId)
      └── scheduleRoutineConfirmPrompt(routineId, fireAt, nextStepName, laRoutineName, laStepName, laStepIndex, laTotalSteps)
          ├── shouldUseAlarmKit() = iOS 권한 OK 시 true
          │   └── **Android = false 반환** (= routineScheduler 측 isAlarmKitAvailableSync iOS only)
          └── scheduleConfirmPromptViaAlarmKit:
              └── AlarmkitBridge.scheduleAlarm({entityId=routineId, type:'confirm_prompt', secondaryLabel, ...})
              └── saveAlarmMetadata({alarmId, type:'confirm_prompt', entityId=routineId})
  → currentRunningAlarmId 갱신 (= LA pause/resume 측 source)
```

| 구간 | iOS | Android |
|---|---|---|
| `shouldUseAlarmKit` | 권한 OK 시 true | **항상 false** (routineScheduler isAlarmKitAvailableSync iOS only) |
| `scheduleConfirmPromptViaAlarmKit` 호출 | 진입 | **호출 자체 안 됨** (shouldUseAlarmKit=false 시 null return) |
| `AlarmkitBridge.scheduleAlarm({type:'confirm_prompt', secondaryLabel:...})` | 정상 | **호출 안 됨**. 호출되더라도 Android module ScheduleAlarmParams 측 `secondaryLabel` field 정의 X = silent drop |

**결론**: **Android 루틴 진행 = 다음 step alarm 미등록 → 루틴 자체 작동 X**.

### 3-B. 발화

```
[iOS]
AlarmKit fire → onAlarmStateChange('alerting')
  → App.tsx listener line 388:
      meta.type === 'confirm_prompt' → onAlarmFire(alarmType='confirm_prompt')
      → transition OnAlarmFire confirm_prompt 분기:
          ├── ar.awaitingConfirm 갱신 (옛 mirror 효과 SaveActiveRoutine effect)
          └── EmitEvent('routineAwaitingConfirmExternally') — UI listener 측 호환
  → App.tsx 측 추가 navigate (line 436):
      ├── isAdhoc → navigate AlarmTab
      └── else → navigate RoutineTab

[Android]
(confirm_prompt 등록 자체 안 됨 → 발화 path 진입 0)
```

### 3-C. 사용자 응답 (= 다음 step 진행)

```
[iOS]
사용자 측 알람 위 "다음 진행" 탭 (= AlarmKit secondaryLabel) → AdvanceNextStepIntent.perform
  → native side = 직접 chain advance + LA 자동 다음 mode
  → AsyncStorage 측 advance_done signal write
  → App.tsx 측 LA polling 측 'advance_done' 감지 → dispatch OnSnapshotChange

[Android]
(secondaryLabel UI 자체 X → "다음 진행" 버튼 X → 사용자 응답 path 자체 X)
```

### 3-D. 취소

```
[iOS]
ScheduleConfirmPrompt 다음 호출 시 이전 currentRunningAlarmId cancel
또는 stop / dismiss 측 CancelConfirmPrompt effect → AlarmkitBridge.cancelAlarm + deleteAlarmMetadata

[Android]
(confirm_prompt 등록 0 → cancel target X)
```

### 3-E. 발견된 위험 (confirm_prompt)

- **Android 루틴 = 전체 미작동**: confirm_prompt 등록 X → 단순 알람 (alarm_main) 도 등록 X → ad-hoc routine 도 X → **루틴 기능 자체가 Android 측 동작 ❌**.
- **Phase 3 영역**: 본 작업 (Phase 1) 범위 외. plan §11 정합.
- **`secondaryLabel` Android 측 schema 누락**: Phase 3 진입 시 = ScheduleAlarmParams 측 `secondaryLabel` 추가 + Android UI 측 "다음 진행" 버튼 native action 또는 AlarmScreen 내부 처리 필요.
- **`advance_done` signal (Android)**: iOS AsyncStorage 측 signal write 측 = Android 도 RN AsyncStorage 공통 → 자체 호환. 단 signal write 측 = native side widget intent 측 발생 (= Android widget 측 신규 구현 필요).

---

---

## 4. prealert 사이클

### 4-A. 등록 (= 루틴 schedule 측 시작 30분/5분 전)

```
syncRollingSchedule (앱 시작 / 루틴 저장 / 콜드 스타트 측 호출)
  → for each routine:
      → scheduleRoutinePrealerts(routine):
          ├── cancelRoutinePrealerts (기존 cancel)
          ├── shouldUseAlarmKit() = iOS 권한 OK 시 true
          │   └── Android = 항상 false
          └── scheduleViaAlarmKit:
              └── for each (요일 × prealert 단계 [30분/5분]):
                  └── AlarmkitBridge.scheduleAlarm({type:'prealert', soundName, ...})
                  └── saveAlarmMetadata({type:'prealert', entityId=routineId})
```

### 4-B. 발화

```
[iOS]
AlarmKit fire → onAlarmStateChange('alerting')
  → App.tsx listener line 388:
      meta.type === 'prealert' → onAlarmFire(alarmType='prealert')
      → transition: prealert silent ignore (= return { next:current, effects:[] })
      → App.tsx 측 = 화면 전환 X, 알람 UI/사운드만 (= AlarmKit 자체 alerting UI)
  → 사용자 측 확인 탭 → AlarmKit 자체 dismiss

[Android]
(prealert 등록 자체 안 됨 → 발화 path 진입 0)
```

### 4-C. 정리

```
[iOS]
syncRollingSchedule 측 = 매 cold-start 측 모든 prealert/chain 정리 + 재등록 (= rolling)
또는 cancelRoutinePrealerts(routineId) 측 = 특정 routine 측 일괄 cancel

[Android]
(prealert 등록 0 → cancel target X)
```

### 4-D. 발견된 위험 (prealert)

- **Android 측 prealert 등록 0**: 사용자 측 routine 측 schedule (= 매일 07:00 등) 시 = 30분 전 / 5분 전 알림 자체 X.
- **Phase 3 영역**: Android 측 alarm tab + routine 영역 활성화 시 = prealert 도 등록 path 필요. 단 = prealert 측 = `setAlarmClock` 직접 호출 (= chain 아님) → Android module 측 정합 (= 단발 등록 패턴 그대로).
- **AlarmKit `secondaryLabel` 측 = prealert 측 미사용** → schema 측 정합 (= secondaryLabel 누락 영향 없음).

---

---

## 5. 통합 관리 계층 점검

### 5-A. SessionKind 4종 ↔ AlarmType 매핑

| SessionKind | 대응 AlarmType | Android 동작 |
|---|---|---|
| `timer` | `timer_main` | ✅ Phase 1 (= 본 작업 완료) |
| `simple_alarm` | `alarm_main` | ❌ Phase 3 (scheduleAlarmMain Android 차단) |
| `routine` | `alarm_main` (chain) + `confirm_prompt` (step) + `prealert` | ❌ Phase 3 |
| `ad_hoc_routine` | `alarm_main` (fire) → `confirm_prompt` (step advance) | ❌ Phase 3 |

= **Android Phase 1 동작 = `timer` 1종만**. 나머지 3종 = Phase 3 영역.

### 5-B. SessionState 7상태 정합

`IDLE → SCHEDULED → STEP_ALERTING → CONFIRMING → ADVANCING → PAUSED → COMPLETED`

| 상태 | Android timer 측 진입 가능 | 비고 |
|---|---|---|
| IDLE | ✅ | session=null |
| SCHEDULED | ✅ | dispatch Start → ScheduleAlarmOnce 등록 |
| STEP_ALERTING | ✅ | onAlarmFire → transition |
| CONFIRMING | ❌ | timer 측 = awaitingConfirm X (= line 221 가드) |
| ADVANCING | ❌ | timer 측 = 1 step → advance X |
| PAUSED | ⚠️ | dispatch Pause → JS state는 PAUSED but native pauseAlarm = **no-op** → 시간 도달 시 발화 회귀 (Phase 2-1 우선) |
| COMPLETED | ✅ | Dismiss → CancelAlarmChain → IDLE |

### 5-C. effectRunner Effect 종 = Android 측 대응 분석

| Effect | iOS 동작 | Android 동작 | 위험 |
|---|---|---|---|
| `ScheduleAlarmChain` | scheduleAlarmMain (chain 30개) | **silent skip** (isAlarmKitAvailableSync=false → null return) | Phase 3 |
| `CancelAlarmChain` | cancelAlarmsForEntity (F0~F3) | iOS와 동일 (= entityId로 metadata filter 후 native cancel) | ⚠️ Android 측 metadata 자체 없으면 무작용. 등록 path 측 차단되어 metadata 0건 → cancel target X = 정합 |
| `ScheduleAlarmOnce` | AlarmkitBridge.scheduleAlarm timer_main | **AlarmkitBridge.scheduleAlarm timer_main** = Android module 측 setAlarmClock | ✅ |
| `StopAlarmNative` | AlarmkitBridge.stopAlarm | Android module 측 cancel + stopService → onDestroy cleanup | ✅ |
| `ScheduleConfirmPrompt` | scheduleRoutineConfirmPrompt | **silent skip** (shouldUseAlarmKit=false → null) | Phase 3 |
| `CancelConfirmPrompt` | AlarmkitBridge.cancelAlarm | iOS와 동일 (등록 0 → no-op 정합) | Phase 3 |
| `PauseAlarmNative` | AlarmkitBridge.pauseAlarm | **silent fail (no-op return 0.0)** | ⚠️ Phase 2-1 |
| `ResumeAlarmNative` | AlarmkitBridge.resumeAlarm | **silent fail (no-op return 0.0)** | ⚠️ Phase 2-1 |
| `CleanupAlertingAlarms` | listAlarms loop + stopAlarm + cancelAlarm | Android module 측 listAlarms 호환 → cleanup 정상 | ✅ |
| `NavigateAlarmScreen` | DeviceEventEmitter emit | DeviceEventEmitter emit (= 플랫폼 무관) | ✅ |
| `NavigateHome` | emit | emit | ✅ |
| `SetIsRoutineActive` | AsyncStorage set/remove | AsyncStorage set/remove | ✅ |
| `SaveActiveRoutine` (legacy mirror) | AsyncStorage write | AsyncStorage write | ✅ |
| `ClearActiveRoutine` (legacy) | AsyncStorage remove | AsyncStorage remove | ✅ |
| `WriteRoutineSnapshot` | AsyncStorage write | AsyncStorage write | ✅ |
| `CancelRoutinePrealerts` | for-loop cancel | (등록 0 → no-op 정합) | Phase 3 |
| `RecordStepSession` | sessions storage push | sessions storage push | ✅ |
| `RestorePendingDisabled` | restorePendingDisabledAlarms (routineController) | iOS만 의미 (Android 측 = 알람 등록 X) | Phase 3 |
| `EmitEvent` / `ShowInterstitialAd` | emit | emit | ✅ |

### 5-D. mappingTable 측 Android 측 schema 정합

| Field | iOS 사용 | Android 사용 | 위험 |
|---|---|---|---|
| `alarmId` | UUID (AlarmKit 생성) | entityId 그대로 (Module 측 fallback UUID) | ⚠️ chain 측 = 같은 entityId 측 30개 = hashCode 충돌 (= Phase 3 시점 정정 필요) |
| `type` | 4종 | 2종 (alarm_main / timer_main만 실용) | Phase 3 |
| `entityId` | alarm.id / routine.id / timer routineId | timer routineId만 | ✅ Phase 1 |
| `chainIndex` | alarm_main chain 0..29 | (해당 없음 = Phase 3) | Phase 3 |
| `chainBaseFireAt` | alarm_main chain 기준 fireAt | (해당 없음 = Phase 3) | Phase 3 |
| `deleted` (soft delete) | F0 set + listener silent skip | 동일 동작 (= 플랫폼 무관 JS path) | ✅ |
| `nextStepIndex` / `endMethod` | confirm_prompt 측 | (해당 없음 = Phase 3) | Phase 3 |

### 5-E. AlarmkitBridge JS ↔ Native 시그니처 정합

| Function | iOS impl | Android impl | 정합 |
|---|---|---|---|
| `isAvailable()` | 26.0+ 검사 | `true` 무조건 (= setAlarmClock 항상 가용) | ✅ |
| `requestAuthorization()` | AlarmKit `requestAuthorization` (시스템 다이얼로그) | `authorizationState()` 반환만 (= **POST_NOTIFICATIONS 다이얼로그 미호출**) | ⚠️ JS 측 routineScheduler PermissionsAndroid 로 우회 처리 (= 본 작업 완료) |
| `getAuthorizationState()` | AlarmKit auth state | `nm.areNotificationsEnabled()` | ✅ |
| `scheduleAlarm(params)` | AlarmKit `.alarm(schedule:...)` | `AlarmScheduler.schedule` | ✅ Phase 1 |
| `cancelAlarm(id)` | AlarmKit cancel | `AlarmManager.cancel` + persist 정리 + alerting 시 service stop | ✅ |
| `stopAlarm(id)` | alerting cancel | `cancel + stopService` | ✅ |
| `listAlarms()` | AlarmKit alarms map (state 포함) | SharedPreferences map (state='alerting' or 'scheduled') | ✅ Phase 1 (단 `'countdown'` / `'paused'` 상태 미지원 = Phase 2 시 보완) |
| `pauseAlarm(id)` | AlarmKit `pause(id:)` | **no-op return 0.0** | ⚠️ Phase 2-1 |
| `resumeAlarm(id)` | AlarmKit `resume(id:)` | **no-op return 0.0** | ⚠️ Phase 2-1 |
| `writeAppGroupString(k,v)` | App Group UserDefaults write | **no-op return false** | ✅ (Android widget Phase 후속) |
| `readAppGroupString(k)` | read | **no-op return null** | ✅ |
| `removeAppGroupKey(k)` | remove | **no-op return false** | ✅ |
| `onAlarmStateChange` event | alarmUpdates AsyncSequence | AlarmEventBus emit | ✅ (단 `'paused'` / `'countdown'` state emit 미지원) |

### 5-F. App.tsx 핸들러 분기 정합

| 핸들러 | iOS 트리거 | Android 트리거 | 정합 |
|---|---|---|---|
| onAlarmStateChange listener | AlarmKit emit | AlarmEventBus emit | ✅ |
| `SUPPRESS_ALARMKIT_BANNER_IN_FG` cancel | 포그라운드 active 시 in-app modal 강제 | **Platform 가드로 Android 제외** (= line 365) → Android FSI 그대로 노출 | ✅ 의도 정합 |
| `runAlertingAlarmCheck` (cold-start +1.5s) | listAlarms → alerting 찾기 | listAlarms → alerting 찾기 | ✅ |
| AppState 'active' onAppActive dispatch | restoreRoutineState + runAlertingAlarmCheck + cleanupGhostAlarms | iOS와 동일 | ✅ |
| `cleanupGhostAlarms` | iOS 잔존 framework alarm 제거 | **Android = isAlarmKitAvailableSync=false → 즉시 return 0** (line 392) | ⚠️ Phase 3 진입 시 = Android 대응 필요. 현재 = Android module 측 ghost 자체 발생 path X (= entityId 측 unique → 정합) |
| `migrateSoundRename` | iOS chain 옛 사운드 측 재등록 | Android = isAlarmKitAvailableSync=false → 즉시 return (line 439) | ✅ Android 사운드 res/raw 측 정합 (= migration 무관) |
| `syncAllAlarms` | chain 멤버 sync | Android = 즉시 return (line 304) | Phase 3 |
| `syncRollingSchedule` (prealert/chain 등록) | iOS 측 routine prealert 등록 | shouldUseAlarmKit=false → no-op | Phase 3 |

---

---

## 6. Android 관점 = 누락 / 분기 누락 종합

### 6-A. Phase 1 = 동작 ✅ (= 본 작업 측 마무리)

| 흐름 | 상태 | 실기 검증 |
|---|---|---|
| 메인 타이머 시작 → 종료 발화 | ✅ (POST_NOTIFICATIONS 부여 시) | ✅ **에뮬레이터 PASS** (5분 timer 측 setAlarmClock 정확 등록) |
| 앱 종료 상태 발화 (setAlarmClock + FSI) | ✅ (Step 4 manifest 정합) | ✅ **에뮬레이터 PASS** (AlarmReceiver fired → AlarmService start → alerting emit → JS navigate) |
| 잠금화면 위 전체화면 알람 | ✅ (showWhenLocked / turnScreenOn merge) | ⏳ |
| 미션/사진 완료 dismiss → 사운드/진동/볼륨 정리 | ✅ (Service.onDestroy) | ✅ **에뮬레이터 PASS** (cancelEntity targets=1 nativeFail=0 finalStale=0, SharedPreferences 완전 정리) |
| 무음모드 우회 + 볼륨 음소거 차단 | ✅ (STREAM_ALARM + ContentObserver) | ⏳ |
| 재부팅 복원 | ✅ (BootReceiver) | (수동 reboot 필요) |
| **POST_NOTIFICATIONS 런타임 요청** | ✅ (본 작업 = 2026-05-26 = routineScheduler Android 분기) | ✅ **자동 부여 + getAuthorizationState='authorized' 정합** |

### 6-B. Phase 2 = 미동작 (= silent fail 위험)

| 흐름 | 상태 | 위험도 | 실기 검증 |
|---|---|---|---|
| 타이머 pause/resume | ✅ **2026-05-26 본 세션 마무리** (= AlarmScheduler.pauseAlarm/resumeAlarm + paused map 영속 + event emit). 상세: `docs/work-2026-05-26-android-phase2-1-and-phase3-2.md` | (해소) | ✅ **에뮬레이터 PASS** — Pause: paused_alarms 영속 + remainingMs 정확 (223,132ms = fireAt-now). Resume: 새 fireAt = now + remainingMs 정확. AlarmManager 측 cancel→재등록 정합. |
| 진행 중 카운트다운 알림 (ongoing) | ✅ **2026-05-26 Phase 2-2 마무리** (= `startOngoingTimerNotification` + `stopOngoingTimerNotification` + LOW priority channel + `setChronometerCountDown(true)` + `setWhen(fireAt)`). schedule/cancel/pauseAlarm 측 자동 호출. AlarmService 측 발화 시점 측 자동 cleanup. 상세: `docs/work-2026-05-26-android-phase2-2-and-3-3.md` | dex deployed PASS, 실 UI 측 검증 = E2E onboarding 측 별도 |

### 6-C. Phase 3 = 전면 미동작 (= 알람 탭 + 루틴 전체)

| 흐름 | 상태 | 위험도 |
|---|---|---|
| 알람 탭 alarm 등록 (`alarm_main`) | ✅ **2026-05-26 Phase 3-0a 마무리** (= `isAlarmKitAvailableSync` Android 허용). 상세: `docs/work-2026-05-26-android-phase3-alarm-tab.md` | (해소) |
| AlarmListScreen UI | ✅ **2026-05-26 Phase 3-4 마무리** (= unsupported 화면 제거, Android 측 정상 진입). | (해소) |
| 알람 chain (60분 ringing 보장) | ✅ **2026-05-26 Phase 3-1 마무리** (= Module 측 매 schedule UUID 발급 → 충돌 차단). 에뮬레이터 측 = chain 30개 정확 등록 + 모두 unique UUID 정합 검증. | (해소) |
| 반복 알람 (daily/weekly) | ✅ **2026-05-26 본 세션 마무리** (= AlarmReceiver 측 scheduleNextOccurrenceIfNeeded 호출 + AlarmScheduler.computeNextOccurrence). once 측 no-op, daily 측 +1일, weekly 측 recurrenceDays 다음 요일. Phase 3 진입 시 자동 정합. | (해소) |
| 루틴 confirm_prompt | ✅ **2026-05-26 Phase 3-0b 마무리** (= `routineScheduler.isAlarmKitAvailableSync` Android 허용 → confirm_prompt 측 등록 path 활성). 상세: `docs/work-2026-05-26-android-phase2-2-and-3-3.md` | (해소) |
| 루틴 prealert | ✅ **2026-05-26 Phase 3-0b 마무리** (= 동일 가드 해제). | (해소) |
| ad-hoc routine | ✅ **2026-05-26 Phase 3-0b 마무리** (= alarm_main 측 Phase 3-0a + confirm_prompt 측 Phase 3-0b 측 동시 해제). | (해소) |
| "다음 진행" secondaryLabel UI | ✅ **2026-05-26 Phase 3-3 마무리** (= AlarmActionReceiver + secondaryLabel field 측 ScheduleAlarmParams/AlarmRecord + AlarmService 측 `addAction` + JS `secondary_action` listener 측 `Advance` dispatch). | (해소) |

### 6-D. 발견된 미세 위험 (= 검토 필요)

1. **`PendingIntent` request code 측 entityId.hashCode() 충돌 가능성**
   - 현 Module 측 `firePendingIntent(context, alarmId.hashCode(), ...)`.
   - 같은 entityId 측 schedule 2회 측 = FLAG_UPDATE_CURRENT 측 = 직전 PendingIntent 덮어쓰기 = 의도 정합 (= upsert 패턴).
   - 단 = **다른 entityId 측 hashCode 충돌** (= 1:N) 시 = 다른 알람 측 = 동일 PendingIntent → cancel 측 = 잘못된 알람 측 cancel 회귀.
   - 발생 확률 = `entityId` 측 = `main_timer_${Date.now()}` (= ms 측 unique) → 충돌 확률 측 ~0.
   - Phase 3 시 = alarm.id (= UUID 측) + chainIndex 측 = `${alarm.id}_${chainIndex}` 패턴 진입 시 = hashCode 충돌 확률 측 = 검토 필요.
   - **대응 = 별도 monotonic counter 측 = 정합 보장** (= Phase 3 작업 시 정정).

2. **AlarmService 측 `START_REDELIVER_INTENT` + 재시작 회귀**
   - 현 Service 측 `return START_REDELIVER_INTENT` (= 강제 종료 시 OS 측 마지막 intent 재배달).
   - 사용자 측 = task manager 측 강제 종료 + intent 재전달 → 옛 알람 측 = 정리 못 한 상태에서 재시작 = 사운드 영구 재생 위험.
   - **대응 = 검토 필요**. AlarmService 측 = onDestroy 측 정합 (= 모든 정리 path 측 onDestroy 측 위치) → 강제 종료 시 = onDestroy 호출 보장 안 됨. = Service 측 = restart 시 intent 측 = alarmId 측 미존재 path 측 = silent stop 정합 필요.

3. **AlarmkitBridgeView 측 = 삭제 됨 (= context-notes 측 확인 정합)** — Step 0 게이트 정합.

4. **Module 측 `recurrence` field 측 = AlarmRecord 측 저장만 + 실제 사용 0**
   - 현 Module 측 = `recurrenceMode` / `recurrenceDays` field 측 = JSON parse + persist만.
   - `AlarmReceiver.onReceive` 측 = 다음 occurrence 재예약 로직 측 = 미구현.
   - Phase 3 시점 = AlarmReceiver 측 = `if (record.recurrenceMode !== 'never') AlarmScheduler.schedule(nextFireAt)` 측 추가 필요.

5. **JS `recurrence` 측 weekly 측 dayOffset shift 정합 의문**
   - 현 alarmScheduler.ts line 110-113 측 `dayOffset shift` 측 = AlarmKit 측 weekly recurrence 측 자동 처리 의존.
   - Android 측 `AlarmReceiver` 측 = 직접 next weekday 계산 시 = 동일 shift 로직 측 = native 측 재구현 필요. = Phase 3 시점 critical.

---

## 7. 결론 + Phase 2/3 우선순위 갱신

### 7-A. 현재 상태 요약

- **Android Phase 1 = 동작 path 완성**. 본 세션 (2026-05-26) 추가 = POST_NOTIFICATIONS 런타임 권한 흐름 (= 막힌 길 풀기).
- 실기기/에뮬레이터 검증 = 별도 (= Step 8).
- iOS = 영향 0 (= Platform 분기 격리).

### 7-B. Phase 2 우선순위 (= silent fail 차단)

> **Phase 2-1 (우선) = pauseAlarm/resumeAlarm Kotlin 구현**

```kotlin
// AlarmkitBridgeModule.kt 측 pauseAlarm:
AsyncFunction("pauseAlarm") { alarmId: String ->
  val record = AlarmScheduler.get(context, alarmId) ?: return@AsyncFunction 0.0
  val now = System.currentTimeMillis()
  val remainingMs = (record.fireAt - now).coerceAtLeast(0L)
  AlarmScheduler.cancel(context, alarmId)
  AlarmScheduler.persistPaused(context, alarmId, remainingMs)
  AlarmEventBus.emit(alarmId, "paused")
  now.toDouble()
}

// resumeAlarm:
AsyncFunction("resumeAlarm") { alarmId: String ->
  val paused = AlarmScheduler.getPaused(context, alarmId) ?: return@AsyncFunction 0.0
  val now = System.currentTimeMillis()
  val newFireAt = now + paused.remainingMs
  AlarmScheduler.schedule(context, paused.record.copy(fireAt = newFireAt))
  AlarmScheduler.clearPaused(context, alarmId)
  AlarmEventBus.emit(alarmId, "scheduled")
  now.toDouble()
}
```

- 추가 = AlarmScheduler 측 `paused` map (SharedPreferences key) + `getPaused` / `persistPaused` / `clearPaused`.
- 추가 = `listAlarms` 측 = paused 측 = `state="paused"` 반환.
- 위험 = 사용자 측 pause 측 = native 측 알람 측 cancel → resume 측 새 fireAt 측 schedule. resume 안 누르면 = 알람 영구 cancel 상태. = pause 자체 = "취소"와 동등 (= iOS AlarmKit 측 동일 의미).

> **Phase 2-2 = 진행 중 카운트다운 알림 (ongoing notification)**

- 별도 NotificationChannel + chronometer notification + AppState polling.
- 잠금화면 측 남은 시간 표시 (= iOS Live Activity 측 Android 대응물).

### 7-C. Phase 3 우선순위 (= alarm 탭 + 루틴 활성화)

> **Phase 3-0 (사전) = JS Platform 가드 해제**

```ts
// src/utils/alarmScheduler.ts:30
- function isAlarmKitAvailableSync(): boolean { return Platform.OS === 'ios'; }
+ function isAlarmKitAvailableSync(): boolean { return Platform.OS === 'ios' || Platform.OS === 'android'; }

// src/utils/routineScheduler.ts:36
- _alarmKitAvailable = Platform.OS === 'ios';
+ _alarmKitAvailable = Platform.OS === 'ios' || Platform.OS === 'android';

// src/screens/AlarmListScreen.tsx:54
- function isAlarmKitSupported(): boolean { return Platform.OS === 'ios'; }
+ function isAlarmKitSupported(): boolean { return Platform.OS === 'ios' || Platform.OS === 'android'; }
```

= 단순 가드 해제만으로 = **alarm_main 등록 path 측 = Android module 측 호출 path 측 = 열림**.
하지만 = 아래 Phase 3-1 / 3-2 / 3-3 측 동시 마무리 안 하면 = 회귀 다발.

> **Phase 3-1 = Android module 측 chain 충돌 정정**

- 현 Module 측 = `id = entityId` (= 같은 entityId 측 chain 30개 측 = 1개만 살아남음).
- 정정 = JS 측 `scheduleAlarmAt` 측 = `entityId` 측 = `${alarm.id}_chain_${chainIndex}` 형태로 전달.
- 또는 = Android module 측 = 항상 새 UUID 발급 (= iOS 와 동일 패턴).
- **권장 = Android module 측 UUID 발급 정합** (= JS schema 측 변경 0).

> **Phase 3-2 = AlarmReceiver 측 반복 알람 재예약**

```kotlin
// AlarmReceiver.kt 측 발화 후:
class AlarmReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val alarmId = intent.getStringExtra(AlarmScheduler.EXTRA_ALARM_ID) ?: return
    val svc = Intent(context, AlarmService::class.java).apply {
      putExtra(AlarmScheduler.EXTRA_ALARM_ID, alarmId)
    }
    context.startForegroundService(svc)
    // 신규: 반복 알람 측 다음 occurrence 재예약
    AlarmScheduler.scheduleNextOccurrenceIfNeeded(context, alarmId)
  }
}

// AlarmScheduler 측 신규:
fun scheduleNextOccurrenceIfNeeded(context: Context, alarmId: String) {
  val record = get(context, alarmId) ?: return
  if (record.recurrenceMode == "never") return
  val nextFireAt = computeNextOccurrence(record) ?: return
  schedule(context, record.copy(fireAt = nextFireAt))
}

private fun computeNextOccurrence(record: AlarmRecord): Long? {
  // daily = +24h, weekly = recurrenceDays 측 다음 요일
  // JS chainMemberRecurrence 측 dayOffset shift 측 동일 로직 측 native 재구현
}
```

> **Phase 3-3 = mappingTable schema 측 Android 측 정합**

- chainIndex / chainBaseFireAt = Android 측 = 사용 X (= chain 패턴 자체 다름).
- 단 = JS path 측 `cancelAlarmsForEntity` 측 = entityId 측 filter → Android 측도 entityId 측 = group cancel 정합.
- **schema 측 = 변경 없음** (= 기존 schema 측 Android 호환).

> **Phase 3-4 = AlarmListScreen UI 측 = `unsupported` 화면 제거**

- isAlarmKitSupported = Android 도 true → 정상 UI 노출.
- AlarmEditScreen 측 = 사용자 알람 생성 path 측 동작.

> **Phase 3-5 = OEM 측 배터리 킬러 / DnD 안내**

- 샤오미/삼성 등 = 사용자 측 설정 측 = 자동 시작 허용 / DnD 우회 필요 안내.
- plan §10 정합.

### 7-D. 작업 진행 추천 path

```
Path A (= 안전 진행)
1. Step 8 검증 (= 실기기/에뮬레이터 Phase 1 동작 확인) ← 본 작업 결과 확정
2. Phase 2-1 (pause/resume Kotlin) ← silent fail 차단
3. Phase 2-2 (ongoing notification) ← UX 보완
4. Phase 3-0..3-5 (alarm 탭 + 루틴 활성화) ← 일괄 진행
5. OEM 측 안내 / 설정 deep-link 추가

Path B (= 빠른 진행)
1. Phase 2-1 우선 (= 회귀 차단)
2. Phase 3-0..3-5 일괄 (= alarm 탭 + 루틴)
3. Phase 2-2 마지막 (= UX 보완)
4. 전체 Step 8 검증 (= 한 번에)
```

**추천 = Path A** (= Phase 1 검증 우선 → 회귀 다발 방지).

### 7-E. 작업 외 영역

- iOS 측 = 본 작업 측 영향 0. 회귀 위험 0.
- 광고 / sound / i18n 등 = 본 audit 범위 외.

---

## 부록 — 본 audit 측 발견된 권장 사항

| 항목 | 우선순위 | 영역 |
|---|---|---|
| Step 8 실기기 검증 | HIGH | Phase 1 마무리 |
| Phase 2-1 pause/resume Kotlin | HIGH | Phase 2 |
| Phase 3-0 JS 가드 해제 + Phase 3-1/3-2 동시 | HIGH | Phase 3 |
| AlarmService START_REDELIVER_INTENT 재시작 회귀 검토 | MED | Phase 1+ 안정성 |
| OEM 배터리 킬러 안내 UI | MED | Phase 3-5 |
| AlarmkitBridge listAlarms 측 `'paused'` / `'countdown'` state 반환 | MED | Phase 2 동반 |
| Android widget (= LA 대응물) | LOW | Phase 후속 |

