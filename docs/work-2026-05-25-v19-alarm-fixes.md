# 2026-05-25 작업 정리 — v1.9 알람/타이머/루틴 fix 3건

**브랜치**: `feature/android-support`
**작업 창**: Build
**작업 완료**: 3건 (3 커밋 분리)

---

## 1. Timer 1초 무음 갭 fix (옵션 B)

**커밋**: `343aa19` — fix(AlarmScreen): in-app 사운드 시작 후 native banner stop (옵션 B)

### 문제

알람 발화 후 사용자가 앱 진입 시 약 1초간 무음 발생.

- AlarmScreen 측 두 useEffect 분리 영역.
- `BannerDismissOnActive` useEffect = `AppState=active` 진입 시점 즉시 `AlarmkitBridge.stopAlarm()` 호출.
- `startAlarmAudio` useEffect = in-app 사운드 (expo-audio) 시작은 별도 비동기 흐름.
- 두 흐름 race → native banner 사운드 stop 후 in-app 사운드 시작 전까지 무음 갭.

### 정정

`dismissAlertingBanner` 함수를 `startAlarmAudio` useEffect 내부로 통합.
- `playWhenLoaded` 측 `player.play()` 직후 `dismissAlertingBanner()` 호출.
- = in-app 사운드 시작 보장 후 native banner stop.
- Platform.OS === 'android' 측 = `startAlarmAudio` 함수 상단 return 측 자동 차단 (= iOS only).

### 수정 파일
- `src/screens/AlarmScreen.tsx` (line 369-413, 709-796 부근)

### 검증
- log02.md 시나리오 2 (06:46~06:51) 측 `AudioFirstThenStop stopAlarm` 로그 출력 확인.
- mount(background) → OnAppActive(.305) → AudioFirstThenStop(.353, 47ms 후) → state=removed(.405, 52ms 후) 흐름 정상.

---

## 2. Chain 최대 50 → 30 축소 (= 100분 → 60분 ringing)

**커밋**: `7e14942` — chore(alarm-chain): chain 최대 50 → 30 축소

### 사용자 의도

> "20개 정도 줄여서 30개로 줄이자. 100분까진 가지 않을거 같아. 30개면 1시간이잖아."

알람 1개 측 100분 ringing 보장 = 과한 영역. 60분이면 충분.

### 변경 내용

| 항목 | 직전 | 변경 후 |
|------|------|---------|
| `ALARM_CHAIN_MAX_INDEX` | 49 | 29 |
| 1 entity chain | 30개 | 30개 |
| ringing 보장 | 100분 | 60분 |
| 분배 (Math.floor(N/activeCount)) | 50/N | 30/N |
| `chainLifespanMs` (= 죽은 chain 판단) | 100분 | 60분 |

### 수정 파일
- `src/utils/alarmScheduler.ts` — 상수 + 주석 동기화
- `src/types/session.ts` — 주석 동기화
- `src/state/SessionController.ts` — 주석 동기화

### 자동 정합 영역 (= 미수정)
- `App.tsx:403` `curIdx >= ALARM_CHAIN_MAX_INDEX` = 상수 비교, 자동 반영.

### 기존 데이터 측 영향
- 기존 사용자 디바이스 측 chain 50개 등록 상태 = 잔존.
- 신규 알람 등록 시점부터 30개로 축소.
- `chainLifespanMs` 60분 기준 점진 cleanup (= `syncAllAlarms` 호출 시).

---

## 3. 루틴 진행 중 Timer/Routine 시작 갭 다이얼로그 — routine alarm 검사 누락 fix

**커밋**: `9b6e6db` — fix(timer/routine): 갭 체크 측 routine alarm 검사 누락 fix

### 사용자 보고

> "알람루틴 도중 타이머 진행 팝업 노출 안돼는 문제"

log02.md 시나리오 (07:15:00 ~ 07:15:38) 측 확인:
- 알람 fire → AlarmScreen → typing dismiss → adhoc routine 시작 (07:15:34)
- routine confirm_prompt countdown 진행 중 (= alarmId=0B8BA754 state=countdown, 2분 후 다음 발화)
- 4초 후 (07:15:38) Timer 시작 시도 → **dialog X**, 그냥 시작됨

### 원인

`HomeScreen.handleStart` + `RoutineListScreen.handlePlay` 측 갭 체크 로직:

```ts
const alarms = await loadAlarms();  // ← AsyncStorage 측 사용자 등록 알람만
const enabledAlarms = alarms.filter(a => a.enabled);
// nextAlarmOccurrenceTime 측 next fire 추정 → conflict 체크
```

= **검사 대상 측 routine 진행 중 alarm 누락**.
- `loadAlarms()` 측 = AsyncStorage 사용자 알람 리스트만.
- routine confirm_prompt alarm (= native AlarmKit 측만 등록) = 누락.
- → conflict null → dialog X.

### 자연어 설명

- 갭 체크 dialog 자체는 살아있음. 꺼지지 않았음.
- 그러나 = "사용자가 등록한 알람만" 검사.
- 루틴 진행 중에 native에 등록된 confirm_prompt 알람 (= 2분 후 다음 발화 예정)은 사용자 등록 알람 리스트가 아니므로 = 검사 대상 누락.
- 따라서 갭 0~2분이어도 dialog 안 뜸.

### 정정 (옵션 A — 정확한 갭 체크)

`AlarmkitBridge.listAlarms()` + `listAllAlarmMetadata()` 측 native alarm 추가 검사:

```ts
const nativeAlarms = await AlarmkitBridge.listAlarms();
const allMeta = await listAllAlarmMetadata();
const userAlarmIds = new Set(enabledAlarms.map(a => a.id));
for (const native of nativeAlarms) {
  let nextFire: number | null = null;
  if (native.state === 'countdown' && native.preAlertSeconds != null) {
    nextFire = nowMs + native.preAlertSeconds * 1000;
  } else if (native.state === 'scheduled' && native.fixedFireMs != null) {
    nextFire = native.fixedFireMs;
  }
  if (nextFire === null || nextFire < nowMs || nextFire > limitMs) continue;
  const meta = allMeta.find(m => m.alarmId === native.id);
  if (!meta) continue;
  if (meta.type !== 'confirm_prompt' && meta.type !== 'alarm_main') continue;
  // 사용자 알람 중복 회피
  if (meta.type === 'alarm_main' && userAlarmIds.has(meta.entityId)) continue;
  // conflict 갱신 (isUserAlarm=false 측 = routine alarm)
}
```

### conflict `isUserAlarm` flag 추가 + onPress 분기

| isUserAlarm | "그래도 시작" onPress 측 동작 |
|-------------|-------------------------------|
| true | 임시 disable + cancel + AsyncStorage 저장 (= 직전 흐름 보존) |
| false (= routine alarm) | cancel ❌, 그대로 (= routine 종료 X, 동시 진행) |

= **routine alarm 측 = "그래도 시작" 누름 시 routine 종료 X, Timer/Routine 시작만**.

### 수정 파일
- `src/screens/HomeScreen.tsx` (handleStart 측 갭 체크 + onPress 분기)
- `src/screens/RoutineListScreen.tsx` (handlePlay 측 갭 체크 + import 추가 + onPress 분기)

### 영향 스크린 (확인)

| 스크린 | 갭 체크 | routine alarm 누락 | fix |
|--------|---------|------|-----|
| HomeScreen.tsx (Timer) | ✅ | ❌ | ✅ |
| RoutineListScreen.tsx (루틴탭) | ✅ | ❌ | ✅ |
| AlarmListScreen.tsx (알람탭) | ❌ 없음 | 해당 없음 | — |
| FavoritesListScreen.tsx | ❌ 없음 | 해당 없음 | — |
| RoutineAlarmScreen.tsx | ❌ 없음 | 해당 없음 | — |

### iOS/Android 차이
- 본 fix = **iOS only** (`AlarmkitBridge` = iOS 전용).
- Android 측 = expo-notifications 별도 영역, 본 fix 무관.

---

## 검증 상태

| 항목 | 결과 |
|------|------|
| tsc | OK (에러 없음, 3건 모두) |
| 콘솔 에러 | 0 |
| iOS 디바이스 검증 | 미수행 (= QA 창 영역) |
| Android | 본 fix = iOS only, Android 측 영향 없음 |

---

## 후속 작업

1. **QA 창 측 iOS 디바이스 검증**
   - Timer 1초 무음 갭 = 사용자 체감 확인
   - 루틴 진행 중 Timer 시작 시 dialog 노출 확인 + "그래도 시작" 측 동시 진행 확인
   - 다른 routine 진행 중 루틴탭 측 새 routine 시작 시 dialog 노출 확인
   - Chain 30개 ringing 보장 60분 측 정상 동작 확인

2. **기존 데이터 측 chain cleanup**
   - 기존 50개 등록 chain = 점진 cleanup. `syncAllAlarms` 호출 시점 측 60분 기준 죽은 chain 판단.

3. **보류**
   - Sub A-5: Pause/Resume + ACTIVE_TIMER_KEY 폐기 (= 사용자 "지금 동작 보존" 의도)

---

## 미커밋 / Untracked 파일

본 작업 외 untracked (= 본 커밋 미포함):
- `log01.md`, `log02.md` — 디버그 로그 (= .gitignore 권고)
- `v2_session_*.md` — 사용자 외부 자료
- `docs/plan-brief-2026-05-23-ios-rearm-churn-regression.md` — 별도 계획서
- `assets/sounds/파일변경/` — 사용자 작업 영역
