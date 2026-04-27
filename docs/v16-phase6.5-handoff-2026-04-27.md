# v1.6 Phase 6.5 인수인계 — 2026-04-27

채팅창 이전용. 다음 채팅에서 본 문서 + CLAUDE.md + git status 확인 후 시작.

---

## 1. 현재 상태 (한 줄 요약)

**v1.6 Phase 6.5 (RoutineAlarm 카메라 모드 통합) 코드 완료. en 1차 번역 완료. 미커밋. 다른 폰 검증 + 배포창 인계 대기.**

---

## 2. 미커밋 변경

### 2.1 Modified
```
M  src/locales/ko.json                       (+4 / -2)  Phase 6.5 텍스트 + 진행 중 카드 i18n
M  src/locales/en.json                       (routine 섹션 통째 동기화 — 186 키)
M  src/screens/RoutineAlarmScreen.tsx        (+311 / -16)  Phase 6.5 + dismissed 가드
```

### 2.2 Untracked (신규 문서)
```
?? docs/plan-2026-04-27-v16-phase6.5-camera.md       정식 계획서
?? docs/v16-phase6.5-plan-brief-2026-04-27.md        구현 창 → 플랜 창 인수
?? docs/v16-phase6.5-handoff-2026-04-27.md            본 문서
```

### 2.3 변경 0 (분리 정책 정합)
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
- **i18n** (메모리 `feedback_i18n_last.md`): 본 사이클은 사용자 명시로 즉시 진행 (예외)

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
1. routine endMethod=camera 알람 진입 → 카메라 + 미션 표시 ✅ (이전 검증 통과)
2. 인식 성공 → blink + fill 애니메이션 → handleDismiss → "다음 루틴 시작" modal ✅ (이전 검증 통과)
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

## 7. 배포 창 인계 — 커밋 + 빌드 명령

### 7.1 커밋 분리 (권장)

**커밋 1: feat — Phase 6.5 RoutineAlarm 카메라 모드 통합**
```bash
git add src/screens/RoutineAlarmScreen.tsx \
        src/locales/ko.json \
        docs/plan-2026-04-27-v16-phase6.5-camera.md \
        docs/v16-phase6.5-plan-brief-2026-04-27.md \
        docs/v16-phase6.5-handoff-2026-04-27.md

git commit -m "$(cat <<'EOF'
feat: v1.6 Phase 6.5 — RoutineAlarm 카메라 모드 통합 (AlarmCameraMode 마운트 + 슬롯/카운트다운/dismiss)

- RoutineAlarm endMethod='camera' 분기 = AlarmCameraMode 마운트 + 부모-측 state/SV/슬롯머신/카운트다운 (AlarmScreen 패턴 차용, 코드 별도 — 분리 정책)
- AlarmCameraMode 무수정 (v1.5 검증 컴포넌트 그대로 재사용)
- AlarmScreen 무수정 (v1.5 출시 기능 회귀 X)
- 분리 정책 (D-2-i): MISSION_POOL 전체 사용 (selectedMissions AsyncStorage 키 미사용)
- 인식 성공 → triggerDetectionSequence (blink + fill) → handleDismiss → routine 의 4-stage modal
- 카운트다운 30초 + 1차 시간 초과 재시도 배너 + 2차 시간 초과 자동 dismiss
- 슬롯머신 재돌림 + 스캔라인 + dangerBlink
- dismissed 가드 — 4 useEffect (카운트다운/만료/스캔라인/dangerBlink)
- wrapper: 검정 배경 + ShutTimer 헤더 + flex:1 박스 (AlarmScreen 동일 layout)
- i18n (ko): routine.cameraScanHint = "대상을 찾아 사진 촬영" / routine.startNext = "다음 루틴 시작"
- docs: plan-brief + 정식 계획서 + 인수인계

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

**커밋 2: feat(i18n) — en 1차 동기화 (routine 186 키)**
```bash
git add src/locales/en.json

git commit -m "$(cat <<'EOF'
feat(i18n): en 1차 동기화 — routine 섹션 186 키 영문 번역

- en.routine flat 키 43 → 186 (143 키 신규 추가)
- ko ↔ en 구조 100% 일치 (nested 13 객체 모두 동기화)
- 영역: listTitle/fieldName/weekday/endMethod/validation/exactAlarm/alarmKit/edit/category(10 fixed)/days/sound/run/duration/time/editBlocked/deleteBlocked
- 12개 언어 (ja/zh-CN/zh-TW/fr/de/es/pt-BR/it/tr/ar/th/id) 는 출시 직전 일괄 (Phase 7)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### 7.2 EAS Build (다른 폰 테스트)

**의존성 추가 0 + Info.plist/Manifest 변경 0 → v1.5 Dev Build 그대로 재사용 가능.**

옵션 A — Preview Build (권장, 내부 테스트):
```bash
eas build --platform all --profile preview
```

옵션 B — Production + TestFlight:
```bash
eas build --platform ios --profile production
eas submit --platform ios --profile production  # ascAppId: 6761991860

eas build --platform android --profile production
```

옵션 C — Dev Client + Metro (빠른 검증):
```bash
npx expo start --dev-client
```

---

## 8. 다음 사이클 우선순위 (사용자 결정 2026-04-27)

| 우선 | 작업 | 작업량 |
|------|------|-------|
| **T1** | AlarmKit 통합 (chain/confirm 마이그레이션 — 64한도+30초 사운드 한도 동시 해방) | ~2-3일 |
| T2 | 다단계 prealert (30분+5분) | ~1-2일 |
| T3 | 잠금 화면 컨트롤 (Live Activities / Foreground Service) — **v1.7 권장** | ~1주+ |
| T4 | Phase 7 다국어 동기화 (ja/zh-*/fr/de/es/pt-BR/it/tr/ar/th/id 12개 언어) — **출시 직전 일괄** | ~2-4일 |

**구현 창 입장 — T1 권장:** 사용자 결정한 다음 작업, 가장 큰 기술 부채 (64 한도 + 30초 사운드 한도) 해소.

---

## 9. 핵심 메모리 / 정책 (다음 채팅에서 자동 로드됨)

- `feedback_search_first.md` — 빌드 에러/API 시그니처 자체 추론 금지
- `feedback_verify_before_status_claim.md` — 작업 상태 단정 전 git 증거 확인
- `feedback_i18n_last.md` — i18n 작업은 구현 완벽 확정 후 마지막 (단 본 사이클 사용자 명시 예외 진행)
- `feedback_timer_routine_separation.md` — 일반 타이머 ↔ 루틴 타이머 분리 정책. 검증된 컴포넌트 공유 OK (단 파급 문제 없을 때만)

---

## 10. 주의사항

- **사용자 정책 #1** — i18n 변경은 ko 만 (단 본 사이클 사용자 명시로 en 1차 진행)
- **사용자 정책 #2** — 단계별 분할 + 각 단계 Cmd+R 검증
- **사용자 정책 #3** — "확인/검토" = 보고만. 실행은 별도 승인 후
- **사용자 정책 #4** — 사용자 명시 외 자동 커밋 금지
- **사용자 정책 #5** — 회귀 보고 시 코드 정독 → 명확 root cause + 1줄 fix
- **CLAUDE.md 보존 구역** — `@preserve IAP` / 보존 코드 삭제 금지
- **반복실수 #1** — 외부 패키지 (vision-camera/worklets-core/fast-tflite) 변경 시 공식 문서 필독
- **반복실수 #5** — 코드 존재 ≠ 기능 동작. 다른 폰 실기기 검증 필요
- **반복실수 #7** — Expo Dev Build 필수 (Expo Go 동작 X)

---

## 11. 다음 채팅 첫 작업

### 시나리오 A — 다른 폰 검증 OK
1. 사용자 검증 완료 보고
2. T1 (AlarmKit 통합) 진행 — 플랜 창 인계 또는 직접 Step 1 영향 분석
3. 분리 정책 적용 (AlarmScreen 의 prealert AlarmKit 통합과 별개로 routine_chain/confirm 도 AlarmKit 으로)

### 시나리오 B — 다른 폰 검증 중 버그 발견
1. 버그 보고 받음
2. 본 인수 문서 + CLAUDE.md + git status 확인
3. 코드 정독 (사용자 정책 #5) → root cause → 1줄 fix
4. 검증 후 추가 커밋

### 시나리오 C — 다른 폰 검증 OK + 출시 진행
1. T4 (다국어 동기화) — 12개 언어 일괄 자동 번역 + 검수 (~2-4일)
2. EAS production build + TestFlight / Play Console submit
3. 사용자 검토 + 출시

---

**작성:** 2026-04-27 구현 창 종료 시점
**HEAD:** `03b700a feat: v1.6 routine 사이클 통합 + 진행 중 루틴 카드 편집/삭제 양방향 차단`
**브랜치:** `feature/v1.6-routine`
**다음 단계:** 배포 창 커밋 + EAS Build → 다른 폰 검증 → 결과에 따라 시나리오 A/B/C
