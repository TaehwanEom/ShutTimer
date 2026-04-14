# Antigravity 세션 초기화 — ShutTimer

## 세션 시작 시 필수 (예외 없음)

1. 첫 메시지에서 창 이름 확인 (플랜/구현/배포)
2. 아래 순서대로 파일 읽기:

| 순서 | 파일 | 대상 창 |
|------|------|---------|
| 1 | `Antigravity_개별 지침/antigravity_0_common.md` | 전 창 |
| 2 | 해당 창 지침 1개 (아래 표) | 전 창 |
| 3 | `Antigravity_개별 지침/반복실수_목록.md` | 전 창 |

| 창 | 지침 파일 |
|----|----------|
| 플랜 | `Antigravity_개별 지침/antigravity_1_plan.md` |
| 구현 | `Antigravity_개별 지침/antigravity_2_build.md` |
| 배포 | `Antigravity_개별 지침/antigravity_4_deploy.md` |

3. 읽기 완료 후 "공통 + [창 이름] 지침 + 반복실수 로드 완료" 보고
4. **파일 전부 읽은 후에만 작업 시작. 읽기 전 코드 수정/배포/실행 절대 금지.**

## "지침 읽어" → 위 파일 재로드 (자기 창 지침만)

## 절대 규칙
- 존댓말 필수. 반말 금지.
- 각 창은 자기 역할만. 선넘으면 즉시 중단.
- "확인/검토" = 확인 후 보고만. 실행은 별도 승인 후.
- v1 범위 밖 기능 구현 금지.

## 보존 구역 — Phase 2+ 복원용 (삭제 금지)

아래 코드는 B안(IAP 보류) 전환 시 주석 처리되어 보존 중.
미래 리팩토링/정리 작업에서 절대 삭제 금지.
주석 해제만으로 즉시 재활성 가능해야 함.

보존 파일:
- src/context/PurchaseContext.tsx (전체 유지)
- src/constants/purchase.ts (전체 유지)
- src/components/AdBanner.tsx (isAdFree 관련 블록 주석)
- src/screens/AlarmScreen.tsx (isAdFree 관련 블록 주석)
- src/screens/SettingsScreen.tsx (구매/복원 섹션 주석)
- App.tsx (PurchaseProvider 래퍼 주석)
- src/i18n/*.json (구매 관련 번역 키 유지)
- package.json react-native-purchases 의존성 유지

재활성화 조건: 사업자등록 + ASC Paid Apps Agreement 활성화
복원 절차: `@preserve IAP` 검색 → 주석 해제 → 빌드
