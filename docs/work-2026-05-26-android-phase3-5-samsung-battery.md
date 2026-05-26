# Phase 3-5 (Samsung 배터리 최적화) — 작업 기록

> 세션: 2026-05-26
> 커밋: `4af701a` + `3581942`
> 브랜치: `feature/android-support`
> 상태: ✅ 구현 완료 + Pixel 에뮬레이터 측 검증 PASS + push 완료

---

## 1. 배경

Phase 1~3-4 마무리 직후 = 잔여 = "Phase 3-5 (OEM 배터리 최적화 안내)" 1건. 유저 측 지시 = **"샤오미가 왜 나와? 삼성폰 기준으로해"** → 삼성 측 한정 구현.

### 왜 필요한가?

- Android 측 OEM (특히 삼성 One UI 측 Device Care = "잠자는 앱" / "심층 잠자는 앱") 측 = 백그라운드 앱 측 알람 / FGS 측 = 강제 종료.
- `AlarmManager.setAlarmClock` 측 fire 시점 도달 시 = 프로세스 죽어있음 → 알람 실패.
- 해결 = 사용자 측 OS 측 = 본 앱 측 "배터리 최적화 제외" 측 = whitelist 등록 + 삼성 Device Care 측 = "잠자는 앱" 목록 측 제외.

---

## 2. 구현 내용

### A. NEW — `src/utils/oemBatteryHelper.ts` (90줄)

핵심 export:

```ts
export function isAndroid(): boolean
export function getManufacturer(): string         // Platform.constants.Manufacturer
export function isSamsung(): boolean              // manufacturer === 'samsung'
export async function requestIgnoreBatteryOptimization(): Promise<boolean>
export async function openBatteryOptimizationList(): Promise<boolean>
export async function openSamsungDeviceCare(): Promise<boolean>
```

#### 동작 흐름

1. **`requestIgnoreBatteryOptimization`** — `Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` intent + `data: package:com.shuttimer.app` → OS 측 dialog ("배터리 최적화 안 함으로 변경?") 띄움.
2. **`openBatteryOptimizationList`** — 1번 실패 시 fallback = `Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS` (= 앱 목록 화면). 그것도 실패 시 = `Settings.ACTION_APPLICATION_DETAILS_SETTINGS` (= 본 앱 정보 화면).
3. **`openSamsungDeviceCare`** — 삼성 측 한정. `com.samsung.android.lool` 패키지 측 BatteryActivity candidates 3종 시도 (= One UI 버전별 activity 명 측 변동 대응). 모두 실패 시 = 표준 `requestIgnoreBatteryOptimization` fallback.

#### iOS 안전 가드

- 모든 함수 측 첫 줄 = `if (!isAndroid()) return false/void;`
- `import * as IntentLauncher` 측 = iOS 측 = no-op stub 반환 (= expo-intent-launcher 측 cross-platform 호환).
- `import * as Application` 측 = `Application.applicationId` = iOS 측 측 = bundle identifier 반환 (= 본 helper 측 호출 안 됨 → 안전).

### B. 수정 — `src/screens/OnboardingScreen.tsx` (+28줄)

#### PermissionType 확장
```ts
type PermissionType = 'att' | 'notification' | 'camera' | 'samsung-battery';
```

#### slides 조건부 push
```ts
...(isSamsung()
  ? [{
      kind: 'permission' as const,
      permission: 'samsung-battery' as const,
      icon: 'battery-saver',
      title: '삼성 디바이스 케어 설정',
      body: '삼성 폰의 "잠자는 앱" 기능이\n알람을 차단할 수 있습니다.\n디바이스 케어에서 본 앱을\n"제외" 목록에 추가해주세요.',
      buttonLabel: '설정 열기',
    }]
  : [])
```

#### requestPermission 분기
```ts
} else if (permission === 'samsung-battery') {
  if (Platform.OS !== 'android') return;
  await openSamsungDeviceCare();
  await AsyncStorage.setItem('samsungBatteryAsked', 'true');
}
```

### C. 수정 — `src/screens/SettingsScreen.tsx` (+24줄)

알람 섹션 측 (= Switch alarmEnabled + vibration) 직후 측 = 배터리 최적화 행:

```tsx
{Platform.OS === 'android' && (
  <TouchableOpacity
    style={styles.toggleRow}
    onPress={async () => {
      if (isSamsung()) {
        await openSamsungDeviceCare();
      } else {
        await requestIgnoreBatteryOptimization();
      }
    }}
  >
    <View style={styles.toggleLeft}>
      <MaterialIcons name="battery-saver" size={22} color={colors.onBackground} />
      <Text style={styles.toggleLabel}>{t('settings.batteryOptimization', { defaultValue: '배터리 최적화 설정' })}</Text>
    </View>
    <MaterialIcons name="chevron-right" size={20} color={colors.secondary} style={{ opacity: 0.5 }} />
  </TouchableOpacity>
)}
```

---

## 3. iOS 파급 영향 보고 = 0

| 항목 | iOS 영향 | 근거 |
|------|---------|------|
| `oemBatteryHelper.ts` 측 import 측 = iOS 측 호출 시 | ❌ 없음 | 모든 export 함수 측 첫 줄 = `isAndroid()` false 측 즉시 return |
| `OnboardingScreen` 측 신규 슬라이드 | ❌ 없음 | `isSamsung()` 측 false → slides[] 측 미push → iOS slides 길이 / 순서 / 인덱스 = 불변 |
| `OnboardingScreen` 측 PermissionType union 확장 | ❌ 없음 | TypeScript 측 union 확장 = 기존 분기 측 영향 0 (= switch case 측 fall-through 안전) |
| `requestPermission('samsung-battery')` 분기 | ❌ 없음 | iOS 측 = 슬라이드 미렌더 → handlePermissionContinue 미호출 → 분기 진입 불가 |
| `SettingsScreen` 측 신규 행 | ❌ 없음 | `Platform.OS === 'android'` 측 비렌더 → iOS 설정 메뉴 측 = 행 / 순서 = 불변 |
| `AlarmkitBridge` 모듈 | ❌ 없음 | 본 작업 = JS 측 only, native 측 미수정 |
| `AlarmEventBus` 측 이벤트 | ❌ 없음 | 본 작업 = 이벤트 미발행 |
| iOS AlarmKit 측 권한 / Live Activity / 알람 entity 흐름 | ❌ 없음 | 본 작업 = 측 미접근 |

---

## 4. 검증

### Pixel 에뮬레이터 (= `emulator-5554`, manufacturer='Google', 비-삼성)

1. **TypeScript check** = `npx tsc --noEmit` 측 = 에러 0건 + warning 0건.
2. **JS bundle 정상 reload** = `am force-stop` + deep-link bypass DevLauncher + RN 측 `Running "main"` 측 로그 확인 + fatal 0건.
3. **Settings 화면 측 검증**:
   - "배터리 최적화 설정" 행 = **노출 확인** (`/tmp/ui-settings2.xml` 측 uiautomator dump 측 = `text="배터리 최적화 설정"` 정확 검출).
   - 행 tap → logcat 측 = 정확한 intent fire:
     ```
     START u0 {act=android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS
             dat=package: ...
             cmp=com.android.settings/.fuelgauge.RequestIgnoreBatteryOptimizations}
     ```
   - `topActivity=ComponentInfo{com.android.settings/com.android.settings.fuelgauge.RequestIgnoreBatteryOptimizations}` 측 = OS 표준 dialog 정확 표시.

### 미검증 영역 (= 실 Samsung 기기 필요)

- 삼성 측 한정 path (`openSamsungDeviceCare`) → Device Care BatteryActivity 측 = 3종 candidates 측 실제 fire 여부.
- Onboarding 측 = 삼성 슬라이드 측 렌더 + 버튼 tap → Device Care 측 deep-link.
- 잠자는 앱 / 심층 잠자는 앱 측 = 본 앱 측 제외 등록 후 = 알람 fire 신뢰성 변화 측정.

---

## 5. 커밋 + push

- **`4af701a`** `feat(android-alarm): Samsung 측 배터리 최적화 deep-link + onboarding 안내 — Phase 3-5`
  - 3 files changed, 160 insertions(+), 1 deletion(-)
  - 신규: `src/utils/oemBatteryHelper.ts`
  - 수정: `src/screens/OnboardingScreen.tsx`, `src/screens/SettingsScreen.tsx`

- **`3581942`** `docs(android-alarm): 진행 노트 측 Phase 3-5 완료 기록 + 잔여 정리`
  - 수정: `docs/context-notes-2026-05-22-android-alarm-engine.md`

- Push 완료: `cedb605..3581942 feature/android-support -> feature/android-support`
