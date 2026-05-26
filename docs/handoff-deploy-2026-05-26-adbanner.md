# 배포 인계 — 2026-05-26 AdBanner 통합

**브랜치**: `feature/android-support`
**추가 commit**: 3개 (`d95a21d` / `f147e36` / `967a29d`)
**대상 버전**: v1.9.x (= app.json 측 자동 increment)
**상태**: 디버그 빌드 + 심사 빌드 모두 진행 가능

---

## 직전 commit 요약

| commit | 내용 |
|--------|------|
| `d95a21d` | Tab 화면 5개 측 AdBanner → MainTabsNavigator tabBar 단일 통합 |
| `f147e36` | TabBarWithAd stable ref (React.memo + 모듈 외부) + require() 모듈 1회성 |
| `967a29d` | tabBar React.memo 직접 전달 → 함수 wrapper 복원 (= 빨간 에러 해결) |

---

## 검증 완료 영역

### 시뮬레이터 (iPhone 17 Pro, iOS 26.4) 실제 동작 100%
- 5개 탭 이동 (타이머/루틴/알람/캘린더/설정)
- Stack push 4개 화면 (RoutineEdit, 카테고리, FavoritesList, AddTimer, AlarmEdit)
- 타이머 시작/일시정지/재개
- 알람 등록 + 실제 fire + AlarmScreen + dismiss + 22 fix cleanup
- 알람루틴 step 01 → 02 → 03 advance + goHome

### production 광고 정합 정적 검증 (11개 항목)
- `eas.json` production env `EXPO_PUBLIC_HIDE_ADS=false`
- `GADApplicationIdentifier` (`ios/ShutTimer/Info.plist`) ↔ `app.json` plugin `iosAppId` 일치
- Banner unit ID iOS: `ca-app-pub-3043284478228309/4187716112`
- `NSUserTrackingUsageDescription` 설정
- `SKAdNetworkItems` 44개 등록
- ATT 요청 path 정상 (신규: OnboardingScreen / 기존: App.tsx)
- `MobileAds().initialize()` 1회성 호출
- `<BannerAd size=ANCHORED_ADAPTIVE_BANNER>` render path 정합

### 사용자 실기기 테스트
- 버그 미발견 (= 사용자 확인)

---

## 디버그 빌드 (= 시뮬레이터/실기기 측 개발 검증용)

### 명령
```bash
cd /Volumes/SeagateBac/moda/Timer
npx expo run:ios --device "Test_iPhone17_iOS26"
```
또는 실기기:
```bash
npx expo run:ios --device  # 디바이스 선택 prompt
```

### 디버그 빌드 특성
- `__DEV__=true` + `EXPO_PUBLIC_HIDE_ADS=true` → AdBanner 측 `return null`
- 광고 자체는 표시 안 됨 (= 의도된 동작)
- AdMob SDK는 초기화됨 (`MobileAds SDK initialized` 로그 확인 가능)
- TabBarWithAd path mount + 5개 탭 정상 작동만 검증 가능

### 디버그 빌드 측 확인 사항
1. 시뮬레이터 부팅 후 빨간 에러 화면 없이 정상 진입
2. 5개 탭 이동 시 깜빡임 없음
3. 알람/루틴 동작 정상
4. 디버그 화면 측 로그 export → `Perf-AdBanner` 누적 없음 확인

---

## 심사용 빌드 (= App Store Connect 제출용)

### 명령
```bash
cd /Volumes/SeagateBac/moda/Timer

# production 빌드
eas build --platform ios --profile production

# 빌드 완료 후 자동 제출
eas submit --platform ios --profile production
```

### production 빌드 특성
- `__DEV__=false` + `EXPO_PUBLIC_HIDE_ADS=false` → AdBanner render 진행
- `<BannerAd>` 컴포넌트 실제 mount + AdMob 광고 fetch + 표시
- TabBarWithAd 안에서 하단 탭 위쪽 영역에 광고 1개 표시 (= 모든 Tab 화면 공유)

### 빌드 시간
- EAS build: 약 15-30분
- App Store Connect 처리: 약 10-30분
- 합계: 약 30-60분

---

## 빌드 후 확인 사항 (= TestFlight 측)

### 핵심 확인 (= 본인 디바이스)
1. **TabBarWithAd 광고 위치**: 하단 탭 위쪽에 광고 띠 정상 표시 (= 잘림 없는지)
2. **광고 위치 stability**: 5개 탭 이동 시 광고 깜빡임 없이 stable
3. **알람 등록 + fire + dismiss** 정상 동작
4. **루틴 실행 + step advance** 정상
5. **타이머 시작/일시정지/재개** 정상
6. **잔존 알람 자동 청소** (= GhostCleanup) — 다음 빌드 설치 후 앱 켜고 5초 대기 시 자동 사라짐 확인

### 부가 확인
- ATT 권한 prompt 표시 + 응답 → 광고 personalization 반영
- Stack push 화면 측 자체 AdBanner (= AddTimerScreen, RoutineEditScreen, FavoritesListScreen, AlarmScreen) 정상 표시

---

## 검증 외 영역 (= 외부 의존)

| 항목 | 책임 |
|------|------|
| AdMob console 측 unit ID 등록 + payment 정보 | 사용자 |
| 광고 fill rate (= no-fill 가능성) | AdMob 서버 inventory |
| 실기기 long-term test (1-2일 연속) | TestFlight 측 모니터링 |

---

## 권장 배포 방식

### App Store Connect 단계 출시 (강력 권장)
```
1일차 = 1%
2일차 = 2%
3일차 = 5%
4일차 = 10%
5일차 = 20%
6일차 = 50%
7일차 = 100%
```

### 각 단계 모니터링
- Crash 리포트 (Xcode Organizer 또는 App Store Connect)
- 1성 리뷰 추세
- AdMob console 측 fill rate + 노출 측정

### 문제 발견 시
- 즉시 배포 hold (App Store Connect 측)
- 핫픽스 commit + 새 빌드 + 단계 출시 재시작

---

## 주의 사항

### 절대 금지
- 직접 Xcode Archive + Upload (= eas build 측 자동 increment + EAS 서버 측 일관 환경 측)
- production 빌드 측 디버그 측 console.log 측 강제 비활성 (= 측 = 측 = 이미 logger.ts 측 처리)
- 단계 출시 측 = 1단계 X → 즉시 100% (= 회귀 시 전 사용자 영향)

### 잠재 위험
- production 빌드 측 실제 광고 표시 = 외부 검증 영역 (= TestFlight 측 본인 디바이스 측 확인 필수)
- AdMob console 측 unit ID 측 = 등록 + payment 정보 = 사전 확인

---

## 결과물 문서

- `docs/work-2026-05-26-adbanner-consolidate.md` (= 작업 상세)
- `docs/handoff-deploy-2026-05-26-adbanner.md` (= 본 문서)
- `docs/work-2026-05-26-v19-autonomous-loop-fixes.md` (= 직전 22 fix)
- `docs/handoff-deploy-2026-05-26-v19.md` (= 직전 v1.9 인계)
- `docs/qa-result-2026-05-26-v19-simulator.md` (= 시뮬레이터 QA)
