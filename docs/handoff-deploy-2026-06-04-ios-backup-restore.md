# iOS 배포창 전달 — 디버그 + 심사용 빌드 (백업/복원 + 루틴 자동입력, 2026-06-04)

발신: iOS 구현창. 대상: iOS 배포창. 브랜치: `feature/android-support`. 버전: `1.8.7`.

> ⚠️ 배포(심사 제출)는 **유저 승인 후에만.** 본 문서는 빌드 대상·상태 정리용. 임의 제출 금지.

---

## 0. 빌드 전 필수 (이번 작업으로 **새로 추가된 요건**)

1. **`npx expo prebuild -p ios --clean` 후 `cd ios && pod install`**
   - 신규 네이티브 의존 **`expo-secure-store`**(= Keychain, 백업/복원 핵심) 등록에 필수. prebuild/pod 안 하면 네이티브 모듈 누락 → 런타임 크래시.
   - 워치 이름(ShutTimer)·기존 네이티브(StopRoutineIntent 등)도 prebuild로 반영(기존 전달문과 동일).
2. **iCloud Phase 2 = 보류(제외)됨 — capability 작업 불필요.**
   - 2026-06-04 빌드에서 프로파일에 iCloud 없어 차단됨 → **`app.json`에서 `com.apple.developer.ubiquity-kvstore-identifier` entitlement 제거**해 제외 처리.
   - **이제 iCloud capability/프로파일 작업 없이 빌드 통과.** 핵심 복원(같은 기기 삭제→재설치)은 Keychain 기반이라 그대로 동작.
   - 여유 될 때 재활성화: `docs/icloud-phase2-deferred-2026-06-04.md` §4 참고 (코드는 보존됨).
   - ⚠️ 로컬 `ios/`가 있으면 옛 entitlements에 kvstore 잔존 가능 → `prebuild --clean` 으로 재생성 필수.
3. 빌드 경로: **터미널 `npm run ios`** 권장. Xcode ▶︎ 단독 금지(prebuild 스킵 → 워치 이름·entitlement 미반영 가능).

---

## 1. 이번 세션 신규 작업 (미커밋 — working tree에 있음, 빌드에 포함됨)

### A. 삭제 후 재설치 복원 (#BackupRestore) — **iOS 실기기 검증 완료 ✅**
| 파일 | 내용 |
|------|------|
| **신규 `src/utils/backupRestore.ts`** | `mirrorToBackup()` / `restoreIfNeeded()`. 콘텐츠(알람·루틴·카테고리·미션) + 온보딩 + 설정 10종을 Keychain(`shuttimer_backup_v1`)에 미러, 재설치 시 복원. idempotent guard. |
| `App.tsx` | ① **루트 게이팅**(앱 트리 렌더 전 `restoreIfNeeded` await — 온보딩/테마 레이스 수정) ② 부트스트랩 `syncAllAlarms` 전 복원 ③ AppState background → 미러 |
| `src/constants/alarms.ts` / `routines.ts` | `saveAlarms()`/`saveRoutines()` 후 미러 |
| `src/screens/OnboardingScreen.tsx` | 온보딩 완료 시 미러 |
| `modules/alarmkit-bridge/ios/AlarmkitBridgeModule.swift` + `.../src/AlarmkitBridgeModule.ts` | iCloud KV(`icloudSetString/Get/Sync`) — Phase 2 |
| `app.json` | iCloud entitlement + `expo-secure-store` 플러그인 |
| `package.json`/lock | `expo-secure-store ~15.0.8` |

- **검증(2026-06-04, 실기기)**: 알람·루틴 + 설정 변경 → 삭제 → 재설치 → **온보딩 skip + 알람·루틴·설정 모두 복원 PASS.**
- 핵심 수정: 복원이 6초 늦게 끝나 온보딩 재노출/설정 회귀하던 **타이밍 레이스를 루트 게이팅으로 해결.**

### B. 루틴 자동 이름 입력 — **iOS 실기기 미검증 (디버그 빌드 확인 대상)**
- `src/screens/RoutineEditScreen.tsx` — 루틴 단계 이름 미입력 시 저장 시점에 **"루틴 01·02…" 자동 채움**. 시간(durationSeconds)만 필수.
- → 디버그 빌드로: 이름 비우고 저장 → "루틴 01~" 들어가는지 확인.

---

## 2. 타 창(Android/공통) 미커밋 — iOS 빌드에 같이 들어감

> Xcode/Expo는 working tree 전체를 빌드 → 디버그 빌드엔 전부 포함됨. **심사 빌드 전 정리 필요(§5).**

- TFLite/카메라: `tfliteModelCache.ts`, `AlarmCameraMode.tsx`, `app.json`(+expo-asset), `package.json`/lock(+patch-package·postinstall), `patches/`
- Android UI: `TimerDigital.tsx`, `DurationWheelPicker.tsx`, `TimeWheelPicker.tsx`, `AddTimerScreen.tsx`, `ActiveRoutineSection.tsx`, `assets/adaptive-icon.png`
- Android 미션 잠금: `effectRunner.ts`, `routineScheduler.ts`
- `AlarmEditScreen.tsx` — 라벨 자동채움(+아래 타입에러)

> ⚠️ **config 혼입 주의**: `app.json`·`package.json`·lock 에는 **내 작업(expo-secure-store/iCloud) + 타 창(expo-asset/patch-package)** 이 한 파일에 섞임 → 선별 커밋 어려움. 정리 시 조율 필요.

---

## 3. ⚠️ 타입 에러 1건 (런타임 무해, strict tsc 실패)
```
AlarmEditScreen.tsx:221  TS2345 — setLabel(string|undefined)  (타 창 작업, 백업/복원과 무관)
```
- 타입 레벨만 → Metro(Babel) 번들·실행엔 무해. **단 `npm run verify-build`가 엄격 tsc면 걸림.**
- 백업/복원 + 루틴 자동입력 변경은 **타입 클린**(이 에러는 별개 창).

---

## 4. 디버그 빌드 — **지금 가능**
1. `npx expo prebuild -p ios --clean`
2. `cd ios && pod install`
3. `npm run ios`
4. 실기기 스모크:
   - **백업/복원 재확인**: 알람·루틴·설정 변경 → 앱 삭제 → 재설치 → 온보딩 skip + 전부 복원
   - **루틴 자동입력(B)**: 단계 이름 비우고 저장 → "루틴 01~" 확인
   - 콘솔 에러 0 확인

---

## 5. 심사용(Release/Archive) 빌드 — **아래 해결 후 가능**

| # | 차단 요소 | 필요 조치 |
|---|---|---|
| 1 | ~~iCloud capability~~ | **해소됨** — iCloud entitlement 제거로 제외 처리(§0-2). 재활성화는 deferred 문서 참고 |
| 2 | **미커밋 타 창 작업 혼입** | 각 창(Android/TFLite/UI) 커밋·정리 → 깨끗한 상태로 빌드 |
| 3 | **루틴 자동입력(B) iOS 미검증** | 디버그 빌드로 확인 후 |
| 4 | **타입 에러 1건** | AlarmEditScreen:221 (타 창 정리) |
| 5 | **워치 watchOS 메타** | App Store Connect watchOS 스크린샷/메타데이터 등록(워치 최초 포함, 기존 전달문 동일) |
| 6 | **빌드 넘버** | 새 제출용 build number 증가 확인 (현재 version 1.8.7) |

→ **2~6 미해결 상태로 심사 제출 금지.** 특히 2(혼입)·5(워치 메타) 필수. (1 iCloud는 제외로 해소.)

---

## 6. 크로스플랫폼 참고 (iOS 빌드 차단 아님)
- Android창 검증 결과(`handoff-android-2026-06-04-backup-restore.md` §2-A): Android는 Auto Backup으로 **데이터는 복원되나 복원된 알람이 재부팅 전까지 미발화** 갭 발견. 후속 fix는 `syncAllAlarms`(공통 JS) 손대야 해 **iOS 영향 검토 후 조율** 필요. **현 시점 iOS 동작엔 영향 없음**(iOS는 AlarmKit가 재설치 후 비어 정상 재예약됨).

---

## 7. 요약
- **디버그 빌드 = 지금 가능** (prebuild --clean + pod install + npm run ios). 백업/복원 재확인 + 루틴 자동입력 검증용.
- **심사 빌드 = 차단** — iCloud capability 활성화 + 미커밋 혼입 정리 + 루틴 자동입력 검증 + 타입 1건 + 워치 메타 후.
- 배포는 유저 승인 후.
