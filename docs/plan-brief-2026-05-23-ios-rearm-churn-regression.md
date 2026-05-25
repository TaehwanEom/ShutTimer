# Plan Brief — iOS: 미션 재무장 churn 회귀 (FIX-2026-05-22-slide-stop-cancel Part 2)

- **작성**: 2026-05-23 / 구현창 (실기기 QA log.md 분석)
- **대상**: 플랜창 — `FIX-2026-05-22-slide-stop-cancel` Part 2 재검토
- **심각도**: 🔴 크리티컬 — 단, **미배포.** QA 단계에서 발견 → 출시 전 차단됨. 커밋 `49eb090`은 워킹트리/로컬에만 존재.
- **회귀 출처**: 커밋 `49eb090` (FIX-2026-05-22-slide-stop-cancel) **Part 2** — `AlarmScreen.tsx` `stopAudioAndVibration` 재무장 추가. **구현창이 만든 코드의 회귀임.**

---

## 1. 한 줄 요약

Part 2(미션 완료 시 체인 재무장)가 — `stopAudioAndVibration`이 *미션 완료*뿐 아니라 *autoDismiss(미션 미완료)* 에서도 호출되는 탓에 — **재무장이 반복 실행(churn)**된다. 그 결과 추적 안 되는 orphan 알람이 누적되고, 정상 cancel/토글로 안 꺼진다.

---

## 2. 배경 — 두 수정의 현재 상태

| 수정 | 커밋 | 상태 |
|---|---|---|
| 1차 syncAllAlarms 멱등화 | `f82d3af` | 정상. 본 회귀와 무관 (3절 증거상 미연루 — 단 플랜이 상호작용 재확인 권장) |
| 2차 Part 1 — 밀어서 중지 cancel 제거 (App.tsx) | `49eb090` | 정상으로 보임 |
| 2차 Part 2 — 미션 완료 재무장 (AlarmScreen.tsx) | `49eb090` | ❌ **본 회귀.** churn 발생 |

본 브리프는 **Part 2만** 대상. Part 1·1차는 유지.

---

## 3. QA 증거 (실기기, log.md, 2026-05-23 KST)

테스트: 알람 `a_1779459001117_hpqv2c`를 00:31(12:31 AM)에 맞추고 시나리오 1(밀어서 중지 → 미션 미완료) 진행.

### 타임라인 (KST)

| 시각 | 이벤트 |
|---|---|
| 00:35 / 00:37 / 00:39 / 00:43 | 체인 멤버 발화 (2분 간격) — 시나리오 1 정상 동작 |
| 00:35:27 | `scheduleAlarm chainIndex=0` — **체인 재무장 #1** (fireAt=내일 00:31) |
| 00:39:35 | `stopAudioAndVibration 진입` → `chain cancel` → **재무장 #2** |
| 00:41:44 | `cancelAlarm 진입` ×~25 (state=scheduled → cancel) |
| 00:43:30 | `stopAudioAndVibration 진입` → `chain cancel` (`metas.count=41`) → **재무장 #3** |

→ **8분 사이 체인 재무장 3회.** 각 재무장 = 25멤버 (`chainCount=floor(50/activeCount)`, activeCount=2). 3회 모두 `fireAt=1779550260000` (= 내일 00:31 KST).

### 결정적 수치

- `listAlarms count=66` (프레임워크 등록 알람)
- `stopAudioAndVibration metas.count=41` (매핑 테이블)
- → **66 − 41 = ~25개 orphan** — AlarmKit에 등록됐으나 매핑 테이블에 없음.

### 사용자 영향 (실제 발생)

- 알람이 계속 울림. 앱 강제 종료해도 안 멈춤 (AlarmKit은 OS 등록 — 정상).
- **알람 토글 OFF → 멈춤.** 단 토글 OFF의 `cancelAlarmsForEntity`는 *매핑된 것만* cancel → orphan ~25개 잔존 → **다음날 00:31 재발화 위험.**

---

## 4. 근본 원인 — 2가지

### 원인 A — 재무장 트리거가 너무 넓다

`stopAudioAndVibration` 호출자는 2개 (`AlarmScreen.tsx:529` `enterResult`, `:570` `autoDismissNoResult`).
Part 2는 `stopAudioAndVibration` 안에 재무장(`scheduleAlarmMain`)을 넣었다 → **두 경로 모두에서 재무장.**

- `enterResult` = 미션 **완료** → 재무장 옳음.
- `autoDismissNoResult` = 미션 **미완료** auto-dismiss → 재무장하면 안 됨.

플랜 `plan-2026-05-22-ios-slide-stop-chain-cancel-fix.md` 5-1절이 *"둘 다 미션 완료/종료 후 시점이라 재무장이 옳다"* 고 단정했는데 — **그 가정이 틀렸다.** 시나리오 1(미션 일부러 미완료)에선 `autoDismissNoResult`가 반복 발동 → 재무장 churn.

### 원인 B — `cancelAlarmsForEntity`가 orphan을 못 잡는다

`cancelAlarmsForEntity` (`alarmScheduler.ts:205-218`)는 `listAllAlarmMetadata()`의 *매핑된* 멤버만 순회 cancel.
churn 과정에서 프레임워크 알람과 매핑 테이블이 어긋남 (66 vs 41) → **매핑에 없는 ~25개는 cancel 대상에서 누락** → 누적. 토글 OFF·미션 완료로도 안 꺼짐.

플랜 8절 검증항목 #1 *"미션 완료 cancel이 체인 전 멤버(최대 50개)를 확실히 죽이는가"* — **QA 결과: 아니오.** orphan 잔존 확인.

---

## 5. 플랜이 답해야 할 핵심 질문

1. **`autoDismissNoResult`의 정확한 의미** — 코드 확인 필요. "미션 미완료 자동 종료"가 맞나? 맞다면:
   - 재무장하면 안 됨 (원인 A).
   - 더 나아가 — `autoDismissNoResult`가 `stopAudioAndVibration`을 호출해 `cancelAlarmsForEntity`로 **체인을 cancel하는 것 자체가 옳은가?** 미션 미완료면 체인은 계속 살아서 2분 뒤 또 울려야 한다. autoDismiss에서 체인을 cancel하면 시나리오 1이 깨진다. (단 QA상 체인은 계속 울렸음 — cancel이 race로 부분 실패했을 가능성. 플랜이 규명할 것.)
2. **재무장의 올바른 위치** — `enterResult`(진짜 미션 완료)에서만 재무장하도록. `stopAudioAndVibration` 공통 경로가 아니라 호출자별 분기.
3. **orphan 회수** — `cancelAlarmsForEntity`가 매핑 누락분(프레임워크엔 있으나 매핑에 없는 entity 알람)까지 잡도록 보강하거나, 매핑 desync 자체를 막을 것. `cleanupGhostAlarms`(콜드 스타트)가 안전망이지만 — 발화 시점엔 못 막음.
4. **1차 수정과의 상호작용** — 증거상 1차(syncAllAlarms 멱등화)는 미연루로 보이나, 재무장 churn + syncAllAlarms 분기 C(체인 없는 알람 신규 예약)의 상호작용을 재확인.

---

## 6. 수정 방향 후보 (플랜이 결정)

- **A. fix-forward (권장)**: 재무장을 `stopAudioAndVibration`에서 빼서 `enterResult`(미션 완료)에만 둠. `autoDismissNoResult`는 재무장 안 함. + `cancelAlarmsForEntity` orphan 회수 보강.
- **B. revert Part 2**: `49eb090`의 Part 2만 되돌림. 단 — Part 2가 막던 *"daily 알람 미션 완료 다음날 재무장 단절"* 이 부활. 단독 revert 불가, 재설계 필요.
- Part 1(App.tsx 밀어서 중지 cancel 제거)·1차는 유지.

---

## 7. 영향 / 회귀

- **미배포** — `49eb090` 로컬 커밋만. 프로덕션 영향 없음. QA가 출시 전 차단.
- 수정 파일 예상: `AlarmScreen.tsx`(재무장 위치), 필요 시 `alarmScheduler.ts`(`cancelAlarmsForEntity` orphan 보강). 플랜이 확정.
- 출시 앱 회귀 테스트 필수: 미션 완료 후 daily 다음날 재무장 / 시나리오 1 반복 후 orphan 누적 0 / 토글·삭제로 완전 정지.

---

## 8. 크로스플랫폼

- iOS 전용 (AlarmKit / `stopAudioAndVibration`은 AlarmKit 경로). 안드로이드 영향 0 — `scheduleAlarmMain`은 `isAlarmKitReady` 가드.

---

## 9. 검증 방법

- 시나리오 1 (밀어서 중지 → 미션 미완료) **반복 수행** 후 `listAlarms count`이 매핑 `metas.count`와 일치하는지 (orphan 0).
- 미션 완료 시에만 재무장 `scheduleAlarm` 로그가 찍히고, autoDismiss 시엔 안 찍히는지.
- 토글 OFF / 알람 삭제 후 `listAlarms count`이 0(또는 해당 entity 0)으로 떨어지는지.

---

## 10. 참조

| 항목 | 위치 |
|---|---|
| 회귀 코드 (Part 2 재무장) | `49eb090` / `AlarmScreen.tsx` `stopAudioAndVibration` 내 `scheduleAlarmMain` 호출 |
| `stopAudioAndVibration` 호출자 | `AlarmScreen.tsx:529` `enterResult`, `:570` `autoDismissNoResult` |
| `cancelAlarmsForEntity` (매핑만 cancel) | `alarmScheduler.ts:205-218` |
| `cleanupGhostAlarms` (orphan 안전망) | `alarmScheduler.ts:256-280` |
| 2차 플랜 (현 회귀의 출처 설계) | `docs/plan-2026-05-22-ios-slide-stop-chain-cancel-fix.md` (특히 5-1절 가정 오류, 8절 검증항목 #1) |
| QA 로그 | `log.md` (실기기, 2026-05-23 00:31~00:43 KST 구간) |

---

## 부록 — 알기 쉬운 설명

- **무엇이 문제냐**: 미션을 끝내면 다음날 알람을 다시 깔아주는 코드(Part 2)를 넣었다. 그런데 이 코드가 — 미션을 *끝냈을 때*만이 아니라, 미션을 *안 하고 화면이 자동으로 닫힐 때*도 같이 돈다. 시나리오 1(일부러 미션 안 함)을 하면 이게 계속 반복돼서, 알람 줄이 자꾸자꾸 새로 깔린다.
- **왜 안 꺼지냐**: 줄을 새로 깔 때마다 옛 줄을 지워야 하는데, 지우는 코드는 "장부(매핑 테이블)에 적힌 것"만 지운다. 반복되며 장부와 실제(OS 등록분)가 어긋나서 — 장부에 없는 유령 알람 ~25개가 남는다. 이건 앱에서 알람을 꺼도, 토글을 내려도 안 지워진다.
- **어떻게 고치나**: 재무장은 *진짜 미션 완료*에서만 돌게 한다. 그리고 줄 지우는 코드가 장부에 없는 유령까지 훑어 지우게 한다.
- **iOS 영향 여부**: iOS 전용. 안드로이드 영향 0.
