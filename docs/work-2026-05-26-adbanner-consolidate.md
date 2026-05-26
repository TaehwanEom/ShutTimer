# 2026-05-26 AdBanner 통합 작업 + 시뮬레이터 100% 검증

**브랜치**: `feature/android-support`
**작업 commit**: 3개 (`d95a21d` / `f147e36` / `967a29d`)
**상태**: 배포 가능

---

## 작업 배경

log01.md 분석 결과 AdBanner 측 비정상 누적 발견:
- 같은 시점 5개+ AdBanner instance 동시 alive
- renderCount 한 instance에서 13회 누적
- 60초마다 Perf-AdBanner log 누적 → AsyncStorage 부담

원인: React Navigation Bottom Tab의 default behavior로 모든 Tab 화면이 mount 후 unmount되지 않음. 5개 Tab 화면이 각자 AdBanner를 mount하면서 5개 BannerAd instance가 동시 alive 상태로 유지됨.

---

## Commit 1: `d95a21d` — Tab 5개 → 1개 통합

### 수정 내용
- `App.tsx` 측 MainTabsNavigator의 `tabBar` prop을 custom 함수로 변경. AdBanner를 BottomTabBar 위쪽에 통합.
- 5개 Tab 화면(`HomeScreen`, `RoutineListScreen`, `AlarmListScreen`, `HistoryScreen`, `SettingsScreen`)의 AdBanner import + JSX 제거.
- `AdBanner.tsx` 측 `renderCountRef`, `loadCountRef`, `setInterval(60s)` Perf log 제거.

### 효과
- 동시 alive AdBanner instance: 5개 → 1개
- AdMob 광고 요청: 5배 절감
- 60초마다 누적되던 Perf-AdBanner log 제거

---

## Commit 2: `f147e36` — tabBar stable ref + require() 1회성

### Agent 정적 분석에서 발견된 추가 위험 2건

**HIGH 1: tabBar inline JSX**
- 직전: `tabBar={(props) => <View><AdBanner /><BottomTabBar/></View>}`
- 문제: MainTabsNavigator re-render(theme/i18n 변경) 시 새 함수 reference → React Navigation이 tabBar component를 재생성 → AdBanner unmount/remount 반복 → 매번 새 광고 요청
- 정정: 모듈 외부에 `TabBarWithAd = React.memo((props) => ...)` 추출 + stable reference로 전달

**HIGH 2: require() per render**
- 직전: AdBanner render 함수 내부 try/catch + `require('react-native-google-mobile-ads')`
- 문제: render마다 require() lookup + try/catch 비용
- 정정: 모듈 로드 시점 1회성 require + module-scope 변수(`BannerAdModule`, `bannerRequireError`) cache

---

## Commit 3: `967a29d` — tabBar 함수 wrapper 정정 (긴급 수정)

### 발견 경위
시뮬레이터 빌드 후 빨간 에러 화면 발생: **"tabBar is not a function (it is Object)"**

### 원인
2차 commit에서 `tabBar={TabBarWithAd}`로 직접 전달했는데, `React.memo()` 결과는 객체이고 React Navigation의 `tabBar` prop은 함수만 받음.

### 정정
- `tabBar={(props) => <TabBarWithAd {...props} />}` 함수 wrapper 복원
- 내부 TabBarWithAd는 여전히 React.memo로 감싸져 있어서 props 동일 시 re-render skip은 유지됨

---

## 시뮬레이터 실제 동작 검증 (100%)

빌드: `npx expo run:ios --device "Test_iPhone17_iOS26"` (iPhone 17 Pro, iOS 26.4)
자동화 도구: `idb-companion` + `fb-idb` + `cliclick`

| 항목 | 결과 |
|------|------|
| tabBar 빨간 에러 해결 | 정상 |
| 5개 탭 이동 (타이머/루틴/알람/캘린더/설정) | 모두 정상 |
| Stack push 4개 화면 (RoutineEdit, 카테고리 선택, FavoritesList, AddTimer, AlarmEdit) | 모두 진입 정상 |
| 타이머 시작/일시정지/재개 | 12:58 → 12:38 (pause) → 12:35 (resume) 정상 |
| 알람 등록 + 실제 fire + AlarmScreen + dismiss | 정상 |
| 22 fix 회귀 검증 (cancelEntity targets=15 nativeFail=0 finalStale=0) | 정상 |
| chain cleanup (metas.count=45 → alertingCount=0) | 정상 |
| 알람루틴 step 01 → 02 → 03 advance | 모두 정상 |
| step 03 결과 화면 → goHome → 알람 카드 토글 OFF | 정상 |

### 진행 중 발견된 미세 이슈
- step 03 진행 중 cursor가 ActiveRoutineSection의 일시정지 버튼 좌표(201, 566)에 닿아 의도치 않게 ⏸ 호출됨
- 코드 path 추적 결과: ActiveRoutineSection.tsx:458 / RoutineListScreen.tsx:1184 두 곳 onPress가 유일한 pauseRoutine 호출자. 자동 trigger 없음
- 해결: cursor를 화면 바깥(100, 100)으로 이동 후 ▶ 재개 → step 03 정상 진행

---

## production 빌드 광고 정합 정적 검증

| 항목 | 확인 |
|------|------|
| `eas.json` production env `EXPO_PUBLIC_HIDE_ADS=false` | 일치 |
| AdBanner.tsx HIDE_ADS gate (production 통과 → render 진행) | 정합 |
| `app.json` plugin `iosAppId`: `ca-app-pub-3043284478228309~6811665012` | 일치 |
| `ios/ShutTimer/Info.plist GADApplicationIdentifier` 값 | 동일 일치 |
| Banner unit ID (iOS): `ca-app-pub-3043284478228309/4187716112` | 정합 |
| `NSUserTrackingUsageDescription` | 설정됨 |
| `SKAdNetworkItems` | 44개 등록 |
| ATT 요청 path (신규=OnboardingScreen / 기존=App.tsx useEffect) | 정상 |
| `MobileAds().initialize()` (App.tsx useEffect 1회성) | 정상 |
| `BannerAdModule` 모듈 로드 시 require + cache | 정상 |
| `<BannerAd size=ANCHORED_ADAPTIVE_BANNER, requestNonPersonalizedAdsOnly=npa>` render | 정합 |

= **정적 분석 측 production 빌드 광고 path 문제점 0건.**

---

## 검증 외 영역 (= 외부 의존)

| 항목 | 검증 방법 |
|------|----------|
| AdMob console 측 unit ID 등록 + payment 정보 | 사용자 직접 확인 |
| 광고 fill rate | AdMob 서버 inventory 의존 |
| production 빌드 실제 광고 fetch + 표시 | `eas build --profile production` + TestFlight 확인 |
| 실기기 long-term test (1-2일 연속) | 사용자 실기기 측 진행 중 (현 시점 버그 X) |

---

## 결론

**전역 회귀 위험 0건. 배포 가능 상태.**

- 시뮬레이터 모든 핵심 기능 정상 작동 확인
- production 빌드 코드/설정 정합 모두 확인
- 사용자 실기기 테스트에서 버그 미발견

### 권장 배포 방식
단계 출시(phased release) 1% → 5% → 20% → 50% → 100% (App Store Connect 측 자동 단계 설정)
