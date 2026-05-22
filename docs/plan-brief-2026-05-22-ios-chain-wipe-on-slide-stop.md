# Plan Brief — iOS 알람 체인 소멸 (밀어서 중지 + 잠금 유지 시)

- **작성**: 2026-05-22 / 구현창 진단 (코드 경로 추적 완료)
- **대상**: 플랜창 — 본 문서 기반으로 수정 설계
- **심각도**: 🔴 **크리티컬** — 출시된 앱(v1.8.5, App Store live, 실사용자)의 핵심 기능 실패
- **브랜치**: `feature/android-support` (단, 본 버그는 iOS 전용 / 안드로이드 무관)

---

## 1. 한 줄 요약

알람이 울린 뒤 사용자가 **밀어서 중지**를 하고 **페이스ID 잠금 해제를 하지 않으면**, 그 알람의 **재알람 체인 전체(2분 간격 최대 50회)가 즉시 소멸**한다. 사용자는 "알람 한 번 껐다"고만 인지하지만, 뒤에서 체인이 통째로 취소되어 다시 울리지 않는다.

---

## 2. 증상 (사용자 보고)

- **시나리오 A (원래 사건)**: AM 6:50 알람 발화 → 아이폰 기본 알람처럼 보이는 전체화면 → 밀어서 중지 → 폰 잠금 유지(페이스ID 안 함) → 이후 재알람 전혀 없음.
- **시나리오 B (재현용 세팅)**: PM 9:01에 `once` 알람 1개 설정 → 발화 → 밀어서 중지 → 잠금 유지 → 추가 알람 없음.
- **공통 조건**: "밀어서 중지 + 잠금 해제 안 함" → 체인 끊김.

---

## 3. 영향도 — 왜 크리티컬

ShutTimer의 핵심 가치는 "한 번에 못 끄게, 계속 깨워서 못 일어나는 사람을 깨운다". 그 본체가 **체인**(2분 간격, 최대 50회 = 100분, `#AlarmChainEager`).

이 버그는 체인을 **가장 중요한 순간에 정확히 실패**시킨다:

- 아침, 잠금 상태, 반쯤 잠든 사용자가 반사적으로 밀어서 끔 → 체인 소멸 → 다시 잠듦 → 오버슬립.
- 즉 **정상적으로 일어난 사용자가 아니라 "끄고 다시 잘 사용자"한테서 체인이 죽는다.** 앱 존재 이유의 정면 실패.
- 출시된 앱(v1.8.5 App Store live) — 실사용자 영향 진행 중.

---

## 4. 근본 원인 — 코드 경로 (단계별, 전부 실제 코드 확인 완료)

### 4-1. 밀어서 중지 → 앱 강제 launch

`OpenAppDismissIntent`는 알람 alert의 stopIntent로 결합됨. 사용자가 슬라이드-투-스톱하면 `perform()` 실행.

`modules/alarmkit-bridge/ios/OpenAppDismissIntent.swift:48-58`
```swift
@available(iOS 26.0, *)
struct OpenAppDismissIntent: LiveActivityIntent {
    static var supportedModes: IntentModes = [.foreground(.immediate)]
    static var authenticationPolicy: IntentAuthenticationPolicy = .alwaysAllowed
```
- `.foreground(.immediate)` → 슬라이드-투-스톱 시 **앱을 foreground로 강제 launch**.
- `.alwaysAllowed` → **잠금 해제(페이스ID) 없이도** 인텐트 실행 + launch 진행.
- `perform()` 본체(`:60-85`)는 `.alerting` 상태 알람만 stop함 → **체인 자체는 perform()이 직접 죽이지 않음** (여기까진 정상).

### 4-2. 밤새 죽은 앱 → 콜드 스타트

알람을 맞춰두고 자는 동안 앱은 미사용 → iOS가 메모리에서 종료(kill). 아침 발화 시점에 앱은 **죽어 있음**. 4-1의 launch = **콜드 스타트**.

### 4-3. 콜드 스타트 → `syncAllAlarms()` 무조건 실행

`App.tsx:755-768` — `AppNavigator` mount 시 `useEffect(() => {...}, [])`:
```js
(async () => {
  try {
    await syncAllAlarms();      // ← 콜드 스타트마다 무조건
    await cleanupGhostAlarms();
  } catch (e) { ... }
})();
```

### 4-4. `syncAllAlarms()` — 체인 전체 cancel 후 재예약

`src/utils/alarmScheduler.ts:230-249`
```js
export async function syncAllAlarms(): Promise<void> {
  if (!isAlarmKitAvailableSync()) return;
  // 1. stale 'alarm_main' mapping cleanup
  const allMeta = await listAllAlarmMetadata();
  for (const meta of allMeta) {
    if (meta.type === 'alarm_main') {
      await AlarmkitBridge.cancelAlarm(meta.alarmId).catch(() => {});  // ← 체인 50개 전부 cancel
      await deleteAlarmMetadata(meta.alarmId).catch(() => {});
    }
  }
  // 2. enabled=true 알람 재예약
  const alarms = await loadAlarms();
  for (const alarm of alarms) {
    if (alarm.enabled) {
      await scheduleAlarmMain(alarm).catch(() => {});
    }
  }
}
```
- **1단계**: 모든 `alarm_main` 알람 cancel → 오늘 남아있던 재알람 멤버(21:03, 21:05 … / 6:52, 6:54 …) **전멸**.
- **2단계**: `scheduleAlarmMain` → `nextAlarmOccurrenceTime` 기준 재예약 (다음 항목 참조).

---

## 5. 정확한 동작 — once / daily 모두 "오늘 체인 소멸, 내일 재구성"

`nextAlarmOccurrenceTime` (`src/constants/alarms.ts:44-62`) 검증 결과:
```js
if (alarm.repeat === 'once' || alarm.repeat === 'daily') {
  for (let offset = 0; offset < 8; offset++) {
    const d = buildAt(offset);                  // 오늘+offset일, HH:MM
    if (d.getTime() > now.getTime()) return d.getTime();
  }
  return null;
}
```
- **`once`와 `daily`를 동일 처리** — 오늘 시각이 이미 지났으면 **내일** 같은 시각 반환. (null 아님.)

→ `syncAllAlarms` 2단계 재예약 결과:
| 알람 타입 | 결과 |
|---|---|
| `daily` (아침 6:50) | **내일 6:50**로 체인 재구성. 오늘 남은 재알람 전부 소멸. 내일은 정상. |
| `once` (PM 9:01) | **내일 9:01**로 체인 재구성. 오늘 남은 재알람 전부 소멸. (+ 6번 부수 버그) |

**핵심**: 두 타입 모두 — 밀어서 중지하는 그 순간 콜드 스타트가 일어나 **오늘 진행 중인 체인이 통째로 날아간다.** 재구성은 *다음 날짜*만 깔기 때문에 오늘의 나머지 재알람은 복구되지 않는다.

---

## 6. 부수 버그 — `once` 알람이 다음날 다시 울림

`syncAllAlarms` 실행 시점에 `once` 알람은 아직 `enabled=true`다. `disableOnceAlarmIfNeeded`는 **마지막 체인(chainIndex ≥ 49) 발화 시에만** 호출되기 때문 (`App.tsx:375-378`):
```js
const curIdx = meta.chainIndex ?? 0;
if (curIdx >= ALARM_CHAIN_MAX_INDEX) {        // chainIndex 49 일 때만
  await disableOnceAlarmIfNeeded(meta.entityId).catch(() => {});
}
```
→ chainIndex 0 발화 후 밀어서 중지 시점엔 `once` 알람이 여전히 `enabled=true` → `syncAllAlarms` 2단계가 `once` 알람을 **내일 시각으로 재예약** → `once` 알람이 다음날 또 울림. (1회성 의미 위반.)

---

## 7. 신뢰도 — 확정 / 미확정

- **확정**: 4-1~4-4, 5, 6의 코드 경로는 전부 실제 파일에서 한 줄씩 확인함. 로그 추측 아님.
- **미확정 (단 1곳)**: 잠금 상태에서 `.foreground(.immediate)` launch가 *즉시* 일어나는지 vs *잠금 해제 시점까지 지연*되는지는 iOS 플랫폼 동작이라 코드로 단정 불가.
  - 즉시 launch면 → 슬라이드 직후 체인 소멸 (증상과 일치).
  - 지연이면 → 잠금 해제할 때까지 체인 생존, 해제 순간 소멸.
  - 어느 쪽이든 **"앱이 콜드 스타트하면 체인이 죽는다"는 결론은 동일**. launch 타이밍만 다름.
- **100% 확정선**: 발화 직후 native log(App Group `native_debug_log_v1`)에 `cancelAlarm 진입` / `OpenAppDismiss-DBG perform 진입` 줄의 타임스탬프 → syncAllAlarms 발동 시점 확정 가능. (필수는 아님 — 경로 자체는 의심 여지 없음.)

---

## 8. 같은 클래스의 회귀 — 일괄-cancel 경로 전수 점검 필요

`App.tsx:380-382`에 이미 *유사한* 회귀를 막은 흔적이 있음:
```js
// v1.8 #AlarmChainRevive — background AlarmScreen mount 차단 (= 잠금 그대로 두면 30초 missionDuration
//   만료 → cancelAlarmsForEntity → chain 일괄 cancel 회귀). ...
if (AppState.currentState === 'background') return;
```
→ "체인을 일괄 cancel하는 경로"가 여러 개고, 하나씩 터지고 있다는 신호. **플랜은 아래 경로를 전부 점검해야 한다:**

1. **`syncAllAlarms`** (`alarmScheduler.ts:230`) — 이번 버그. **미가드.** 콜드 스타트마다 무조건.
2. **`cancelAlarmsForEntity`** (`alarmScheduler.ts:205`) — `#AlarmChainRevive`로 background mount 경로는 막음. 다른 진입점(앱 편집/삭제 등) 영향 확인 필요.
3. **AlarmScreen background mount → 미션 타임아웃 → `cancelAlarmsForEntity`** — `.foreground(.immediate)`가 잠금 상태에서도 `AppState`를 `active`로 만들면 `:383` 가드(`background return`)를 우회할 수 있음 → 잠금 상태에서 AlarmScreen mount → 사용자가 미션 못 함 → 30초 만료 → 체인 cancel. **이 우회 가능성도 검증 대상.**

---

## 9. 수정 시 제약 (설계는 플랜창 몫 — 여기선 경계만)

- `syncAllAlarms`의 **원래 목적은 보존**해야 함: ① 이전 빌드의 stale `alarm_main` mapping cleanup, ② 앱 닫힌 동안 사용자가 한 알람 편집 반영. 통째로 제거 불가.
- 핵심 요구: **"진행 중인 체인"을 `syncAllAlarms`가 건드리지 않도록.** "진행 중" 정의 = `chainBaseFireAt`이 오늘이고 일부 멤버가 이미 발화했거나 현재 `alerting`인 알람.
- 재예약을 `nextAlarmOccurrenceTime`(다음 정규 시각)이 아니라 **현재 chainIndex부터 이어서** 해야 할 수도 있음 — 설계 옵션.
- 출시 앱 — **iOS 회귀 위험**. 알람 생성/편집/삭제/토글의 정상 경로에 회귀 없어야 함.

---

## 10. 크로스플랫폼 영향

**안드로이드 영향 0.**
- `syncAllAlarms`는 첫 줄 `if (!isAlarmKitAvailableSync()) return;` → 안드로이드에서 즉시 return.
- 안드로이드 알람 엔진은 별도(`AlarmManager` + `AlarmService`, 본 세션 Step 4~7에서 구현). 이 체인 분배/`syncAllAlarms` 코드를 쓰지 않음.
- 수정 대상 파일(`OpenAppDismissIntent.swift`, `alarmScheduler.ts`의 iOS 경로, `App.tsx` 콜드스타트)은 전부 iOS 전용 또는 `isAlarmKitAvailableSync` 가드 안쪽 → 수정해도 안드로이드 회귀 없음.

---

## 11. 검증 방법 (수정 후)

- `daily` 알람으로 재현/검증 (`once`는 1회성이라 반복 테스트 불편).
- 절차: 알람 발화 → 밀어서 중지 → 잠금 유지 → +2분 재알람 발화 확인.
- native log(App Group `native_debug_log_v1`)에서 `cancelAlarm 진입` 폭주 없는지 + 다음 체인 멤버 발화 기록 확인.
- 출시 앱이므로 알람 생성/편집/삭제/토글 정상 경로 회귀 테스트 필수.

---

## 12. 관련 선행 작업

- **A3 fix** (commit `a3abcd0`, `docs/plan-2026-05-22-ios-alarm-chain-robustness.md`): chain member를 `.relative`(daily/weekly) 반복으로 만들어 "다음날 생존"을 고침.
- 본 버그는 **다른 축**이다: A3 = "체인 멤버가 다음날까지 OS 반복으로 살아남는가", 본 버그 = "오늘 진행 중인 체인이 앱 콜드 스타트로 소멸하는가". 같은 chain robustness 영역이지만 별개 결함. A3 수정과 충돌 없음.

---

## 13. 플랜창이 봐야 할 핵심 코드 (재조사 불필요하도록 명시)

| 파일 | 라인 | 내용 |
|---|---|---|
| `modules/alarmkit-bridge/ios/OpenAppDismissIntent.swift` | 전체 87줄 | `.foreground(.immediate)` + `.alwaysAllowed` + `perform()` |
| `App.tsx` | 755-768 | 콜드 스타트 `useEffect([])` → `syncAllAlarms()` 호출 |
| `App.tsx` | 367-391 | `onAlarmStateChange` `alarm_main` 분기 (#AlarmChainEager 주석 포함) |
| `App.tsx` | 380-383 | `#AlarmChainRevive` 가드 (같은 클래스 회귀 선례) |
| `src/utils/alarmScheduler.ts` | 230-249 | `syncAllAlarms` — 이번 버그 본체 |
| `src/utils/alarmScheduler.ts` | 205-218 | `cancelAlarmsForEntity` — 또 다른 일괄-cancel 경로 |
| `src/utils/alarmScheduler.ts` | 115-137 | `scheduleAlarmMain` — 재예약 진입점 |
| `src/constants/alarms.ts` | 44-73 | `nextAlarmOccurrenceTime` — once/daily 동일 처리 |

---

## 부록 — 별도 발견: AlarmKit 50개 한도 초과 (이번 버그와 무관, 같이 검토 권장)

같은 조사 중 발견한 **별개 버그**. 이번 체인 소멸 버그와 직접 인과는 없으나 함께 검토 권장.

- 체인 예산 분배: `chainCount = floor(50 / activeCount)` (`alarmScheduler.ts:123-127`). 의도 = 알람 N개면 각 50/N칸 → 합 50.
- 그런데 log.md 실측: 알람 2개가 각각 **25개 / 50개**로 예약됨 (합 75) → AlarmKit `listAlarms count=50` → **약 25개 멤버가 OS에 의해 조용히 드롭**.
- 원인: 두 알람이 `activeCount`를 따로(2 / 1) 계산. 알람 추가/토글 시 기존 알람들의 체인을 재분배하지 않아 합이 50을 초과할 수 있음.
- 영향: 다중 알람 사용자에서 체인 꼬리(후반 멤버) 손실. **이번 증상의 직접 원인은 아님** (앞쪽 재알람 멤버는 살아있음 — log.md 확인됨).
- 크로스플랫폼: iOS 전용. 안드로이드 `AlarmManager`는 이 한도 없음.
