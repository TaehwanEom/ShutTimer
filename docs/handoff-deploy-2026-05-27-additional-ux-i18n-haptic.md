# 추가 배포 전달문 — 2026-05-27 v2 (i18n + UX + haptic)

> 브랜치: `feature/android-support`
> HEAD: `3d7fe9d`
> 이전 전달문: `handoff-deploy-2026-05-27-session-fix-and-ads.md` (`60747de` 시점)
> 대상 빌드: iOS Release (App Store 심사 제출용)

---

## 1. 한 줄 요약

이전 전달문 (세션 Fix + 광고) 이후 사용자 측 추가 보고 받은 4건 정정 + iPhone 다이얼 UX 개선 1건.

---

## 2. 포함된 커밋 (4건)

| 커밋 | 종류 | 내용 |
|------|------|------|
| `6714f5c` | fix(i18n) | 팝업 측 한국어 defaultValue 그대로 외국어 사용자에게 노출되던 14개 locale × 6키 = 84건 번역 누락 정정 |
| `5930701` | fix(ux) | 루틴 step 카운트다운 측 "00:00" 표시 못 보고 즉시 알람 fire 되던 표시 버그 정정 (ceil → floor) |
| `ab2c295` | fix(ux) | 루틴 또는 ad-hoc routine 진행 중에도 알람 토글이 자유롭게 on/off 되던 문제 정정 (= 토글 disabled) |
| `3d7fe9d` | feat(ux) | 타이머 다이얼 회전 시 = iPhone Clock 정합 haptic + 시스템 click sound 추가 (expo-haptics 신규) |

---

## 3. 사용자 보고 → 해결 매핑

### 보고 1: "팝업 내용 번역 안 됨"

- **증상**: "예정된 알람 충돌" dialog 측 영어/일본어/중국어 사용자에게도 "루틴 진행 중 알람" / "진행 중인 타이머" 한국어 그대로 노출
- **원인**: `routine.routineAlarmLabel` + `routine.timerAlarmLabel` 키 측 = 14개 locale json 측 단 하나도 등록 안 됨 → `defaultValue` 한국어 그대로 fallback
- **해결**: Phase 3-5 신규 키 4개 포함 = 6개 키를 14개 언어 (ko/en/ja/zh-CN/zh-TW/es/fr/de/it/pt-BR/ar/id/th/tr) 측 일괄 추가
- **포함 키**:
  - `routine.routineAlarmLabel`
  - `routine.timerAlarmLabel`
  - `onboarding.permissionSamsungBatteryTitle/Body/Button` (Phase 3-5)
  - `settings.batteryOptimization` (Phase 3-5)

### 보고 2: "루틴 타이머 00:01에서 알람 울려, 00:00까지 안 감"

- **증상**: 30초 step 측 카운트다운 = "00:30" → "00:29" → ... → "00:01" → 즉시 알람 → "00:00" 못 봄
- **원인**: `Math.ceil(remainMs / 1000)` 사용 → 0.001~0.999초 남은 시점에도 "00:01" 표시 → 0초 정확 도달 시 즉시 handleMissionEnd → 알람 fire
- **해결**: `Math.ceil` → `Math.floor` 변경. "00:00" 측 = 약 1초간 명시 표시 후 알람.
- **영향 범위**: ActiveRoutineSection 측만 (HomeScreen timer 측 = 사용자 확인 = "0까지 간다" = 정상 → 미수정)

### 보고 3: "루틴 진행 중에도 알람 토글 자유롭게 on/off 됨"

- **증상**: 루틴 또는 ad-hoc routine 진행 중에도 AlarmListScreen 측 알람 카드의 Switch가 동작
- **원인**: AlarmRow 측 Switch 측 = `disabled` prop 사용 안 함
- **해결**: AlarmRowProps 측 `toggleDisabled` 추가 + AlarmListScreen 측 = `anyRoutineRunning = !!activeRoutine` 검사 → 진행 중 시 모든 토글 disabled (회색 시각 피드백)
- **참고**: Timer 진행 중 측 = activeRoutine 저장 안 함 → 영향 0 (= 기존 동작 보존)

### 요청 4: "다이얼 회전 사운드 (iPhone Clock 다이얼처럼)"

- **요청**: 타이머 다이얼 회전 시 iPhone Clock 다이얼과 동일한 click 사운드 + 진동
- **해결**: `expo-haptics ~15.0.8` 신규 설치 + TimerDial 측 onPanResponderGrant/Move 측 = `Haptics.selectionAsync()` 호출
- **호출 정합**:
  - tap 시점 (Grant) = 1회 호출
  - drag 중 (Move) = **분 단위 변경 시점만** 호출 (= 60fps 매 frame 호출 차단)
- **효과**:
  - 일반 모드 = 시스템 click 사운드 + 진동
  - 무음 모드 = 진동만 (iOS 표준 동작)
  - 시뮬레이터 = 동작 안 함 (= Taptic Engine 없음, 실 디바이스에서만 확인 가능)

---

## 4. 신규 dependency

| 패키지 | 버전 | 용도 |
|--------|------|------|
| expo-haptics | ~15.0.8 | 다이얼 회전 haptic + 시스템 click sound |

**EAS 빌드 측 영향**: `package.json` + `package-lock.json` 변경. EAS 빌드 시 자동 설치. iOS Native module로 prebuild 시 cocoapods 자동 등록.

---

## 5. 변경 파일 (5건)

```
src/locales/*.json (14개)               i18n 84건 번역 추가
src/components/ActiveRoutineSection.tsx 카운트다운 ceil → floor
src/screens/AlarmListScreen.tsx         알람 토글 disable
src/components/TimerDial.tsx            다이얼 haptic 호출
package.json + package-lock.json        expo-haptics 신규
```

---

## 6. 검증 상태

### 완료
- **TypeScript check** = 모든 커밋 측 0 error
- **각 fix 측 코드 분석** = 회귀 위험 0건 확인

### 미완료 (= 실 디바이스 필요)
- **다이얼 haptic 측 실 측정** = 시뮬레이터 측 Taptic Engine 없음 → iPhone 실 디바이스에서만 확인 가능
- **i18n 측 외국어 사용자 측 측정** = 시뮬레이터 측 언어 변경 시 확인 가능하나 미실행
- **카운트다운 표시 변경** = 코드 분석으로 1초 차이 검증, 실 디바이스 시각 확인 권장
- **토글 disable** = 시뮬레이터 측 검증 가능, 실 디바이스 동일

---

## 7. 심사 전 권장 검증 (5분 추가)

이전 전달문의 알람 시나리오 검증 + 추가:

1. **다이얼 사운드**: 본인 iPhone 측 = 타이머 화면 측 다이얼 회전 → click 사운드 + 진동 확인
2. **루틴 카운트다운**: 짧은 step (예: 5초) 측 = "00:00" 표시 약 1초간 확인 후 알람
3. **알람 토글**: 루틴 ▶ 진행 중 → 알람 탭 진입 → 알람 토글 측 = 회색 + 반응 안 함 확인
4. **i18n**: Settings 측 언어 = 영어로 변경 → 루틴 ▶ + 충돌 dialog 확인 시 "Routine alarm in progress" 영어 표시 확인

---

## 8. 위험 평가

| 항목 | 위험도 |
|------|------|
| i18n 추가 측 회귀 | 0 — 신규 키만 추가, 기존 키 미수정 |
| ActiveRoutineSection 측 ceil → floor | 0 — 표시만 영향, handleMissionEnd 로직 동일 |
| 알람 토글 disable | 0 — disabled prop 측 react-native 표준, 기존 handleToggle 미수정 |
| expo-haptics 신규 dependency | 매우 낮음 — Expo 공식 패키지, `.catch(() => {})` silent fail로 호출 실패도 다이얼 동작 영향 0 |
| iOS AlarmKit framework | 0 — 미접근 |
| Android | 0 — 동일 코드, expo-haptics Android 측 자동 fallback (약한 진동) |

---

## 9. 롤백 방법

### 개별 롤백
```bash
# 다이얼 haptic만 롤백
git revert 3d7fe9d

# 알람 토글 disable만 롤백
git revert ab2c295

# 카운트다운 표시만 롤백
git revert 5930701

# i18n만 롤백
git revert 6714f5c
```

### 전체 롤백 (이전 전달문 시점으로)
```bash
git revert 3d7fe9d ab2c295 5930701 6714f5c
```

### 이전 전달문 + 본 전달문 = 모두 롤백
```bash
git revert 3d7fe9d ab2c295 5930701 6714f5c e79e3e8 ee5ccaf df529de
```

---

## 10. 배포 우선순위

1차 전달문 (`60747de`)의 세션 Fix 측 = **최우선** (= 사용자 직접 보고 = "먹통")
본 전달문 측 = **UX 개선** (= 사용자 만족도 + 외국어 사용자 = 한국어 노출 회피)

= 함께 배포 권장. 분리 배포 시 측 = 1차 (세션 Fix) 측 = 먼저, 본 전달문 측 = 다음 빌드.

---

## 11. 후속 작업

- **Xcode 워크스페이스** = `ios/ShutTimer.xcworkspace` 측 = prebuild + pod install 완료 → Run 가능
- **광고 복원** = 광고 해제 후 별도 PR 측 = `e79e3e8` 측 revert
- **HomeScreen timer countdown** = 사용자 측 = "0까지 간다" 확인 = 미수정 유지 (= 만약 필요 시 별도 fix)
