# Build 창 인계 — 2026-05-29 Watch Bundle ID 정합

> 출처: Deploy 창
> 브랜치: `feature/android-support`
> HEAD: `bc832d5` (v1.8.7 release prep)
> 대상: `targets/watch/expo-target.config.js` 1줄 추가

---

## 1. 한 줄 요약

v1.8.7 디버그 빌드 중 EAS가 watch target Bundle ID(`com.shuttimer.app.watch`)를 Apple Developer Portal에 자동 등록 시도 → **외부 다른 팀 점유로 실패** → `com.shuttimer.watch`로 변경 필요.

---

## 2. 배경 (= 빌드 에러)

빌드 명령:
```bash
cd /Volumes/SeagateBac/moda/Timer && rm -rf ios && npx expo prebuild --platform ios --clean && NPM_CONFIG_CACHE=/tmp/shuttimer-npm-cache eas build --local --platform ios --profile preview --output /Volumes/SeagateBac/moda/Timer/build/ios/ShutTimer-v1.8.7-debug.ipa
```

에러:
```
✖ The bundle identifier com.shuttimer.app.watch is not available to team "eunju lee (Individual)" (SD6264B7H3), change it in your app config and try again.
An attribute in the provided entity has invalid value - An App ID with Identifier 'com.shuttimer.app.watch' is not available. Please enter a different string.
Error: build command failed.
```

---

## 3. 진단 결과

### 3.1 Apple Developer Portal 확인 (eunju lee 팀)

| Bundle ID | 상태 |
|---|---|
| `com.shuttimer.app` | 등록 완료 (메인) |
| `com.shuttimer.app.widget` | 등록 완료 (widget target) |
| `com.shuttimer.app.watch` | **미등록 + 등록 시도 거부** = 외부 다른 팀 점유 확정 |
| `com.shuttimer.watch` | **신규 등록 완료** (2026-05-29, eunju lee 팀) |

### 3.2 코드 측 자동 생성 원인

`targets/watch/expo-target.config.js`:
```js
module.exports = config => ({
  type: 'watch',
  icon: '../../assets/icon.png',
  colors: { $accent: '#FF6B35' },
  deploymentTarget: '11.0',
  entitlements: {},
});
```

- `bundleIdentifier` 명시 안 됨
- `@bacons/apple-targets` (v4.0.7, commit `a55a518` 도입) 가 자동으로 메인 Bundle ID(`com.shuttimer.app`) + `.watch` 접미사 → `com.shuttimer.app.watch` 생성
- widget target도 동일 패턴 (`com.shuttimer.app.widget`)이라 widget은 정상 작동

### 3.3 grep 결과

`shuttimer.app.watch` 문자열은 코드/config/plist에 없음 (= prebuild 자동 생성 확정):
```
git grep 'shuttimer\.app\.watch'  → 0건
```

---

## 4. 권장 수정 (= 1줄 추가)

**파일**: `targets/watch/expo-target.config.js`

```js
/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = config => ({
  type: 'watch',
  bundleIdentifier: 'com.shuttimer.watch',  // ← NEW (Apple Portal 등록 ID 정합)
  // ShutTimer 측 메인 icon 측 정합 (= 단일 App Store binary).
  icon: '../../assets/icon.png',
  colors: {
    $accent: '#FF6B35', // ShutTimer 오렌지
  },
  // watchOS 11+ (= 최신 SwiftUI + WKExtendedRuntimeSession + UNUserNotificationCenter).
  deploymentTarget: '11.0',
  entitlements: {
    // Phase 1 = 일반 타이머 측 = 단독 동작 (= iPhone sync X). 추가 entitlements 측 X.
  },
});
```

`@bacons/apple-targets`은 `bundleIdentifier` 옵션을 정식 지원 (widget target과 동일 패턴이나 명시 vs 자동 차이만).

---

## 5. 영향 범위

| 영역 | 영향 |
|---|---|
| 메인 앱 (`com.shuttimer.app`) | 영향 0 |
| Widget (`com.shuttimer.app.widget`) | 영향 0 |
| Watch target Bundle ID | `com.shuttimer.app.watch` → `com.shuttimer.watch` |
| App Group 공유 (`group.com.shuttimer.app`) | 영향 0 (watch entitlements는 빈 상태, Phase 1 iPhone 연동 X) |
| TestFlight / App Store 기존 빌드 (1.8.6 215~224) | 영향 0 (watch target은 이번 1.8.7부터) |
| iOS native ios/ 폴더 | rm -rf 후 prebuild 재생성하므로 영향 0 |

---

## 6. 후속 절차

```bash
# 1. 코드 수정 (위 §4 그대로)
#    → targets/watch/expo-target.config.js 에 bundleIdentifier: 'com.shuttimer.watch' 추가

# 2. commit + push
cd /Volumes/SeagateBac/moda/Timer
git add targets/watch/expo-target.config.js
git commit -m "fix(watch): bundle identifier com.shuttimer.app.watch → com.shuttimer.watch (Apple Developer Portal 정합)"
git push origin feature/android-support

# 3. 배포창에서 빌드 명령 재실행 (=동일 명령)
# (Deploy 창 영역)
```

---

## 7. 검증

### 7.1 즉시 검증 (= 코드 수정 후)
- `cat targets/watch/expo-target.config.js` 로 `bundleIdentifier` 라인 확인
- `npx expo prebuild --platform ios --clean` 단독 실행 → `ios/` 생성 후
  ```bash
  grep -r 'com.shuttimer.watch\|com.shuttimer.app.watch' ios/ | head -20
  ```
  - `com.shuttimer.watch` 만 나오고 `com.shuttimer.app.watch` 0건이면 OK

### 7.2 빌드 검증 (= Deploy 창)
- preview + production 빌드 둘 다 통과
- .ipa Info.plist 측 메인 Bundle ID = `com.shuttimer.app` 유지 확인
- Embedded watch target Bundle ID = `com.shuttimer.watch` 확인

---

## 8. 위험 / 주의

| 항목 | 위험 | 비고 |
|---|---|---|
| Apple Portal Provisioning Profile 자동 생성 | 낮음 | EAS가 새 Bundle ID로 자동 처리 (기존 widget도 동일 흐름) |
| 기존 사용자 watch 데이터 마이그레이션 | 0 | watch target 자체가 1.8.7부터 신규 (= a55a518 이전 빌드 없음). 마이그레이션 대상 없음 |
| `@bacons/apple-targets` `bundleIdentifier` 옵션 호환 | 낮음 | widget target도 동일 plugin 사용. 옵션 표준 지원 |
| watch target Bundle ID 도메인 변경 (= `.app.` 빠짐) | 매우 낮음 | App Group `group.com.shuttimer.app` 공유 자체는 entitlement 매칭이라 도메인과 무관 |

---

## 9. 롤백 (= 본 수정 되돌리기)

```bash
git revert HEAD  # 본 fix commit 되돌리기
```

= `com.shuttimer.app.watch` 자동 생성 복귀. 단 Apple Portal 등록 안 됐으니 빌드 다시 실패 (= 의미 없음, 롤백 X).

---

## 10. Build 창 작업 결과 보고 요청

수정 완료 후 다음 정보 Deploy 창에 회신:
- 수정한 commit hash
- push 완료 여부
- `npx expo prebuild --platform ios --clean` 단독 실행 시 `ios/` 안 `com.shuttimer.watch` 정확히 박혔는지 (위 §7.1)
