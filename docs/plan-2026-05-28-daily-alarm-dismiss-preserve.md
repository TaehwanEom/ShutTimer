# 일일 알람 dismiss 후 다음날 보존 fix (2026-05-28, iOS 우선)

> 본 문서: 계획 + 실행 기록
> 실 사용자 보고: 아이폰 측 3일 이상 앱 미실행 시 알람 안 울림
> 진단: 한계 5 (= dismiss 후 chain 전체 cancel → 다음 cold start까지 알람 재예약 X)
> 범위: iOS 우선. Android는 production 빌드 시 후속 사이클 적용.

---

## 1. 한 줄 요약

`Dismiss` / `Advance lastStep` 측 = chain[0] (= .relative daily) 보존 + chain[1..29] (= safety chain) 만 cancel. chain[0] 측 OS 자동 일일 반복 → 다음날 정상 발화.

= **쉽게 말하면**: dismiss 누르면 오늘 안전망(2분 간격 30개)만 끄고, 다음날 본 알람은 살려둠.

---

## 2. 문제 정밀 진단

### 현 동작 (= 버그)
1. 사용자 dismiss → `Dismiss` action → `CancelAlarmChain` effect
2. `cancelAlarmsForEntity(entityId)` → chain[0..29] 측 전부 cancel
3. iOS: chain[0] = .relative(daily) cancel → OS 자동 반복 종료 → Day 2 알람 X
4. 사용자 cold start 미발생 → `syncAllAlarms` 분기C 측 재예약 X → Day 2/3/... 알람 X

### 기대 동작
1. 사용자 dismiss → chain[1..29] (= safety chain) 만 cancel
2. chain[0] = .relative(daily) 보존 → OS 자동 Day 2 같은 시각 fire
3. Day 2 fire 시 listener 측 `rearmSafetyChain` (= 이미 구현됨) 측 = chain[1..29] 신규 schedule
4. 사용자 앱 미실행해도 = 매일 알람 정상

---

## 3. 영향 경로 분석 (= CancelAlarmChain effect 5개 호출 위치)

| # | 위치 | 의미 | 본 fix 적용? |
|---|------|------|------------|
| 1 | SessionController Stop (line 231) | 강제 종료 (= 사용자 의도적 중단) | ❌ 기존 전체 cancel 유지 |
| 2 | SessionController Start override (line 275) | 새 세션 시작 시 옛 세션 정리 | ❌ 기존 전체 cancel 유지 |
| 3 | SessionController DisableAlarm (line 395) | 알람 자체 OFF | ❌ 기존 전체 cancel 유지 |
| 4 | **SessionController Dismiss (line 525)** | 사용자 미션 완료 | ✅ **신규 (daily 보존)** |
| 5 | **SessionController Advance lastStep (line 559)** | 루틴 마지막 step 완료 | ✅ **신규 (daily 보존)** |

= 5개 중 **2개만** 적용. 나머지 3개는 옛 동작 유지 (= 명시적 종료 의도).

---

## 4. 정정 설계

### 4-1. 신규 effect: `CancelSafetyChainOnly`
- `alarmEntityId` 측 = daily/weekly 알람 → chain[1..29] 만 cancel + chain[0] 보존
- `alarmEntityId` 측 = once 알람 → 기존 `cancelAlarmsForEntity` 호출 (= 전체 cancel + disableOnce)
- `alarmEntityId` 측 = 알람 lookup 실패 → 기존 `cancelAlarmsForEntity` 호출 (= 안전망 = 알 수 없는 entity 측 전체 cleanup)

### 4-2. 신규 함수: `cancelSafetyChainPreservingDaily(alarmEntityId)`
- 위치: `src/utils/alarmScheduler.ts`
- 시그니처: `export async function cancelSafetyChainPreservingDaily(alarmEntityId: string): Promise<void>`
- 동작:
  1. `loadAlarms()` 측 entity lookup
  2. once 또는 lookup 실패 → `cancelAlarmsForEntity(alarmEntityId)` 위임 (= 기존 동작)
  3. daily/weekly:
     - `listAllAlarmMetadata()` 측 = entityId + type='alarm_main' + chainIndex >= 1 필터
     - F0: 각 meta 측 markAlarmDeleted
     - F1: 각 meta 측 AlarmkitBridge.cancelAlarm
     - F2: verify retry 3회 (= 기존 패턴 동일)
     - F3: stale=0 시 deleteAlarmMetadata
  4. chain[0] alerting 중인 경우 → AlarmkitBridge.stopAlarm(chain0.alarmId) 호출 (= alerting 종료 + .relative(daily) OS 자동 반복 보존)

### 4-3. effectRunner 측 분기
- `Dismiss` / `Advance lastStep` 측 = `cancelSafetyChainPreservingDaily` 호출
- 나머지 3개 = `cancelAlarmsForEntity` (기존) 호출
- 구현: `CancelAlarmChain` effect에 옵션 추가 `{ preserveDaily?: boolean }` 또는 신규 effect `CancelSafetyChainOnly` 분리

→ **신규 effect 분리** 선택 (= 옛 effect 의미 보존 + 명시적 의도)

---

## 5. iOS↔Android 영향

| 항목 | iOS | Android |
|------|-----|---------|
| chain[0] 패턴 | .relative(daily) → OS 자동 반복 보존 | daily PendingIntent → AlarmReceiver +1일 자동 |
| chain[1..29] 패턴 | .fixed 단발 → 다음날 rearmSafetyChain 필요 | daily PendingIntent → fire 시 자동 +1일 |
| 본 fix 적용 시 | chain[0] 보존 → 다음날 fire → rearmSafetyChain 측 chain[1..29] 신규 schedule | chain[0] 보존 → AlarmReceiver +1일 자동 = 정상 |
| 회귀 위험 | 낮음 (= 기존 rearmSafetyChain 로직 활용) | 중간 (= chain[1..29] 측 fire 시 자동 +1일이 보존되도록 dismissed alarmId 측만 cancel 필요) |

**우선 적용: iOS만**. Android는 production 빌드 사이클 시 추가 검증 후 적용.

→ `cancelSafetyChainPreservingDaily` 측 = iOS Platform 가드 + Android 측 = 기존 `cancelAlarmsForEntity` 위임 (= 안드로이드 회귀 0)

---

## 6. 변경 파일 목록

| 파일 | 변경 |
|------|------|
| `src/utils/alarmScheduler.ts` | `cancelSafetyChainPreservingDaily` 신규 export |
| `src/state/SessionController.ts` | Dismiss / Advance lastStep 측 = 신규 effect `CancelSafetyChainOnly` dispatch |
| `src/state/effectRunner.ts` | `CancelSafetyChainOnly` effect 분기 신규 → `cancelSafetyChainPreservingDaily` 호출 + `rebalanceAllChains` 후속 호출 (= 기존 패턴 동일) |

= 3개 파일. 신규 함수 1개 + 신규 effect kind 1개.

---

## 7. 안 건드릴 파일 / 영역

- ❌ `cancelAlarmsForEntity` (= 기존 함수, 의미 보존)
- ❌ 나머지 3개 호출 위치 (Stop / Start override / DisableAlarm)
- ❌ `rearmSafetyChain` (= 이미 구현, 활용)
- ❌ iOS native 코드
- ❌ Android native 코드
- ❌ 본일 직전 fix (= chain ghost fire / chainCount rebalance / confirm_prompt dedup / Swift debounce)

---

## 8. 검증 계획

### 8-1. TypeScript check
- `npx tsc --noEmit` 0 error

### 8-2. iOS 시뮬레이션
- 시나리오 A (daily 알람 + dismiss + D+1):
  1. daily 알람 등록 (= 1분 후 fire)
  2. fire → dismiss
  3. AlarmKit framework 측 list → chain[0] 존재 + chain[1..29] 없음 확인
  4. 시계 + 24h → chain[0] fire → listener 측 rearmSafetyChain → chain[1..29] 신규 schedule 확인
- 시나리오 B (once 알람 + dismiss):
  1. once 알람 등록 + fire + dismiss
  2. 전체 cancel + disable 확인 (= 기존 동작 보존)
- 시나리오 C (weekly 알람 + dismiss):
  1. weekly 알람 (월/수/금) + 월요일 fire + dismiss
  2. chain[0] = .relative(weekly mon/wed/fri) 보존
  3. 시계 + 48h → 수요일 chain[0] fire 확인

### 8-3. Android 회귀
- 시나리오 D (Android once 알람 + dismiss):
  1. once 알람 등록 + fire + dismiss
  2. cancelSafetyChainPreservingDaily 측 Android 가드 측 = cancelAlarmsForEntity 위임 확인 (= 기존 동작 동일)

---

## 9. 위험 평가

| 항목 | 위험도 | 비고 |
|------|--------|------|
| iOS 측 chain[0] 보존 → 다음날 rearm | 낮음 | 기존 rearmSafetyChain 코드 활용 |
| once 알람 측 본 fix 측 분기 | 0 | cancelAlarmsForEntity 위임 |
| Android 측 영향 | 0 | Platform 가드 → cancelAlarmsForEntity 위임 |
| 본일 직전 fix 회귀 | 0 | cancelAlarmsForEntity 자체 보존 |
| Stop / DisableAlarm 측 영향 | 0 | 호출 경로 분리, 본 fix 대상 X |

---

## 10. 후속 작업 (= 본 plan 측 X)

- Android 측 동일 패턴 적용 (= production 빌드 사이클 시)
- 안드로이드 한계 1/2/3 (Direct Boot / SharedPreferences race / 동시 발화 누수) = `plan-2026-05-28-android-deep-check-fixes.md` 측 별도
