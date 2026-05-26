# 크리티컬 수정 + 시나리오 + "유령 알람" 원인 기록 — 2026-05-27

> 배포: `feature/android-support` HEAD `60747de`
> 관련 커밋: `df529de` (Fix A + B), `ee5ccaf` (Fix A.2), `e79e3e8` (광고)

---

## 1. 한 줄 요약

이번 세션에서 "유령 알람" 두 종류 발견 + 정정. 둘 다 SessionController state machine 측 잔존 세션이 다음 동작을 가로채거나, 새로 시작된 세션을 silently 죽인 케이스.

---

## 2. 유령 알람 1번 — "보이지 않는 좀비 세션"

### 증상

사용자 시나리오:
1. 타이머 60초 시작 → 정상 진행
2. 타이머 종료 → 미션 (타이핑) 풀고 dismiss
3. 홈으로 돌아옴 → 정상 보임
4. 루틴 탭 진입 → 루틴 ▶ 누름
5. **아무 반응 없음 (= 먹통)**
6. 알람이 한 번 fire 후 → 다시 루틴 ▶ 누르면 정상 시작

= 화면상으로는 보이지 않지만 내부에는 옛 타이머 세션이 좀비처럼 살아있어서, 새 루틴 시작 요청을 가로채는 상태.

### 원인 추적 (log01 측 14:32 구간)

```
14:32:01.538 [SessionController] dispatch action=Dismiss currentState=STEP_ALERTING
14:32:03.885 [AlarmScreen-DBG] unmount routeAtUnmount=Home
14:32:06.804 [SessionController] dispatch action=Start currentState=CONFIRMING
14:32:06.804 [SessionController] Start rejected — existing session main_timer_1779805815995 (CONFIRMING)
14:32:07.643 [SessionController] dispatch action=Start currentState=CONFIRMING
14:32:07.643 [SessionController] Start rejected — existing session main_timer_1779805815995 (CONFIRMING)
```

### 코드 수준 원인

`SessionController.transition()` 측 Dismiss action 결과:
- 입력: `STEP_ALERTING` 상태
- 결과: `CONFIRMING` 상태 + ShowInterstitialAd effect

Dismiss는 STEP_ALERTING → CONFIRMING 전이만 처리. 그 다음 dispatch (Advance 또는 Stop) 가 와야 세션이 정리됨.

`AlarmScreen.goHome()` 측 흐름:
- routine kind = `fromRoutine='last_step'` 분기 → stopRoutine 호출 ✓
- alarm with steps = `startRoutineFromAlarm` 호출 → 새 ad-hoc routine 측 override ✓
- **timer kind / simple_alarm kind (steps 없음) = 아무 정리 dispatch 없음** ← 누락

= 결과: timer 세션이 CONFIRMING 상태로 영구 잔존. 다음 사용자가 루틴 ▶ 누르면 `dispatch(Start)` 가 "existing session" 검사에 걸려서 reject.

### Fix A (df529de)

`src/screens/AlarmScreen.tsx` 의 `goHome()` 측 navigation.reset 직전:

```ts
if (currentSession && (currentSession.kind === 'timer' || currentSession.kind === 'simple_alarm')) {
  await sessionDispatch({ type: 'Stop', reason: 'user_button' });
}
```

= timer / simple_alarm kind 세션이 잔존하면 강제로 Stop dispatch → 세션 정리 → 다음 루틴 ▶ 정상 동작.

### Fix B (df529de) — 안전망

`src/utils/routineController.ts` 의 `startRoutine()` 측 진입부:

```ts
const preSession = await getCurrentSession();
if (preSession && (preSession.kind === 'timer' || preSession.kind === 'simple_alarm')) {
  await sessionDispatch({ type: 'Stop', reason: 'override' });
}
```

= Fix A가 어떤 이유로든 실행 안 된 케이스 (앱 강종, 크래시 등) 대비. 루틴 시작 시점에 이중 검사.

---

## 3. 유령 알람 2번 — "막 시작된 루틴이 즉시 죽는다"

### 증상

사용자 시나리오:
1. 알람 (안에 step 3개 들어있는 거) 설정 + 토글 on
2. 알람 시간 도달 → 알람 울림 → 미션 풀고 dismiss
3. **dismiss 직후 = 안에 있던 루틴이 자동 시작되어야 함 (= 정상 동작)**
4. **실제: 루틴이 안 시작됨**

= 알람 안에 들어있던 루틴이 한 순간 시작되는 듯 보이다가 흔적도 없이 사라짐. 마치 유령처럼.

### 원인 추적 (코드 분석)

`AlarmScreen.goHome()` 측 흐름 (Fix A 적용 후):

```ts
// 1. 옛 세션 변수 capture
const currentSession = await getCurrentSession();  // = simple_alarm
const alarmEntityId = ...;

if (alarmEntityId) {
  // 2. ad-hoc routine 시작 (= 새 ad_hoc_routine 세션이 storage 측 옛 simple_alarm 덮어쓰기)
  if (a.steps.length > 0 && currentSession) {
    await startRoutineFromAlarm(a);  // ← 여기서 storage 측 = 이제 ad_hoc_routine
  }
  
  // 3. Fix A 측 = 옛 currentSession 변수로 검사 (BUG!)
  if (currentSession && currentSession.kind === 'simple_alarm') {  // ← 옛 변수 → true
    await sessionDispatch({ type: 'Stop' });  // ← storage 측 새 ad_hoc_routine 죽임
  }
}
```

= 변수 `currentSession` 측 = step 1에서 capture된 시점의 값. step 2에서 storage가 바뀌어도 변수는 그대로. step 3의 Fix A 측 = `currentSession.kind === 'simple_alarm'` 측 = true → dispatch(Stop) 발동 → 그런데 dispatch는 storage 측 현재 세션 (= ad_hoc_routine) 에 작용 → **막 시작된 루틴 죽음**.

### Fix A.2 (ee5ccaf)

```ts
// 재읽기 필수
const sessNow = await getCurrentSession();
if (sessNow && (sessNow.kind === 'timer' || sessNow.kind === 'simple_alarm')) {
  await sessionDispatch({ type: 'Stop' });
}
```

= `sessNow` 측 = startRoutineFromAlarm 측 직후 측 = 재읽기. 새 세션이 ad_hoc_routine이면 kind 검사 실패 → Stop SKIP → 루틴 살아남음 ✓.

---

## 4. 두 유령 알람의 공통 root cause

둘 다 **SessionController state machine 측 = "이전 세션 정리" 책임이 분산되어 있어서 누군가 빠뜨리거나 잘못 가로채는 케이스**.

- 유령 1: 정리 책임자가 아무도 없어서 → 좀비 세션 잔존
- 유령 2: 정리 책임자가 너무 늦게 작동해서 → 새 세션 죽임

## 5. 시나리오 매트릭스 (검증 완료)

| 시나리오 | 시작 상태 | 동작 | 기대 결과 | 검증 |
|---------|----------|------|----------|------|
| 1 | IDLE | 타이머 60초 set + ▶ + fire + dismiss | SESSION=NULL (= Fix A) | iOS 시뮬레이터 PASS |
| 2 | stale CONFIRMING (timer) | 루틴 ▶ | stale 정리 + 새 routine 시작 (= Fix B) | iOS 시뮬레이터 PASS |
| 3 | stale CONFIRMING (simple_alarm) | 루틴 ▶ | stale 정리 + 새 routine 시작 (= Fix B) | iOS 시뮬레이터 PASS |
| 4 | routine SCHEDULED | 타이머 ▶ | "예정된 알람 충돌" dialog → 시작 → override → 새 timer | iOS 시뮬레이터 PASS |
| 5 | (시나리오 1과 동일 path) | 타이머 다시 set + ▶ | 시나리오 1 동일 결과 | iOS 시뮬레이터 PASS (시나리오 1로 검증) |
| 6 | IDLE | 알람 (steps 3개) 측 fire → dismiss | ad-hoc routine 자동 시작 (= Fix A.2) | 코드 분석 PASS (실 디바이스 검증 필요) |

---

## 6. 회귀 위험 점검 결과

| 항목 | 위험도 |
|------|--------|
| Fix A 측 routine kind 영향 | 0 — timer/simple_alarm만 검사 |
| Fix A 측 ad_hoc_routine 영향 | 0 (Fix A.2 적용 후) |
| Fix B 측 routine 시작 path 영향 | 0 — stale non-routine만 정리 |
| iOS AlarmKit framework 영향 | 0 — JS dispatch 흐름만 수정 |
| Android | 0 — 동일 SessionController = 동일 보호 |
| onAlarmStateChange listener 영향 | 0 — goHome/startRoutine 직접 호출 없음 |

---

## 7. 디버깅 측 교훈

1. **변수 capture timing**: async/await 측 = 사이 사이에 storage가 바뀔 수 있음. 의사결정 시점에 `await getCurrentSession()` 재호출 필수.
2. **State machine 측 정리 책임**: 모든 종착 상태 (= CONFIRMING) 측 = 누가 다음 dispatch를 보내는지 명시 매핑 필요. 안 그러면 좀비 세션 잔존.
3. **Side effect 측 = 변수 vs storage 동기 가정 금지**: dispatch가 storage를 바꿈. dispatch 호출 후의 변수는 이미 stale.

---

## 8. 미커밋 / 후속

- 미커밋 0건
- 후속: 사용자 실 디바이스 측 = 시나리오 6 (알람 + steps → fire → dismiss → ad-hoc routine 자동 시작) 1회 측정 후 심사 제출 권장
- 광고 측 = 별도 PR 측 = 광고 해제 후 `e79e3e8` 측 revert
