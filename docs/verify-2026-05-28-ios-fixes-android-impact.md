# 2026-05-28 iOS fix 5건 안드로이드 영향 검증

> 본 문서: 본일 5건 iOS fix 측 안드로이드 회귀/영향 검증 결과
> 결론: **5건 모두 안드로이드 회귀 0**. 1건 양성 영향 (= JS dedup), 1건 잠재 한계 (= Android 측 debounce 없음).

---

## 1. 한 줄

본일 5건 iOS fix 측 = 안드로이드 회귀 0건. 단 1건 잠재 한계 신규 식별 (= Android 측 "다음 진행" race 측 debounce 없음).

= **쉽게 말하면**: 오늘 고친 5개 iOS 수정 모두 안드로이드에 나쁜 영향 0. 다만 안드로이드 측에는 비슷한 race 보호 장치가 아직 없음 (= 단, 사용자 보고도 없음).

---

## 2. 검증 대상 (= 본일 commit 5건)

| # | commit | 변경 영역 | iOS↔Android 영향 |
|---|--------|----------|------------------|
| 1 | da96a95 | iOS chain ghost fire 차단 (= chainIndex 1+ → .fixed) | iOS 전용 |
| 2 | 8ac714c | confirm_prompt dedup + Swift debounce | JS / Swift 분리 |
| 3 | e47fa4d | chainCount 재밸런싱 | Platform 공통 |
| 4 | 3aa0529 | daily dismiss 후 chain[0] 보존 | iOS 전용 + Android 위임 |
| 5 | 7842d30 | rebalance preserve 가드 | Platform 공통 |

---

## 3. Fix별 검증 결과

### Fix 1 — da96a95 (iOS chain ghost fire 차단)

**Platform 가드 위치 (= 다층 방어)**:
- `alarmScheduler.ts:103` — chainMemberRecurrence iOS chainIndex 1+ → 'never'. Android = daily/weekly 유지
- `alarmScheduler.ts:224` — rearmSafetyChain `Platform.OS !== 'ios' return` (= no-op)
- `alarmScheduler.ts:299` — cleanupConsumedSafetyChain `Platform.OS !== 'ios' return`
- `alarmScheduler.ts:715` — migrateChainFixedSafety `Platform.OS !== 'ios' return`
- `App.tsx:452` — chainIndex 0 alerting → rearmSafetyChain + chainIndex >= 1 fire → deleteAlarmMetadata 측 `Platform.OS === 'ios'` 분기

**결과**: ✅ 안드로이드 영향 0. iOS 전용 fix. Android 측 chain 패턴 (= daily/weekly OS 자동 반복) 보존.

---

### Fix 2 — 8ac714c (confirm_prompt dedup + Swift debounce)

**JS dedup (= effectRunner ScheduleConfirmPrompt)**:
- Platform-agnostic JS 코드
- Android 측 routine 사용 시 = ScheduleConfirmPrompt effect → dedup 적용
- Android Kotlin AlarmkitBridgeModule 측 `cancelAlarm` 호출 → `AlarmScheduler.cancel` → `AlarmManager.cancel` + `persistRemove` 정상

**결과**: ✅ **양성 영향** (= Android 측도 동일 dedup 보호).

**Swift debounce (= AdvanceNextStepIntent.swift)**:
- iOS 전용 파일. Android 빌드 측 포함 X. 무관.

**Android 측 대응 코드**:
- `modules/alarmkit-bridge/android/.../AlarmActionReceiver.kt` 측 secondary_action handling
- **debounce 코드 없음**

**잠재 한계 신규 식별**: Android 측 = "다음 진행" 1.5초 내 2회 press 시 = AdvanceNextStepIntent 다중 발화 가능성. 단 사용자 보고 X (= iOS만 발생). 발생률 매우 낮음.

**결과**: ✅ JS dedup 양성 적용. ⚠️ Swift debounce 측 = Android 별도 구현 필요 (= 잠재 한계, 사용자 보고 X).

---

### Fix 3 — e47fa4d (chainCount 재밸런싱)

**Platform 가드**:
- `rebalanceAllChains` 측 = `if (!isAlarmKitAvailableSync()) return;` (= iOS + Android 양쪽 적용)
- 명시 주석: "Platform 공통 (= iOS + Android 양쪽 적용)"

**Android 동작**:
- activeCount 변경 시 모든 활성 알람 chain 재계산
- mismatch 시 옛 chain cancel + 재schedule
- Android 측 `AlarmkitBridge.cancelAlarm` → `AlarmScheduler.cancel` → `AlarmManager.cancel` + `persistRemove` 정상
- `scheduleAlarmMain` 재호출 → Android 측 `AlarmkitBridge.scheduleAlarm` → `AlarmScheduler.schedule` + `persistUpsert` 정상

**실 검증**: 6회차 안드로이드 sim 1 측 = "rebalance idempotent skip 정상" 확인 (= `handoff-deploy-2026-05-28-chain-rebalance.md` 측 검증 완료)

**잠재 한계**: rebalance 측 = 다수 native call → SharedPreferences race window 증가 가능 (= `plan-2026-05-28-android-deep-check-fixes.md` 한계 2 측 별도 다룸)

**결과**: ✅ 안드로이드 정상 작동 (= 실 시뮬레이터 검증 완료).

---

### Fix 4 — 3aa0529 (daily dismiss 후 chain[0] 보존)

**Platform 가드**: `alarmScheduler.ts:407`
```ts
if (Platform.OS !== 'ios') {
  return cancelAlarmsForEntity(alarmEntityId);
}
```

**Android 동작**: 옛 `cancelAlarmsForEntity` 위임 → 전체 chain cancel → effectRunner 측 `rebalanceAllChains` 호출 → mismatch → 즉시 신규 chain schedule (= 내일 발화 측 자동 등록)

**핵심 발견**: Android 측 = 옛 동작 측 = "Dismiss → 전체 cancel → rebalance 측 즉시 재schedule" 패턴 → **한계 5 자동 해결**됨 (= 옛 검증 보고 측 정정).

iOS와 Android 차이:
- iOS: `.relative(daily)` cancel 시 OS 반복 사라짐 → rebalance 측 새 chain[0] 등록해도 framework race / dismiss 측 jamming 측 가능성 (= 사용자 보고 root cause)
- Android: AlarmManager `setAlarmClock` 측 단발 + `scheduleNextOccurrenceIfNeeded` 측 fire 후 +1일 자동. cancel 후 rebalance → 새 PendingIntent 등록 = 다음 occurrence 정상

**결과**: ✅ 안드로이드 회귀 0. 본 fix 측 iOS 전용 chain[0] 보존 패턴 미적용 (= production 안드로이드 빌드 시 별도 fix 검토). 단 안드로이드 측 한계 5 = 옛부터 자동 해결됨.

---

### Fix 5 — 7842d30 (rebalance preserve 가드)

**Platform 가드 없음** (= Android에도 가드 적용)

**Android 트리거 조건 분석**:
- 가드 조건: `isRecurring && isPreserveState` 측 `isPreserveState = currentChain.length === 1 && chainIndex === 0`
- Android 측 = cancelSafetyChainPreservingDaily → cancelAlarmsForEntity 위임 → 전체 chain cancel → `currentChain.length === 0`
- `isPreserveState = false` → 가드 skip 발동 X → 옛 동작 (= rebalance 측 재schedule) 그대로

**결과**: ✅ 안드로이드 영향 0 (= preserve 상태 진입 조건 미충족 = 가드 trigger 안 됨).

---

## 4. 종합 매트릭스

| Fix | iOS 효과 | Android 회귀 | Android 양성 | Android 잠재 한계 |
|-----|---------|------------|--------------|------------------|
| 1 (da96a95) | chain ghost fire 차단 | 0 | - | - |
| 2 (8ac714c) | confirm_prompt dedup + Swift debounce | 0 | JS dedup 동일 적용 | Android debounce 없음 (= 사용자 보고 X) |
| 3 (e47fa4d) | chainCount 재밸런싱 | 0 (= 실 sim 검증 PASS) | - | SharedPreferences race window 증가 (= 별도 plan 한계 2) |
| 4 (3aa0529) | daily chain[0] 보존 | 0 | - | iOS 전용 fix. Android 측 = 옛 rebalance 측 자동 해결 |
| 5 (7842d30) | preserve 가드 | 0 (= 가드 trigger 안 됨) | - | - |

---

## 5. 신규 발견 (= 옛 검증 보고 정정)

### 5-1. Android 측 한계 5 (일일 알람 dismiss 후 누락) = 자동 해결됨
- **옛 보고**: "안드로이드 영향 있음" (= 양쪽 공통 설계로 표시)
- **정정**: Android 측 = dismiss → 전체 cancel → rebalance 측 즉시 재schedule → 다음날 정상 발화. 한계 5 = iOS만 영향.
- **출처**: `handoff-deploy-2026-05-28-chain-rebalance.md` 측 rebalance 측 = Platform 공통 호출 + Android `AlarmReceiver.scheduleNextOccurrenceIfNeeded` 측 = fire 후 +1일 자동.

### 5-2. Android 측 잠재 한계 신규 (= 한계 6)
- **위치**: `modules/alarmkit-bridge/android/.../AlarmActionReceiver.kt`
- **내용**: "다음 진행" 1.5초 내 다중 press race 측 debounce 코드 없음. iOS Swift `AdvanceNextStepIntent` 측 debounce 1.5초 (= 8ac714c) 대응 없음.
- **발생률**: 매우 낮음 (= iOS 사용자만 보고). Android production 빌드 시 별도 fix 검토.

---

## 6. 권장 후속 작업 (= 본 검증 측 = 작업 X)

| 우선순위 | 작업 | 사유 |
|---------|------|------|
| 🟢 낮음 | Android 측 AlarmActionReceiver debounce 추가 | 잠재 한계 6. 사용자 보고 X. production 빌드 시. |
| 🟢 낮음 | Android 측 daily dismiss chain[0] 보존 패턴 (= Fix 4 측 안드로이드 적용) | 옛 rebalance 측 자동 해결되지만 = UUID 안정성 + 효율 개선 |

= 모두 안드로이드 production 빌드 사이클 시 별도 fix.

---

## 7. 결론

**본일 iOS fix 5건 측 안드로이드 회귀 0건**. iOS 디버그 심사 통과 + 한계 5 fix 정상 + 안드로이드 영향 검증 완료. 안드로이드 측 신규 잠재 한계 1건 식별 (= 우선순위 낮음).
