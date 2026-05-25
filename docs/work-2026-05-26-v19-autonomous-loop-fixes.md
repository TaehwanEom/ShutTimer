# 2026-05-26 작업 정리 — v1.9 자율주행 정적 분석 + fix 22건

**브랜치**: `feature/android-support`
**작업 창**: Build (자율주행 모드)
**총 commit**: 14건
**총 fix**: 22건 (HIGH/MED 모두 처리, false positive/LOW skip)

---

## 자율주행 흐름

사용자 요청 = "성공할 때까지 무한 반복" → 3개 영역 측 = N차 정적 분석 + 자동 fix + tsc 검증 + commit + 다음 차수 분석 → "수렴 완료" 판정까지 반복.

| 영역 | 차수 | 총 fix |
|------|------|--------|
| 알람 시스템 | 1차~4차 | 9 |
| UI/State sync + StoreReview | 1차~4차 | 8 |
| 캘린더 + cache + 광고 + 로깅 | 1차~3차 | 5 |
| **총** | | **22** |

각 영역 측 = 마지막 차수 = "수렴 완료. 잔존 HIGH 없음" 판정 후 종료.

---

## 영역 1 — 알람 시스템 (9 fix)

### `a12a56f` — fix(#4) mapping table soft delete

직전 = `cancelAlarmsForEntity` F0 = 정식 `deleteAlarmMetadata`. native cancel 실패 + OS race 시 = native banner+사운드 잔존 fire → meta=NULL silent skip (= 사용자 화면 X 좋음) + 그러나 native 사운드 측 출력 = orphan 동일 회귀.

정정 = `AlarmMetaRecord` 측 `deleted?: boolean` flag + `markAlarmDeleted` 함수 신설:
- F0: markAlarmDeleted (soft delete)
- F2 verify retry → stale=0 시 F3 정식 delete
- stale>0 시 = metadata 잔존 (deleted=true)
- App.tsx listener 측 = meta.deleted===true 감지 시 = silent native cancel + metadata 정식 delete + return

### `dd75d20` — fix(#3) listener cancelAlarm 측 meta lookup 후로 이동

직전 = state==='alerting' 즉시 cancelAlarm → AlarmScreen startAlarmAudio race + meta type 무관 cancel.

정정 = meta lookup 후 = (a) deleted=true → silent cancel + return / (b) 의도된 type 만 SUPPRESS cancel / (c) NULL/unknown 측 = cancel skip.

### `75e3eeb` — fix(#1) Pause/Resume currentRunningAlarmId null fallback

직전 = `currentRunningAlarmId` null 시 = silent return. race 시점 widget pause 클릭 → null skip → LA pause 미발동 회귀.

정정 = fallback = `AlarmkitBridge.listAlarms()` 측 = (Pause 측 countdown / Resume 측 paused) 상태 alarm lookup → pause/resume 호출.

### `9665106` — fix(#6 + #9)

**#6 CleanupAlertingAlarms full cancel**: stopAlarm 호출만 → alerting → scheduled 복귀 가능. 정정 = stopAlarm + cancelAlarm 둘 다 (완전 정리).

**#9 once chainBaseFireAt=null edge fix**: v1.7 이전 migration metadata 시 = base=null → chainDead=true → 활성 once 알람 무조건 disable 회귀. 정정 = native verify fallback (alive=0 시만 cleanup, verify 실패 시 = 살아있음 처리).

### `68f4316` — fix(2차 #1+#2+#3+#5) soft delete ghost + read lock + cleanup delay + chain verify

- **#1** cleanupGhostAlarms 측 deleted=true ghost 인정 → cleanup 누락 차단
- **#2** loadAlarmMetadata + listAllAlarmMetadata 측 runMappingExclusive read lock → write chain 완료 후 read 보장
- **#3** active 진입 cleanupGhostAlarms 지연 2초 → 5초 → AsyncStorage commit 측 race 회피
- **#5** scheduleAlarmMain chainBaseFireAt 일관성 verify warn

### `9e698a0` — fix(3차 #1) scheduleAlarmAt atomicity

직전 = native scheduleAlarm 성공 + saveAlarmMetadata throw 시 = native id 측 잔존 + mapping 측 X = orphan.

정정 = nativeId let outer scope → saveAlarmMetadata throw 시 = native cancelAlarm rollback → orphan 발생 X.

### 4차 = 수렴 판정

trinity invariant (session ↔ AsyncStorage ↔ native AlarmKit) 측 = dispatch 직렬화 + mutex + effect await chain 측 = HIGH 잔존 없음.

---

## 영역 2 — UI/State sync + StoreReview (8 fix)

### `461352c` — fix 4건 통합

- **#6 dual SoT sync (HIGH)**: AlarmScreen guard 측 AsyncStorage isRoutineActive read → race 시 false positive 강제 이동. 정정 = `getCurrentSession()` 측 Session state 단독 SoT 사용.
- **#2 + #1 StoreReview chain**: Promise chain 중간 실패 시 다음 step skip. 정정 = 각 step 독립 try/catch + sequential await + setItem await.
- **#3 ACTIVE_TIMER_KEY 영속화 await**: pause/resume 측 .then() fire-and-forget → 강제 종료 시 write loss. 정정 = await get + await set sequential.
- **#8 markRecommendShown await**: handleRecommendClose async + await markRecommendShown → write 완료 보장.

### `aff4602` — fix(2차 #1+#2)

- **#1 HomeScreen cold-start isRoutineActive → Session SoT 전환 (HIGH)**: AsyncStorage isRoutineActive read → SetIsRoutineActive effect write 진행 중 mount 시 race → stale cleanup 오작동. 정정 = getCurrentSession 측 단독 SoT.
- **#2 persistPausedEndAt async await (HIGH)**: .then() fire-and-forget → dial 회전 후 즉시 resume 클릭 시 write 미완료. 정정 = async + sequential await + .catch() floating 방어.

### `e7b1476` — fix(3차) AlarmScreen mount race

직전 = getCurrentSession await ~ navigation.reset 사이 ~200ms window 측 다른 dispatch session 변경 → reset 시점 state stale → 잘못된 navigation layout 깨짐.

정정 = mountedRef + dismissedRef guard. unmount/dismiss 후 stale navigation 차단.

### 4차 = 수렴 판정

trinity (UI ↔ Session ↔ AsyncStorage ↔ native) = dispatch 직렬화 + mutex + effect await chain 측 invariant 유지. StoreReview = enterResult + handleRecommendClose 측 모두 await + setItem sequential. async/await missing = 0건.

---

## 영역 3 — 캘린더 + cache + 광고 + 로깅 (5 fix)

### `5254027` — fix 4건 통합

- **#1 preloadDismissMethod await (HIGH)**: App.tsx 측 fire-and-forget → 콜드 스타트 시 AlarmScreen mount 시점 cache null → 기본값 fallback. 정정 = IIFE + await + catch logging.
- **#3 recordStepSession executionId fallback (MED)**: executionId 누락 시 = 모든 record dedup X → LA Intent 두 경로 record 중복. 정정 = 30초 dedup fallback (id 측 timestamp 추출).
- **#6 recordAlarmSession 중복 방지 (MED)**: 사용자 재시도 시 = 매번 push → 히스토리 중복. 정정 = 30초 내 동일 label+type='alarm' record dedup.
- **#4 logger persistAll throttle (MED)**: 매 record 측 setItem → 빈번 write race. 정정 = 1초 debounce.

### `90c1242` — fix(2차) logger flushLogs on background

직전 = persistAll 1초 debounce → AppState=background 진입 직후 kill 시 = pending log lost.

정정 = flushLogs() export 신설 (= debounce clear + persistImmediate). App.tsx AppState change listener 측 background/inactive 진입 시 호출 → kill 전 보존.

### 3차 = 수렴 판정

logger race 정상 / record dedup id format 일관 / preload IIFE + AlarmScreen 3단계 fallback / AdMob no-fill = ERROR listener → show 미호출 → handleAfterAd 정상.

---

## 사용자 영향 요약

### 해결된 핵심 버그

| 영역 | 직전 | 개선 후 |
|------|------|---------|
| 옛 잘못된 알람 (= 22:14, 22:16 잔존) | 매일 fire | 자동 cleanup + silent skip |
| routine step 사운드 2중 중첩 (background) | 두 번 들림 | 한 번만 |
| 위젯 일시정지 가끔 안 됨 | 잠재 race | native fallback 항상 동작 |
| 알람 등록 후 사라짐 (rare) | 가능 | rollback 보장 |
| Timer pause/resume write 손실 | fire-and-forget | await 보장 |
| dial 회전 후 resume 측 옛 시간 회귀 | persist 미완료 race | sequential await |
| 별점 모달 안 뜸 / 중복 표시 | chain race | 각 step await + recommend_pending 보장 |
| 콜드 스타트 dismissMethod 미적용 | preload race | IIFE await |
| 캘린더 step/알람 중복 기록 | 측 = LA 두 경로 + 재시도 | 30초 window dedup |
| 로그 측 강제 종료 시 직전 lost | debounce pending | background 진입 시 즉시 flush |

---

## 검증 상태

| 항목 | 결과 |
|------|------|
| tsc | OK (모든 차수 통과) |
| 콘솔 에러 | 0 |
| iOS 디바이스 검증 | 미수행 (= QA 창 영역) |
| Android | 본 fix = iOS+JS 영역 / Android 측 별도 영역 |

---

## 후속 작업

1. **QA 창 측 iOS 디바이스 검증** — 14개 commit 측 = 다음 빌드 후 디바이스 측 = 사용자 핵심 흐름 측 (알람 fire → dismiss → routine → step advance → 완료) + 잔존 알람 자동 정리 + 사운드 단독 재생 + 별점 모달 표시 + 캘린더 dedup + 로그 보존 측 검증.

2. **잔존 영역 (= 본 자율주행 외)** — 측 = 측 = 측 = i18n / UI 컴포넌트 / 설정 화면 측 = 별도 자율주행 측 가능.

3. **Sub A-5: Pause/Resume 통합 보류** — 직전 작업 (= 사용자 "지금 동작 보존" 의도). 본 자율주행 측 = 영역 X.

---

## 자율주행 측 false positive / cover skip 측 (= 신뢰 측 정합)

각 차수 측 agent 측 = HIGH 보고 측 → 실제 코드 측 확인 후 false positive / 이미 cover 측 = skip 결정:

- 알람 시스템 측 = 9 false positive/cover (#5, #7, #8, #10 1차 + #4 2차 + #2-#5 3차)
- UI/State + StoreReview 측 = 3 cover (#4, #5, #7) + 1 fix 외 자동 해소 (#5)
- 캘린더+cache+광고+로깅 측 = 6 cover/LOW (#2, #5, #7, #8, #9, #10) + 1 cover (2차 #2)

= **추측 회피 + 실제 코드 흐름 추적 후 결정** 원칙 준수.
