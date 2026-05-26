# 추가 배포 전달문 — 2026-05-28 (체인 유령 발화 차단)

> 브랜치: `feature/android-support`
> 직전 전달문: `handoff-deploy-2026-05-27-additional-ux-i18n-haptic.md` (`bf81787` 시점)
> 본 전달문 변경 = 미커밋 (작업트리 측 `App.tsx` + `src/utils/alarmScheduler.ts`)
> 대상 빌드: iOS Release (App Store 심사 제출용)

---

## 1. 한 줄 요약

알람 시각 ~ 알람+60분 윈도우 안에서 새로 체인이 깔리면 (= 토글 OFF→ON / 편집 / Xcode 재설치 / App Store 업데이트 직후) chainIndex 12+ 가 즉시 발화하던 **유령 알람 버그** 정정. iOS 전용. 코드 + 마이그레이션 + 옛 체인 정리 1회 자동 실행.

= **쉽게 말하면**: "02:17 알람인데 02:41에 갑자기 울리던" 사용자 보고 (log01.md, 2026-05-27) 의 근본 원인 차단.

---

## 2. 버그 메커니즘 (= 왜 울렸나)

### 발견 경로
- 2026-05-27 사용자 보고: Xcode 빌드 받아 테스트 중 02:41에 알람이 갑자기 울림. 02:17 알람만 켜둔 상태.
- log01.md 분석 결과: 02:39:33 콜드 부팅 → syncAllAlarms 측 = 매핑 빈 상태 (= 분기C) → 30개 새로 등록 → 02:41:00 발화 (= chainIndex 12).

### 원인 (= iOS 전용)
iOS `AlarmKit` 측 `.relative(daily)` 반복 알람 = **fireAt 의 시각(HH:MM)만 추출하고 날짜를 버림**. "매일 그 시각" 패턴으로 등록.

= **쉽게 말하면**: 코드가 "내일 02:41에 울려"라고 넘겨도, iOS는 날짜를 떼고 "매일 02:41" 로 저장. 그러면 "다음 02:41" = 오늘 02:41 (= 부팅 시각 02:39 기준 2분 후) → 발화.

체인 30개가 전부 daily 반복으로 박혀서, 윈도우 안 콜드 부팅 시 = 오늘 안 지난 HH:MM 측 12~29 멤버가 줄줄이 즉시 발화.

### Android 측 영향 ❌
Android = `setAlarmClock` 측 **절대 timestamp 보존** + `AlarmReceiver` 측 발화 후 +1일 재예약 = 본 버그 발생 구조 X. 회귀 없음.

---

## 3. 정정 (= 무엇을 했나)

### Fix A: chainMemberRecurrence 측 iOS chainIndex 1+ → `.fixed`
- `src/utils/alarmScheduler.ts` line 94-111
- chainIndex 0 (= 기준 알람) = `.relative(daily/weekly)` 유지 → OS 자동 반복 보존
- chainIndex 1+ (= 안전 체인 멤버) = iOS 측 `mode: 'never'` (= .fixed 단발) → AlarmKit 측 날짜 + 시각 모두 보존
- Android chainIndex 1+ = daily/weekly 유지 (= 본 버그 없음 + AlarmReceiver 자동 반복 보존)

= **쉽게 말하면**: iOS가 날짜를 떼는 게 문제니까, 1번째부터 29번째까지 알람은 "이 날짜 그대로만" 형태로 박아서 날짜 보존 강제. Android는 원래 잘 작동하니까 그대로 둠.

### Fix B: 안전 체인 재예약 로직 (= rearmSafetyChain)
- iOS 측 chainIndex 1+ 가 .fixed 단발이라 발화 후 소비됨 → 다음날부터 안전 체인 X 회귀 우려.
- 정정:
  - **listener (App.tsx)**: chainIndex 0 alerting 시 그날치 안전 체인 재예약 (중복 가드 포함, Day 1 = 이미 존재 → skip)
  - **syncAllAlarms 분기 B-skip**: chainIndex 0 살아있고 1+ 누락 시 next 미래 occurrence 기준 재예약
  - 양쪽 다 트리거되어 listener 못 잡아도 다음 앱 오픈 시 복구

= **쉽게 말하면**: 안전 체인 1~29번이 한 번 울리면 사라지니까, 매일 첫 알람 울릴 때 그날치 안전 체인을 다시 깔아주는 로직 추가. 앱이 잠들어 있으면 못 깔지만, 유저가 다음에 앱 열 때 syncAllAlarms 가 알아서 복구.

### Fix C: 옛 체인 일회성 마이그레이션 (= migrateChainFixedSafety)
- App Store 업데이트 받은 기존 유저 측 = 옛 빌드(v1.8/v1.9)에서 등록한 `.relative(daily)` 체인이 OS 레벨에 영속.
- 그대로 두면 listener metadata cleanup 측 회귀 (= 메타 lookup NULL → in-app 처리 ❌).
- 정정: 첫 콜드 부팅 1회 = 켜진 알람 전체 측 옛 체인 cancel + 새 로직으로 재등록.
- baseFireAt = nextAlarmOccurrenceTime (= 항상 미래) → 마이그레이션 자체가 유령 발화 트리거 ❌.
- AsyncStorage 플래그 측 1회 가드.

= **쉽게 말하면**: 업데이트 받기 전부터 알람 켜놨던 유저는 옛날 방식 체인이 폰에 남아있음. 업데이트 후 앱 처음 켤 때 한 번만 자동으로 옛 체인 전부 빼고 새 방식으로 다시 깔아줌. 소리 X, 그냥 등록 갈아치움.

### Fix D: 소비된 metadata cleanup
- `cleanupConsumedSafetyChain` (신규) + listener 측 chainIndex 1+ fire 시 즉시 deleteAlarmMetadata
- iOS 전용 가드 (Android = alarmId 재사용이라 삭제 시 회귀)

= **쉽게 말하면**: 한 번 울린 안전 체인 알람의 잔재 데이터를 정리해서, 다음에 새로 깔 때 중복 안 생기게 함.

---

## 4. 변경 파일 (2건)

```
src/utils/alarmScheduler.ts    chainMemberRecurrence + rearmSafetyChain + cleanupConsumedSafetyChain
                                + syncAllAlarms B-skip 재무장 + migrateChainFixedSafety (신규 export)
App.tsx                         listener chainIndex 0 rearm + chainIndex 1+ cleanup (iOS only)
                                + migrateChainFixedSafety import + cold start 호출
```

= 코드 외 신규 dependency / Native module / iOS 설정 변경 ❌. 순수 JS 측 변경.

---

## 5. 영향 범위

| 영역 | iOS | Android |
|------|-----|---------|
| chainMemberRecurrence | chainIndex 1+ → .fixed (= 변경) | daily/weekly 유지 (= 그대로) |
| rearmSafetyChain | 작동 | early return (Platform 가드) |
| cleanupConsumedSafetyChain | 작동 | early return |
| listener chainIndex 1+ cleanup | 작동 | early return |
| migrateChainFixedSafety | 1회 실행 | early return |
| syncAllAlarms B-skip 재무장 | 누락 감지 시 작동 | hasChainSafety=true 측 → skip (= no-op) |

= iOS 측 = 동작 변경 + 마이그레이션. Android 측 = 회귀 위험 0 (= 모든 신규 로직 측 early return).

---

## 6. 사용자 영향

### 신규 유저 (= 업데이트 후 알람 신규 등록)
- 영향 ❌. 처음부터 새 로직으로 등록.

### 기존 유저 (= App Store 업데이트)
1. AsyncStorage 보존 → 매핑 유지
2. 첫 콜드 부팅 시 = `migrateChainFixedSafety` 1회 실행
3. 켜진 알람 측 옛 체인 30개 → 새 체인 30개 자동 교체
4. baseFireAt = next future occurrence → 마이그레이션 도중 발화 ❌
5. 다음 알람 시각부터 = 새 로직 정상 작동

= **쉽게 말하면**: 유저는 업데이트 받고 앱만 한 번 열면 됨 (= 또는 다음 알람 시각에 알아서 부팅). 소리 안 나고 자동 교체. 평소처럼 알람 받음.

### 마이그레이션 안전성 검증
- baseFireAt = nextAlarmOccurrenceTime → 항상 미래 시각만 반환
- chainIndex 1+ = .fixed → AlarmKit 측 날짜 + 시각 보존 → 오늘 발화 ❌
- chainIndex 0 = .relative(daily) → "다음 매칭" = 내일 (= 오늘 시각 지났으면)
- 윈도우 안 마이그레이션도 = 오늘 조용 → 내일 평소대로

---

## 7. 체인 보존 결정 (= 단발 알람 X)

리서치 결과 (Apple Developer Forum + AlarmKit docs):
1. **AlarmKit 자체에 반복 울림 있음** = `postAlert` 인터벌 + `secondaryButton: .countdown`. iPhone Clock 9분 스누즈 패턴.
2. **단, 유저가 스누즈 버튼 눌러야 작동** = 자동 X. 깊이 자는 유저 보호 X.
3. **iOS 26.2 베타 3 이후 AlarmKit 알람 발화 중 멈춤 회귀** (= Apple 측 버그, Apple 데모 앱에서도 재현, https://developer.apple.com/forums/thread/809398).
4. = 체인 30개 = 깊은 잠 보장 + Apple 자체 버그 우회. v1.8 도입 결정이 옳음.

= **쉽게 말하면**: iPhone 알람의 반복 울림은 유저가 버튼 눌러야 작동. 우리 체인은 자동. 게다가 Apple 측 알람이 지금 가끔 중간에 멈추는 버그가 있어서, 30개 깔아두면 1개 멈춰도 다음 게 울려서 안전. 체인 자체는 유지가 맞음.

---

## 8. 검증 상태

### 완료
- **TypeScript check** = 0 error
- **호출자 영향 범위** = scheduleAlarmMain / cancelAlarmsForEntity / syncAllAlarms 시그니처 변경 X. 기존 호출자 (AlarmListScreen / AlarmScreen / HomeScreen / routineController / effectRunner) 영향 ❌
- **Android 에뮬레이터 리로드** = `am broadcast com.facebook.react.devsupport.RELOAD` 전송 완료

### 미완료 (= 실 디바이스 필요)
- **iOS 실 디바이스 측 마이그레이션 동작** = 시뮬레이터 측 검증 가능하나 미실행
- **유령 알람 차단 측 실 디바이스 재현 시도** = 옛 빌드에서 보고된 케이스를 새 빌드로 재현 → 차단 확인

### 권장 검증 시나리오 (= 5분, iOS 실 디바이스 1대)
1. 알람 추가 → 현재 시각 **-5분** (= 이미 지난 시각) → daily → 저장 → 토글 ON
2. 화면 보고 3분 기다림
3. **수정 전 (옛 빌드)**: chainIndex 1+ 가 줄줄이 발화 = 버그 재현
4. **수정 후 (새 빌드)**: 조용. 내일 그 시각에 첫 발화

---

## 9. 위험 평가

| 항목 | 위험도 | 비고 |
|------|--------|------|
| iOS 신규 알람 측 정상 동작 | 매우 낮음 | chainIndex 0 동일 + 1+ 만 .fixed |
| iOS 기존 알람 측 마이그레이션 | 낮음 | nextAlarmOccurrenceTime 측 항상 미래 보장 |
| iOS 측 listener 재예약 누락 | 낮음 | syncAllAlarms 측 백업 복구 path 존재 |
| iOS 측 안전 체인 robust 저하 | 중간 | 앱 완전 종료 + 미오픈 시 Day 2+ 안전 체인 X. **단, chainIndex 0 (= 본 알람) 측 OS 자동 daily → 본 알람은 정상 발화** |
| Android 측 회귀 | 0 | 모든 신규 로직 측 Platform.OS !== 'ios' 측 early return |
| 동기/race 측 회귀 | 낮음 | listener 중복 가드 (= 기존 chainIndex 1+ 존재 검사) + migrateChainFixedSafety AsyncStorage 1회 가드 |

= **쉽게 말하면**: iOS 측 = 유령 알람 차단 + 본 알람은 그대로 잘 울림. 안전 체인 (= 60분 동안 2분마다 깨워주는 거) 은 앱이 살아있을 때만 다음날부터 작동 (= 종료된 상태면 본 알람만 울림). Android 측 = 아무것도 안 바뀜.

---

## 10. 롤백 방법

### 코드 롤백 (= 본 작업 전체 되돌리기)
```bash
git checkout HEAD -- App.tsx src/utils/alarmScheduler.ts
```

### 부분 롤백 (= 마이그레이션만 비활성)
`App.tsx` 측 `await migrateChainFixedSafety();` 라인 주석 처리.
= 기존 유저 측 옛 체인 그대로 유지 (= 유령 발화 회귀 but 다른 회귀 X).

### 마이그레이션 강제 재실행
AsyncStorage 키 삭제 후 앱 재시작:
```ts
await AsyncStorage.removeItem('@shuttimer/chain_fixed_safety_migration_v2_0');
```

---

## 11. 배포 우선순위

직전 전달문 (`bf81787` = i18n + UX + haptic) 후속.
본 전달문 = **유저 직접 보고 버그 정정** (= 우선순위 높음).
함께 배포 권장. 분리 시 본 전달문 측 = 다음 빌드 최우선.

---

## 12. 후속 작업

- **실 디바이스 측 검증** = 위 §8 시나리오 1개 (= 5분).
- **iOS 26.2 베타 회귀 측 추적** = Apple Developer Forum thread 809398 측 모니터링. 향후 베타 측 fix 시 = 체인 길이 축소 검토 가능.
- **체인 정책 측 별도 옵션화 검토** = 사용자 설정 측 "안전 체인 ON/OFF" 토글 추가 가능성. 본 배포 측 X (= 현 기본 동작 유지).
- **로그 모니터링** = TestFlight 배포 시 = `alarmScheduler-DBG` / `onAlarmStateChange-DBG` 로그 측 = `rearmSafetyChain` / `migrateChainFixedSafety` 실행 카운트 확인.

---

## 13. 미커밋 상태 안내

본 변경 측 = 작업 트리 측 미커밋. 배포 진행 시 = 별도 커밋 필요.

권장 커밋 메시지:
```
fix(ios): 알람 체인 측 유령 발화 차단 + 기존 유저 마이그레이션

- chainMemberRecurrence 측 iOS chainIndex 1+ → .fixed (= AlarmKit 측 .relative(daily) 측 날짜 strip 회피)
- rearmSafetyChain + cleanupConsumedSafetyChain (= 소비된 chain metadata orphan 정리 + 다음날 안전 체인 복구)
- migrateChainFixedSafety (= 옛 .relative(daily) 체인 → .fixed 1회성 자동 교체)
- syncAllAlarms 분기 B-skip 측 = 안전 체인 누락 감지 + 재예약
- App.tsx listener 측 chainIndex 0 alerting 시 rearmSafetyChain + chainIndex 1+ fire 시 metadata cleanup (iOS only)

근본 원인 = AlarmKit `.relative(daily)` 측 = fireAt HH:MM 만 추출 → 윈도우 안 콜드 부팅 / 토글 OFF→ON / 편집 시 chainIndex 12+ 의 시각이 오늘 미래 → 즉시 발화 (= log01.md 2026-05-27).
Android 측 = 절대 timestamp 측 보존 → 본 버그 X → 모든 신규 로직 측 Platform.OS !== 'ios' 측 early return.

사용자 보고: 02:17 daily 알람 측 = Xcode 재설치 후 02:41 갑자기 발화.
```
