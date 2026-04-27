# v1.6 Phase 6.5 인수인계 — 2026-04-27

채팅창 이전용. 다음 채팅에서 본 문서 + CLAUDE.md + git status 확인 후 시작.

**최종 갱신:** 배포창 빌드 인계 시점 (커밋 10ff9d1 + 빌드 결정 사항 반영)

---

## 1. 현재 상태 (한 줄 요약)

**v1.6 Phase 6.5 (RoutineAlarm 카메라 모드 통합) + en 1차 번역 모두 커밋 완료. 배포창 빌드 진행 대기 (Q1~Q4 + 빌드 클린 결정 필요). 다른 폰 검증 미완.**

**HEAD:** `10ff9d1 docs: v1.6 Phase 6.5 인수인계`
**브랜치:** `feature/v1.6-routine`
**working tree:** clean ✅
**`npx tsc --noEmit`:** EXIT=0 ✅

---

## 2. 본 사이클 커밋 히스토리

```
10ff9d1 docs: v1.6 Phase 6.5 인수인계 ← 본 문서 (다음 갱신 시점)
17ac6af feat(i18n): en 1차 동기화 — routine 섹션 186 키 영문 번역
d21143c feat: v1.6 Phase 6.5 — RoutineAlarm 카메라 모드 통합
03b700a feat: v1.6 routine 사이클 통합 + 진행 중 루틴 카드 편집/삭제 양방향 차단 (이전 사이클)
fa5d3b5 chore: .gitignore — .backup/, .claude/, *.mp4, sound/, svg/ 추가
```

**최신 git 태그:** v1.0.4 (3 사이클 전, 본 사이클 미태그)

### 2.1 변경 0 (분리 정책 정합 — 본 사이클 시점)
- `src/screens/AlarmScreen.tsx` — 0 (v1.5 출시 기능 보호)
- `src/screens/AlarmCameraMode.tsx` — 0 (365L 그대로 재사용)
- `App.tsx`, `routineController.ts`, `routineScheduler.ts`, `HomeScreen.tsx`, `RoutineListScreen.tsx`, `ActiveRoutineSection.tsx` — 0

---

## 3. Phase 6.5 작업 요약 (5 Step + 검수 + 회귀 fix)

| Step | 내용 |
|------|------|
| A | placeholder 제거 + import (worklets-core, AlarmCameraMode, MISSION_COCO_LABELS/CONFIDENCE_OVERRIDE, Detection) |
| B | 모듈 상수 (TARGET_CONFIDENCE/RETRY/BLINK/COMPLETE/ROUTINE_CAMERA_DURATION_SEC) + state 5 + ref 3 + SV 6 + Animated.Value 4 + 슬롯머신 state/ref + clearShuffle helper + frame processor 갱신 useEffect |
| C | AlarmCameraMode 마운트 + props 29개 매핑 + wrapper (검정 배경 + ShutTimer 헤더 + flex:1 박스) + Dimensions 기반 boxWidth/boxHeight |
| D | triggerDetectionSequence + reshuffleMission (MISSION_POOL 전체 — 분리 정책 D-2-i) + 카운트다운 useEffect + 만료 처리 useEffect (재시도 배너 1차 + 자동 dismiss 2차) + 스캔라인 + dangerBlink + cleanup |
| E | i18n: routine.cameraScanHint = "대상을 찾아 사진 촬영" / routine.startNext = "다음 루틴 시작" |
| 회귀 fix | (1) boxWidth/boxHeight Dimensions 기반 (2) wrapper 검정 배경 + 헤더 (3) SafeAreaView !dismissed 분기 (4) 4 useEffect dismissed 가드 |

**핵심 정책:**
- **분리 정책** (메모리 `feedback_timer_routine_separation.md`): AlarmScreen / AlarmCameraMode 무수정. 코드 별도 작성 (selectedMissions 키 미사용, MISSION_POOL 전체)
- **검증된 컴포넌트 공유 OK** (사용자 명시): AlarmCameraMode 365L 그대로 재사용 (단 파급 문제 없을 때만)
- **i18n** (메모리 `feedback_i18n_last.md`): 본 사이클은 사용자 명시로 즉시 진행 + en 1차 동기화

---

## 4. en 1차 번역 (143 키 신규 + 43 기존 보존)

| 항목 | 결과 |
|------|------|
| ko routine flat | 186 키 |
| en routine flat | **186 키** ✅ |
| 누락 | 0 |
| 초과 | 0 |

**번역 영역:** listTitle/newTitle/editTitle/fieldName, weekday (7), endMethod (4), validation*, exactAlarm*, alarmKit (3), edit (37), category (10 fixed + 모달 + 에러 = 22), days (5), sound (4), run (14), duration (3), time (4), editBlocked/deleteBlocked.

**일관성:** ko ↔ en 구조 100% 일치 (flat 186/186, nested 13개 객체 모두 동기화).

**12개 언어 (ja/zh-CN/zh-TW/fr/de/es/pt-BR/it/tr/ar/th/id):** 0 키 — Phase 7 출시 직전 일괄 (T4).

---

## 5. 검수 결과 (구현 창 자체 검수)

| 영역 | 결과 |
|------|------|
| 분리 정책 (AlarmScreen/AlarmCameraMode 변경 0, selectedMissions 미사용) | ✅ |
| AlarmCameraMode props 매핑 (29/29 누락 0) | ✅ |
| i18n 키 일치 (cameraScanHint / startNext + en 186 동기화) | ✅ |
| timer ↔ routine 양방향 충돌 가드 (handleStart, ActiveRoutineSection askUser, AlarmScreen 이중 가드) | ✅ |
| routine endMethod 분기 회귀 (tap/shake/auto 영향 0) | ✅ |
| 콜드 스타트 / 알람 진입 trace | ✅ |
| 진행 중 카드 편집/삭제 차단 (이전 사이클) 회귀 | ✅ |
| Medium fix 완료 (dismissed 가드 4 useEffect) | ✅ |
| Critical 우려 | **0** |
| Minor 우려 (matched.value deps 누락) | AlarmScreen 패턴 그대로 — 영향 미세, fix 불필요 |
| `npx tsc --noEmit` | EXIT=0 |

---

## 6. 검증 미완 — 다른 폰 빌드 후 사용자 실기기 검증 필요

### 6.1 Step D 추가분 (Phase 6.5 핵심 흐름)
1. routine endMethod=camera 알람 진입 → 카메라 + 미션 표시 ✅ (이전 채팅 검증 통과)
2. 인식 성공 → blink + fill 애니메이션 → handleDismiss → "다음 루틴 시작" modal ✅ (이전 채팅 검증 통과)
3. **30초 카운트다운** 작동 (0→30) (Step D 추가, 미검증)
4. **≤5초 카운터 빨강 깜빡** (Step D, 미검증)
5. **시간 초과 1회 → 재시도 배너** → 시간 리셋 (Step D, 미검증)
6. **시간 초과 2회 → 자동 handleDismiss** (Step D, 미검증)
7. **다시 뽑기 버튼 → 슬롯머신 → 새 미션** (Step D, 미검증)
8. **카메라 전환 버튼** → 전/후면 토글 (Step D, 미검증)
9. **권한 거부 → fallback UI** (Step D, 미검증)

### 6.2 회귀 검증
10. routine endMethod=tap → 회귀 X (탭 dismiss 정상)
11. routine endMethod=shake → 회귀 X (흔들기 dismiss 정상)
12. routine endMethod=auto → 회귀 X (controller 직접 advance, RoutineAlarm 진입 X)
13. **일반 timer 알람 (AlarmScreen) → v1.5 카메라 모드 회귀 X** (분리 정책 검증)
14. timer 진행 중 routine ▶ → askUser 가드
15. routine 진행 중 timer ▶ → handleStart 가드 (Alert)
16. 콜드 스타트 (앱 kill 후 알람 응답) → routine 카메라 진입
17. 진행 중 카드 편집/삭제 → 차단 (이전 사이클)
18. **en locale 영문 표시** (시스템 언어 영어) → routine 모든 화면 영문 정상

---

## 7. 배포 창 빌드 상태 (최종 인계 시점)

### 7.1 git 상태
| 항목 | 값 |
|------|---|
| HEAD | `10ff9d1 docs: v1.6 Phase 6.5 인수인계` |
| branch | `feature/v1.6-routine` |
| working tree | clean ✅ |
| 최신 태그 | `v1.0.4` (3 사이클 전, 본 사이클 미태그) |

### 7.2 app.json (로컬)
```json
{
  "name": "ShutTimer",
  "slug": "ShutTimer",
  "version": "1.0.1",          ⚠ v1.6 사이클인데 1.0.1 그대로
  "ios": {
    "buildNumber": "31"        ⚠ EAS appVersionSource: remote 라 무시됨 — 정리 권장
  },
  "extra": { "eas": { "projectId": "beb94412-73f7-4df6-9078-e83421d49fc2" } }
}
```

### 7.3 eas.json
```json
{
  "cli": { "appVersionSource": "remote" }
}
```

### 7.4 EAS 서버 측 (실제 출시값)
| 항목 | 값 |
|------|---|
| iOS buildNumber | 126 (다음 자동 127) |
| 최근 5건 빌드 프로파일 | 모두 production (build 7/8/9 finished, 10 canceled) |
| **preview 빌드 이력** | **0건** ⚠ |
| 마지막 성공 빌드 | 4/11/2026 build 9 (commit c4c467f) |

### 7.5 빌드 위험 4건
1. **preview 첫 시도** — Ad-hoc 인증서 + 프로비저닝 프로파일 자동 생성 필요. EAS CLI 인터랙티브 프롬프트 가능
2. **타깃 device UDID 등록 필요** — preview (internal distribution) = ad-hoc. 검증 폰 UDID 가 프로비저닝 프로파일에 없으면 빌드 성공해도 설치 불가
3. **app.json version 1.0.1** — v1.6 사이클인데 그대로 → 사용자 식별 부담
4. **마지막 빌드 4/11 → 본 빌드 4/27** — 16일 누적. fingerprint 변경 가능성 → cache miss 가능

---

## 8. Q1~Q4 결정 사항 (사용자 결정 영역, 구현 창 권장 포함)

| Q | 항목 | 옵션 | **구현 창 권장** | 사용자 결정 |
|---|------|------|--------------|----------|
| **Q1** | 빌드 식별 | (a) 그대로 1.0.1 / **(b) 1.6.0 업데이트** | (b) — v1.6 사이클 일관성 + 식별 명확. ios.buildNumber 31 도 정리 (remote 라 무시) | 대기 |
| **Q2** | UDID 등록 | YES → 진행 / NO → device:create | `eas device:list --platform ios` 로 확인 → 미등록 시 `eas device:create` | 대기 |
| **Q3** | git tag | (a) 빌드 후 tag / (b) 검증 후 tag | (a) `git tag v1.6.0-preview` + push (preview 식별) | 대기 |
| **Q4** | `eas device:list` 실행 | OK | OK — 확인 작업, 영향 0 | 대기 |
| **빌드 클린** | `--clear-cache` 사용 | (a) 기본 / **(b) `--clear-cache`** | (b) — 16일 누적 + preview 첫 시도. 안전 마진 | 대기 |

---

## 9. 배포 창 진행 절차 (Q1~Q4 + 빌드 클린 결정 받은 후)

```bash
# (Q4 OK) — device 확인
eas device:list --platform ios

# (Q1 b) — version 업데이트 + ios.buildNumber 정리
# app.json:
#   "version": "1.0.1" → "1.6.0"
#   ios.buildNumber 제거 (appVersionSource: remote 라 무시됨)

# 변경분 커밋
git add app.json
git commit -m "chore: v1.6.0 — app.json version bump + ios.buildNumber 정리 (remote 무시)"

# (Q2 — UDID 미등록 시) device 등록
eas device:create

# 빌드 (--clear-cache 권장)
eas build --platform ios --profile preview --clear-cache

# (Q3 a) — 빌드 완료 후 태그
git tag v1.6.0-preview
git push origin v1.6.0-preview

# 다른 폰 설치 (preview = ad-hoc IPA URL 또는 internal distribution 링크)
# 사용자 검증 (§6 시나리오 17건)
```

**Android 추가 시:**
```bash
eas build --platform android --profile preview --clear-cache
```

---

## 10. 향후 구현 항목 — 전체 백로그

### 10.1 routine 사이클 다음 작업 (사용자 결정 2026-04-27)

| 우선 | 작업 | 작업량 | 영역 |
|------|------|-------|------|
| **T1** | AlarmKit 통합 (chain/confirm 마이그레이션 — 64 한도 + 30초 사운드 한도 동시 해방) | ~2-3일 | routine 푸쉬 |
| T2 | 다단계 prealert (30분+5분) | ~1-2일 | routine 푸쉬 |
| T3 | 잠금 화면 컨트롤 (Live Activities / Foreground Service) — **v1.7 권장** | ~1주+ | timer + routine UX |
| T4 | Phase 7 다국어 동기화 (ja/zh-CN/zh-TW/fr/de/es/pt-BR/it/tr/ar/th/id 12개 언어) — **출시 직전 일괄** | ~2-4일 | i18n 일반 |

**구현 창 입장 — T1 권장:** 사용자 결정한 다음 작업, 가장 큰 기술 부채 (64 한도 + 30초 사운드 한도) 해소.

### 10.2 routine 외 — 앱 전체 백로그

| ID | 항목 | 상태 | 우선순위 / 비고 |
|----|------|------|--------------|
| **B1** | IAP 재활성화 (Phase 2+) | 보존 — `@preserve IAP` 태그 코드 유지 | 사업자등록 + ASC Paid Apps Agreement 활성화 후. CLAUDE.md "보존 구역" 명시 |
| **B2** | Rewarded Ads (광고 시청 시 무료 한도 해금) | 메모리 `project_v16_rewarded_ads.md` 언급 | 광고 모델 — IAP 보류 (B안) 와 함께 검토 |
| **B3** | Critical Alerts (iOS 16-25 알람 한도 보완) | 메모리 `project_v16_critical_alerts.md` 언급 | Apple Entitlement 신청 필요. AlarmKit (T1) 와 보완 관계 |
| **B4** | v1.5 카메라 모드 (AlarmScreen) 개선 | v1.5 출시 안정 | 미션 풀 확장 / 인식 정확도 / FOV 등 — 사용자 결정 영역 |
| **B5** | HistoryScreen 개선 | 기본 동작 | 통계 / 차트 / 기간 필터 — 사용자 결정 영역 |
| **B6** | SettingsScreen 개선 | 기본 동작 | 추가 옵션 — 사용자 결정 영역 |
| **B7** | AlarmKit production 인증서 / 번들 분리 | 미구현 | T1 통합 후 production 출시 시 검토 |
| **B8** | EAS production build 정식 출시 (v1.6.0) | 본 사이클 후 | T1~T4 완료 + 검증 통과 후 |

### 10.3 정책 / 운영 영역 (코드 외)

| 항목 | 상태 |
|------|------|
| 사업자등록 (IAP B1 전제) | 미진행 |
| ASC Paid Apps Agreement (IAP B1 전제) | 미신청 |
| Critical Alerts Entitlement (B3 전제) | 미신청 |
| Apple TestFlight beta tester 등록 | 미진행 |

### 10.4 출시 로드맵 (제안)

| 단계 | 작업 |
|------|------|
| 1 | 본 사이클 (Phase 6.5) 검증 → 다른 폰 PASS |
| 2 | T1 AlarmKit 통합 (chain/confirm) → 검증 |
| 3 | T2 다단계 prealert → 검증 |
| 4 | T4 다국어 동기화 (12 언어 일괄) |
| 5 | EAS production build + TestFlight + Play Console submit |
| 6 | (사용자 결정) T3 잠금 화면 / B1 IAP / B2 Rewarded Ads — v1.7 사이클 분리 |

### 10.5 T1 — AlarmKit 통합 상세 명세 (다음 사이클 첫 작업)

#### 10.5.1 현재 통합 상태

| 푸쉬 종류 | 현재 경로 | AlarmKit 통합 |
|---------|----------|--------------|
| **prealert** (시작 5분 전) | iOS 26+ AlarmKit / 그 외 expo-notifications WEEKLY | ✅ **통합 완료** ([routineScheduler.ts:210-218](../src/utils/routineScheduler.ts#L210)) |
| **routine_chain** (자동 진행 백그라운드 체인) | expo-notifications DATE trigger | ❌ **미통합** — 30초 사운드 한도 적용 |
| **routine_confirm_prompt** (확인 후 진행) | expo-notifications DATE trigger | ❌ **미통합** — 30초 사운드 한도 적용 |

**근거:** [routineScheduler.ts:2-3](../src/utils/routineScheduler.ts#L2)
> (1) 시작 5분 전 푸시 알림 — iOS 26+ 면 AlarmKit (한도 없음), 그 외 expo-notifications WEEKLY (64 한계).
> (2) 자동 진행 모드 백그라운드 체인 — DATE trigger 1개. AlarmKit/expo-notifications 모두 임시 1슬롯.

#### 10.5.2 작업 목표
- **routine_chain + routine_confirm_prompt** 도 prealert 패턴으로 AlarmKit 마이그레이션
- iOS 26+ AlarmKit / iOS 25 이하 + Android = expo-notifications fallback
- **결과:** 64 한도 + 30초 사운드 한도 동시 해방 (iOS 26+ 한정)

#### 10.5.3 영향 파일
| 파일 | 변경 내용 |
|------|----------|
| `src/utils/routineScheduler.ts` | chain/confirm 스케줄링 함수에 AlarmKit 분기 추가. cancel 함수에 chain/confirm AlarmKit cancel 추가 |
| `modules/alarmkit-bridge/src/AlarmkitBridgeModule.ts` (Swift) | chain/confirm 등록 함수 추가 (prealert 패턴 재사용 가능 시 X) |
| `modules/alarmkit-bridge/index.ts` | TS 인터페이스 추가 |
| `App.tsx` | 알림 응답 핸들러에 AlarmKit chain/confirm 응답 처리 추가 |

#### 10.5.4 사전 조건 (이미 통과)
- ✅ AlarmKit bridge 모듈 (`modules/alarmkit-bridge`) — prealert 통합 시 구축
- ✅ `requestAlarmKitAuthorizationIfNeeded` 구현 ([routineScheduler.ts:66](../src/utils/routineScheduler.ts#L66))
- ✅ `isAlarmKitAvailableSync` / `shouldUseAlarmKit` 가용성 / 권한 체크 helper
- ✅ `NSAlarmKitUsageDescription` Info.plist + app.json 추가됨
- ✅ AlarmKit bridge 의 cancel 함수 (legacy + alarmkit 양쪽)

#### 10.5.5 분리 정책 (사용자 명시)
- AlarmKit bridge 모듈 자체 = **검증된 컴포넌트, 공유 OK** (prealert 도 사용 중)
- AlarmScreen 변경 X — v1.5 출시 기능 보호
- routineScheduler / App.tsx 의 chain/confirm 분기만 추가 (AlarmKit 사용)
- iOS 25 이하 / Android 사용자 = 기존 expo-notifications fallback (회귀 X)

#### 10.5.6 단계 분할 (제안)

| Step | 내용 | 검증 |
|------|------|------|
| Step 1 | AlarmKit bridge 의 chain/confirm 등록 함수 명세 정리 — prealert 패턴 재사용 vs 신규 함수 | 결정 후 native module 변경 |
| Step 2 | routineScheduler 의 `scheduleConfirmPrompt` / 백그라운드 chain 함수에 `shouldUseAlarmKit` 분기 추가 | tsc + AlarmKit 등록 동작 |
| Step 3 | cancel 함수 (`cancelRoutinePrealerts` / `cancelBackgroundNotif`) 에 chain/confirm AlarmKit cancel 추가 | 강제 종료 후 stale 알람 정리 |
| Step 4 | App.tsx 알림 응답 핸들러 — AlarmKit chain/confirm 발화 응답 처리 (RoutineAlarm / RoutineList navigate) | 다른 폰 검증 |
| Step 5 | 검증 시나리오 6건 (아래) | iOS 26+ / iOS 25 이하 / Android |

#### 10.5.7 검증 시나리오

| # | 시나리오 | 기대 |
|---|---------|------|
| 1 | iOS 26+ — routine_chain AlarmKit 발화 → 다음 step 진행 | 정상 + 사운드 30초+ 재생 가능 |
| 2 | iOS 26+ — routine_confirm_prompt AlarmKit 발화 → 사용자 앱 진입 | 정상 + RoutineAlarm or RoutineList navigate |
| 3 | iOS 25 이하 — routine_chain expo-notifications fallback | 회귀 X (기존 동작) |
| 4 | Android — routine_chain expo-notifications fallback | 회귀 X |
| 5 | 강제 종료 후 재시작 — chain/confirm AlarmKit cancel 정상 (stale 알람 정리) | 푸쉬 1개만 발화 |
| 6 | 64 한도 — prealert + chain/confirm 모두 AlarmKit 라 expo-notifications 슬롯 부담 ↓ | 한도 초과 회귀 X |

#### 10.5.8 위험 요소

| # | 위험 | 완화 |
|---|------|------|
| 1 | iOS 26+ 사용자 비율 (출시 직후 ↓) | iOS 25 이하 fallback 유지로 영향 차단 |
| 2 | AlarmKit chain/confirm 패턴이 prealert 와 다른 동작 (예: 알림 응답 흐름) | Apple 공식 문서 정독 (반복실수 #1 — 추측 금지) |
| 3 | routine_confirm_prompt 의 사용자 응답 → AlarmKit 알람 응답 핸들러 호환성 | App.tsx 알림 응답 핸들러 검증 필수 |
| 4 | EAS Dev Build 재생성 필요 여부 | AlarmKit bridge 모듈 변경 시 native rebuild 필요 |

#### 10.5.9 Critical Alerts (B3) 와의 관계

- **iOS 26+** → AlarmKit (T1) 권장 — 64 한도 + 30초 사운드 한도 해방
- **iOS 16-25** → Critical Alerts Entitlement (B3) 신청 시 30초 사운드 한도 해방 (Apple 승인 필요)
- **Android** → 기존 expo-notifications (한도 영향 그대로)
- T1 + B3 보완 시 iOS 16+ 모든 사용자 사운드 한도 해방 가능

#### 10.5.10 작업량 추정
- Step 1~5 총 ~2-3일 (사전 조건 통과로 단축)
- 단 Apple AlarmKit chain 알림 동작 미확인 — Step 1 시점에 공식 문서 정독 + 검증 필요

---

## 11. 핵심 메모리 / 정책 (다음 채팅 자동 로드)

- `feedback_search_first.md` — 빌드 에러/API 시그니처 자체 추론 금지
- `feedback_verify_before_status_claim.md` — 작업 상태 단정 전 git 증거 확인
- `feedback_i18n_last.md` — i18n 작업은 구현 완벽 확정 후 마지막 (단 본 사이클 사용자 명시 예외 진행 + en 1차)
- `feedback_timer_routine_separation.md` — 일반 타이머 ↔ 루틴 타이머 분리 정책. 검증된 컴포넌트 공유 OK (단 파급 문제 없을 때만)

---

## 12. 주의사항

- **사용자 정책 #1** — i18n 변경은 ko 만 (단 본 사이클 사용자 명시로 en 1차 진행)
- **사용자 정책 #2** — 단계별 분할 + 각 단계 Cmd+R 검증
- **사용자 정책 #3** — "확인/검토" = 보고만. 실행은 별도 승인 후
- **사용자 정책 #4** — 사용자 명시 외 자동 커밋 금지
- **사용자 정책 #5** — 회귀 보고 시 코드 정독 → 명확 root cause + 1줄 fix
- **CLAUDE.md 보존 구역** — `@preserve IAP` / 보존 코드 삭제 금지
- **반복실수 #1** — 외부 패키지 (vision-camera/worklets-core/fast-tflite) 변경 시 공식 문서 필독
- **반복실수 #5** — 코드 존재 ≠ 기능 동작. 다른 폰 실기기 검증 필요
- **반복실수 #7** — Expo Dev Build 필수 (Expo Go 동작 X) / preview 빌드 = ad-hoc

---

## 13. 다음 채팅 첫 작업 시나리오

### 시나리오 A — 사용자 Q1~Q4 + 빌드 클린 결정 받음, 빌드 진행 중
1. 사용자 결정 받기 (Q1 version, Q2 UDID, Q3 tag, Q4 device list, 빌드 클린)
2. §9 배포 절차 실행
3. EAS build 결과 모니터링 (~10-15분, --clear-cache 시 ~25분)
4. 다른 폰 설치 + 사용자 검증

### 시나리오 B — 다른 폰 검증 OK
1. 사용자 검증 완료 보고 (§6 시나리오 17건 PASS)
2. **T1 (AlarmKit 통합)** 진행 — 플랜 창 인계 또는 직접 Step 1 영향 분석
3. 분리 정책 적용 (AlarmScreen 의 prealert AlarmKit 통합과 별개로 routine_chain/confirm 도 AlarmKit 으로)

### 시나리오 C — 다른 폰 검증 중 버그 발견
1. 버그 보고 받음
2. 본 인수 문서 + CLAUDE.md + git status 확인
3. 코드 정독 (사용자 정책 #5) → root cause → 1줄 fix
4. 검증 후 추가 커밋

### 시나리오 D — 검증 OK + 출시 진행
1. **T4 (다국어 동기화)** — 12개 언어 일괄 자동 번역 + 검수 (~2-4일)
2. EAS production build + TestFlight / Play Console submit
3. 사용자 검토 + 출시

---

**작성:** 2026-04-27 (배포창 빌드 인계 시점)
**HEAD:** `10ff9d1 docs: v1.6 Phase 6.5 인수인계`
**다음 단계:** Q1~Q4 + 빌드 클린 결정 → §9 절차 → 다른 폰 검증 → 시나리오 A/B/C/D
