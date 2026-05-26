# 안드로이드 알람 엔진 — 최종 진행 인계 (2026-05-26)

> 다음 세션 측 = 이 문서 + `docs/context-notes-2026-05-22-android-alarm-engine.md` 측 = 먼저 읽으면 됨.

---

## 0. 한 줄 요약

**Android 알람 엔진 Phase 0~3-5 측 전부 완료 + Pixel 에뮬레이터 측 검증 PASS + push 완료.** 잔여 = 실 Samsung 기기 측 실측 검증 (= 에뮬레이터 측 한계 영역).

---

## 1. Phase 별 완료 상태

| Phase | 영역 | 상태 | 커밋 | 검증 |
|-------|------|------|------|------|
| 0 | 게이트 | ✅ | - | - |
| 1 | 모듈 기반 (manifest 권한 8개, 스텁 제거) | ✅ | (이전) | 빌드 PASS |
| 2 | 엔진 코어 (setAlarmClock 예약/취소) | ✅ | (이전) | 빌드 PASS |
| 3 | 발화 체인 (Receiver→Service, 소리/진동/볼륨) | ✅ | (이전) | 빌드 PASS |
| 4 | 전체화면 + RN 연결 (AlarmEventBus + MainActivity merge + cold-start polling) | ✅ | (이전) | 빌드 PASS |
| 5 | 타이머 연결 (HomeScreen `shouldUseAlarmKitInTimer` Android 허용) | ✅ | (이전) | 빌드 PASS |
| 6 | 재부팅 복원 (`BootReceiver` + `rescheduleAllFromBoot`) | ✅ | (이전) | 빌드 PASS |
| 7 | 해제·정리 (`AlarmService.onDestroy`) | ✅ | (이전) | 빌드 PASS |
| 1 후속 | POST_NOTIFICATIONS 런타임 권한 흐름 | ✅ | (이전) | 에뮬레이터 PASS |
| Audit | 4종 알람 × iOS/Android 정합 점검 | ✅ | (이전) | - |
| 2-1 | pauseAlarm/resumeAlarm Kotlin + paused map 영속 | ✅ | (이전) | 에뮬레이터 PASS (remainingMs=223,132ms 정확) |
| 3-2 | AlarmReceiver 측 daily/weekly 다음 occurrence 재예약 + computeNextOccurrence | ✅ | (이전) | dex symbols 확인 |
| 3-0a | alarmScheduler.ts 측 Android 허용 | ✅ | (이전) | 검증 PASS |
| 3-1 | Module UUID per schedule (chain 충돌 차단) | ✅ | (이전) | 에뮬레이터 측 chain 30개 unique UUID 등록 검증 PASS |
| 3-4 | AlarmListScreen 측 Android 허용 (unsupported 화면 제거) | ✅ | (이전) | 검증 PASS |
| 2-2 | ongoing chronometer notification (setUsesChronometer + setChronometerCountDown + setWhen) | ✅ | (이전) | dex 확인 |
| 3-0b | routineScheduler.ts 측 `_alarmKitAvailable` Android 허용 | ✅ | (이전) | dex 확인 |
| 3-3 | AlarmActionReceiver + secondary action button + App.tsx listener + dispatch Advance | ✅ | (이전) | dex 확인 |
| **3-5** | **Samsung 측 배터리 최적화 deep-link + Onboarding 안내 + Settings 행** | ✅ | **`4af701a`** | **Pixel 에뮬레이터 측 표준 dialog fire PASS** |

---

## 2. 전체 시나리오 검증 (Step 8 부분 PASS, 에뮬레이터)

5단계 정확 동작:
1. **Timer schedule** = `dispatch Start → ScheduleAlarmOnce → AlarmkitBridge.scheduleAlarm → setAlarmClock` 정확 등록 (`exactAllowReason=policy_permission`).
2. **Phase 2-1 Pause** = `pauseAlarm → cancel + paused_alarms 영속` (remainingMs=223,132ms 정확 산출).
3. **Phase 2-1 Resume** = `resumeAlarm → 새 fireAt = now + remainingMs + schedule 재등록` (정확).
4. **Phase 1 Fire** = `AlarmReceiver fired → AlarmService start → AlarmEventBus.emit("alerting") → JS SESSION_EVENT_NAVIGATE → AlarmScreen mount` (정확 시점, 48ms drift).
5. **Dismiss** = `cancelEntity done targets=1 nativeFail=0 finalStale=0` + SharedPreferences 완전 정리.

Phase 3-5 측 추가 (= 본 세션 마무리):
6. **Settings 측 "배터리 최적화 설정" 행 tap** = `act=android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS / cmp=com.android.settings/.fuelgauge.RequestIgnoreBatteryOptimizations` 정확 fire (Pixel 에뮬레이터 측 = 비-삼성 path).

---

## 3. 만들어진 / 수정된 파일 (전체)

### Native (`modules/alarmkit-bridge/android/`)

- `AlarmkitBridgeModule.kt` — JS 계약 함수 전체 (scheduleAlarm/cancelAlarm/stopAlarm/listAlarms/isAvailable/권한 + pauseAlarm/resumeAlarm 실 구현)
- `AlarmScheduler.kt` — setAlarmClock 예약/취소 + SharedPreferences 영속 + paused map + computeNextOccurrence + ongoing chronometer notification helpers
- `AlarmReceiver.kt` — 발화 수신 → AlarmService 시작 + scheduleNextOccurrenceIfNeeded (Phase 3-2)
- `AlarmService.kt` — FGS(mediaPlayback), 알림+FSI, 소리(STREAM_ALARM)/진동/볼륨강제+ContentObserver + secondary action button (Phase 3-3)
- `AlarmActionReceiver.kt` — NEW (Phase 3-3): secondary button (= "다음 진행") 측 사용자 탭 → AlarmEventBus emit + cancel
- `AndroidManifest.xml` — 권한 8개 + AlarmReceiver + AlarmService(mediaPlayback) + AlarmActionReceiver(exported=false) + BootReceiver

### JS (`src/`)

- `utils/oemBatteryHelper.ts` — NEW (Phase 3-5): isSamsung() + requestIgnoreBatteryOptimization + openSamsungDeviceCare candidates chain
- `utils/routineScheduler.ts` — Phase 1 (POST_NOTIFICATIONS 권한 흐름) + Phase 3-0b (`_alarmKitAvailable` Android 허용)
- `utils/alarmScheduler.ts` — Phase 3-0a (Android 허용)
- `screens/AlarmListScreen.tsx` — Phase 3-4 (Android 허용)
- `screens/OnboardingScreen.tsx` — Phase 3-5 (samsung-battery permission slide)
- `screens/SettingsScreen.tsx` — Phase 3-5 ("배터리 최적화 설정" 행)
- `App.tsx` — Phase 3-3 (secondary_action listener + dispatch Advance)

### Module bridge

- `modules/alarmkit-bridge/src/AlarmkitBridge.types.ts` — Phase 3-3 (`'secondary_action'` state 추가)

---

## 4. 커밋 이력 (2026-05-26 전체)

```
3581942 docs(android-alarm): 진행 노트 측 Phase 3-5 완료 기록 + 잔여 정리
4af701a feat(android-alarm): Samsung 측 배터리 최적화 deep-link + onboarding 안내 — Phase 3-5
cedb605 docs(android-alarm): 알람 엔진 Phase 1-3 작업 4건 + 사이클 감사 + 진행 노트 갱신
58e5340 feat(android-alarm): App.tsx 측 secondary_action listener + dispatch Advance — Phase 3-3
5df47b7 feat(android-alarm): JS 측 가드 해제 + POST_NOTIFICATIONS 권한 흐름 — Phase 1 + 3-0a + 3-0b + 3-4
e251a0d feat(android-alarm): native 모듈 Phase 1-3 일괄 — pause/resume + ongoing notif + chain UUID + recurrence reschedule + secondaryLabel
```

브랜치: `feature/android-support` → push 완료 (origin/feature/android-support 동기화).

---

## 5. 잔여 (= 다음 세션 측 이어갈 영역)

### 5-1. 실 Samsung 기기 측 실측 검증 (= 에뮬레이터 측 한계 영역)

- [ ] FSI 잠금화면 점유 + 무음모드 우회 + 볼륨 버튼 차단
- [ ] 재부팅 복원 (`rescheduleAllFromBoot` 실 동작)
- [ ] daily / weekly 측 24h 이후 재예약 실 fire
- [ ] Samsung Device Care 측 = "잠자는 앱" 측 본 앱 등록 후 = 알람 fire 신뢰성 변화 측정
- [ ] Phase 3-5 measure: 삼성 슬라이드 측 = `openSamsungDeviceCare` candidates 중 = 실제 fire 성공 candidate index
- [ ] Phase 3-3 측 동적 검증 (= routine confirm_prompt 측 secondary button E2E flow)

### 5-2. 후속 영역 (= 본 작업 외 = 별도 세션)

- [ ] Android Widget (= iOS 측 Widget Extension 대응)
- [ ] production 빌드 (`eas build -p android --profile production`) 검증
- [ ] iOS 회귀 spot check (= 본 세션 측 = iOS 측 영향 0 보고, 실 회귀 spot test = 안 했음)
- [ ] Play Console internal testing track 측 = 외부 테스터 측 dogfood

---

## 6. 환경 상태 (= 세션 종료 시점)

- 안드로이드 에뮬레이터 `emulator-5554` = 실행 중, Phase 3-5 측 JS reload 완료, Settings → 배터리 최적화 dialog 측 dismiss 됨.
- Metro = 백그라운드 실행 중.
- 미커밋 변경 = 0건. 모든 Phase 3-5 코드 + 문서 = commit + push 완료.
- 브랜치 = `feature/android-support`, origin 동기 = OK.

---

## 7. 대기 상태

유저 측 추가 지시 대기. 가능 분기:
1. **실 Samsung 기기 검증** = 본 세션 측 한계 영역 → 유저 측 실기기 보유 시 = adb wireless / USB 연결 + 동일 시나리오 재실행.
2. **PR / 머지** = `feature/android-support` → `main` 측 PR 생성 + 머지.
3. **다른 영역** = Widget / production 빌드 / iOS 회귀 spot / Play Console 등.
