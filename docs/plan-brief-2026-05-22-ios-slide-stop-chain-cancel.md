# Plan Brief — iOS: 밀어서 중지가 알람 체인을 통째로 죽인다 (#AlarmRepeat 자기모순)

- **작성**: 2026-05-22 / 구현창 (실기기 log.md 분석 + git 추적)
- **대상**: 플랜창 — 본 문서 기반으로 수정 설계
- **심각도**: 🔴 크리티컬 — 출시 앱(v1.8.5 live)의 핵심 기능(미션 유도)이 무력화됨
- **선행**: `plan-2026-05-22-ios-chain-wipe-fix.md` (FIX-2026-05-22-chain-wipe, syncAllAlarms 멱등화) — **완료·검증됨.** 본 건은 그 후속(브리프 8절에서 플래그한 "2차 cancel 경로")이 실기기 로그로 확정된 것.

---

## 1. 한 줄 요약

알람이 울린 뒤 **밀어서 중지**하면, `open_app_dismiss` 핸들러가 `cancelAlarmsForEntity`를 호출해 **그 알람의 체인 전체를 즉시 cancel**한다. 미션을 완료하지 않아도 체인이 죽으므로, "미션 완료할 때까지 2분마다 다시 깨운다"는 체인의 존재 이유가 무력화된다.

---

## 2. 배경 — 1차 수정은 됐고, 2차 경로가 남았다

| 경로 | 상태 |
|---|---|
| ① `syncAllAlarms` 콜드 스타트 wipe | ✅ FIX-2026-05-22-chain-wipe로 수정·검증 완료 (3절 로그) |
| ② `open_app_dismiss` → `cancelAlarmsForEntity` | ❌ **본 문서 대상.** 미수정 |

브리프 `plan-brief-2026-05-22-ios-chain-wipe-on-slide-stop.md` 8절에서 "체인 일괄 cancel 경로가 여러 개"라고 플래그했고, 그 중 ②가 실기기 로그로 진범 확정됨.

---

## 3. log.md 증거 (실기기, Release 빌드, 2026-05-22)

테스트: weekly(매일) 알람 발화 → 밀어서 중지. 타임라인:

| 시각(UTC) | 이벤트 |
|---|---|
| `14:12:04` | 앱 콜드 스타트. `[GhostCleanup] frameworkCount=66 mappingCount=66`. **cancel 0건·재예약 0건** → ①(syncAllAlarms) 수정 정상 작동 검증 |
| `14:14:00` | 알람 `2887661B` (entity `a_1779459001117_hpqv2c`) 발화. `AppState=background` (앱 살아있음 — kill 아님). schedule = `relative weekly([일~토]) 23:14` |
| `14:14:18` | `[OpenAppDismiss-DBG] perform 진입` — 밀어서 중지. `alertingCount=0` |
| `14:14:18~19` | `[LAControl-DBG] open_app_dismiss 분기 진입` → `alarm entity chain cancel` → 네이티브 `cancelAlarm 진입` **×16** (`state=scheduled → cancel()`) → `listAlarms 66 → 50` |
| `14:14:19` | `[AlarmScreen-DBG] mount` |
| `14:14:49` | `[AlarmScreen-DBG] stopAudioAndVibration chain cancel` — 미션 완료 경로 (이미 mapping 없음 → no-op) + `[Ad-DBG] enterResult` |

**핵심**: 체인 16개가 `14:14:18` **밀어서 중지 시점**에 전멸. AlarmScreen mount(`14:14:19`)·미션 완료(`14:14:49`)보다 **앞선다.** 미션과 무관하게 체인이 죽는다.

> 참고: 이 테스트는 앱이 background에 살아있는 상태(warm)였음. 하지만 `open_app_dismiss` 핸들러는 cold/warm 무관하게 밀어서 중지 시 항상 실행되므로, 결론은 동일하다.

---

## 4. 근본 원인

[App.tsx:625-643](App.tsx#L625-L643) — `open_app_dismiss` 신호 핸들러의 alarm-entity 분기:

```js
// v1.8 #AlarmRepeat — slide-to-stop 측 = chain 형제 일괄 cancel.
// 직전 = alerting 1개만 stop (= OpenAppDismissIntent perform 측) → scheduled 측 chain 49개 잔존 → 2분 뒤 또 울림.
// 정정 = mapping table 측 entityId 동일 모든 alarm cancel.
await cancelAlarmsForEntity(alarmEntity.id).catch(() => {});   // ← App.tsx:631
```

`cancelAlarmsForEntity` ([alarmScheduler.ts:205-218](src/utils/alarmScheduler.ts#L205-L218))는 해당 entityId의 모든 `alarm_main` mapping을 cancel + delete.

### git 추적 — `#AlarmRepeat`은 별도 핫픽스가 아니다

`git blame` 결과: 커밋 **`314ba8b`** (2026-05-13) — 메시지 **"feat: v1.8 #AlarmRepeat — 알람 2분 간격 chain 반복 + stale fireAt fix"**.

→ **체인 기능을 처음 만든 바로 그 커밋**에 이 cancel이 같이 들어갔다. 주석의 "직전 = … 2분 뒤 또 울림"은 그 커밋 *개발 도중*의 상태를 가리킨다. 즉:
- 체인(2분마다 재발화)을 만들고 →
- 같은 커밋에서 "밀어서 중지했는데 2분 뒤 또 울리네?"를 **버그로 오인** →
- `cancelAlarmsForEntity`로 체인을 통째로 끄도록 "정정".

**별도의 보호 대상(다른 글리치)이 있어서 넣은 게 아니다.** 체인의 *기능*을 만든 사람이 그 기능을 *버그로 착각*해 같은 커밋에서 무력화한 자기모순이다. → 제거 리스크가 낮다 (단 8절 검증 필수).

---

## 5. 확정된 설계 의도 (제품 오너 Eom 확인)

> **체인의 존재 이유 = 사용자를 앱으로 끌어들여 미션을 완료하게 만드는 장치.**
> - 밀어서 중지 → 사운드만 꺼짐. **알람 종료 아님.**
> - 2분 뒤 다시 발화 (체인) → 또 밀어서 중지 → 또 발화 → … → 결국 앱 진입 → 미션 완료.
> - **미션 완료 = 그때 비로소 종료.** 체인 cancel은 *오직* 이 시점.

`#AlarmRepeat`의 "밀어서 중지 = 체인 몰살"은 이 의도와 정면충돌한다. 현재는 `#AlarmRepeat`이 이겨서 체인이 사실상 동작하지 않는다 (사용자가 알람을 완전히 무시하고 한 번도 밀어서 중지를 안 할 때만 체인이 살아남음).

---

## 6. 두 개의 cancel 경로 — 무엇이 옳고 그른가

| 경로 | 위치 | 트리거 | 판정 |
|---|---|---|---|
| 밀어서 중지 cancel | [App.tsx:631](App.tsx#L631) `cancelAlarmsForEntity` | `open_app_dismiss` (밀어서 중지) | ❌ **제거 대상** — 미션 전에 체인을 죽임 |
| 미션 완료 cancel | [AlarmScreen.tsx:300-301](src/screens/AlarmScreen.tsx#L300-L301) `cancelAlarmsForEntity` (`stopAudioAndVibration` 내부, 호출부 :529·:570) | 미션 완료 → dismiss | ✅ **유지** — 이게 올바른 종료 시점 |

---

## 7. 수정 방향 (제안 — 최종 설계는 플랜창)

- [App.tsx:631](App.tsx#L631)의 `cancelAlarmsForEntity` 호출(+ 632 로그 + 628-630 주석)을 **`open_app_dismiss` 경로에서 제거.**
- 밀어서 중지 시에는 — 화면 진입(AlarmScreen navigate)만 하고 체인은 **건드리지 않는다.**
- 체인 cancel은 미션 완료 경로(AlarmScreen `stopAudioAndVibration`)에서만 유지.
- 결과: 밀어서 중지 → 사운드만 꺼짐 → 2분 뒤 다음 체인 멤버 발화 → 미션 완료해야 비로소 전체 cancel.

---

## 8. 플랜이 반드시 확인할 것

1. **미션 완료 cancel의 커버리지**: `stopAudioAndVibration`의 `cancelAlarmsForEntity`가 체인 전 멤버(최대 50개)를 확실히 죽이는가. 일부만 죽으면 미션 완료 후에도 잔존 멤버가 울린다 (`#AlarmRepeat`이 막으려던 바로 그 증상). 이게 보장돼야 7절 제거가 안전.
2. **dismiss 경로 다양성**: AlarmScreen dismiss 방식이 여러 개(typing/흔들기/카메라 등). 모든 미션 완료 경로가 `stopAudioAndVibration`(→ cancel)을 거치는지 확인. 거치지 않는 경로가 있으면 그 경로에서 체인이 안 죽음.
3. **recurring 알람의 다음날 재무장**: 미션 완료 시 `cancelAlarmsForEntity`가 daily/weekly 알람의 체인을 *전부* cancel한다. 다음날 발화가 어떻게 재무장되는지(현행: `syncAllAlarms` 분기 C 등) 확인하고 회귀 없도록.
4. **AlarmScreen을 안 거치는 밀어서 중지**: 사용자가 밀어서 중지만 하고 앱에 진입하지 않거나(잠금 유지) 앱을 죽이면 — 체인이 계속 울려야 한다(의도대로). 이때 cancel하는 다른 경로가 없는지 확인.

---

## 9. 영향 범위 / 회귀 위험

- **수정 파일 예상**: `App.tsx` (`open_app_dismiss` 핸들러 1곳). 플랜이 확정.
- **출시 앱** — 회귀 테스트 필수: 밀어서 중지 → 미션 완료 → 정상 종료 / 밀어서 중지 → 미션 미완료 → 2분 뒤 재발화 / 미션 완료 후 잔존 발화 없음 / daily 알람 다음날 정상.
- `#AlarmRepeat` 제거 시 의도적으로 "2분 뒤 재발화"가 부활한다 — 이건 회귀가 아니라 **설계 복원**(5절).

---

## 10. 크로스플랫폼

- 본 경로(`open_app_dismiss` / `OpenAppDismissIntent` / AlarmKit)는 **iOS 전용.**
- 안드로이드 알람 엔진은 별도(`AlarmManager` + `AlarmService`). 본 수정과 무관 — 영향 0.
- `cancelAlarmsForEntity` 자체는 공용 함수지만 본 건은 호출부(App.tsx open_app_dismiss)만 손대므로 안드로이드 경로 미접촉.

---

## 11. 검증 방법

- 실기기 + iOS 26 + dev/Release 빌드 (시뮬레이터 불가).
- daily 알람 발화 → 밀어서 중지 → **미션 안 하고 잠금 유지** → 2분 뒤 재발화하면 PASS.
- 밀어서 중지 → 앱 진입 → 미션 완료 → 즉시 종료 + 이후 잔존 발화 0건 확인.
- native log: 밀어서 중지 시점에 `cancelAlarm 진입` 폭주가 **없어야** 하고, 미션 완료 시점에만 체인 cancel.

---

## 12. 참조

| 항목 | 위치 |
|---|---|
| 밀어서 중지 cancel (제거 대상) | `App.tsx:625-643`, 특히 `:631` |
| `#AlarmRepeat` 도입 커밋 | `314ba8b` (2026-05-13) "feat: v1.8 #AlarmRepeat — 알람 2분 간격 chain 반복 + stale fireAt fix" |
| 미션 완료 cancel (유지) | `src/screens/AlarmScreen.tsx:273` `stopAudioAndVibration`, `:300-301` cancel, 호출부 `:529`·`:570` |
| `cancelAlarmsForEntity` 정의 | `src/utils/alarmScheduler.ts:205-218` |
| `OpenAppDismissIntent` (밀어서 중지 시 perform) | `modules/alarmkit-bridge/ios/OpenAppDismissIntent.swift` |
| 선행 수정 (syncAllAlarms) | `docs/plan-2026-05-22-ios-chain-wipe-fix.md` |
| 1차 진단 브리프 | `docs/plan-brief-2026-05-22-ios-chain-wipe-on-slide-stop.md` |

---

## 부록 — 알기 쉬운 설명

- **체인이 뭐냐**: 알람이 한 번 울리고 끝이 아니라, 2분마다 최대 50번 다시 울리는 "줄". 사용자가 못 일어나고 뭉개도 계속 깨워서, 결국 앱에 들어가 미션(타이핑 등)을 하게 만드는 장치다. 이게 이 앱의 핵심 기능이다.
- **지금 뭐가 문제냐**: 알람을 밀어서 끄는 순간, 앱이 그 줄 전체를 잘라버린다. 그래서 2분 뒤에 다시 울려야 할 게 안 울린다. 사용자는 미션도 안 했는데 알람이 끝나버린다 → 다시 잠들어도 안 깨워준다.
- **왜 그렇게 됐냐**: 체인 기능을 만든 그 작업에서, 만든 사람이 "밀어서 껐는데 2분 뒤 또 울리네? 버그네" 하고 줄을 통째로 자르게 해버렸다. 사실 그 "또 울림"이 핵심 기능인데 버그로 착각한 거다.
- **어떻게 고치나**: "밀어서 중지하면 줄 자르기"를 없앤다. 줄은 **미션을 실제로 완료했을 때만** 자른다. 그러면 밀어서 꺼도 2분 뒤 다시 울리고, 미션을 해야 비로소 끝난다 — 원래 의도대로.
- **iOS 영향 여부**: 이 버그도 수정도 iOS 전용. 안드로이드는 알람 엔진이 따로라 영향 0.
