# Plan — iOS 밀어서 중지 체인 cancel 제거 + 미션 완료 재무장

- **작성**: 2026-05-22 / 플랜창
- **근거 문서**: `docs/plan-brief-2026-05-22-ios-slide-stop-chain-cancel.md` (구현창 진단)
- **태스크 ID**: FIX-2026-05-22-slide-stop-cancel
- **심각도**: 🔴 크리티컬 — 출시 앱(v1.8.5 live)의 핵심 기능(미션 유도 체인) 무력화
- **브랜치**: `feature/android-support` (iOS 전용 버그, 안드로이드 무관)
- **선행 관계**: `FIX-2026-05-22-chain-wipe`(syncAllAlarms 멱등화)와 **강하게 결합됨** — 본 문서 "1차 플랜과의 관계" 절 필독.

---

## 0. 검증 결과 (브리프 ↔ 코드 ↔ git, 1:1 대조)

| 브리프 주장 | 검증 방법 | 판정 |
|---|---|---|
| `open_app_dismiss` 핸들러가 `App.tsx:631`에서 `cancelAlarmsForEntity` 호출 | `App.tsx:625-643` 직접 확인 — `:631` 일치 | ✅ 확정 |
| `App.tsx:631`이 `#AlarmRepeat` 체인 도입 커밋(`314ba8b`)과 동일 커밋 | `git blame -L 628,632 App.tsx` → 전부 `314ba8b` (2026-05-13 "feat: v1.8 #AlarmRepeat") | ✅ 확정 — 자기모순 입증 |
| 미션 완료 cancel은 `AlarmScreen.tsx:301` `stopAudioAndVibration` 내부 | `AlarmScreen.tsx:295-302` 직접 확인 | ✅ 확정 |
| log.md 14:14:18 밀어서 중지 시점에 체인 16개 cancel | (실기기 로그, 브리프 3절) — 코드 경로상 정합 | ✅ 정합 |

**플랜창 추가 검증 (브리프 미기재)**:
- `cancelAlarm` 네이티브 동작 (`AlarmkitBridgeModule.swift:519-538`): 멤버 state가 `alerting`이면 `stop()`, `scheduled`면 **`cancel()`**. 즉 체인의 미발화 멤버는 `cancel()`로 **반복(recurrence)까지 완전 제거**된다. → 한 번 cancel하면 daily/weekly 반복이 죽는다 (4-3절 핵심 근거).
- `stopAudioAndVibration` 호출자는 **단 2개** — `enterResult`(`:529`), `autoDismissNoResult`(`:570`). 모든 dismiss 방식(tap/shake/camera/math/typing)이 이 둘 중 하나를 거친다. → 미션 완료 cancel 커버리지 OK (브리프 8절-②).
- 선행 수정 `FIX-2026-05-22-chain-wipe`는 **워킹트리에 미커밋 상태로 적용되어 있음** (`git blame` → `alarmScheduler.ts` syncAllAlarms 구간 "Not Committed Yet"). 본 플랜은 그 위에서 설계함.

**결론**: 브리프 진단 정확. 단, 브리프가 제안한 "App.tsx:631 제거" 단독으로는 **불완전**하다 — 미션 완료 시 daily/weekly 알람의 다음날 재무장이 끊긴다 (4-3절). 본 플랜은 재무장을 함께 설계한다.

---

## 1. 대상 파일

grep 기반 명시 열거.

| 파일 | 수정 대상 | 사유 |
|---|---|---|
| `App.tsx` | `open_app_dismiss` 핸들러 alarm 분기 (라인 628-632) | 밀어서 중지 시 체인 일괄 cancel 제거 (Part 1) |
| `src/screens/AlarmScreen.tsx` | `stopAudioAndVibration` 내 체인 cancel 직후 (라인 301 근처) | 미션 완료 시 daily/weekly 체인 재무장 추가 (Part 2) |

## 2. 수정하지 않는 파일 (명시 선언)

- `src/utils/alarmScheduler.ts` — `cancelAlarmsForEntity`·`scheduleAlarmMain`·`syncAllAlarms` **로직 변경 없음.** Part 2는 기존 `scheduleAlarmMain`을 *호출*만 한다.
- `OpenAppDismissIntent.swift` / `AlarmkitBridgeModule.swift` — 네이티브 변경 없음. `perform()`의 alerting `stop()`은 정상.
- `App.tsx`의 `open_app_dismiss` 라우팅(navigate 부분 `:633-642`)·콜드 스타트 `useEffect`·`alarm_main` 리스너 — 미접촉.
- `src/constants/alarms.ts` / `alarmkitMappingTable.ts` — 미접촉.
- 안드로이드 알람 엔진 관련 파일 전부 — 미접촉 (5-2절).

## 3. 레이어

**Logic 레이어 단독.** 앱 상태/제어신호 처리 로직(`App.tsx` 신호 핸들러)과 dismiss 처리 로직(`AlarmScreen.stopAudioAndVibration`)만 수정. UI 렌더링·Native API(Swift)·Config 미접촉.

---

## 4. 수정 내용 — 동작 사양 (코드 아님, 동작 명세)

### 4-1. Part 1 — 밀어서 중지 체인 cancel 제거 (`App.tsx`)

**현재 (버그)**: `open_app_dismiss` 신호 핸들러의 alarm 분기(`App.tsx:627` `if (alarmEntity)`)가 `:631`에서 `cancelAlarmsForEntity(alarmEntity.id)`를 호출 → 밀어서 중지하는 순간 그 알람의 체인 전체가 cancel된다.

**수정 후**: 라인 628-632(주석 `:628-630` + cancel `:631` + 로그 `:632`)를 **삭제**한다. `if (alarmEntity)` 블록은 **AlarmScreen으로 navigate만** 하고 체인은 건드리지 않는다 (`:633-642`의 navigate·return 로직 그대로 유지).

→ 밀어서 중지 = 사운드만 꺼짐(`OpenAppDismissIntent.perform()`의 alerting `stop()`). 체인의 나머지 멤버는 살아남아 2분 뒤 다음 멤버가 발화한다.

### 4-2. Part 2 — 미션 완료 시 daily/weekly 체인 재무장 (`AlarmScreen.tsx`)

**현재**: `stopAudioAndVibration`(`:273`)이 `:298-302`에서 `route.params.alarmEntityId`에 대해 `cancelAlarmsForEntity`로 체인 전체를 cancel한다. 재무장(reschedule) **없음.**

**수정 후**: `:301`의 `cancelAlarmsForEntity(alarmEntityIdParam)` **직후**, 다음 동작을 추가한다.
1. `loadAlarms()`로 알람 목록을 다시 읽어 `alarmEntityIdParam`에 해당하는 알람을 찾는다.
2. 그 알람에 대해 `scheduleAlarmMain(alarm)`을 호출한다.

`scheduleAlarmMain`의 기존 내부 가드가 타입별로 알아서 처리한다.
- **daily/weekly + enabled** → `nextAlarmOccurrenceTime`(= 다음 발화일) 기준으로 **새 체인을 즉시 재예약**. → 다음날(또는 다음 선택 요일) 정상 발화.
- **once** → `cancelAlarmsForEntity`가 내부에서 이미 `disableOnceAlarmIfNeeded`로 `enabled=false` 처리함 → `scheduleAlarmMain`은 `if (!alarm.enabled) return null`로 **no-op**. → 1회성 알람은 재무장 안 됨 (의도대로).

→ 미션 완료 = 오늘 남은 체인 cancel + 다음 발화분 즉시 재무장. **앱이 열려 있는 그 시점에 결정적으로 재예약**되므로, 콜드 스타트를 기다리지 않는다.

### 4-3. Part 2가 반드시 필요한 이유 (브리프 8절-③ 해소)

체인 멤버는 전부 `.relative` daily/weekly **반복** 등록이다(`#AlarmChainRecurring`). 그런데 0절 검증대로 `cancelAlarmsForEntity` → 네이티브 `cancel()`은 **반복까지 완전 제거**한다.

- Part 1만 적용하면 — 밀어서 중지는 체인을 안 죽이지만, **미션 완료 시 `cancelAlarmsForEntity`가 체인을 죽인다**(이건 의도대로 — 오늘 남은 알림 중지).
- 죽은 뒤 재무장이 문제다. 선행 수정 `FIX-2026-05-22-chain-wipe`로 `syncAllAlarms`가 멱등화되어 **콜드 스타트 시 체인을 재구성하지 않는다** (살아있는 체인 skip / 체인 없으면 schedule). 미션 완료 후 앱은 foreground 상태로 남고 콜드 스타트가 안 일어나므로, `syncAllAlarms`의 재예약(분기 C)이 트리거되지 않는다.
- 결과 — Part 1만 적용 시 **daily 알람이 미션 완료 다음날 발화하지 않는다.** (현 출시 앱도 사실상 같은 증상 — 첫날 발화 후 체인이 죽고 재무장 안 됨. 사용자 보고 "이후 재알람 없음"의 한 축.)

→ 재무장은 "콜드 스타트 시 syncAllAlarms"가 아니라 **"미션 완료 시점에 즉시"** 일어나야 한다. 그래서 Part 2는 선택이 아니라 **필수**다.

### 4-4. 수정 후 전체 흐름

| 이벤트 | 동작 |
|---|---|
| 알람 발화 (chainIndex N) | AlarmKit alerting |
| 밀어서 중지 | `perform()`이 alerting 멤버만 `stop()`. 앱 진입 → AlarmScreen navigate. **체인 미손상** (Part 1) |
| 콜드 스타트 `syncAllAlarms` | 체인 살아있음 → skip (선행 수정) |
| 사용자가 무시·잠금 유지 | 2분 뒤 chainIndex N+1 발화 → 다시 깨움 ✅ |
| 미션 완료 (daily/weekly) | `cancelAlarmsForEntity`(오늘 체인 정리) + `scheduleAlarmMain`(다음 발화분 재무장) ✅ |
| 미션 완료 (once) | `cancelAlarmsForEntity` → `disableOnceAlarmIfNeeded`로 disable → 재무장 no-op ✅ |
| 다음날 | 재무장된 새 체인 정상 발화 ✅ |

---

## 5. 영향 범위

### 5-1. 영향받는 화면 / 상태
- **`open_app_dismiss` 신호 핸들러** (`App.tsx`): 밀어서 중지 후 동작이 "cancel + navigate" → "navigate만"으로 바뀜. navigate 대상·파라미터 불변.
- **`stopAudioAndVibration`** (`AlarmScreen`): dismiss 처리에 reschedule 1건 추가. `enterResult`·`autoDismissNoResult` 두 호출자 모두 영향 — 둘 다 "미션 완료/종료 후" 시점이라 재무장이 옳다.
- `enterResult` 흐름에서 `stopAudioAndVibration`이 광고 표시 전에 `await`된다. `scheduleAlarmMain`(체인 최대 50건 예약)이 추가되어 광고 직전 **0.5~1초 지연 가능**. 허용 범위. QA에서 체감 지연 발견 시 reschedule을 fire-and-forget(`.catch`)로 전환하는 옵션 — Build 판단.

### 5-2. iOS / Android 차이
- **안드로이드 영향 0.**
  - Part 1의 `open_app_dismiss` / `OpenAppDismissIntent`는 iOS 전용 경로.
  - Part 2가 추가 호출하는 `scheduleAlarmMain`은 첫 줄 `isAlarmKitReady()`(iOS+authorized)로 가드 → 안드로이드에서 즉시 no-op. `stopAudioAndVibration`은 공용 코드지만 추가 라인이 안드로이드에서 무해(가드 + `.catch`).
  - 안드로이드 알람 엔진은 별도(`AlarmManager`+`AlarmService`) — 본 수정 미접촉.

### 5-3. 앱 상태(foreground / background / killed)별 영향
- 밀어서 중지는 cold/warm 무관하게 `open_app_dismiss` 핸들러를 항상 거침 → Part 1 효과 동일.
- Part 2의 재무장은 미션 완료 시점(앱 foreground active) — 가장 안정적인 상태에서 실행됨.

---

## 6. 검증 방법

실기기 + iOS 26 + dev/Release 빌드 필수 (AlarmKit은 Expo Go·시뮬레이터 불가). 본 수정은 순수 TS — 네이티브 리빌드 불필요, 핫리로드 가능.

### 6-1. 핵심 — 밀어서 중지 후 체인 생존
1. daily 알람 설정 (예: 3분 뒤).
2. 발화 → 밀어서 중지 → **미션 안 하고 잠금 유지.**
3. +2분 후 다음 체인 멤버가 발화하면 **PASS.** (현재는 발화 안 함)
4. native log: 밀어서 중지 시점에 `cancelAlarm 진입` 폭주가 **없어야** 함.

### 6-2. 핵심 — 미션 완료 후 종료 + 다음날 재무장
1. 발화 → 앱 진입 → 미션 완료.
2. 미션 완료 직후 잔존 체인 발화 0건 확인 (오늘 더 안 울림).
3. native log: 미션 완료 시점에 `stopAudioAndVibration chain cancel` **직후** `scheduleAlarm` 로그(체인 재예약)가 찍히는지 확인.
4. 다음날 같은 시각 알람이 정상 발화하는지 확인. (실기기 1일 경과 테스트 — 또는 알람 시각을 다음날 근접 시각으로 잡아 단축 검증.)

### 6-3. 회귀 테스트 (출시 앱 — 필수)
- once 알람 미션 완료 → 종료 + **다음날 재발화 안 함** 확인 (disable 정상).
- daily/weekly 알람 생성·시각 편집·삭제·on/off 토글 정상.
- 미션 dismiss 방식 5종(tap/shake/camera/math/typing) 각각 — 미션 완료 시 체인 cancel + 재무장 동작 확인.
- 루틴 시작(알람 충돌) → 종료 → 알람 복원 정상.

### 6-4. 플랫폼
- iOS 필수. 안드로이드는 코드 경로 미진입(5-2) — 알람 dismiss 회귀만 1회 확인 + 빌드 컴파일 확인.

---

## 7. 주의사항

① **v1/v2 범위**: 출시 v1.8.5 크리티컬 버그 수정. 신규 기능 아님. v2 침범 없음.

② **선행 수정과의 결합**: `FIX-2026-05-22-chain-wipe`(syncAllAlarms 멱등화)가 적용된 상태를 전제로 한다. 그 수정이 콜드 스타트 재예약을 없앴기 때문에 Part 2(즉시 재무장)가 필수가 됐다. 두 수정은 함께여야 정합한다 — "1차 플랜과의 관계" 절 참조.

③ **출시 앱 회귀 위험**: 6-3 회귀 테스트 필수. 특히 once 알람이 미션 완료 후 재무장되지 않는지(=disable 정상) 반드시 확인.

④ **`AlarmScreen.tsx` import 추가**: Part 2는 `scheduleAlarmMain`, `loadAlarms` 호출이 필요. `AlarmScreen.tsx`는 현재 `cancelAlarmsForEntity`만 import(`:32`) → `scheduleAlarmMain`(`alarmScheduler`)·`loadAlarms`(`constants/alarms`) import 추가 필요.

⑤ **체인 cancel은 미션 완료 경로에만 남는다**: Part 1 적용 후 `cancelAlarmsForEntity`의 알람 호출 경로는 — 미션 완료(`stopAudioAndVibration`), 알람 편집/삭제/토글(AlarmList/AlarmEdit), 루틴 충돌(RoutineList/HomeScreen). 전부 "의도적 종료" 경로. 밀어서 중지만 제거된다.

⑥ **지시 범위 엄수**: App.tsx는 628-632 삭제만, AlarmScreen은 301 직후 재무장 추가만. 주변 코드 개선·리팩토링 금지 (CLAUDE.md "Surgical Changes").

---

## 8. 배포 전제조건

- **없음.** `app.json`·`eas.json` 변경 없음. 순수 TS — 네이티브 리빌드 불필요.
- 단, 선행 수정 `FIX-2026-05-22-chain-wipe`가 워킹트리 미커밋 상태다. 배포창은 **두 수정을 별도 커밋으로 분리**할 것 (개별 롤백 가능하도록 — CLAUDE.md 시맨틱 커밋).

---

## Pre-Modify 체크리스트

- [x] 대상 파일 목록 확정 (grep 기반) — `App.tsx`, `AlarmScreen.tsx`
- [x] 범위 외 파일 미접촉 선언 — 2절
- [x] 현재 동작 기능 회귀 없음 분석 — 5절 + 6-3
- [x] v1/v2 경계 확인 — v1 버그 수정
- [x] 4개 레이어 중 Logic 단독 접촉 선언 — 3절

## 반복실수 점검 (플랜 시점)

| # | 실수 패턴 | 점검 결과 |
|---|---|---|
| 1 | v2 기능을 v1에 | 해당 없음 — 크리티컬 버그 수정 |
| 2 | 관련 파일 누락 | grep으로 `cancelAlarmsForEntity`·`stopAudioAndVibration`·`scheduleAlarmMain` 호출자 전수 확인. 브리프가 놓친 재무장 단절을 발견·반영 |
| 3 | iOS/Android 분기 누락 | 5-2에 명시 — 안드로이드 영향 0 |
| 4 | 권한 설정 누락 | 권한 변경 없음 — 8절 |
| 5 | 앱 상태별 동작 누락 | 5-3에 cold/warm/killed·foreground 명시 |
| 6 | 레이어 침범 | Logic 단독 — 3절 |

---

## 빌드창 핸드오프

```
[Build window handoff]
Task: FIX-2026-05-22-slide-stop-cancel — 밀어서 중지 체인 cancel 제거 + 미션 완료 재무장
Target files:
  - App.tsx — open_app_dismiss 핸들러 alarm 분기에서 라인 628-632 삭제
              (#AlarmRepeat 주석 + cancelAlarmsForEntity 호출 + LAControl-DBG 로그).
              navigate·return 로직(:633-642)은 그대로.
  - src/screens/AlarmScreen.tsx — stopAudioAndVibration 의 cancelAlarmsForEntity(:301) 직후,
              loadAlarms()로 해당 알람 조회 → scheduleAlarmMain(alarm) 호출 추가.
              scheduleAlarmMain·loadAlarms import 추가 필요.
Files not modified: alarmScheduler.ts(로직), OpenAppDismissIntent.swift, AlarmkitBridgeModule.swift,
                    alarms.ts, alarmkitMappingTable.ts, 안드로이드 알람 엔진 — 전부 미접촉
Layer: Logic
Notes:
  - Part 1만으로는 불완전. Part 2(재무장) 필수 — 미적용 시 daily 알람이 미션 완료 다음날 안 울림.
  - 재무장은 scheduleAlarmMain 의 내부 가드에 위임 — once 는 자동 no-op(disable됨), daily/weekly 만 재예약.
  - 선행 수정 FIX-2026-05-22-chain-wipe(syncAllAlarms 멱등화) 적용 상태 전제.
  - 지시 범위 외 수정 금지.
Verification: 6절 — 6-1 밀어서 중지 후 체인 생존, 6-2 미션 완료 후 재무장,
              6-3 회귀(once 재무장 안 됨·CRUD·dismiss 5종·루틴 복원), 안드로이드 컴파일+dismiss 확인
Deployment prerequisites: 없음 (순수 TS). 단 선행 수정과 별도 커밋으로 분리할 것.
```

---

## 1차 플랜과의 관계 (FIX-2026-05-22-chain-wipe)

두 수정은 **하나의 버그("밀어서 중지하면 알람이 다시 안 울림")의 두 축**이며 결합되어야 정합한다.

| | 1차 (chain-wipe) | 2차 (slide-stop-cancel, 본 문서) |
|---|---|---|
| 죽이는 주체 | `syncAllAlarms` 콜드 스타트 일괄 wipe | `App.tsx:631` 밀어서 중지 cancel |
| 수정 | syncAllAlarms 멱등화 (살아있는 체인 skip) | App.tsx:631 제거 + 미션 완료 재무장 |
| 결합점 | 1차가 콜드 스타트 재예약을 없앰 → 2차에서 **미션 완료 시 즉시 재무장**이 필수가 됨 |

→ 1차의 `syncAllAlarms` 분기 C(체인 없는 알람 신규 예약)는 이제 **안전망**으로만 남는다 (정상 흐름의 재무장은 2차 Part 2가 담당). 1차 플랜 문서 수정은 불필요 — 분기 C는 안전망으로서 여전히 유효.

배포 순서 권장 — 1차·2차를 **별도 커밋**으로, 함께 배포. 둘 중 하나만 배포하면 정합 깨짐.

---

## 후속 조사 (본 수정 범위 밖)

### 후속 1 — AlarmScreen 잠금 중 mount → autoDismissNoResult 오발동
- `.foreground(.immediate)`가 잠금 상태에서 AlarmScreen을 mount시키고 미션 타임아웃 시 `autoDismissNoResult` → `stopAudioAndVibration` → 오늘 체인 cancel.
- 단 본 수정의 Part 2 덕에 **다음날 재무장은 보장**된다 — 손실은 "오늘 남은 알림"뿐으로 축소됨.
- 1차 플랜 "후속 1"과 동일 건. native log로 잠금 중 mount 실증 후 가드 강화 별도 검토.

### 후속 2 — AlarmKit 50개 한도 초과 (1차 브리프 부록)
- 다중 알람 시 체인 예산 합이 50 초과 → 후미 멤버 OS 드롭. 별도 플랜.

---

## 부록 — 알기 쉬운 설명

- **체인이 뭐냐**: 알람이 한 번 울리고 끝이 아니라, 2분마다 다시 울리는 "줄"(최대 50번). 미션을 할 때까지 계속 깨운다. 이 앱의 핵심이다.
- **무엇이 문제였나**: 알람을 밀어서 끄는 순간, 코드가 그 줄을 통째로 잘랐다(`App.tsx:631`). 그래서 2분 뒤 다시 울려야 할 게 안 울렸다. git로 추적하니 — 체인을 처음 만든 그 작업에서, 만든 사람이 "밀어서 껐는데 2분 뒤 또 울리네? 버그네" 하고 줄을 자르게 해버렸다. 사실 그 "또 울림"이 핵심 기능인데 버그로 착각한 자기모순이다.
- **그런데 그것만 고치면 안 된다**: 줄을 자르는 코드는 두 군데다. ① 밀어서 중지(잘못됨 — 없앤다), ② 미션 완료(맞음 — 남긴다). ②를 남기면 — 미션을 끝낸 날, 줄이 잘린다. 그런데 알람 줄은 "매일 반복"으로 OS에 박혀 있어서, 한 번 자르면 *내일치 반복까지* 사라진다. 그래서 ②에서 줄을 자른 직후, **곧바로 내일 줄을 새로 깔아줘야** 한다. 안 그러면 미션 끝낸 다음날 알람이 안 울린다.
- **어떻게 고치나**: ① 밀어서 중지에서 "줄 자르기"를 없앤다. ② 미션 완료에서는 줄을 자르되, *바로 그 자리에서 다음날 줄을 새로 깐다*. 결과 — 밀어서 꺼도 2분 뒤 또 울리고, 미션을 해야 비로소 끝나고, 다음날 또 정상으로 울린다. 원래 의도대로.
- **iOS 영향 여부**: 이 버그도 수정도 **iOS 전용**. 안드로이드는 알람 엔진이 따로라 영향 0.
