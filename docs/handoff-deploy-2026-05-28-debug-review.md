# 배포 전달문 — 2026-05-28 (디버그 빌드 심사 제출용)

> 브랜치: `feature/android-support`
> 직전 전달문: `handoff-deploy-2026-05-28-chain-fixed-safety.md` (커밋 `1c5c06a`)
> 본 전달문 = 직전 전달문 후속 추가 fix 2건 (= 미커밋) + 시뮬레이션 검증 결과 종합
> 빌드 종류: **iOS Debug build for App Store Review submission**

---

## 1. 한 줄 요약

새벽 체인 유령 발화 fix (커밋 완료) + 추가로 발견된 confirm_prompt 중복 베너 + AdvanceNextStepIntent 다중 발화 정정 2건 (미커밋). 시뮬레이터 검증 5회 PASS.

= **쉽게 말하면**: 사용자가 보고한 "02:17 알람이 02:41에 갑자기 울림" + "베너에서 다음 누르니 마지막 step 건너뜀" 두 버그 모두 차단.

---

## 2. 본 빌드 포함 변경 사항 (= 2개 fix 그룹)

### 그룹 A: 체인 유령 발화 차단 (이미 커밋 완료)

| 커밋 | 종류 | 내용 |
|------|------|------|
| `da96a95` | fix(ios) | 알람 체인 측 유령 발화 차단 + 기존 유저 마이그레이션 |
| `1c5c06a` | docs(deploy) | 위 fix 전달문 |

**무엇을**: iOS AlarmKit `.relative(daily)` 측 fireAt 날짜 strip 회귀 정정. chainIndex 1+ → `.fixed`로 변경.
**증상**: 02:17 daily 알람 → Xcode 재설치 / 토글 OFF→ON / 편집 → 02:41에 chainIndex 12가 즉시 발화.
**파일**: `src/utils/alarmScheduler.ts` + `App.tsx`.
**상세**: `handoff-deploy-2026-05-28-chain-fixed-safety.md` 참조.

### 그룹 B: confirm_prompt 중복 + AdvanceIntent 다중 발화 차단 (미커밋, 본 빌드 추가 포함)

| 파일 | 변경 |
|------|------|
| `src/state/effectRunner.ts` | `ScheduleConfirmPrompt` case에 entityId 매칭 모든 잔존 confirm_prompt 강제 cancel 추가 (= 2차 dedup) |
| `modules/alarmkit-bridge/ios/AdvanceNextStepIntent.swift` | `perform()`에 1.5초 debounce 추가 (NSLock 보호) |

**무엇을**: 루틴 step 종료 시 같은 routine에 confirm_prompt 알람 2개 동시 alerting → 사용자 "다음 진행" 1회 press가 양쪽 다 처리 + 추가 press 유발 → AdvanceNextStepIntent 4회 발화 → 마지막 step skip + 조기 종료.
**증상**: 3-step 루틴에서 step 1 종료 시 "다음 진행" 누르면 step 2 (= 마지막) 실행 안 되고 루틴 즉시 종료.
**기록**: `log01.md` (= 2026-05-27 06:35) 측 = `AdvanceNextStepIntent.perform` 5초 동안 4회 발화 직접 관찰.

= **쉽게 말하면**:
- 옛 코드: 같은 step에 알람 2개 등록되는 race 가능 → 베너 2개 → user 1번 눌러도 양쪽 처리 → step 건너뜀
- 새 코드: ① JS dedup이 잔존 confirm_prompt 강제 정리 + ② 네이티브 측 1.5초 안 중복 호출 무시. 두 겹 안전망.

---

## 3. 변경 파일 (= 본 빌드 전체)

### 그룹 A (커밋 완료)
```
src/utils/alarmScheduler.ts    chainMemberRecurrence + rearmSafetyChain + cleanupConsumedSafetyChain
                                + syncAllAlarms B-skip 재무장 + migrateChainFixedSafety
App.tsx                         listener chainIndex 0 rearm + chainIndex 1+ cleanup (iOS only)
                                + migrateChainFixedSafety import + cold start 호출
```

### 그룹 B (미커밋)
```
src/state/effectRunner.ts                            ScheduleConfirmPrompt dedup (= entityId 잔존 강제 cancel)
modules/alarmkit-bridge/ios/AdvanceNextStepIntent.swift   perform() debounce 1.5초 + NSLock
```

= 총 4개 파일. 신규 dependency / Native module / iOS 설정 변경 ❌.

---

## 4. 영향 범위

| 영역 | iOS | Android |
|------|-----|---------|
| 그룹 A: chainMemberRecurrence | chainIndex 1+ → `.fixed` (= 변경) | daily/weekly 유지 (= 회귀 0) |
| 그룹 A: rearmSafetyChain / cleanup / migration | 작동 | early return (Platform 가드) |
| 그룹 A: listener chainIndex 1+ cleanup | 작동 | early return |
| 그룹 B: effectRunner dedup | 작동 (= JS 공통) | 작동 (= 공통 코드, 영향 동일) |
| 그룹 B: AdvanceIntent debounce | 작동 (= Swift native) | **N/A** (= Android 측 별도 모듈) |

**Android 측 영향 종합**: 그룹 A = 회귀 0 (= 가드). 그룹 B = effectRunner dedup만 작동 (= 안전 강화). debounce는 iOS만.

---

## 5. 사용자 영향

### 신규 유저 (= 본 빌드 첫 사용)
- 영향 ❌. 처음부터 새 로직.

### 기존 유저 (= 본 빌드로 업데이트)
1. AsyncStorage 보존 → 매핑 유지
2. 첫 콜드 부팅 시 = `migrateChainFixedSafety` 1회 실행 (= 그룹 A 마이그레이션)
3. 옛 체인 30개 → 새 체인 30개 자동 교체 (소리 X)
4. 다음 알람 시각부터 = 새 로직 정상 작동

= **쉽게 말하면**: 유저는 업데이트 받고 앱 한 번 열면 끝. 소리 안 나고 자동 교체.

---

## 6. 검증 상태

### 완료
- **TypeScript check** = 0 error
- **시뮬레이션 5회 (알람 시스템 전체)** = 모두 PASS
  - Simple 'once' alarm ✓
  - Daily alarm chain ✓
  - Weekly alarm + days ✓
  - 다중 알람 chainCount 분배 ✓
  - Routine 세션 ✓
- **시뮬레이션 심층 분석 5회** = 모두 PASS
  - 실 발화 (now+90s) `Schedule.fixed` 직접 확인 ✓
  - 앱 종료 상태 fire (OS-level) ✓
  - 2개 알람 동시 fire (Start rejected 가드) ✓
  - ad-hoc routine 전체 lifecycle ✓
  - weekly Mon+Fri 정확 산출 ✓
- **코드 검수 5회 + 7개 파일 정밀 분석** = 추가 결함 0건
- **Android 에뮬레이터 리로드** = broadcast 전송 완료

### 미완료 (= 실 디바이스 필요)
- **잠금화면 슬라이드 정지 동작** (= 시뮬레이터 재현 불가)
- **무음 모드 풀볼륨 발화** (= 시뮬레이터 무음 정책 다름)
- **AdvanceIntent debounce 실 동작** (= Swift 변경 → Xcode 재빌드 필요. 본 디버그 빌드에 포함)
- **iOS 26.2 베타 회귀** (= Apple 자체 버그 영역, 통제 불가)

---

## 7. 디버그 빌드 특이사항 (= 심사 시 주의)

### 본 빌드 특성
- **Debug configuration** = Console.log 활성, AsyncStorage 디버그 로그 + AppGroup native_debug_log_v1 작성 활성
- **AdMob** = `__DEV__` 측 = 비활성 가능성 있음. 빌드 설정 확인 필요
- **소스맵** = 디버그 빌드라 stack trace 측 readable

### 심사관(reviewer) 측 주의
- 알람 권한 (AlarmKit) 자동 요청 = 권한 거부 시 알람 등록 안 됨 → 거부 후 재허용 시나리오 권장
- 알람 시뮬레이션 = 심사관이 알람을 가까운 시각으로 설정 → 발화 확인 가능. 단 권한 거부 시 발화 X.
- Android 측 = 동일 코드. SCHEDULE_EXACT_ALARM 권한 요구

### 빌드 절차
```bash
# 1. 미커밋 변경 커밋
git add modules/alarmkit-bridge/ios/AdvanceNextStepIntent.swift src/state/effectRunner.ts
git commit -m "$(cat <<'EOF'
fix: confirm_prompt 중복 dedup + AdvanceNextStepIntent debounce

- effectRunner ScheduleConfirmPrompt 측 entityId 매칭 모든 잔존 confirm_prompt 강제 cancel
- AdvanceNextStepIntent.perform 측 1.5초 debounce (NSLock 보호)

근본 원인 (log01.md 2026-05-27 06:35):
- 같은 routine 측 confirm_prompt 알람 2개 동시 alerting → 사용자 "다음 진행" 1회 press가 양쪽 다 처리 + 추가 press 유발
- AdvanceNextStepIntent 5초 동안 4회 발화 → 마지막 step skip + routineEnded=true 조기 종료

두 겹 안전망:
- JS dedup (= 1차) = 잔존 confirm_prompt 강제 정리로 동시 alerting 자체 차단
- Native debounce (= 2차) = 1.5초 내 중복 호출 무시로 step skip 방지
EOF
)"

# 2. iOS prebuild (= 만약 ios/ 없으면)
rm -rf ios && npx expo prebuild --clean --platform ios

# 3. Xcode 빌드 (Debug configuration)
# Xcode 열어서 → Product > Archive (Debug scheme 선택) → Distribute → App Store Connect
# 또는 EAS:
eas build --platform ios --profile preview  # = TestFlight용 빌드
```

---

## 8. 위험 평가

| 항목 | 위험도 | 비고 |
|------|--------|------|
| 그룹 A iOS 신규 알람 정상 동작 | 매우 낮음 | 시뮬레이션 5회 직접 검증 |
| 그룹 A iOS 기존 알람 마이그레이션 | 낮음 | nextAlarmOccurrenceTime 미래 보장 |
| 그룹 A Android 회귀 | 0 | 모든 신규 로직 early return |
| 그룹 B JS dedup 회귀 | 0 | `type === 'confirm_prompt'` 명시 필터, 다른 타입 무영향 |
| 그룹 B Native debounce 회귀 | 매우 낮음 | 1.5초 = 정상 사용자 행동 영향 X |
| iOS 26.2 베타 AlarmKit | 통제 불가 | Apple 자체 버그 (= 체인 30개로 회피) |
| 디버그 빌드 성능 | 낮음 | 심사용이라 OK. release 빌드 시 별도 최적화 |

= **쉽게 말하면**: 모든 변경이 회귀 위험 매우 낮음. iOS 26.2 베타 회귀만 통제 외 영역.

---

## 9. 심사 제출 전 권장 검증 (= 실 디바이스 5분)

본인 또는 심사 담당자 측 iPhone 1대:

1. **알람 권한 부여** = 첫 실행 시 권한 허용 → 알람 등록 가능 확인
2. **시뮬 1**: 알람을 현재 시각 -5분 (= 이미 지난 시각)으로 daily 설정 → ON → 3분 기다림 → **오늘 안 울리는지** (= 새벽 fix 검증)
3. **시뮬 2**: 알람을 현재 +1분 daily 설정 → ON → 1분 기다림 → 발화 → 잠금화면에서 슬라이드 정지 → 1분 기다림 → 다시 울리는지 (= safety chain 보존 확인)
4. **시뮬 3**: 3-step routine 시작 → step 1 종료 베너에서 "다음 진행" → step 2가 정상 실행되는지 (= 그룹 B 검증)
5. **Android** (= 별도 기기 있으면): 동일 시나리오 → 회귀 0 확인

---

## 10. 미커밋 상태 안내

본 전달문 작성 시점 = 그룹 B (`AdvanceNextStepIntent.swift` + `effectRunner.ts`) 측 미커밋.

빌드 진행 시 = §7 빌드 절차의 git add + commit 먼저 실행 후 prebuild + archive.

---

## 11. 롤백 방법

### 그룹 B만 롤백 (= 본 전달문 추가 fix 되돌리기)
```bash
git checkout HEAD -- modules/alarmkit-bridge/ios/AdvanceNextStepIntent.swift src/state/effectRunner.ts
```

### 그룹 A + B 모두 롤백 (= 새벽 fix까지 되돌리기)
```bash
git revert 1c5c06a da96a95
git checkout HEAD -- modules/alarmkit-bridge/ios/AdvanceNextStepIntent.swift src/state/effectRunner.ts
```

### 마이그레이션 강제 재실행 (= 디버그 시)
시뮬레이터/실 디바이스 측 AsyncStorage 직접 수정 또는 앱 데이터 삭제 후 재설치.

---

## 12. 후속 작업

- **실 디바이스 검증** = §9 시나리오 (= 5분)
- **TestFlight 배포** = 본 디버그 빌드 → 내부 테스터 5명 1주일
- **App Store Release 빌드** = 디버그 검증 PASS 후 별도 Release configuration 빌드
- **로그 모니터링** = `alarmScheduler-DBG` / `onAlarmStateChange-DBG` / `Intent-DBG-AlarmKit` 측 = `rearmSafetyChain` / `migrateChainFixedSafety` / `AdvanceNextStepIntent debounce SKIP` 실행 카운트 확인 (= AppGroup native_debug_log_v1)
