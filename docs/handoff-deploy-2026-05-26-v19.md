# Deploy 창 인계 — v1.9 자율주행 fix 22건 (2026-05-26)

**브랜치**: `feature/android-support`
**Build 창 완료 commit**: 14건 (= 6 직전 + 8 자율주행)
**Build 자동 검증**: tsc 전체 통과 ✅
**디바이스 QA**: **미수행** = Deploy 창 측 디바이스 측 필수 검증 후 store submission

---

## Part 1 — 변경 영역 (= QA 필수 시나리오 매핑)

### A. 알람/Timer 사운드 시스템 (= 6 commit)

| commit | 영역 | QA 시나리오 |
|--------|------|-------------|
| `343aa19` | AlarmScreen Audio first then native stop | TC-A1: 알람 fire → 앱 active 진입 → 사운드 1초 끊김 X |
| `7e14942` | chain max 30 (= 60분 ringing) | TC-A2: 알람 등록 후 미dismiss = 60분 후 native banner 자동 종료 |
| `9b6e6db` | timer/routine 갭 dialog (= routine alarm 검사) | TC-A3: 루틴 진행 중 Timer 시작 시 갭 dialog 노출 |
| `08a19c3` | 갭 dialog 측 timer_main 검사 추가 | TC-A4: Timer 진행 중 routine 시작 시 갭 dialog 노출 |
| `c9f6593` | dialog body 시각 표시 제거 (label만) | TC-A5: dialog 본문 = "'XXX'이(가) 예정되어 있습니다" 형식 |
| `508564d` | 갭 체크 함수 추출 + pause+dial 변경 측 갭 dialog | TC-A6: Timer 일시정지 + dial 회전 + 재생 → 갭 dialog → "취소" = paused 유지 |
| `999b551` | pause+dial dialog "취소" 시 isPaused 복원 | TC-A7: 직전 dialog "취소" 누름 시 UI 측 paused 그대로 (= 카운트다운 진행 X) |

### B. 백그라운드 사운드 + orphan alarm cleanup (= 2 commit)

| commit | 영역 | QA 시나리오 |
|--------|------|-------------|
| `f4ecbde` | routine in-app 사운드 background skip + orphan cleanup on active | TC-B1: 백그라운드 routine step alerting = native banner 사운드만 (= 2중 중첩 X) <br> TC-B2: 잔존 옛 alarm 측 = 앱 active 진입 후 5초 뒤 자동 정리 |
| `6d6469d` | advance_done mapping save (= orphan 발생 root cause 차단) | TC-B3: 루틴 step 진행 후 = 다음 step alerting 시 silent skip X (= 정상 화면 진입) |

### C. soft delete + race fix 누적 (= 6 commit)

| commit | 영역 | QA 시나리오 |
|--------|------|-------------|
| `a12a56f` | mapping table soft delete + listener deleted=true silent skip | TC-C1: 알람 dismiss 직후 = 잘못된 알람 fire X (= 1ms~30초 race window 측) |
| `dd75d20` | listener cancelAlarm meta lookup 후 이동 | TC-C2: 포그라운드 알람 fire 시 = listener race X (= 정상 dispatch) |
| `75e3eeb` | Pause/Resume currentRunningAlarmId null fallback | TC-C3: routine 진행 중 위젯 일시정지 = LA pause 정상 진입 (= silent skip X) |
| `9665106` | CleanupAlertingAlarms full cancel + once chainBaseFireAt=null verify | TC-C4: 옛 빌드 metadata 잔존 시 = 활성 once 알람 측 disable 안 됨 |
| `68f4316` | soft delete ghost + read lock + cleanup delay + chain verify | TC-C5: 신규 알람 등록 직후 = 자동 cleanup 측 cancel X (= 5초 delay) |
| `9e698a0` | scheduleAlarmAt atomicity rollback | TC-C6: 알람 등록 (rare 실패 시) = native + mapping 측 일관성 보장 |

### D. UI/State sync + StoreReview (= 3 commit)

| commit | 영역 | QA 시나리오 |
|--------|------|-------------|
| `461352c` | dual SoT + StoreReview chain + timer persist + markRecommend await | TC-D1: 알람 dismiss 후 잘못된 화면 이동 X <br> TC-D2: 미션 5회 성공 후 별점 모달 표시 + 중복 표시 X |
| `aff4602` | HomeScreen cold-start Session SoT + persistPausedEndAt async | TC-D3: 콜드 스타트 시 routine 측 active 시 timer 측 stale cleanup 정확 <br> TC-D4: dial 회전 후 즉시 resume 클릭 시 새 endAt 정확 적용 |
| `e7b1476` | AlarmScreen mount race mountedRef guard | TC-D5: 알람 dismiss 후 새 알람 fire 시 layout 깨짐 X |

### E. 캘린더/세션 + cache + 광고 + 로깅 (= 2 commit)

| commit | 영역 | QA 시나리오 |
|--------|------|-------------|
| `5254027` | preload await + step/alarm dedup + logger 1초 debounce | TC-E1: 콜드 스타트 직후 알람 fire = dismissMethod 정확 적용 (= 흔들기 모드 default fallback X) <br> TC-E2: 같은 step 2회 advance = 캘린더 측 1회만 기록 <br> TC-E3: 사용자 알람 재시도 = 캘린더 측 30초 내 1회만 기록 |
| `90c1242` | logger flushLogs on background | TC-E4: 백그라운드 진입 → 강제 종료 후 재시작 = 직전 로그 보존 |

---

## Part 2 — 디버그 빌드 (= 시뮬레이터 + 내부 테스트)

### 명령

```bash
# 옵션 A — Expo CLI (= 로컬 시뮬레이터, 빠름, 본 환경 측 권장)
npx expo run:ios

# 옵션 B — EAS Development Build (= 디바이스 측 internal distribution)
eas build --platform ios --profile development
```

### eas.json `development` 환경

- `EXPO_PUBLIC_SHOW_DEBUG_UI=true` (= 디버그 UI 노출)
- `EXPO_PUBLIC_HIDE_ADS=true` (= 광고 차단)
- `developmentClient=true` + `distribution=internal`

### 디버그 빌드 측 검증 가능 영역

- ✅ 22 fix 측 = JS only → Metro reload 또는 신규 빌드 후 즉시 반영
- ✅ tsc 통과 검증 = 본 환경 측 완료
- ✅ TC-A1~E4 측 일부 = 디버그 빌드 측 가능 (= 광고 측 X 영역 제외)
- ❌ TC-D2 (별점 모달) = 디버그 빌드 측 = `EXPO_PUBLIC_HIDE_ADS=true` 측 = 별점 트리거 측 영향 X (= 검증 가능)
- ❌ AdBanner / interstitial 측 검증 = 디버그 빌드 측 X = production 빌드 측 필요

---

## Part 3 — 심사용 빌드 (= App Store Production)

### 명령

```bash
# Step 1 — EAS Production Build
eas build --platform ios --profile production

# Step 2 — App Store Connect 자동 submit
eas submit --platform ios --profile production
```

### eas.json `production` 환경

- `EXPO_PUBLIC_SHOW_DEBUG_UI=false`
- `EXPO_PUBLIC_HIDE_ADS=false` (= 광고 정상 노출)
- `autoIncrement=true` (= 빌드 번호 자동 증가)
- `submit.production.ios.ascAppId=6761991860` (= App Store Connect 측 등록)

### 심사용 빌드 측 측정 가능 영역 (= 디버그 빌드 측 미가능)

- TC-D2 별점 모달 측 = 정상 트리거 + RecommendModal 표시
- AdBanner 측 = no-fill / 정상 광고 측 = 정상 표시
- Interstitial 측 = enterResult → show → 정상 dismiss 흐름
- `lastInterstitialShowAt` 60초 cooldown 측 = 중복 호출 차단

---

## Part 4 — QA 절차 (= Antigravity_4_deploy.md 정합)

### Step 1 — TC 작성 (= 위 Part 1 표 기반)

TC-A1 ~ TC-E4 = 14개. 각 TC 측 = "expected" 명시 + "FAIL condition" 명시.

### Step 2 — Device test 실행

- Expo Go 측 = 디버그 빌드 (= 옵션 A)
- 실기기 측 = production 빌드 (= TC-D2, AdBanner, Interstitial 측)
- AppState 측 = foreground / background / killed 측 모두 검증

### Step 3 — PASS/FAIL/UNTESTED 분류

- **PASS** = 디바이스 측 직접 확인 + expected 일치
- **FAIL** = expected 불일치. 재현 절차 + 정확 error 포함
- **UNTESTED** = 환경 측 직접 검증 불가. 이유 명시. **PASS 측 표기 금지 (= false reporting)**

### Step 4 — 결과 보고 (= antigravity_4_deploy.md 측 format)

```
[Task] v1.9 자율주행 fix QA 결과
Environment: Expo Go + Device
Result: XX/14 PASS

| TC | Scenario | iOS | Android | Note |
|----|----------|-----|---------|------|
| A1 | 알람 fire 1초 갭 X | PASS | - | |
| A2 | 60분 ringing 보장 | UNTESTED | - | 60분 대기 환경 X |
| ... | ... | ... | ... | ... |

UNTESTED:
- TC-A2: 60분 대기 환경 측 X
- ...

FAIL details:
- TC-XX repro: ...
```

---

## Part 5 — 알려진 주의사항

### iOS 26+ AlarmKit framework

- 본 22 fix 측 = iOS only (= AlarmkitBridge 측). Android 측 = 측 = 별도 (= expo-notifications). Android 측 = 영향 X.
- AlarmKit framework 측 = 시스템 측 영구 저장. 빌드 변경 측 무관 + 옛 native alarm 측 잔존 가능.

### 잔존 native alarm 측 (= 사용자 디바이스)

- 옛 빌드 측 등록 + mapping 누락 alarm 측 = 새 빌드 측 = `cleanupGhostAlarms` 측 = 앱 active 진입 5초 후 자동 정리.
- 사용자 측 = 앱 한번 켜기 = 자동 cleanup. 별도 안내 X.

### Sub A-5 보류

- Pause/Resume + ACTIVE_TIMER_KEY 폐기 = 본 fix 측 X (= 사용자 "지금 동작 보존" 의도).

### 검증 후 분기

- **All PASS** → `eas submit --platform ios --profile production` 실행 → App Store Connect 측 심사 등록
- **FAIL 1건 이상** → Build 창 측 인계 (= code modify 영역 X) → 재 fix → 재 QA

---

## Part 6 — Commit 누적 (= 본 세션 전체)

```
343aa19 fix(AlarmScreen): in-app 사운드 시작 후 native banner stop (옵션 B)
7e14942 chore(alarm-chain): chain 최대 50 → 30 축소 (= 100분 → 60분 ringing)
9b6e6db fix(timer/routine): 갭 체크 측 routine alarm 검사 누락 fix
08a19c3 fix(timer/routine): 갭 체크 측 timer_main 검사 누락 추가
c9f6593 refactor(alarm-conflict): dialog body 측 시각 표시 제거 + label만 유지
508564d refactor(timer): 갭 체크 함수 추출 + pause+dial 변경 측 갭 dialog 추가
999b551 fix(timer): pause+dial 변경 측 갭 dialog "취소" 시 isPaused 복원
f4ecbde fix(alarm): orphan cleanup on active + routine in-app 사운드 background skip
6d6469d fix(routine): advance_done signal 측 mapping save 추가 (root cause 차단)
a12a56f fix(#4): mapping table soft delete + listener deleted=true silent skip
dd75d20 fix(#3): listener cancelAlarm 호출 측 meta lookup 후로 이동
75e3eeb fix(#1): Pause/Resume currentRunningAlarmId null 시 native lookup fallback
9665106 fix(#6 + #9): CleanupAlertingAlarms full cancel + once chainBaseFireAt=null verify
68f4316 fix(2차 #1+#2+#3+#5): soft delete ghost + read lock + cleanup delay + chain verify
9e698a0 fix(3차 #1): scheduleAlarmAt atomicity rollback
461352c fix(UI/State 1차): dual SoT + StoreReview chain + timer persist + markRecommend await
aff4602 fix(UI/State 2차): HomeScreen Session SoT + persistPausedEndAt async
e7b1476 fix(UI/State 3차): AlarmScreen mount race mountedRef guard
5254027 fix(캘린더+cache+광고+로깅 1차): preload await + step dedup + alarm dedup + logger debounce
90c1242 fix(로깅 2차): logger background flush
```

---

## Deploy 창 측 = 본 인계 받은 후 진행

1. 본 문서 측 TC 14개 작성
2. 디버그 빌드 → Expo Go + 디바이스 측 QA
3. 심사용 빌드 → TestFlight + production 측 QA (= AdBanner / Interstitial / 별점 모달 측)
4. All PASS 시 = `eas submit` 측 App Store Connect 측 등록
5. 측 = 사용자 측 = 심사 측 결과 측 = 측 = 측 = 측 = 측 = 측 = 측 = 측 = 측 = 측 = 측 = 측 = 측 = 측 = 측 = 측 = 측 = 별도 측.
