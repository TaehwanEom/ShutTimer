# 분석 — 잠금 중 루틴알람 발화 후 루틴 미진행 (cold-start 감지) (2026-06-05)

대상: iPhone 12 mini(iOS 26.5) 실기기 로그 분석. App Store 빌드 1.8.7(234).
목표: "cold-start 시 미처리(이미 발화) 알람 감지 → 루틴 자동 시작" (옵션 1) 코드 가능성 끝까지 검증.

## ✅ 구현 완료 (2026-06-05, UX 1번 = 라이브 alerting 케이스와 동일)
- `App.tsx` — `runLockedColdStartGapFallback` 추가 + `runAlertingAlarmCheck`에서 alerting 없을 때 호출.
  - alerting 없음 → 메타로 "다음 안전멤버(chainIndex≥1)가 2분 내 발화 예정 = 미해제 진행 중" 추론 → `onAlarmFire(alarmType='main')`로 세션 생성(루틴 시작 전제) + `navigate('Alarm')` → 미션 → 루틴.
  - 부활방지: 해제 시 안전체인 메타 삭제 → 매칭 없음. 내일치(base=내일, fireAt≈23h) → 윈도우 밖 제외.
  - **iOS 전용 가드**(`Platform.OS!=='ios'` early return) — Android 체인 구조 상이로 제외(Android창 별도).
  - 재울림: AlarmScreen `startAlarmAudio`가 active 진입 시 in-app 사운드 재생(iOS).
- 검증: **App.tsx 타입 클린**. 실기기 검증 = 빌드 후 필요(아래 §9).

## 9. 실기기 재검증 시나리오 (빌드 후)
1. 루틴 알람 1~2분 뒤 설정 → 화면 잠금 → 발화 대기.
2. 발화 후 **소리 멈춘 틈(멤버 사이 ~2분 gap)**에 잠금 해제 → 앱 진입.
3. 기대: **즉시 알람/미션 화면 진입**(2분 대기 없이) → 미션 완료 → 루틴 시작.
4. 반례(부활방지): 잠금화면에서 알람을 끈(dismiss) 뒤 앱 진입 → **루틴 시작 안 됨(정상)**.

## 0. 결론 (한 줄)
- **구현 가능. 네이티브 수정 불필요(JS만).** 기존 `runAlertingAlarmCheck`(App.tsx)가 `state==='alerting'`만 봐서 **안전체인 2분 간격의 "틈(gap)"에 앱이 켜지면 못 잡는 게** 원인. 메타데이터(`chainBaseFireAt`)+안전체인 생존 여부로 "발화했지만 미해제" 상태를 추론해 즉시 루틴 시작하면 됨.

## 1. 실측 타임라인 (로그 증거)
| 시각 | 사건 |
|---|---|
| 14:14:12 | 앱(3855) `running-suspended` (잠금 백그라운드) |
| 14:14:18 | 알람 발화(PowerUIAgent). **이 시점 앱 JS 로그 0개** = 루틴 로직 미실행 |
| 14:14:50 | 3855 종료(audio session destroy) |
| 14:15:09 | 잠금해제 → 앱 cold-start(4528) |
| 14:15:11 | `OnAppActive currentState=IDLE` — 세션 없음(잠금 중 앱 죽어서 세션 자체가 안 생김) |
| 14:15:11+1.5s | `runAlertingAlarmCheck` 실행 → **alerting 알람 없음**(이미 멈춤) → 아무 동작 X |
| 14:15:20 | chain0 상태 = **`scheduled`** (alerting 아님 = gap) |
| 14:16:02 | chain0 = **`alerting`** (다음 안전체인 발화) → 처리 시작 |
| 14:16:07~21 | open_app_dismiss → 미션 → `startRoutineFromAlarm steps=3 kind=started` (루틴 시작 성공) |

→ **루틴은 결국 시작됐지만, 발화(14:14:18)~다음 안전체인(14:16:02) 사이 ~2분간 미진행.** 사용자가 이 구간에 "안 된다"고 인지. 이 구간에 앱을 닫거나 알람을 잠금화면에서 꺼버리면 루틴이 영영 시작 안 됨.

## 2. 원인 (정밀)
- 루틴 진행은 **앱 foreground JS**가 돌려야 함. 잠금 중엔 JS 정지 → 발화 시점에 루틴 못 시작.
- 안전체인(chainIndex 1~29, 2분 간격)이 미해제 시 재발화 → 앱이 active일 때 그중 하나를 `onAlarmStateChange('alerting')` → `OnAlarmFire`로 잡아 처리. **이게 정상 복구 경로.**
- cold-start 보완책 `runAlertingAlarmCheck`(App.tsx:595)도 있으나 **`state==='alerting'` 인 알람만** 찾음. 안전체인 멤버는 짧게 alerting 후 `scheduled`로 돌아가므로, **멤버 간 2분 gap에 cold-start가 떨어지면 잡을 게 없음** = 이번 케이스.

## 3. 가용 데이터 (구현 근거 — 모두 기존재)
- `AlarmkitBridge.listAlarms()` → `{id, state}[]` (현재 alerting 판별용)
- `AlarmMetaRecord` (alarmkitMappingTable): `entityId`, `chainIndex`, **`chainBaseFireAt`**, `deleted`
  - 안전체인 멤버 fireAt = `chainBaseFireAt + chainIndex * 120000`
- `nextAlarmOccurrenceTime(alarm)` (constants/alarms.ts)
- `ALARM_CHAIN_INTERVAL_MS=120000`, `ALARM_CHAIN_MAX_INDEX=29`, chainLifespan=60분
- 기존 navigate 경로: `alarm_main` → `navigate('Alarm', {endMethod, alarmEntityId})` → AlarmScreen이 미션 후 `startRoutineFromAlarm` 호출

## 4. 부활방지 가드 (핵심)
- **해제하면 `cancelSafetyChainPreservingDaily`가 안전체인(1~29) 취소**, chain0(.relative)만 보존.
- 따라서 **"현재 fire 사이클 내에 살아있는(deleted!==true) 안전체인 멤버 존재" = 아직 미해제**. 이것이 false-resurrection 막는 신호.

## 5. 제안 구현 (옵션 1 — gap 메우기)
`runAlertingAlarmCheck`에서 alerting 알람을 **못 찾았을 때** fallback 추가:
1. enabled 알람별 메타에서 `chainBaseFireAt`(현 사이클 base) 확인.
2. `base <= now <= base + chainLifespan(60분)` (= 발화 사이클 진행 중) **이고**
3. `chainIndex>=1 && deleted!==true` 안전체인 멤버가 **near-future(예: now 기준 다음 2분 내 fireAt)**로 존재 (= 미해제 진행 중) **이면**
4. → alerting 케이스와 **동일하게** `navigate('Alarm', {endMethod, alarmEntityId})` → 기존 미션→루틴 경로 재사용.

- **네이티브 변경 0.** App.tsx `runAlertingAlarmCheck` 한 함수 확장 + 메타 계산 헬퍼.
- 결과: 잠금해제(cold-start) 즉시 알람/미션 화면 진입 → 미션 후 루틴 시작. 2분 대기 제거.

## 6. ⚠️ 미결 UX 결정 (구현 전 확인 필요)
- gap 시점엔 **알람 소리가 안 울리는 중**. 진입 시 AlarmScreen이 `startAlarmAudio`로 **다시 울릴지**, 아니면 **무음으로 미션만 띄울지** 정해야 함.
- "미션 없이 바로 루틴 시작"으로 갈지(이미 발화했으니 미션 skip), "미션 완료해야 루틴 시작" 기존 정책 유지할지.

## 7. ⚠️ 크로스플랫폼 (iOS=표준, Android 영향)
- `runAlertingAlarmCheck`는 공통 JS. Android는 알람엔진/체인 구현이 달라 **동일 동작 보장 안 됨** → Android창 별도 검증 필요. iOS 기준으로 구현 후 인계.

## 8. 한계 (옵션 1로 못 막는 것)
- 사용자가 **잠금화면에서 알람을 끄고 앱을 안 여는** 경우: 끄면(stop) 안전체인이 취소될 수 있어 cold-start 시 살아있는 멤버가 없을 수 있음 → 그 경우 루틴 시작 불가. (이건 옵션 2 = 루틴 단계 자체를 AlarmKit 알람화 해야 근본 해결.)
