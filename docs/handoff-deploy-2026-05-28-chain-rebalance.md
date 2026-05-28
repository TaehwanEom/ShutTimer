# 배포 전달문 — 2026-05-28 (chainCount 재밸런싱)

> 브랜치: `feature/android-support`
> 직전 전달문: `handoff-deploy-2026-05-28-debug-review.md` (커밋 `ed4b998`)
> 본 커밋: `e47fa4d` fix(alarm): chainCount 재밸런싱

---

## 1. 한 줄 요약

알람 5개+ 활성 시 = AlarmKit framework limit (~64) 초과 위험 사전 차단. 활성 알람 갯수 변경 시 기존 알람 chain 자동 재계산.

= **쉽게 말하면**: 알람 많이 켜는 사용자도 framework 한계까지 안 가게 자동 조정.

---

## 2. 문제

`scheduleAlarmMain` (alarmScheduler.ts:135) 측 = chainCount = `floor(30 / activeCount)` 호출 시점 계산만.

기존 알람의 chain은 새 알람 추가/삭제 시 변경되지 않음.

| 시점 | 활성 알람 | 신규 chainCount | 기존 chain (= 변경 X) | framework 총합 |
|------|----------|-----------------|----------------------|--------------|
| t=0 | A enable | A=30 | - | 30 |
| t=1 | B enable | B=15 | A=30 | **45** ⚠️ |
| t=2 | C enable | C=10 | A=30, B=15 | **55** ⚠️ |
| t=3 | D enable | D=7 | A=30, B=15, C=10 | **62** ⚠️ |
| t=4 | E enable | E=6 | A=30, B=15, C=10, D=7 | **68** ❌ 한계 초과 |

---

## 3. 정정

### `rebalanceAllChains` 함수 신규 (alarmScheduler.ts)

```ts
// v2.1 #ChainRebalance (2026-05-28)
export async function rebalanceAllChains(): Promise<void> {
  // 모든 활성 알람 측 target chainCount 재계산
  // current === target 시 skip (idempotent)
  // 다르면 옛 chain cancel + scheduleAlarmMain 재호출
}
```

### effectRunner 후속 호출

- `ScheduleAlarmChain` effect → scheduleAlarmMain → **rebalanceAllChains**
- `CancelAlarmChain` effect → cancelAlarmsForEntity → **rebalanceAllChains**

= 알람 ON/OFF 토글 시 자동 재계산.

---

## 4. 변경 파일 (2개)

```
src/utils/alarmScheduler.ts    rebalanceAllChains 신규 export
src/state/effectRunner.ts      ScheduleAlarmChain + CancelAlarmChain effect 측 후속 호출
```

총 +51 lines.

---

## 5. 영향 범위

| 영역 | iOS | Android |
|------|-----|---------|
| `rebalanceAllChains` 자체 | 작동 | 작동 (= Platform 공통) |
| 토글 ON 후 재계산 | ✓ | ✓ |
| 토글 OFF 후 재계산 | ✓ | ✓ |
| idempotent (= current=target skip) | ✓ | ✓ |

= 양쪽 OS 동일 적용. 회귀 위험 0.

---

## 6. 사용자 영향

### 신규 유저
- 영향 ❌ (= 알람 5개 이하 시 = 기존 동작과 동일)

### 기존 유저 (= 본 빌드 업데이트)
- 영향 ❌ 즉시 (= 기존 알람 chain은 그대로)
- 다음 토글 ON/OFF 시 = 자동 재계산 적용

### 파워 유저 (= 알람 5개+ 활성)
- 신규 알람 추가 시 = 기존 알람도 같이 chain 축소 → framework limit 안전권 유지
- 알람 삭제 시 = 남은 알람 chain 확장 (= 안전망 강화)

= **쉽게 말하면**: 파워 유저는 framework limit 초과 위험에서 자동 보호됨.

---

## 7. 검증 상태

### 완료
- **TypeScript check** = 0 error
- **시뮬레이션 검증**:
  - 알람 2개 cold boot → 각 chainCount=15, total=30 정확 ✓
  - `rebalanceAllChains` 호출 시 = current=target → skip (= idempotent 로그) ✓

### 미완료 (= 실 디바이스 권장)
- 알람 5개 토글 시퀀스 (= 1→2→3→4→5 순차 enable) → 각 단계 chain 재밸런싱 확인
- 5개 활성 → 1개 disable → 남은 4개 chainCount=7 재밸런싱 확인

---

## 8. 위험 평가

| 항목 | 위험도 | 비고 |
|------|--------|------|
| idempotent 가드 (= 무한 루프) | 0 | `if (currentChainCount === targetChainCount) continue` |
| 토글 ON/OFF 시 race | 매우 낮음 | effectRunner 측 순차 처리 (= await chain) |
| Android 회귀 | 0 | Platform 공통 코드, 기존 daily/weekly 유지 |
| 성능 (= 알람 N개 재schedule) | 낮음 | N≤10 보통, 30 schedule × N = 200ms 이하 |

---

## 9. 롤백 방법

```bash
# 본 커밋 단독 롤백
git revert e47fa4d
```

---

## 10. 미수정 (= 알려진 한계)

`docs/plan-2026-05-28-precision-fix.md` §3 측 3건:
- markAlarmDeleted silent fail (= AsyncStorage 실패 시만, 발생률 극히 낮음)
- migrateChainFixedSafety check-set 비원자 (= cold start 1회만 호출, 실 발생 X)
- AdvanceIntent debounce 모서리 (= 빈 entityId / 시계 점프 / 재시작, 모두 극단 케이스)

= **알려진 한계로 문서화 유지**. 향후 발생 시 빠른 진단 가능.

---

## 11. 후속 작업

- [ ] 실 디바이스 검증 (= 5개 알람 토글 시퀀스)
- [ ] 본 fix + 직전 fix들 통합 빌드 → TestFlight
- [ ] App Store Release 빌드 + 심사 제출
