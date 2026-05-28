# 정밀 분석 후속 수정 계획 — 2026-05-28

> 발견 출처: `docs/session-record-2026-05-28.md` + 본 세션 정밀 분석 5회
> 발견 약점: 4건 (모두 minor, 운영 영향 낮음)
> 본 계획: Phase 1 (실 fix 1건) + Phase 2 (문서화 3건)

---

## 1. 한 줄 요약

알람 5개+ 활성 시 framework limit 위험 차단 (= chainCount 재밸런싱). 나머지 3개는 코드 안 건드리고 알려진 한계로 문서만 추가.

= **쉽게 말하면**: 진짜 영향 있는 1건만 고치고, 이론적 약점 3건은 기록으로 남긴다.

---

## 2. Phase 1: chainCount 재밸런싱 (= 실 fix)

### 문제

`scheduleAlarmMain` (alarmScheduler.ts:135) 측 = chainCount = `floor(30 / activeCount)` 호출 시점 계산.

**문제**: 새 알람 enable 시 기존 알람의 chain은 그대로. 시간 흐름 → framework 측 알람 누적.

**예시**:
| 시점 | 활성 알람 | 신규 chainCount | 기존 chainCount | framework 총합 |
|------|----------|-----------------|----------------|--------------|
| t=0 | 알람A enable | A=30 | - | 30 |
| t=1 | 알람B enable | B=15 | A=30 (= 변경 X) | **45** ⚠️ |
| t=2 | 알람C enable | C=10 | A=30, B=15 | **55** ⚠️ |

= 알람 5개 enable 시 = 30 + 15 + 10 + 7 + 6 = **68개** → AlarmKit framework limit (~64) 초과 가능.

### 수정

**[src/utils/alarmScheduler.ts](src/utils/alarmScheduler.ts) 측 신규 함수 `rebalanceAllChains` 추가**:

```ts
// v2.1 #ChainRebalance (2026-05-28) — 활성 알람 갯수 변경 시 기존 알람 chain 재계산.
//   호출자: EnableAlarm + DisableAlarm + scheduleAlarmMain 후 분기.
export async function rebalanceAllChains(): Promise<void> {
  if (!isAlarmKitAvailableSync()) return;
  const alarms = await loadAlarms();
  const allMeta = await listAllAlarmMetadata();

  const activeAlarms = alarms.filter(a => a.enabled);
  const targetChainCount = Math.max(1, Math.min(
    ALARM_CHAIN_MAX_INDEX + 1,
    Math.floor((ALARM_CHAIN_MAX_INDEX + 1) / Math.max(1, activeAlarms.length))
  ));

  for (const alarm of activeAlarms) {
    const currentChain = allMeta.filter(
      m => m.type === 'alarm_main' && m.entityId === alarm.id && m.deleted !== true
    );
    const currentChainCount = currentChain.length;

    // chainCount 일치 시 = skip (idempotent 보장)
    if (currentChainCount === targetChainCount) continue;

    // 다르면 = 옛 chain 전체 cancel + scheduleAlarmMain 재호출
    Logger.warn('alarmScheduler-DBG',
      `rebalanceAllChains entityId=${alarm.id} current=${currentChainCount} target=${targetChainCount}`);
    for (const meta of currentChain) await cancelAlarm(meta.alarmId);
    await scheduleAlarmMain(alarm).catch(() => {});
  }
}
```

### 호출자 추가

**[src/state/effectRunner.ts](src/state/effectRunner.ts) ScheduleAlarmChain effect 측 = 후속 호출**:

```ts
case 'ScheduleAlarmChain': {
  await scheduleAlarmMain(effect.alarm).catch(() => {});
  await rebalanceAllChains().catch(() => {});  // ← 신규
  break;
}
```

**[CancelAlarmChain effect 측 = 후속 호출**:

```ts
case 'CancelAlarmChain': {
  await cancelAlarmsForEntity(effect.alarmEntityId).catch(() => {});
  await rebalanceAllChains().catch(() => {});  // ← 신규
  break;
}
```

### 영향

- **iOS + Android 공통 적용** (= chainCount 자체가 platform-agnostic)
- **idempotent** = current=target 시 skip → 무한 루프 X
- **회귀 위험 낮음** = scheduleAlarmMain 호출 chain만 더 자주 발생

### 작업량

- 코드: 1일 (= 함수 추가 + effect 호출 + 테스트)
- 검증: 시뮬레이션 1회 (= 5 알람 enable → 각 chainCount=6 + total=30 확인)

---

## 3. Phase 2: 알려진 한계 문서화 (= 코드 안 건드림)

### 약점 #2: markAlarmDeleted silent fail

**위치**: [alarmScheduler.ts:302](src/utils/alarmScheduler.ts#L302) `await markAlarmDeleted(meta.alarmId).catch(() => {});`

**문제**: AsyncStorage write 실패 시 silent. metadata `deleted=false` 잔존 + F1/F2 cancel 실패 시 = orphan + 사용자 화면 진입 가능.

**왜 안 고치는가**:
- AsyncStorage write 실패 자체가 극히 드뭄 (= 디스크 꽉 참 등)
- retry 코드 추가 시 = 새 race / dead-lock 진입점
- listener 측 silent skip 안전망 + cleanupGhostAlarms 측 보조 청소 = **사용자 영향 0에 가까움**

**문서 추가**: 본 plan 문서에 알려진 한계로 기록.

### 약점 #3: migrateChainFixedSafety 비원자

**위치**: [alarmScheduler.ts:566-586](src/utils/alarmScheduler.ts#L566-L586) check + set 사이 비원자

**문제**: 이론적으로 동시 호출 시 두 번 진입 가능.

**왜 안 고치는가**:
- App.tsx 측 cold start 1회만 호출 (= 실제 발생 X)
- mutex 추가 시 = 코드 복잡 + 새 잠재 dead-lock
- 두 번 실행돼도 = 옛 chain cancel + 새 schedule 두 번 = 결과 같음 (= 데이터 손상 X)

**문서 추가**: 본 plan 문서에 알려진 한계로 기록.

### 약점 #4: AdvanceIntent debounce 모서리 케이스

**위치**: [AdvanceNextStepIntent.swift:280-289](modules/alarmkit-bridge/ios/AdvanceNextStepIntent.swift#L280-L289)

**문제 3가지**:
- 빈 entityId = `"__empty__"` 공통 key (= 다중 routine 빈 값 시 잘못 차단)
- 시계 점프 = wall clock 의존 (= NTP sync 시 잘못 차단/통과)
- App 재시작 직후 = dict 초기화 (= 1.5초 race 가능)

**왜 안 고치는가**:
- 빈 entityId 자체가 비정상 (= snapshot fallback path, 거의 안 옴)
- 시계 점프 = 사용자 press 직후 점프 = 극히 드뭄
- App 재시작 직후 race = 시스템이 알람 chain도 같이 정리하므로 영향 적음

**문서 추가**: 본 plan 문서에 알려진 한계로 기록.

---

## 4. 작업 순서

### Phase 1 (= 실 fix, 1일)
1. `src/utils/alarmScheduler.ts` 측 `rebalanceAllChains` 함수 추가
2. `src/state/effectRunner.ts` 측 ScheduleAlarmChain + CancelAlarmChain effect 측 호출 추가
3. TypeScript check
4. 시뮬레이션 검증:
   - 알람 1개 enable → chainCount=30 확인
   - 알람 추가로 enable (총 5개) → 각 chainCount=6 + framework total=30 확인
   - 알람 1개 disable → 남은 4개가 chainCount=7로 재밸런싱 확인
5. 커밋 + 핸드오프 doc 추가

### Phase 2 (= 문서화, 0일 = 본 문서로 완료)
- 본 plan 문서 commit 시 자동 완료
- 향후 관련 회귀 발생 시 = 본 문서 참조

---

## 5. 위험 평가

| 항목 | 위험도 | 비고 |
|------|--------|------|
| Phase 1 회귀 (= 기존 동작 깨짐) | 낮음 | idempotent 가드 (current=target skip) + 기존 scheduleAlarmMain 재사용 |
| Phase 1 성능 (= 알람 추가 시 N개 재schedule) | 낮음 | 알람 N개 작음 (보통 1-10), 30개 schedule × N = 200ms 이하 |
| Phase 2 (= 안 고침) 후속 회귀 | 매우 낮음 | 각 케이스 발생률 극히 낮음 |

---

## 6. 검증 시나리오 (Phase 1)

### 시뮬레이션 시나리오 (= AsyncStorage 시드 + cold boot 패턴)

| # | 시나리오 | 기대 |
|---|---------|------|
| 1 | 알람 1개 enable | chainCount=30 (= 기존 동일) |
| 2 | 알람 2개 enable → 1개 추가 → 2개 enable | 양쪽 chainCount=15 (= **재밸런싱**) |
| 3 | 알람 5개 enable | 각 chainCount=6, total=30 |
| 4 | 알람 5개 → 1개 disable | 남은 4개가 chainCount=7로 재밸런싱 |
| 5 | 알람 30개 enable (= 한계) | 각 chainCount=1 (= safety chain X), warning log |

### 실 디바이스 시나리오 (= 사용자 권장)

1. 알람 5개 등록 → 각각 ON
2. 첫 알람 시각 도달 → 정상 fire 확인
3. dismiss 후 다른 알람 영향 0 확인

---

## 7. 롤백 방법

```bash
# Phase 1 코드 롤백
git revert <commit-hash>

# 또는 rebalanceAllChains 호출만 비활성
# effectRunner.ts 측 라인 주석 처리
```

---

## 8. 후속 작업

- [ ] Phase 1 코드 작성 + 커밋
- [ ] 시뮬레이션 검증 5개 시나리오
- [ ] 핸드오프 문서 (= `handoff-deploy-2026-05-28-chain-rebalance.md`)
- [ ] 실 디바이스 검증 (= 사용자 권장)

---

## 9. 결정 필요

본 plan 진행 여부:
- (A) **Phase 1만 진행** (= 추천, 1일 작업)
- (B) Phase 1 + Phase 2 추가 fix (= 3시간 더, 효과 미미)
- (C) **둘 다 안 진행** (= 현 상태 유지, 본 문서만 commit)

사용자 결정 필요.
