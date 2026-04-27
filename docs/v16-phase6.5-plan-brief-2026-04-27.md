# Phase 6.5 카메라 모드 — 플랜 창 인수 (2026-04-27)

**구현 창 → 플랜 창 인계.** 플랜 창은 이 문서 + 본문 정독 후 정식 계획서를 작성하여 구현 창으로 재인계.

**브랜치:** `feature/v1.6-routine`
**HEAD:** `03b700a feat: v1.6 routine 사이클 통합 + 진행 중 루틴 카드 편집/삭제 양방향 차단`
**working tree:** clean (직전 사이클 종료, 미커밋 0)

---

## 1. 작업 정의

**목표:** RoutineAlarmScreen 의 `endMethod='camera'` 분기에서 v1.5 AlarmCameraMode 의 실제 사진 인식 흐름을 통합. 현재 placeholder (랜덤 emoji + 탭 dismiss) 제거.

**우선순위:** T0 (사용자 결정 2026-04-27, 다음 사이클)

**참고 명세:**
- `docs/v1.6-progress-2026-04-25.md` §7 우선순위 2: "현재 placeholder 랜덤 MISSION_POOL emoji 표시 + 탭 dismiss → v1.5 AlarmCameraMode 통합. 작업량 ~1-2일. **AlarmCameraMode SharedValues 5개 + 미션/슬롯머신 로직 이식**"
- `docs/v1.6-routine-handoff-2026-04-27.md` §"미해결 #2": [RoutineAlarmScreen.tsx#L331](../src/screens/RoutineAlarmScreen.tsx#L331) `// TODO Phase 6.5: AlarmCameraMode 통합` (`cameraScanHint` 임시 문구 포함)
- `docs/v1.6-progress-2026-04-25.md` §10 보존: "src/screens/AlarmCameraMode.tsx — v1.5 사진 인식 컴포넌트 (Phase 6.5에서 RoutineAlarm 통합 예정)"

---

## 2. 현재 코드 상태 (정독 결과)

### 2.1 RoutineAlarmScreen — placeholder 위치
[RoutineAlarmScreen.tsx:329-342](../src/screens/RoutineAlarmScreen.tsx#L329)

```tsx
if (routine.endMethod === 'camera' && cameraMission) {
  // TODO Phase 6.5: AlarmCameraMode 통합으로 실제 사진 인식 dismiss로 교체.
  // 현재는 랜덤 미션 표시 + 탭 dismiss (임시).
  const emoji = MISSION_EMOJI[cameraMission];
  const label = MISSION_LABEL[cameraMission] ?? cameraMission;
  return (
    <TouchableOpacity style={styles.dismissArea} activeOpacity={0.9} onPress={handleDismiss}>
      {emoji && <Image source={emoji} style={styles.cameraEmoji} resizeMode="contain" />}
      <Text style={styles.completeText}>{label}</Text>
      <Text style={styles.dismissHint}>
        {t('routine.cameraScanHint', { defaultValue: '대상을 찾아 사진 촬영 (임시: 탭하여 계속)' })}
      </Text>
    </TouchableOpacity>
  );
}
```

`cameraMission` 은 mount 시 `MISSION_POOL` 에서 랜덤 1건 픽 (RoutineAlarmScreen.tsx:109-110 일대).

### 2.2 AlarmCameraMode — 보존 컴포넌트 (365L)
**위치:** `src/screens/AlarmCameraMode.tsx`
**역할:** v1.5 Phase A — 카메라 모드 child. parent (AlarmScreen) 가 SharedValues / 미션 / 슬롯머신 등을 생성·관리하고 props 로 전달. AlarmCameraMode 는 Camera 마운트 + frame processor + 인식 UI 만 담당.

**props 다수 (요약):**
- SharedValues 6개: `matched`, `lastRun`, `targetLabelsSV`, `thresholdSV`, `consecutiveHits`, `isShufflingSV`
- 미션 정보 4개: `currentMission`, `currentEmoji`, `missionLabel`, `missionSentence`
- 슬롯머신 3개: `isShuffling`, `shuffledList`, `shuffleIdx`
- UI 상태 5개: `isRetryBannerVisible`, `successAnimating`, `resultState`, `isDanger`, `remainingSeconds`
- 애니메이션 4개: `successBlink`, `successFill`, `scanLine`, `dangerBlink`
- 레이아웃 2개: `boxWidth`, `boxHeight`
- 콜백 2개: `onMatchDetected`, `onReshuffle`
- 기타: `t`, 권한 색상

### 2.3 AlarmScreen — parent-측 로직 (참조용, 변경 대상 아님)
**위치:** `src/screens/AlarmScreen.tsx`
**관여 라인:**
- L34-35: `import AlarmCameraMode from './AlarmCameraMode'`
- L36: `MISSION_EMOJI, MISSION_POOL, MISSION_LABEL, MISSION_COCO_LABELS, MISSION_CONFIDENCE_OVERRIDE` import
- L132-142: 사용자 선택 미션 풀 (AsyncStorage) + 미션 픽 로직
- L161-168: SharedValues 생성 (matched, targetLabelsSV, consecutiveHits, isShufflingSV 등)
- L194-195: 슬롯머신 state
- L423-436: AsyncStorage 미션 선택 로드
- L724-731: frame processor + targetLabelsSV 갱신

→ **상당량의 parent-측 로직이 AlarmScreen 에 분산됨.** RoutineAlarmScreen 에 그대로 복제 시 광범위한 코드 중복 + 동기화 부담.

---

## 3. 통합 방식 — 옵션 (플랜 창 결정 영역)

| 옵션 | 설명 | 장점 | 단점 |
|------|------|------|------|
| **(α) 부모 로직 그대로 복제** | AlarmScreen 의 SharedValues/미션/슬롯머신 로직을 RoutineAlarmScreen 에도 동일 복제. AlarmCameraMode 는 그대로 child 로 마운트 | 변경 최소 — AlarmCameraMode 미수정 | 코드 중복. 향후 인식 로직 변경 시 양쪽 동기화 필요 |
| **(β) 공유 hook 추출** | `useAlarmCameraController` (또는 유사) hook 으로 부모 로직 추출. AlarmScreen + RoutineAlarmScreen 둘 다 hook 사용 | DRY. 향후 유지보수 ↓ | AlarmScreen 리팩토링 — 기존 v1.5 회귀 위험. 작업량 ↑ |
| **(γ) AlarmCameraMode self-contained 리팩토링** | parent-측 로직을 AlarmCameraMode 안으로 흡수 (또는 별도 wrapper 컴포넌트 추가). props 단순화 | 가장 깔끔. 양 화면 단순 마운트 | 가장 큰 리팩토링. AlarmCameraMode 365L → 더 큰 컴포넌트. 회귀 위험 ↑↑ |

**구현 창 의견:**
- **(α) 가 위험 ↓ + 작업량 ↓** — 1-2일 (progress §7 추정과 일치)
- **(β) 가 정합 ↑** 이지만 AlarmScreen 회귀 위험 평가 필요 — 회귀 시 v1.5 출시 기능 손상
- **(γ) 는 v1.6 사이클 부담** — v1.7 권장

플랜 창에서 trade-off 평가 후 결정.

---

## 4. 결정해야 할 명세 사항 (플랜 창 → 사용자 / 자체 분석)

| # | 항목 | 결정 영역 |
|---|------|----------|
| 1 | 통합 방식 | (α)/(β)/(γ) 중 1 |
| 2 | 미션 풀 정책 — AlarmScreen 의 사용자 선택 미션 (AsyncStorage) 재사용? RoutineAlarm 별도 풀? | 재사용 권장 (사용자 일관성) — 단 현재 RoutineAlarm 의 `cameraMission` 단일 픽 로직 (L109-110) 과 충돌 |
| 3 | dismiss 흐름 — 사진 인식 성공 시 `handleDismiss()` 호출 (기존) 또는 controller advance 직결? | `handleDismiss()` 재사용 권장 — 기존 dismiss 흐름 유지 |
| 4 | fallback — 인식 실패 / 시간 초과 / 권한 거부 시 처리 | 권한 거부: 탭 dismiss fallback / 시간 초과: AlarmScreen 의 `isDanger` 패턴 재사용 / 인식 실패: 슬롯머신 재돌림 |
| 5 | 권한 흐름 — v1.5 카메라 권한 그대로 재사용 OK? | 같은 `react-native-vision-camera` 사용 — 권한 자동 재사용. 단 RoutineAlarm 진입 시 권한 미부여 케이스 fallback UI 필요 |
| 6 | 슬롯머신 / 재돌림 / 사용자 선택 미션 풀 — RoutineAlarm 에서도 노출? 단순화? | 사용자 결정 영역. v1.5 와 동일 UX 권장 |
| 7 | 콜드 스타트 / kill 후 재시작 — RoutineAlarm 진입 시 SharedValues / 슬롯머신 state 초기화 흐름 | 마운트 시 매번 fresh init — Phase 6.5 통합 후 검증 시나리오에 추가 |
| 8 | i18n — `cameraScanHint` "(임시: 탭하여 계속)" 문구 → 정식 문구 (사용자 정책 #1: ko 만, 사이클 마지막 단계) | 통합 완료 시점에 ko 텍스트 확정 후 마지막 단계로 i18n 키 정리 |

---

## 5. 위험 요소 (반복실수 #1 사례 — Critical)

`docs/v1.6-routine-handoff-2026-04-27.md` 의 §"외부 패키지 사용 원칙" + 본 프로젝트 반복실수 목록 #1 (2026-04-17 v1.5 스파이크):

- `react-native-fast-tflite` v3 API 추측 구현 → 크래시
- `react-native-worklets-core` babel plugin 요구사항 미확인 → 빌드 실패
- `react-native-fast-tflite` CoreML delegate 의 Expo config plugin 요구사항 누락 → 런타임 실패
- `vision-camera-resize-plugin` 공식 `buffer.slice()` 패턴 미준수 → 잠재 버그

**원칙 (예외 없음):**
- 공식 README/문서 확인 후 코드 작성 (node_modules/{패키지}/README.md 직접 읽기)
- 추측 금지 — 타입 정의 (.d.ts) 만 보고 코드 작성 금지
- 네이티브 의존성 추가 시 Expo config plugin 요구사항 여부 확인
- babel.config.js / Podfile 커스텀 변수 (`$EnableCoreMLDelegate` 등) 확인

**Phase 6.5 적용:**
- AlarmCameraMode 자체는 v1.5 에서 검증됨 → 그대로 재사용 시 위험 ↓
- 단 RoutineAlarmScreen 통합 시 새 사용 패턴 (e.g., 다중 마운트, 콜드 스타트 부터 진입 등) 에서 회귀 가능성 존재
- 옵션 (β)/(γ) 채택 시 위험 ↑↑ — Hook/리팩토링 과정에서 SharedValue 참조 분리 / worklet 호환성 깨질 가능성

---

## 6. 영향 범위 (Step 1 사전 자료)

### 직접 수정 대상
- `src/screens/RoutineAlarmScreen.tsx` (L329-L342 포함, 주변 영향 가능)

### 간접 영향 (옵션 (β)/(γ) 시)
- `src/screens/AlarmScreen.tsx` (parent-측 로직 hook 추출 / 컴포넌트 흡수)
- `src/screens/AlarmCameraMode.tsx` (옵션 (γ) 시 props 단순화)

### 신규 생성 가능
- `src/hooks/useAlarmCameraController.ts` (옵션 (β) 시)

### 자산
- `assets/sounds/` — 카메라 인식 성공 사운드 (v1.5 기존 자산 재사용)
- `src/constants/missionIcons.ts` — MISSION_POOL/EMOJI/LABEL/COCO_LABELS/CONFIDENCE_OVERRIDE (재사용)

### iOS / Android 차이
- 카메라 권한 흐름 (Info.plist `NSCameraUsageDescription` / Android `CAMERA` permission) — 이미 v1.5 에서 설정됨
- worklet / frame processor — Android 동작 검증 필요 (v1.5 검증 상태 가정)

### 권한 / 설정
- 추가 권한 없음 (v1.5 카메라 권한 그대로)
- Expo config plugin / babel — v1.5 설정 그대로 재사용
- 추가 의존성 없음

### 앱 상태별 동작 (foreground/background/killed)
- RoutineAlarm 은 알람 응답 진입 → 항상 foreground
- background 에서 카메라 작동 X (정상)

---

## 7. 검증 시나리오 (Step 4 사전 자료)

| # | 시나리오 | 기대 결과 |
|---|---------|----------|
| 1 | endMethod='camera' 루틴 알람 진입 → 카메라 마운트 + 미션 표시 | 정상 |
| 2 | 미션 대상 인식 → consecutiveHits 임계 도달 → success 애니메이션 → dismiss | 정상 |
| 3 | 인식 실패 / 시간 초과 → fallback (재돌림 또는 탭 dismiss) | 정상 |
| 4 | 카메라 권한 거부 → fallback UI (탭 dismiss) | 정상 |
| 5 | 콜드 스타트 (앱 kill 후 알람 응답) → RoutineAlarm 진입 | 정상 마운트 |
| 6 | 슬롯머신 재돌림 (사용자 미션 풀 다중) → targetLabelsSV 갱신 | 정상 |
| 7 | endMethod='camera' 루틴 → AlarmScreen 의 카메라 모드와 충돌 X | 회귀 X |
| 8 | iOS / Android 양쪽 동작 | 동일 |
| 9 | 4 stage modal (alarm → next → nextCountdown / auto / complete) 와 카메라 dismiss 흐름 호환 | 회귀 X |

---

## 8. 본 사이클 분할 제안 (참고)

플랜 창에서 작업 단계를 분할할 때 권장 단위:

- **Step A** — 통합 방식 결정 후 RoutineAlarmScreen camera 분기 신설 (placeholder 제거)
- **Step B** — SharedValues / 미션 풀 / 슬롯머신 부모-측 로직 통합 (옵션에 따라)
- **Step C** — AlarmCameraMode 마운트 + props 연결
- **Step D** — fallback (권한 거부, 인식 실패, 시간 초과)
- **Step E** — i18n (ko 만, 사용자 정책 #1) — 마지막 단계

각 Step 별 Cmd+R 검증 (사용자 정책 #2 — 단계별 분할 + 각 단계 검증).

---

## 9. 플랜 창 산출물 — 권장 형식

본 인수 자료를 기반으로 플랜 창에서 작성할 정식 계획서 권장 구조:

```
docs/plan-2026-04-27-v16-phase6.5-camera.md (또는 유사)

1. 작업 정의 + 범위 (확정)
2. 통합 방식 채택 — (α)/(β)/(γ) 중 1 + 근거
3. 결정 사항 (본 문서 §4 8건 모두 확정)
4. 영향 범위 분석 (본 문서 §6 보강)
5. 단계 분할 (Step A~E + Cmd+R 검증 포인트)
6. 위험 요소 + 완화 (본 문서 §5 보강)
7. 검증 시나리오 (본 문서 §7 보강)
8. 구현 창 전달문 (각 Step 별 파일/라인/명세)
```

---

## 10. 인계 후 절차

1. 사용자: 플랜 창 띄움
2. 플랜 창: 본 문서 + AlarmCameraMode + AlarmScreen + RoutineAlarmScreen 정독 → 정식 계획서 작성
3. 플랜 창: 통합 방식 (α/β/γ) + 결정 사항 8건 사용자에게 보고 → 승인
4. 플랜 창 → 구현 창 인계 (정식 전달문)
5. 본 구현 창: Step 1 영향 범위 분석 → Step 2 파급 분석 보고 → 사용자 승인 → Step 3 구현 → Step 4 검증 → Step 5 완료 보고

---

**작성:** 2026-04-27 구현 창 (직전 사이클 = v1.6 routine 통합 + 진행 중 카드 차단 직후)
**다음 단계:** 플랜 창에서 통합 방식 결정 + 정식 계획서 작성
