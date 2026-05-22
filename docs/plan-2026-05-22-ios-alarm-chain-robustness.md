# iOS 알람 체인 견고화 — 구현 계획서

- 작성일: 2026-05-22
- 대상: iOS (AlarmKit) — 출시 중인 라이브 앱 (v1.8.x)
- 창: 구현창 (계획 단계 — 유저 승인 후 구현 착수)

---

## 1. 배경 / 문제

### 시나리오 (유저 보고)
- AM 6:50 알람이 떠야 할 때 → AlarmKit 알람이 잠금화면에 출력 (시스템이 그림 → 아이폰 기본 알람처럼 보임 = 의도된 동작)
- 사용자가 잠금 해제 없이 잠금화면에서 슬라이드로 중지
- → 알람만 꺼지고 ShutTimer 미션 화면이 안 뜸 ("아무 반응 없음")

### 근본 원인 (진단 완료)
ShutTimer의 "꺼지지 않는 알람"은 **체인**(`#AlarmChainEager`)에 의존한다 — 2분 간격으로 최대 50회 재발화하여, 슬라이드로 꺼도 계속 울려 결국 사용자가 앱을 열고 미션을 하게 만드는 구조.

그런데 체인이 견고하지 않다:
- `chainIndex 0` = 주간/매일 반복(`.relative`) → OS가 매주/매일 자동 재발화 ✅
- `chainIndex 1~49` = **특정 날짜에 못박힌 `.fixed` 단발** → 예약 당시 "다음 occurrence" 하루치만 ❌

체인 재예약(`syncAllAlarms`)은 **앱을 켤 때만** 실행된다 (백그라운드 주기 동기화 없음 — 코드 확인).

→ 사용자가 잠금화면 슬라이드로 알람을 끄면 앱이 안 열리고, `syncAllAlarms`가 재실행되지 않는다. 그 결과 **다음날부터 `chainIndex 0` 하나만 남아 평범한 단발 알람으로 전락** → 슬라이드 한 번에 미션 완전 우회.

---

## 2. 접근 검토

| 안 | 내용 | 장점 | 단점 / 위험 |
|---|---|---|---|
| A1 | `OpenAppDismissIntent.perform()`(네이티브 인텐트)에서 다음 occurrence 체인 재예약 | 앱이 죽어도 동작 | 인텐트 시간 예산 한계(50개 await 스케줄), **출시앱 네이티브 인텐트 수술**, 알람 정의를 App Group으로 미러링하는 신규 통로 필요 → 위험 큼 |
| A2 | 체인 예산 50개를 다음 N개 occurrence에 분산 예약 | 순수 RN, 저위험 | per-occurrence 체인이 얕아짐(예: 7회=14분). N일 후 다시 앱 의존 |
| **A3 (채택)** | **체인 멤버 전체(`chainIndex 1+`)도 `chainIndex 0`처럼 `.relative` 반복 알람으로 등록** | **재예약 자체가 불필요** — 매주/매일 OS 자동 반복. 거의 순수 RN 변경. **네이티브 무수정** | 자정 넘는 체인 멤버의 요일 계산 필요 (엣지 케이스) |

### 채택: A3

> 초기 구두 추천은 A1(인텐트 재무장)이었으나, 계획 정밀 검토 결과 **A3가 명백히 우월**하여 변경한다.
> 이유: A3는 "재예약" 문제 자체를 없앤다. 체인의 모든 멤버가 `chainIndex 0`과 똑같이 OS 자동 반복이 되면, 앱을 영영 안 열어도 체인이 매주/매일 그대로 살아있다. 네이티브 인텐트를 건드리지 않으므로 출시앱 회귀 위험이 최소.

---

## 3. 채택안(A3) 상세 설계

### 핵심
`chainIndex 1~49`를 현재 `{ mode: 'never' }`(→ 네이티브 `.fixed`) 대신, **알람의 반복 설정을 따르는 `.relative` 반복**으로 등록한다.

### 멤버별 recurrence 계산 규칙
```
chainMemberRecurrence(alarm, chainIndex, fireAt, chainBaseFireAt):
  - alarm.repeat === 'once'  → { mode: 'never' }            // 'once'는 1회성, 체인도 .fixed 유지
  - chainIndex === 0         → mapAlarmRepeatToRecurrence()  // 현행 유지
  - alarm.repeat === 'daily' → { mode: 'daily' }             // 매일 = 자정 넘어도 매일
  - alarm.repeat === 'weekly':
      dayOffset = (fireAt의 날짜) - (chainBaseFireAt의 날짜)  // 0 또는 1 (체인 최대 100분 → 자정 1회만 가능)
      shiftedDays = alarm.days.map(d => (d + dayOffset) % 7)
      → { mode: 'weekly', days: shiftedDays }
```
- 체인 멤버의 시각(hour:minute)은 네이티브가 `fireAt`에서 그대로 추출 → RN은 `fireAt`만 정확히 넘기면 됨 (현행과 동일).
- 자정을 넘는 체인 멤버(예: 23:30 알람의 후반 체인)는 요일을 +1 shift → 올바른 다음날 새벽에 반복.

### 네이티브
**변경 없음.** `AlarmkitBridgeModule.swift`의 `scheduleAlarm`은 이미 `recurrence.mode`가 `weekly`/`daily`면 `.relative(.weekly([...]))`로 스케줄한다. RN이 `chainIndex 1+`에 `never`가 아닌 recurrence를 넘기면 그대로 동작한다. → 네이티브 빌드 산출물 변화 0.

---

## 4. 수정 대상 파일 (선언)

| 파일 | 변경 |
|---|---|
| `src/utils/alarmScheduler.ts` | `scheduleAlarmAt()` — `chainIndex 1+`의 recurrence를 멤버별 계산으로 교체. 헬퍼 함수 `chainMemberRecurrence` 추가 |

## 5. 안 건드릴 파일 (선언)

| 파일 | 이유 |
|---|---|
| `modules/alarmkit-bridge/ios/AlarmkitBridgeModule.swift` | 네이티브 무수정 — 이미 `.relative` 처리 |
| `modules/alarmkit-bridge/ios/OpenAppDismissIntent.swift` | A1 폐기 → 인텐트 무수정 |
| `App.tsx` | B(신호 만료 검사)는 후속 — 이번 범위 밖 |
| `src/constants/alarms.ts` | `nextAlarmOccurrenceTime` 등 무수정 |

---

## 6. 파급(영향) 보고

### iOS 회귀
- 변경 범위 = `alarmScheduler.ts` 1개 파일, `scheduleAlarmAt` 1개 함수의 recurrence 분기.
- **네이티브 빌드 산출물 변화 없음** → 네이티브 회귀면 0.
- `chainIndex 0` 경로 무변경 → 기존 정상 동작(주간 반복 알람 발화) 보존.
- `'once'` 알람 경로 무변경(`{mode:'never'}` 유지) → 1회성 알람 회귀 없음.
- 위험 지점: `weekly` 알람의 자정-크로스 요일 shift 계산 → 테스트로 검증 필수.

### 반대 플랫폼(Android) 영향
- `alarmScheduler.ts`는 `isAlarmKitAvailableSync()`(= `Platform.OS === 'ios'`) 게이트 안에서만 동작 → **Android 알람 엔진 경로와 분리됨, 영향 없음.**
- 단, 안드로이드 알람 엔진(`modules/alarmkit-bridge/android`)도 `recurrence` 파라미터를 받는다(`ScheduleAlarmParams`). 안드로이드는 자체 체인 미구현 상태이므로 이번 변경이 안드로이드 동작을 바꾸지 않음 — 그러나 향후 안드로이드 체인 구현 시 동일 `chainMemberRecurrence` 로직 재사용 가능(설계 정합성 ↑).
- **결론: Android 무영향. 근거 = iOS 전용 게이트 내부 + 안드로이드 체인 미구현.**

### AlarmKit 알람 수 한도
- 체인 멤버 수(`chainCount`) 변화 없음 — `.fixed` 50개 → `.relative` 50개, 개수 동일.
- 공식 한도 수치 미공개(웹서치 확인) → 현행 50개 가정 유지. 실기기에서 동일 요일 50개 `.relative` 등록 가능 여부는 검증 항목으로 둠.

---

## 7. 테스트 계획

1. 평일(weekly) 알람 등록 → 네이티브 로그에서 `chainIndex 1~N`이 `recurrence=weekly`로 스케줄되는지 확인
2. 잠금화면 슬라이드 중지 시뮬레이션 → **다음날** 체인이 살아있는지(2분 재발화) 확인 — 본 버그의 직접 재현/검증
3. 다음 주 동일 요일 자동 발화 확인 (체인 멤버가 OS 자동 반복되는지)
4. `'once'` 알람 → 체인이 여전히 `.fixed`, 1회만 발화 (회귀 없음)
5. 자정 크로스 알람(예: 23:30) → 후반 체인 멤버가 다음날 새벽 올바른 요일에 등록되는지
6. `daily` 알람 → 체인 멤버 매일 반복 확인
7. iOS E2E 회귀 (알람 등록/수정/삭제/토글)

---

## 8. 미해결 / 실기기 검증 필요

- AlarmKit이 동일 요일 50개 `.relative` 반복 알람을 모두 허용하는지 → 실기기 검증. 한도 초과 시 `chainCount` 축소 정책 재검토.
- 자정 크로스 시 `.relative` 반복의 정확성(DST 경계 포함).

---

## 9. 범위 밖 (후속 — Phase 2)

- **B — 잠금해제 후 미션 복원**: `open_app_dismiss` 신호 만료 검사(`appGroupSync.ts`). 오래된 죽은 알람의 미션이 뒤늦게 뜨는 문제. 별도 계획.
- A1(인텐트 재무장)은 A3 채택으로 폐기. A3로 불충분할 경우에만 재고.
