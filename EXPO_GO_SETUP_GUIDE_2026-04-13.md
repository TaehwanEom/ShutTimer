# Expo Go 셋팅 가이드 (2026-04-13)

**목표:** 네이티브 모듈을 사용하는 React Native 앱을 Expo Go에서 실행 가능하게 셋팅

---

## 문제 상황

다음 네이티브 모듈들로 인해 Expo Go에서 앱이 실행되지 않음:
- `react-native-google-mobile-ads` (TurboModuleRegistry 에러)
- `react-native-purchases` (RevenueCat 에러)
- `@react-native-ml-kit/image-labeling` (네이티브 모듈)
- `expo-notifications` (SDK 53 이후 제한)

---

## 해결 순서 (중요: 순서 지키기)

### Step 1: package.json 수정

```bash
# 네이티브 광고 모듈 제거
react-native-google-mobile-ads 삭제
```

**파일:** `package.json`  
**변경:** dependencies 섹션에서 `react-native-google-mobile-ads` 제거

---

### Step 2: app.json 수정

**파일:** `app.json`  
**변경:** plugins 섹션에서 다음 제거

```json
[
  "react-native-google-mobile-ads",
  {
    "androidAppId": "ca-app-pub-...",
    "iosAppId": "ca-app-pub-..."
  }
]
```

---

### Step 3: 코드 파일 수정

#### 3-1. PurchaseContext.tsx

```tsx
// 변경 전
import Purchases, { CustomerInfo } from 'react-native-purchases';

// 변경 후
let Purchases: any = null;
try {
  Purchases = require('react-native-purchases').default;
} catch {
  // Expo Go에서는 react-native-purchases 미지원
}

type CustomerInfo = any;

// useEffect에서
if (!Purchases) {
  setLoading(false);
  return;
}
```

#### 3-2. App.tsx

```tsx
// 제거할 코드
import { PurchaseProvider } from './src/context/PurchaseContext';
let PurchaseProvider: React.ComponentType<{ children: React.ReactNode }> | null = null;
try {
  PurchaseProvider = require('./src/context/PurchaseContext').PurchaseProvider;
} catch (e) {}

// App() 함수 간소화
export default function App() {
  return (
    <ThemeProvider>
      <ForceUpdate />
      <AppNavigator />
    </ThemeProvider>
  );
}
```

#### 3-3. AdBanner.tsx

```tsx
// 변경 후
export default function AdBanner() {
  return null;
}
```

#### 3-4. AlarmScreen.tsx

```tsx
// 제거
import { InterstitialAd, AdEventType, TestIds } from 'react-native-google-mobile-ads';

// 변경
const isAdFree = true; // Expo Go: 광고 비활성화
const interstitial = null; // 광고 비활성화

// ImageLabeling 동적 로드
try {
  const ImageLabeling = require('@react-native-ml-kit/image-labeling').default;
  const result = await ImageLabeling.label(photo.uri);
} catch {
  // Expo Go에서는 이미지 인식 모듈 미지원, 항상 success 처리
  enterResult('success');
}
```

#### 3-5. SettingsScreen.tsx

```tsx
// 제거
import { usePurchase } from '../context/PurchaseContext';

// 변경
const isAdFree = true;
const purchaseAdFree = async () => { console.warn('Purchase not available in Expo Go'); };
const restorePurchases = async () => { console.warn('Restore not available in Expo Go'); return false; };
```

---

### Step 4: 의존성 재설치

```bash
npm install
```

**중요:** 새로운 node_modules를 생성하고 제거된 패키지를 완전히 제거

---

### Step 5: Expo 서버 시작

```bash
npm start
```

**예상 출력:**
```
Starting project at /Volumes/Seagate Bac/moda/Timer
Starting Metro Bundler
Waiting on http://localhost:8081
```

---

## 확인 사항

✅ 에러 메시지 없음  
✅ "Expo Go app detected" 메시지 표시  
✅ 앱이 Expo Go에서 로드됨  

---

## 주의사항

### 건드리면 안 되는 것
- `expo-notifications` (제거하지 말 것 - 경고만 무시)
- `SIZE`, `cx`, `cy` (레이아웃 변경)
- `styles` (스타일 구조)

### 조건부 로드 방식 사용 금지
```tsx
// ❌ 하지 마
if (Platform.OS === 'ios') {
  import(...)
}

// ✅ 이렇게
try {
  require(...)
} catch {
  // 에러 처리
}
```

---

## 만약 또 에러가 나면?

### 1단계: Metro 캐시 초기화
```bash
npm start -- --reset-cache
```

### 2단계: node_modules 완전 재설치
```bash
rm -rf node_modules
npm install
```

### 3단계: 파일 검색으로 남은 import 확인
```bash
grep -r "react-native-google-mobile-ads" src/
grep -r "react-native-purchases" src/ --exclude-dir=node_modules
```

만약 import가 남아있으면 해당 파일을 Step 3에 따라 수정

---

## 체크리스트 (다음 세팅 시)

- [ ] package.json에서 react-native-google-mobile-ads 제거
- [ ] app.json에서 플러그인 제거
- [ ] PurchaseContext.tsx 동적 로드로 변경
- [ ] App.tsx에서 PurchaseProvider 제거
- [ ] AdBanner.tsx → null 반환
- [ ] AlarmScreen.tsx 수정 (광고, 이미지 인식)
- [ ] SettingsScreen.tsx 수정 (usePurchase)
- [ ] npm install 실행
- [ ] npm start 실행
- [ ] Expo Go에서 오류 없이 로드 확인

---

**작성일:** 2026-04-13  
**목적:** 다음 Expo Go 셋팅 시 오류 없이 한 번에 완료하기
