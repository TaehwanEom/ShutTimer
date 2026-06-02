# 데일리 알람+루틴이 며칠간 안 울리는 버그 — 원인 + 수정 (2026-06-02)

> ✅ **검증 완료 (1.8.6 디버그 빌드 실측, log02)**: 두 수정 적용 후 루틴 사이클 전 구간에서 chain[0](EBC79791, .relative daily) 보존됨 — `removed`/전체취소 0건, 24분 뒤에도 scheduled 유지. 취소→재생성 churn 제거.

대상: App Store 1.8.6 (= 8b55a1d, 스케줄 코드 현재와 동일) / 현재 트리 공통
창: iOS 구현(Build)

---

## 1. 증상 (사용자 확인)
- 매일 울리던 **데일리 알람 + 루틴**이 **어제까지 정상, 오늘 갑자기 미발화**.
- 한 번 끊기면 **며칠간 쭉** 안 울림 (자가복구 안 됨).
- 확인해보니 **토글은 ON 상태인데 안 울림**. **OFF→ON 하니 부활.**
- 앱은 백그라운드 상태(완전 종료 아님), 정식 최신 iOS(베타 아님), 알람 1개.
- 재발성인데 정황이 일정치 않아 이전엔 원인 파악 실패.

## 2. 근본 원인 (코드 2곳 + 사용자 행동으로 확정)
**루틴 시작 시 원본 데일리 알람의 chain[0](.relative daily = 매일 반복 심장)까지 전체취소됨.**

1. 데일리 알람 발화 → `onAlarmFire` → `Start(simple_alarm, alarmBinding.alarmEntityId = 원본 alarm.id)` 세션 생성 (ActionDispatcher.ts).
2. 해제 → `startRoutineFromAlarm` → `Start(kind: ad_hoc_routine)`.
3. **Start override 분기** (SessionController.ts:281-287)에서 `current.alarmBinding.alarmEntityId`(= 원본 alarm.id)에 `CancelAlarmChain`(전체취소) → `cancelAlarmsForEntity` → **chain[0]까지 삭제** → OS 자동 daily 반복 사라짐.
4. 복구(`syncAllAlarms` → 분기 C 재스케줄)는 **cold start(앱 완전 재실행) 시에만 실행** (App.tsx:888, mount 1회). 백그라운드 유지 중엔 안 돎.

→ 결과: 루틴 한 번 돌면 chain[0] 사라짐 → 앱을 완전히 껐다 켜지 않으면 며칠이고 미발화. **enabled(토글) 값은 안 건드려서 UI는 ON으로 보이지만 실제 예약은 비어 있음.** OFF→ON = `EnableAlarm → scheduleAlarmMain` 재실행 → chain[0] 재생성 → 부활. (사용자 확인과 정확히 일치)

### 검증 (회귀 없음 확인)
- `ClearActiveRoutine` effect: `chain`/`confirm_prompt`만 취소, `alarm_main` 미취소 → chain[0] 안 건드림.
- 루틴(ad_hoc_routine) 세션은 `alarmBinding` 없음(dispatchStartRoutine 미설정) → 루틴 **종료(Stop) 시 원본 알람 취소 안 됨**.
- 즉 chain[0]을 죽이는 경로는 **Start override 단 한 곳**.

## 3. 수정 (2곳 — `src/state/SessionController.ts`)
`CancelAlarmChain`(전체취소, chain[0]까지 삭제) → `CancelSafetyChainOnly`(chain[0] 보존 + 안전체인만 취소):

1. **Start override 분기** (line ~300) — 1차 수정.
2. **Stop 전환** (line ~248) — 2차 수정. ← log02(1.8.6 디버그) 검증에서 발견.

```ts
// before
effects.push({ kind: 'CancelAlarmChain', alarmEntityId: current.alarmBinding.alarmEntityId });
// after
effects.push({ kind: 'CancelSafetyChainOnly', alarmEntityId: current.alarmBinding.alarmEntityId });
```

`CancelSafetyChainOnly` → `cancelSafetyChainPreservingDaily`:
- **daily/weekly**: chain[0] 보존 + 안전체인(1+)만 취소 → 데일리 반복 유지 (= 수정 목적).
- **once / 알람 아닌 entity**: 함수 내부에서 전체취소로 자동 폴백 → 기존 동작 동일 (**회귀 0**).
- **DisableAlarm 전환(line 421)은 `CancelAlarmChain` 유지** — 알람 토글 OFF/삭제 시엔 전체취소가 정상.

### 왜 2곳인가 (log02 1.8.6 디버그 빌드 실측)
1차 수정만 했을 때 로그(08:38:31~33):
- 08:38:32 Dismiss → `cancelSafetyChain ... chain0Preserved=true` (chain[0] 보존 OK)
- **08:38:33 `startRoutine stale non-routine session(simple_alarm, CONFIRMING) 감지 → dispatch Stop`** → 이 Stop의 `CancelAlarmChain`(전체취소)이 **chain[0](778A5FBC) 다시 제거** → rebalance가 재생성해 살아남았으나 "취소→재생성" 불안정.
- → **Stop 전환도 보존(2차)** 적용 = chain[0]을 아예 안 건드림 → 취소·재생성 churn 제거.

타입 정합: `CancelSafetyChainOnly`는 SideEffect 타입(SessionController.ts:55) + effectRunner 핸들러(effectRunner.ts:150)에 이미 존재 → 컴파일 영향 없음.

## 4. 함께 짚은 것 (이번 범위 아님)
- **Stop 전환(SessionController.ts:240)도 전체취소** → "스텝 없는 순수 데일리 알람"을 앱 내에서 stop 시 비슷한 위험 가능. 단 사용자 케이스(알람+루틴)는 override 경로라 이번 수정으로 해결. Stop 쪽은 별도 점검 대상.
- **안전망(foreground 복귀 시 syncAllAlarms)**: 근본 차단(chain[0] 미삭제)으로 불필요 판단. 추가 시 복귀마다 재스케줄 비용/리스크 → 미적용.

## 5. 크로스플랫폼
`SessionController.ts`는 공통 JS → **Android에도 반영**. 단 Android 알람 스케줄/체인 구현은 네이티브가 달라 동작·회귀를 **Android에서 별도 QA 필요**. (이 override 로직 자체는 공통)

## 6. 상태
- 코드 수정 적용 + 타입 정합 확인. **미커밋.**
- **빌드 미실행**(사용자 지시 = 빌드 승인 없이 진행 금지).
- 최종 동작 확인: 빌드 후 실기기에서 (데일리 알람+루틴 발화 → 해제 → 루틴 → 다음날/cold-start 없이도 다음날 발화 유지) 검증 필요.
