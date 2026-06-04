# iCloud Phase 2 (기기교체/초기화 복원) — 보류 + 재활성화 가이드 (2026-06-04)

브랜치: `feature/android-support`. 작성: iOS 구현창.

## 0. 한 줄
- **2026-06-04 빌드 차단**(프로비저닝 프로파일에 iCloud capability 없음) 때문에 **iCloud Phase 2를 일단 제외.** 코드는 보존, entitlement만 제거. **여유 될 때 아래 4단계로 재활성화.**

## 1. 지금 상태 (제외 후)
- **핵심 복원(같은 기기 삭제→재설치)은 그대로 동작 ✅** — Keychain(`expo-secure-store`) 기반, 권한 불필요. 실기기 검증 완료.
- **빠진 것 = 기기 교체/초기화 후 복원 1가지뿐** (iCloud KV 경로). 이게 보류분.
- **iCloud 코드는 삭제 안 함(보존)**:
  - `modules/alarmkit-bridge/ios/AlarmkitBridgeModule.swift` — `icloudSetString/icloudGetString/icloudSync` (그대로 둠)
  - `modules/alarmkit-bridge/src/AlarmkitBridgeModule.ts` — 인터페이스 + 폴백 스텁 (그대로 둠)
  - `src/utils/backupRestore.ts` — mirror 시 iCloud 기록 시도 / restore 시 로컬 없으면 iCloud fallback (try/catch로 감쌈)
  - → **entitlement 없으면 `NSUbiquitousKeyValueStore`가 sync 안 되고 false/nil 반환 → try/catch no-op. 에러·크래시 없음.**

## 2. 제외를 위해 한 변경 (이번 1건만)
- `app.json` ios.entitlements 에서 **`com.apple.developer.ubiquity-kvstore-identifier` 줄 제거.**
  - 이것만 빼면 App Store 프로파일(iCloud 없음)과 일치 → 빌드 통과.
- **⚠️ prebuild 재실행 필요**: 로컬 `ios/` 폴더가 있으면 옛 `.entitlements`에 kvstore가 남아있을 수 있음 → `npx expo prebuild -p ios --clean` 로 재생성. (EAS 빌드는 app.json에서 prebuild 하므로 자동 반영.)

## 3. 빌드 차단이었던 이유 (재발 방지 메모)
```
Provisioning profile "...AppStore 2026-04-10..." doesn't include the iCloud capability.
... doesn't include the com.apple.developer.ubiquity-kvstore-identifier entitlement.
```
- app.json 엔 entitlement가 있었는데 **App ID에 iCloud capability가 안 켜져 있어** 프로파일(4/10자)에 iCloud가 없었음 → 불일치로 빌드 실패.

## 4. ⭐ 재활성화 (여유 될 때 — 4단계)
1. **app.json entitlement 복구**: ios.entitlements 에 아래 한 줄 다시 추가.
   ```json
   "com.apple.developer.ubiquity-kvstore-identifier": "$(TeamIdentifierPrefix)$(CFBundleIdentifier)"
   ```
   (application-groups 배열 닫는 `]` 뒤에 `,` 붙이고 추가.)
2. **App ID에 iCloud 켜기** (Apple Developer Portal):
   - Identifiers → `com.shuttimer.app` → Capabilities → **iCloud** 체크 → **Key-value storage** 포함 저장.
   - (NSUbiquitousKeyValueStore는 KV만 쓰므로 **CloudKit 컨테이너 불필요.**)
3. **프로비저닝 프로파일 재발급**:
   - `eas credentials` → iOS → production → Provisioning Profile → 재생성 (새 프로파일에 iCloud 포함).
   - 또는 클라우드 `eas build -p ios --profile production`(--local 빼면) → EAS가 capability 자동 동기화 + 프로파일 자동 재발급.
4. **prebuild + 재빌드**: `npx expo prebuild -p ios --clean` → 빌드.
   - 검증: 새 기기(또는 초기화 후)에서 재설치 → 알람·설정 복원되는지. (단 NSUbiquitousKeyValueStore는 최초 설치 시 download 지연 가능 → 한 번에 안 오면 재실행 시 복원될 수 있음.)

## 5. 코드 무결성
- 보류 중에도 backup/restore **타입 클린** + 핵심(로컬 Keychain) 동작. iCloud 코드는 dead-no-op로 남아 회귀 없음.
- 재활성화 시 **코드 추가 작업 거의 없음** = §4의 설정/프로파일 4단계만.
