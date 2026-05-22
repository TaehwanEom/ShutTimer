# Plan — iOS 알람 체인 소멸 수정 (syncAllAlarms 멱등화)

- **작성**: 2026-05-22 / 플랜창
- **근거 문서**: `docs/plan-brief-2026-05-22-ios-chain-wipe-on-slide-stop.md` (구현창 진단)
- **태스크 ID**: FIX-2026-05-22-chain-wipe
- **심각도**: 🔴 크리티컬 — 출시 앱(v1.8.5 App Store live) 핵심 기능 실패
- **브랜치**: `feature/android-support` (버그는 iOS 전용, 안드로이드 무관)

---

## 0. 검증 결과 (브리프 ↔ 실제 코드 1:1 대조)

브리프 진단을 코드와 직접 대조함. 추측 없음.

| 브리프 주장 | 실제 코드 | 판정 |
|---|---|---|
| `OpenAppDismissIntent`가 `.foreground(.immediate)` + `.alwaysAllowed` | `OpenAppDismissIntent.swift:51-52` 일치. `perform()`는 `.alerting` 알람만 stop, 체인 미손상 | ✅ 확정 |
| 콜드 스타트마다 `syncAllAlarms()` 무조건 실행 | `App.tsx:755-768` mount `useEffect([])` → `:763` 호출 | ✅ 확정 |
| `syncAllAlarms`가 `alarm_main` 전체 cancel 후 재예약 | `alarmScheduler.ts:230-249` 일치 | ✅ 확정 |
| `nextAlarmOccurrenceTime` once/daily 동일 처리, 둘 다 "내일" 반환 | `alarms.ts:56-62` 일치 | ✅ 확정 |
| `disableOnceAlarmIfNeeded`는 chainIndex≥49 에서만 호출 | `App.tsx:375-378` 일치 | ✅ 확정 |

**브리프가 누락한 사실 (플랜창 추가 발견)**: `syncAllAlarms`에는 호출자가 **2개**다.
1. `App.tsx:763` — 콜드 스타트 (브리프가 다룬 경로).
2. `routineController.ts:260` `restorePendingDisabledAlarms()` — 루틴이 충돌로 임시 disable 한 알람을 루틴 종료 시 `enabled=true` 복원 후 `syncAllAlarms()`로 재예약. **이 경로가 깨지지 않도록 설계에 반영함** (4절 참조).

결론: 브리프 진단 정확. 본 플랜은 브리프 4~6절 위에 누락 호출자 1건을 더해 설계함.

---

## 1. 대상 파일

grep 기반 명시 열거.

| 파일 | 수정 대상 | 사유 |
|---|---|---|
| `src/utils/alarmScheduler.ts` | `syncAllAlarms()` 함수 1개 (라인 230-249) | 버그 본체. 전체 cancel → 멱등 동작으로 교체 |

**수정 파일은 1개, 함수는 1개뿐이다.**

## 2. 수정하지 않는 파일 (명시 선언)

- `App.tsx` — `syncAllAlarms()` 호출부(`:763`)·`alarm_main` 리스너(`:367-391`)·`disableOnceAlarmIfNeeded` 트리거(`:375-378`) **전부 그대로 둔다**. 트리거를 chainIndex 0으로 옮기면 안 된다 (이유: 7절-④).
- `OpenAppDismissIntent.swift` — 버그 원인이 아니다. `perform()`는 정상 동작.
- `src/constants/alarms.ts` — `nextAlarmOccurrenceTime`은 사양대로 정확. 변경 없음.
- `src/utils/alarmkitMappingTable.ts` — 스키마 변경 없음. `chainIndex`/`chainBaseFireAt` 필드는 이미 존재.
- `src/utils/routineController.ts` — 호출자이지만 본 설계가 이 경로를 보존하므로 수정 불필요.
- AlarmScreen / AlarmList / AlarmEdit 등 화면 — 손대지 않는다.

## 3. 레이어

**Logic 레이어 단독.** 알람 스케줄링 로직(`alarmScheduler.ts`)만 수정. UI·Native API(Swift)·Config(app.json) 미접촉.

---

## 4. 수정 내용 — `syncAllAlarms` 동작 사양 (코드 아님, 동작 명세)

### 4-1. 현재 동작 (버그)

1. 모든 `alarm_main` mapping을 **무조건 전부 cancel + delete**.
2. `enabled=true` 알람을 `scheduleAlarmMain`으로 **전부 재예약** (`nextAlarmOccurrenceTime` = 오늘 지났으면 내일).

→ 콜드 스타트 시점에 **오늘 진행 중이던 체인이 통째로 소멸**, 재구성은 내일 날짜로만. 오늘 남은 재알람(6:52, 6:54…) 전멸.

### 4-2. 수정 후 동작 (멱등 — "이미 정상인 체인은 건드리지 않는다")

핵심 원칙: 체인 멤버는 `.relative` OS 반복으로 등록되어 **OS가 권위 있는 상태**다. 정상 등록된 체인은 콜드 스타트마다 재등록할 필요가 없다. `syncAllAlarms`는 "빠진 것만 채우고, 죽은 것만 치운다".

`alarm_main` mapping 전체를 `entityId` 기준으로 그룹화한 뒤, 아래 3분기로 처리한다.

**분기 A — mapping이 있는 entityId 중, 대응 알람이 없거나 `enabled=false`인 경우 (고아/비활성)**
- 해당 entityId의 mapping 전체를 cancel + delete.
- (= 기존 "stale cleanup" 목적 보존. 사용자가 인앱에서 끈 알람·삭제한 알람의 잔존 mapping 정리.)

**분기 B — mapping이 있고 알람이 `enabled=true`인 경우**
- **once 알람이고 체인이 죽은 경우**: cancel + delete + `disableOnceAlarmIfNeeded(entityId)`로 `enabled=false` 처리.
  - "체인이 죽음"의 판정: `chainBaseFireAt`이 없음(undefined) **또는** `chainBaseFireAt + (ALARM_CHAIN_MAX_INDEX+1) × ALARM_CHAIN_INTERVAL_MS < Date.now()` (= 기준시각 + 100분 경과).
  - (= 부수 버그 "once가 다음날 또 울림" 방어 처리. 이미 다 발화한 once를 재예약하지 않고 끈다.)
- **그 외 (daily/weekly, 또는 once인데 체인이 아직 살아있음)**: **아무것도 하지 않는다 (skip).** ← **이번 버그의 핵심 수정.**
  - 진행 중이거나 미래에 유효한 체인은 OS 반복/`.fixed` 예약 그대로 둔다.

**분기 C — `enabled=true`인데 `alarm_main` mapping이 하나도 없는 알람**
- `scheduleAlarmMain(alarm)`으로 체인 신규 예약.
- (= 루틴 충돌 복원 경로 `restorePendingDisabledAlarms`가 의존하는 동작. 체인이 취소된 채 복원된 알람을 다시 깐다. once 알람도 여기 해당 — 아직 발화 안 한 once이므로 재예약이 옳다.)

### 4-3. 이 설계가 각 시나리오를 어떻게 처리하는가

| 시나리오 | 처리 | 결과 |
|---|---|---|
| daily 6:50, 발화 후 밀어서 중지 → 콜드 스타트 | 분기 B-skip (체인 mapping 50개 살아있음, `perform()`은 `.stop`만 함, mapping 삭제 안 함) | ✅ 오늘 6:52·6:54… 체인 생존 |
| once 21:01, 발화 후 밀어서 중지 → 콜드 스타트 | 분기 B-skip (체인 살아있음, `chainBaseFireAt+100분 > now`) | ✅ 오늘 체인 생존, 22:39 chainIndex49 발화 → 자동 disable → 내일 안 울림 (부수 버그도 해결) |
| once가 체인 다 발화했는데 still `enabled` (disable 누락) | 분기 B-dead → cancel + `enabled=false` | ✅ 내일 재발화 차단 |
| 루틴 충돌로 임시 disable 됐던 알람, 루틴 종료 후 복원 | `restorePendingDisabledAlarms`가 `enabled=true` 복원 → `syncAllAlarms` 분기 C → 재예약 | ✅ 체인 복구 (기존 동작 보존) |
| 사용자가 인앱에서 끈 알람의 잔존 mapping | 분기 A → cancel + delete | ✅ 정리됨 |

---

## 5. 영향 범위

### 5-1. 영향받는 코드/상태
- **`syncAllAlarms` 호출자 2곳 모두**: ① `App.tsx:763` 콜드 스타트, ② `routineController.ts:260` 루틴 복원. 두 경로 다 4-3 표대로 정상 동작하도록 설계됨.
- `cleanupGhostAlarms`(`App.tsx:764`, `syncAllAlarms` 직후 실행): 수정 후 mapping table이 살아있는 체인을 **유지**하므로, framework 알람이 mapping에 "known"으로 남음 → ghost로 오인 cancel 안 됨. ✅ 정합.
- AsyncStorage 스키마: **변경 없음.** mapping table의 `chainIndex`/`chainBaseFireAt`는 이미 존재. 하위호환 OK. (단, v1.8 이전 `chainBaseFireAt` 누락 mapping은 once일 때 "죽음"으로 간주 → 정리됨. 의도된 처리.)

### 5-2. iOS / Android 차이
- **안드로이드 영향 0.** `syncAllAlarms` 첫 줄 `if (!isAlarmKitAvailableSync()) return;` → 안드로이드 즉시 return. 안드로이드 알람 엔진(`AlarmManager`)은 이 코드 미사용.

### 5-3. 앱 상태(foreground / background / killed)별 영향
- 본 수정은 **killed → 콜드 스타트** 경로의 동작을 고치는 것이 목적.
- foreground/background에서 `syncAllAlarms`가 도는 경우는 루틴 복원 경로뿐이며, 분기 C로 정상 처리됨.

---

## 6. 검증 방법

본 수정은 **순수 TS(JS) 변경** — 네이티브 리빌드 불필요, 기존 dev build에서 핫리로드로 테스트 가능. **단, AlarmKit 알람 발화는 Expo Go 불가** → 실기기 + dev build 필수.

### 6-1. 핵심 버그 재현/검증 (실기기, daily 알람으로)
1. daily 알람 1개 설정 (예: 3분 뒤 시각).
2. 발화 → 밀어서 중지 → **잠금 유지 (페이스ID 안 함)**.
3. +2분 후 재알람 발화하는지 확인. → **발화하면 PASS.**
4. native log(App Group `native_debug_log_v1`)에서 `cancelAlarm 진입` 폭주가 없고 다음 체인 멤버 발화 기록이 있는지 확인.

### 6-2. 빠른 프록시 검증 (실기기, 발화 대기 없이)
1. 알람 1개 등록 → 앱 강제 종료 → 재실행 (콜드 스타트).
2. JS log에서 `syncAllAlarms` 후 `[GhostCleanup] mappingCount`가 알람 등록 직후와 **동일하게 유지**되는지 확인 (대량 cancel 없음).

### 6-3. 회귀 테스트 (출시 앱 — 필수)
- 알람 생성 / 시각 편집 / 삭제 / on-off 토글 → 각각 정상 동작 확인.
- once 알람 발화 → 다음날 재발화 **안 함** 확인.
- 루틴 시작(알람 충돌 발생) → 루틴 종료 → 충돌났던 알람 체인 복원 확인.

### 6-4. 플랫폼
- iOS만 검증하면 됨. 안드로이드는 코드 경로 미진입(5-2) — QA 불필요하나, 안드로이드 빌드가 깨지지 않는지 컴파일 확인은 할 것.

---

## 7. 주의사항

① **v1/v2 범위**: 본 작업은 출시된 v1.8.5의 크리티컬 버그 수정. 신규 기능 아님. v2 범위 침범 없음.

② **출시 앱 회귀 위험**: 알람 CRUD·토글·루틴 복원 4개 경로 회귀 테스트 필수(6-3). 절대 빠뜨리지 말 것.

③ **`syncAllAlarms`의 원래 목적 보존됨**: ① stale mapping cleanup → 분기 A가 수행. ② enabled 알람 재예약 → 분기 C가 수행 (단 "이미 정상인 체인"은 분기 B-skip로 제외 — 이게 수정의 본질).

④ **`App.tsx:375-378`의 `chainIndex>=49` 트리거를 chainIndex 0으로 옮기지 말 것**: once 알람은 체인이 다 발화할 때까지 `enabled=true`로 남아야 분기 A(고아 cancel)에 걸리지 않는다. 0으로 옮기면 체인 진행 중에 once가 disabled 되어, 콜드 스타트 시 분기 A가 남은 체인을 cancel → 회귀.

⑤ **알려진 한계 (수정하지 않음, 기록만)**: 알람 생성 중(`scheduleAlarmMain` 루프 진행 중)에 앱이 kill 되어 체인이 일부만 저장된 경우, 분기 B-skip가 그 불완전 체인을 그대로 둔다(예: 50개 중 10개). 발생 확률 극히 낮고 다음 편집 시 자가 치유됨. 부록의 50개 한도 버그와 함께 별도 검토.

---

## 8. 배포 전제조건

- **없음.** `app.json` 권한·`eas.json` 변경 없음. 순수 TS 변경이라 네이티브 리빌드도 불필요(기존 dev build로 검증, 프로덕션은 정규 빌드 1회).

---

## Pre-Modify 체크리스트

- [x] 대상 파일 목록 확정 (grep 기반) — `alarmScheduler.ts` 1개
- [x] 범위 외 파일 미접촉 선언 — 2절
- [x] 현재 동작 기능 회귀 없음 분석 — 5절 + 6-3 회귀 테스트
- [x] v1/v2 경계 확인 — v1 버그 수정, v2 침범 없음
- [x] 4개 레이어 중 Logic 단독 접촉 선언 — 3절

## 반복실수 점검 (플랜 시점)

| # | 실수 패턴 | 점검 결과 |
|---|---|---|
| 1 | v2 기능을 v1에 | 해당 없음 — 크리티컬 버그 수정 |
| 2 | 관련 파일 누락 | grep으로 `syncAllAlarms` 호출자 2곳 전수 확인 (브리프 누락분 1건 발견·반영) |
| 3 | iOS/Android 분기 누락 | 5-2에 명시 — 안드로이드 영향 0 |
| 4 | 권한 설정 누락 | 권한 변경 없음 — 8절 |
| 5 | 앱 상태별 동작 누락 | 5-3에 foreground/background/killed 전부 명시 |
| 6 | 레이어 침범 | Logic 단독 — 3절 |

---

## 빌드창 핸드오프

```
[Build window handoff]
Task: FIX-2026-05-22-chain-wipe — syncAllAlarms 멱등화 (iOS 알람 체인 소멸 수정)
Target files: src/utils/alarmScheduler.ts — syncAllAlarms() 함수 1개 (라인 230-249) 교체
Files not modified: App.tsx, OpenAppDismissIntent.swift, alarms.ts, alarmkitMappingTable.ts,
                    routineController.ts, AlarmScreen/AlarmList/AlarmEdit 등 화면 — 전부 미접촉
Layer: Logic
Notes:
  - 4-2절 분기 A/B/C 사양 그대로 구현. 기존 import만으로 충분 (신규 import 불필요).
  - "once 체인 죽음" 판정 식: chainBaseFireAt 없음 OR chainBaseFireAt + 50×ALARM_CHAIN_INTERVAL_MS < Date.now()
  - App.tsx:375-378 트리거 절대 이동 금지 (주의사항 ④).
  - 출시 앱 — 회귀 위험. CLAUDE.md "Surgical Changes" 준수, syncAllAlarms 함수 외 손대지 말 것.
Verification: 6절 — 6-1 핵심 재현(실기기), 6-2 빠른 프록시, 6-3 회귀 4종, 안드로이드 컴파일 확인
Deployment prerequisites: 없음 (순수 TS, 네이티브 리빌드 불필요)
```

---

## 후속 조사 (본 수정 범위 밖 — 별도 태스크)

브리프 8절·부록에서 제기된 항목. 본 플랜에 **묶지 않는다** (추측성 수정 금지·surgical 원칙).

### 후속 1 — AlarmScreen 잠금 중 mount 가능성 (브리프 8절)
- 가설: `.foreground(.immediate)`가 잠금 상태에서 `AppState`를 `inactive`로 만들면, `App.tsx:383`의 가드 `if (AppState.currentState === 'background') return;`는 `inactive`를 못 막아 → AlarmScreen이 잠금 상태로 mount → 미션 30초 만료 → `cancelAlarmsForEntity` → 체인 소멸.
- **미확정.** 플랫폼 동작이라 코드로 단정 불가.
- **게이트**: native log(`native_debug_log_v1`)에서 잠금 중 AlarmScreen mount + `cancelAlarm 진입`이 실제로 찍히는지 먼저 확인. 확인되면 → 가드를 `=== 'background'`에서 `!== 'active'`로 강화하는 별도 플랜. 확인 안 되면 불필요.

### 후속 2 — AlarmKit 50개 한도 초과 (브리프 부록)
- 알람 2개가 각 25/50개로 예약(합 75) → AlarmKit이 약 25개를 조용히 드롭.
- 원인: 알람 추가/토글 시 기존 알람들의 체인 예산을 재분배 안 함.
- 본 버그와 직접 인과 없음. iOS 전용. 별도 플랜 필요.

---

## 부록 — 알기 쉬운 설명

- **이 버그가 뭔가**: 알람이 울려서 밀어서 끄면, 아직 안 끝난 "2분마다 다시 울리는 줄(체인)"이 통째로 사라진다. 사용자는 "한 번 껐다"고 생각하지만 뒤에서 100분짜리 알람 줄 전체가 취소된다.
- **왜 그러나**: 알람을 끄면 앱이 자동으로 켜진다. 그런데 밤새 앱은 꺼져 있었으므로 이건 "완전 새로 켜기(콜드 스타트)"다. 앱은 켜질 때마다 `syncAllAlarms`라는 청소 함수를 돈다. 이 함수가 "알람 줄을 전부 지우고 다시 깐다". 그런데 다시 깔 때 *오늘 남은 것*이 아니라 *내일 것*만 깐다. 그래서 오늘 남은 재알람이 다 날아간다.
- **어떻게 고치나**: 청소 함수를 "전부 지우고 다시 깔기"에서 "**이미 멀쩡한 줄은 그냥 둔다**"로 바꾼다. 빠진 것만 채우고, 죽은 것만 치운다. 멀쩡히 돌아가는 알람 줄은 OS가 알아서 반복해 주므로 앱이 다시 깔 이유가 없다.
- **iOS 영향 여부**: 이 버그도 수정도 **iOS 전용**. 안드로이드는 알람 엔진이 따로라 영향 0.
