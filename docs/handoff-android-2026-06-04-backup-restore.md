# Android 구현창 인계 — 삭제 후 재설치 복원(백업/복원) (2026-06-04)

발신: iOS 구현창. 대상: Android 구현창. 브랜치: `feature/android-support`.

## 0. 배경 / 문제
앱 삭제 후 재설치하면 **완전 초기화**(알람·온보딩 다 날아감)되는 UX 문제. 실사용자가 문제 생겨 삭제→재설치 시 알람 다 잃음. 인앱결제 도입 시에도 곤란.

## 1. iOS에서 구현한 것 (이번 작업, 공통 JS + iOS 네이티브 의존)
**핵심**: iOS Keychain은 앱 삭제해도 데이터가 잔존함 → `expo-secure-store`(=Keychain)에 알람·온보딩을 미러해두고, 재설치 시 복원.

### 파일
- **신규 `src/utils/backupRestore.ts`**:
  - `BACKUP_KEYS` 화이트리스트 = **콘텐츠**(`shuttimer_alarms`, `shuttimer_routines`, `shuttimer_custom_categories`, `shutimer_missions`) + **온보딩**(`onboardingCompleted`) + **설정/선호**(`shuttimer_language`, `shutimer_dismiss_method`, `shutimer_vibration_enabled`, `shutimer_dark_mode`, `shutimer_alarm_sound`, `shutimer_primary_color`, `shutimer_dial_type`, `shutimer_alarm_enabled`, `shutimer_mission_duration`, `shutimer_selected_missions`, `shutimer_keep_screen_on`).
    - ⚠️ 런타임/세션/알람매핑/마이그레이션 플래그/로그 키는 **절대 포함 금지** (복원 시 stale state 주입 → 오작동).
  - `mirrorToBackup()`: 위 키를 AsyncStorage → SecureStore(`shuttimer_backup_v1`)에 JSON 번들로 미러. fire-and-forget.
  - `restoreIfNeeded()`: **프레시 설치 신호(`onboardingCompleted`가 null) + 백업 존재** 시 복원. 정상 사용 중엔 no-op(지운 알람 부활 방지). 내부 `restoreAttempted` guard로 **여러 번 호출돼도 1회만** 수행(idempotent).
- `src/constants/alarms.ts`: `saveAlarms()` 후 `mirrorToBackup()`.
- `src/constants/routines.ts`: `saveRoutines()` 후 `mirrorToBackup()`.
- `src/screens/OnboardingScreen.tsx`: 온보딩 완료 시 `mirrorToBackup()`.
- `App.tsx`:
  - **AppState 리스너** — background/inactive 전환 시 `mirrorToBackup()`.
  - 부트스트랩 IIFE 시작부, `syncAllAlarms()` **전**에 `await restoreIfNeeded()` (복원된 알람을 재예약하기 위해 sync 전에 실행).
  - **⭐ 타이밍 레이스 수정 (아래 §1.1 — 공통 JS, Android도 직접 영향)**.
- `package.json`: `expo-secure-store ~15.0.8` 추가 (+ config plugin 자동 추가됨 → **prebuild 필요**).

### 1.1 ⭐ 타이밍 레이스 수정 (중요 — Android도 동일하게 적용됨)
**증상(수정 전)**: 재설치 시 **온보딩이 다시 뜨고 설정이 기본값으로 회귀**. (복원 자체는 성공했는데 결과가 안 보임.)

**원인**: 복원은 정상 작동했으나 **너무 늦게** 끝남. 로그상 앱 시작 후 복원 완료까지 ~6초(Debug/Metro 로딩) 걸렸는데:
- `SplashScreen`은 **1.5초** setTimeout에서 `onboardingCompleted`를 읽어 온보딩/홈 분기 → 복원 전에 "기록 없음 → 온보딩" 오판정.
- `ThemeContext`는 **mount 시 1회** `dark_mode`/`primary_color`를 읽음 → 복원 전 기본값으로 그려짐.
- 즉 **읽기(스플래시·테마) 가 복원보다 먼저** = 레이스.

**수정**: `App.tsx` 루트 컴포넌트에서 **앱 트리(ThemeProvider/NavigationContainer) 렌더 전에 `restoreIfNeeded()`를 await**하도록 게이팅.
```tsx
const [restoreReady, setRestoreReady] = useState(false);
useEffect(() => { restoreIfNeeded().catch(() => false).finally(() => setRestoreReady(true)); }, []);
if (!restoreReady) return <View style={{ flex: 1, backgroundColor: '#FFFFFF' }} />; // 네이티브 스플래시 유지
```
- 복원 완료 후에야 ThemeProvider·SplashScreen이 mount → **복원된 값으로 초기화**.
- 정상 실행(온보딩 완료 상태): `onboardingCompleted != null` → `restoreIfNeeded` 즉시 no-op → **지연 없음**.
- guard 덕분에 루트 게이트 + 부트스트랩 IIFE에서 중복 호출돼도 1회만 수행.

**→ Android 주의**: 이 게이팅은 **공통 JS**라 Android에도 그대로 적용됨. Android는 (secure-store가 삭제 시 사라져) 복원할 백업이 없으면 `restoreIfNeeded`가 빠르게 no-op → 게이트가 즉시 풀려 **회귀 없음**. Android Auto Backup 등으로 백업이 복원되는 경로를 추가하면 이 게이팅이 그대로 활용됨.

### iOS 빌드 주의
- **prebuild + pod install 필요** (expo-secure-store 네이티브). 빌드/검증은 배포·빌드창.
- 설치 중 `[bacons/apple-targets] ios.appleTeamId 누락` 경고 출력됨 → 빌드 영향 가능성, 빌드창 확인 필요(기존 빌드는 통과했으니 soft warning일 수 있음).

## 2. ⚠️ Android — 이대로는 복원 안 됨 (Android창 작업 필요)
**`expo-secure-store`는 Android에서 앱 삭제 시 데이터가 함께 삭제됩니다** (iOS Keychain과 동작 다름). → 재설치 시 `restoreIfNeeded()`가 **백업을 못 찾아 graceful no-op**. **즉 현재 코드로 iOS는 복원되지만 Android는 복원 안 됨.**

코드 자체는 **크로스플랫폼 안전**(Android에서 mirror는 설치 중엔 쓰이고, 삭제되면 restore가 그냥 빈 결과 → 기존처럼 새로 시작). 회귀 없음.

### Android 복원을 위해 할 일 (택1)
1. **Android Auto Backup** (가장 가벼움): `android/app/src/main/AndroidManifest.xml`의 `android:allowBackup="true"` + `fullBackupContent`/`dataExtractionRules`로 AsyncStorage(파일) 백업 포함 → 구글 드라이브 자동 백업/재설치 복원. 코드 거의 불필요. 단 유저 백업 설정·타이밍 의존, 100% 보장 아님.
2. **공용 백엔드/계정**: 로그인 기반 서버 동기화. iOS·Android 동일 동작 + 기기 간 복원. 작업량 큼.

→ **권장**: 우선 Android Auto Backup 설정 확인/적용. (이미 켜져 있으면 어느 정도 복원될 수도 — 실기기로 삭제→재설치 검증 필요.)

---

## 2-A. ⭐ Android 검증 결과 (Android창, 2026-06-04 — 에뮬레이터 google_apis API36 + bmgr LocalTransport)

**검증 방법**: `bmgr` LocalTransport로 백업→삭제(uninstall)→재설치→복원 사이클(구글 계정 없이 결정적). `adb root`로 RKStorage·shared_prefs 직접 확인. 실제 알람 1개 생성 후 사이클.

### ✅ 확인된 것
1. **Auto Backup이 데이터를 복원함 (추가 코드 0).** `allowBackup="true"`(Expo 기본, 생성 manifest 확인) + 제외 규칙 없음 → **AsyncStorage(RKStorage = 알람·온보딩·설정) + 네이티브 shared_prefs(alarmkit_bridge_alarms.xml 등) 통째 복원.** 주입 마커·`onboardingCompleted`·`shuttimer_alarms`·`shuttimer_alarmkit_metadata` 모두 재설치 후 생존 확인.
   - → 인계가 우려한 "secure-store 삭제로 복원 안 됨"과 **별개로, AsyncStorage Auto Backup 경로로 데이터는 복원됨.**
2. **앱 정상 부팅.** 크래시 0, **온보딩 skip**(복원된 onboardingCompleted), 알람 UI 표시, 설정 복원. `[GhostCleanup] 30=30 ghostCount=0`(일치), `migrateSoundRename skip`(플래그 복원 → 이중실행 방지 = 올바름). §1.1 타이밍 게이팅도 Android에서 회귀 없음.

### ⚠️ 발견한 갭 — **복원된 알람이 재부팅 전엔 발화 안 함**
- 복원 직후 **`dumpsys alarm`에 우리 앱 알람 0개 armed** (미래 시각 알람인데도). 즉 재설치 후 **알람 목록엔 보이지만 재부팅 전까지 실제로 안 울림.**
- **원인**: 복원된 **AsyncStorage 매핑(`shuttimer_alarmkit_metadata`)** 때문에 `syncAllAlarms`가 "이미 예약됨"으로 판단 → AlarmManager 재예약 skip. (iOS는 AlarmKit가 재설치 후 진짜 비어서 재예약 트리거; Android는 prefs+매핑이 같이 복원돼 **거짓 일치**.) 네이티브 prefs를 지워도(framework=0) 매핑 때문에 skip되는 것 관찰함. 이 매핑은 RKStorage DB의 한 키라 **파일 단위 백업 제외 불가.**
- **완화(영구 손실 아님)**: 네이티브 prefs도 복원되므로 **다음 기기 재부팅 시 `BootReceiver.rescheduleAllFromBoot`가 미래 알람을 재예약 → 그때부터 정상 발화** (미래/반복 알람 보존 = 커밋 `21029e4`). 재설치~재부팅 사이 구간만 미발화.

### 권장 (후속 — common JS라 iOS 조율 필요, 단독 변경 금지)
- `syncAllAlarms`가 매핑만 보지 말고 **실제 AlarmManager 무장 상태와 대조**해 재예약하거나, **"복원 직후 감지 → 런타임 매핑 클리어 후 재예약"** 로직 추가. `syncAllAlarms`는 공통 JS → iOS 영향 검토 후 조율.
- 별개: Auto Backup 자체는 실기기에서 **유저 백업 ON + 구글 로그인 + 타이밍** 의존 = 100% 보장 아님(인계 기재 그대로).

### 결론
- **데이터 복원 = 작동(코드 0), 앱 안정.** 단 **알람 즉시 발화는 재부팅 의존** → 위 후속 fix는 iOS 조율 필요. 현재 Android는 "재설치 후 데이터·온보딩·설정 복원 + 알람은 재부팅 후 발화" 상태.

## 3. Phase 2 (iCloud, iOS) — 구현 완료
- **iCloud KV(NSUbiquitousKeyValueStore)** 추가됨 → 기기 교체/초기화에도 복원 + 1MB 한도(Keychain 2KB 제약 해소).
- 네이티브: `modules/alarmkit-bridge/ios/AlarmkitBridgeModule.swift` 에 `icloudSetString/icloudGetString/icloudSync` 추가.
- TS 인터페이스: `AlarmkitBridgeModule.ts` 에 선언 + 폴백 스텁.
- entitlement: `app.json` ios.entitlements 에 `com.apple.developer.ubiquity-kvstore-identifier` 추가.
- `backupRestore.ts`: mirror 시 iCloud에도 기록, restore 시 로컬 없으면 iCloud fallback.
- **⚠️ 빌드 요건**: App ID에 **iCloud(Key-Value) capability 활성화** 필요 (Apple Developer Portal / 자동서명). prebuild + pod install 포함. iCloud 미설정이면 빌드/서명 실패 가능 → 빌드창 확인.
- ⚠️ NSUbiquitousKeyValueStore는 최초 설치 시 클라우드값 download 지연 가능 → iCloud 경로는 "재실행 시 복원될 수 있음" (로컬 경로가 1차).
- **Android 무관** (iCloud는 iOS 전용).

## 4. 검증 상태
- iOS: **타입 클린**(내 변경 에러 0). **실기기 검증 완료(2026-06-04)** — 알람·루틴 설정 + 설정 변경 → 삭제 → 재설치 → **온보딩 skip + 알람·루틴·설정 모두 복원 확인**. (타이밍 레이스 수정 후 통과.)
- 커밋: backup/restore 관련 파일만 선별 커밋(다른 창 작업과 working tree 공유 → 뭉쳐 커밋 회피).

## 5. 요약 (한 줄)
- iOS 삭제후재설치 복원 = Keychain 미러/복원으로 구현(공통 JS + expo-secure-store). **Android는 secure-store가 삭제 시 사라져 복원 안 됨 → Android창이 Auto Backup(또는 백엔드) 적용 필요.**
