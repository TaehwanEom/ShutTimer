# iOS 배포창 전달 — 디버그 + 심사 통합 (2026-06-10)

발신: iOS 구현창. 대상: iOS 배포창. 브랜치: `feature/android-support`. 버전: **1.8.9 / build 246**.

> ⚠️ 심사 제출은 **유저 승인 후에만.** 본 문서는 빌드 대상·상태·차단요소 정리용.

---

## ⚡ 최신 업데이트 (2026-06-10 추가 — 이 블록 우선)

### 새 커밋 (build 246 이후 추가됨 → 246은 구버전)
| 커밋 | 내용 |
|---|---|
| `295b7d6` | 알람탭 단계이름 자동채움(루틴탭과 동일 "루틴 01~") + #ReArmChurn 1차(불충분) |
| `ebcd1dd` | **#ReArmChurn 보강(실 수정)** — 잠금화면 루틴 진행 중 깜빡임+버튼 재등장 원인 수정 |

### #ReArmChurn = 이번 핵심 수정
- 증상: 잠금 중 루틴 "다음 진행" 후 앱 깨어날 때 **잠금화면 카드 깜빡임 + "다음" 버튼 재등장**(재press 시 step skip 위험).
- 수정: native advance 후 Resync가 살아있는 알람을 cancel→재생성하던 churn 차단. **전부 JS 변경 → pod install 불요.**
- 검증 마커: 실기기 로그에 `[effectRunner] ScheduleConfirmPrompt SKIP same-step rearm` 뜨면 가드 작동.

### ✅ 빌드 순서 (반드시 이대로 — "고침 ≠ 확인됨")
**1단계: 디버그 빌드 → 실기기 검증 먼저**
- 대상 기기: **iPhone 12 mini** (iPhone13,1). build UDID `00008101-001E49D0027A001E` (devicectl: `156007CD-3C9F-59AC-ABDD-DD2CDB4EC010`). 연결·페어링 확인됨, 개발자모드 ON.
- 검증 절차: 루틴(2단계 이상) 잠금 진행 → "다음 진행" 누르고 앱 깨우기 → `idevicesyslog`에서
  - `SKIP same-step rearm` 마커 확인 + **LiveActivity 안 깜빡임** 확인
  - 알람탭에서 단계 이름 비우고 저장 → "루틴 01" 자동 들어가는지
- ⚠️ **시뮬레이터 불가**(AlarmKit 미발화) → 반드시 실기기.

**2단계: 디버그 검증 통과 후에만 → 심사용 재빌드(247)**
- `eas build -p ios --profile production --local` (watchOS 26.5 설치됨, iCloud 제외 상태 그대로)
- 버전 1.8.9. "이 버전의 새로운 기능" = 잠금 루틴 수정 (영·한·일·중, `docs/release-notes-1.8.9-*` 참조)
- `eas submit` 업로드는 **유저 승인 후**.

### ⚠️ 주의
- 빌드는 working tree 전체 포함 → **타 창 미커밋분(카메라/TFLite/UI)도 들어감** (240/246과 동일 상태).
- 타입에러 1건 `AlarmEditScreen:221` = 타 창, 런타임 무해.
- 깜빡임 fix는 **실기기 미검증** 상태(시뮬레이터 한계) → 1단계가 그 검증임.

---

---

## 0. 현황 한눈에

| 항목 | 상태 |
|---|---|
| App Store 직전 제출 | 1.8.8 (240) — 판매 준비됨 |
| **production .ipa** | **빌드 246 생성 완료** — `build-1781021438770.ipa` (104MB, watchOS 통과) |
| watchOS 26.5 아카이브 차단 | ✅ 해소(플랫폼 설치) |
| iCloud Phase 2 | 제외(entitlement 없음) — capability 작업 불필요 |
| 타입 에러 | 1건 (`AlarmEditScreen:221`, 타 창, 런타임 무해) |

### ⚠️⚠️ 빌드 246의 버전 표시 위치 주의 (중요)
- **빌드 246은 "버전 위치 변경 전"에 빌드됨** → 버전이 **설정 화면 가운데**(`dfa25c7`)로 들어가 있음.
- 유저 요청 = **스플래시(첫 화면) 왼쪽 하단**. 이 변경은 **미커밋 상태(`SplashScreen.tsx`)라 246에 없음.**
- → **버전을 스플래시 하단으로 넣은 최종본을 심사에 올리려면 재빌드(247) 필요.** 246 그대로 올리면 설정 가운데 버전.

---

## 1. 이번 사이클 커밋된 변경 (1.8.9)

| 커밋 | 내용 | 검증 |
|---|---|---|
| `ba5079b` | 삭제 후 재설치 복원(Keychain) + 잠금 루틴 cold-start 미진행 fix + iCloud 브리지 | iOS 실기기 검증(6/5) |
| `33b254a` | expo-secure-store 의존 추가 | — |
| `2a87fed` | 루틴 단계 이름 자동입력 ("루틴 01~") | 시뮬 미검증 |
| `dfa25c7` | 버전 표시(설정 하단) | ⚠️ 아래 미커밋분으로 **스플래시 이전** |
| `ba83e1c` | 인앱 공지 갱신(5월 제거 + 신규 3개, 14개 언어) | 원격 notices.json도 갱신됨(라이브) |
| `127235f` | **cold-start 시 루틴 마지막단계 미션 갑자기 종료 fix** (#LastStepMissionPop) | 실기기 검증 필요 |
| `fd84040` | 위 fix **로그 마커**(`LastStepMissionPop 가드 발동`) + RoutineAlarm 가드 보강 | 로그로 device 검증용 |

---

## 2. 미커밋 (working tree — 빌드 포함됨)

**내 작업 (커밋 대기):**
- `SplashScreen.tsx` — **버전 스플래시 왼쪽 하단 이동** (포맷 `1.8.9 (246)`). ⭐ 유저 최종 요청 위치.
- `SettingsScreen.tsx` — 설정 가운데 버전 **제거**(스플래시로 이동했으므로).

**타 창 (TFLite/UI/Android 공통):**
- `tfliteModelCache.ts`, `AlarmCameraMode.tsx`, `AddTimerScreen.tsx`
- `TimerDigital.tsx`, `DurationWheelPicker.tsx`, `TimeWheelPicker.tsx`, `ActiveRoutineSection.tsx`
- `effectRunner.ts`, `routineScheduler.ts`, `AlarmEditScreen.tsx`(+타입에러), package.json/lock 일부

> ⚠️ EAS `requireCommit` 미설정 → **빌드는 working tree 전체 포함**. 246에도 타 창 미커밋분 들어감(240과 동일 상태).

---

## 3. 검증 상태 (솔직)

| 대상 | 시뮬레이터 | 실기기 |
|---|---|---|
| 앱 실행/크래시 | ✅ 정상 | — |
| 네비게이션(설정 진입 등) | ✅ 정상(회귀 없음) | — |
| 버전 표시(스플래시 좌하단 `1.8.9`) | ✅ **화면 확인** | — |
| **알람 종료 미션** | ❌ **불가** (AlarmKit가 시뮬레이터서 발화 안 함) | 필요 |
| **cold-start 미션 pop fix** | ❌ 불가(같은 이유) | **로그 마커로 검증** |

→ **AlarmKit는 시뮬레이터에서 발화 안 함.** 알람 미션·cold-start fix는 **실기기에서 로그(`LastStepMissionPop 가드 발동`)로 검증**해야 함.

---

## 4. 디버그 빌드(실기기 검증) — 권장
1. `npx expo prebuild -p ios --clean` → `cd ios && pod install`
2. `npx expo run:ios --device <12미니 UDID>` (개발자 모드 ON 필요)
3. 실기기 검증:
   - 알람/루틴 마지막단계 설정 → 잠금 → 발화 → cold-start 재현
   - `idevicesyslog`로 `LastStepMissionPop 가드 발동` + AlarmScreen 미해제 확인 = fix 작동
   - 버전 스플래시 좌하단 표시 확인
   - 콘솔 에러 0

---

## 5. 심사용 빌드 — 차단/조치

| # | 항목 | 조치 |
|---|---|---|
| 1 | **246엔 스플래시 버전 없음** | 스플래시 버전 커밋 후 **재빌드(247)** → 최종본 |
| 2 | 미커밋 타 창 혼입 | 각 창 커밋·정리 후 깨끗한 빌드 권장 |
| 3 | 타입 에러 1건 | `AlarmEditScreen:221` (타 창) |
| 4 | cold-start fix 실기기 검증 | §4 로그 검증 후 |
| 5 | 빌드 넘버 | 246 사용 → 재빌드 시 247 자동 증가 |

→ **1~5 미해결로 심사 제출 금지.** 특히 1(버전 위치)·4(검증).

---

## 6. 심사 제출 절차 (승인 후)
1. 스플래시 버전 커밋 + §2 정리 → **재빌드(247)**
2. `eas submit -p ios --profile production` (ASC App ID `6761991860`) → 업로드(처리 10~30분)
3. TestFlight 기기 설치 → 알람 미션·버전 최종 확인
4. **"이 버전의 새로운 기능"** 입력 — `docs/release-notes-1.8.9-...` (잠금 루틴 수정, 영·한·일·중):
   - 한: "잠금 상태에서 알람을 끈 뒤 루틴이 진행되지 않던 문제를 수정했습니다."
5. 심사 제출 (유저 승인 후)

---

## 7. 요약
- **빌드 246 = .ipa 생성 완료(watchOS 통과)** — 단 **버전이 설정 가운데**(스플래시 아님).
- **스플래시 버전(유저 최종 요청)·타 창 정리 → 재빌드(247)가 심사용 최종본.**
- 알람 미션·cold-start fix = **실기기 로그 검증**(시뮬레이터 불가).
- 배포는 유저 승인 후.
