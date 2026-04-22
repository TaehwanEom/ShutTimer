# v1.5 심사 대응 — 위치 권한 제거 보존 문서

**작성일:** 2026-04-22
**작성 이유:** v1.5 App Store 심사 Guideline 2.1 Information Needed 리젝 대응.
현재 빌드 27 purpose string `"Used to provide more relevant ads. Denying does not affect app functionality."`
가 Apple Tech Talks "Write clear purpose strings" 가이드라인의 vague 패턴에 해당하여
5.1.1 추가 리젝 리스크가 있음. 위치 권한을 실제로 읽어서 사용하는 코드가 0건이고
AdMob은 위치 권한 없이도 non-personalized 모드로 정상 동작하므로 v1.5에서 **권한 전체 제거**.

**재도입 조건:** v1.6 이상에서 purpose string을 구체화하고 실제 위치를 의미 있게 사용하는
기능을 함께 도입할 때. "ads"만을 위한 권한은 재도입 금지.

**재도입 시 필독:**
- Apple Tech Talks [Write clear purpose strings](https://developer.apple.com/videos/play/tech-talks/110152/)
- purpose string에 반드시 **예시(example)** 포함 필요
- 타이머 앱이 위치를 요구하는 합리적 기능(예: 지역 기반 사용 통계, 여행 모드) 설계 선행

---

## 보존 자산 1 — app.json `NSLocationWhenInUseUsageDescription`

**파일:** `app.json`
**위치:** `expo.ios.infoPlist` 객체 내, `NSCameraUsageDescription` 다음 줄
**원문:**

```json
"NSLocationWhenInUseUsageDescription": "Used to provide more relevant ads. Denying does not affect app functionality.",
```

**재도입 시:** 위 문구는 vague로 판정되는 패턴이므로 그대로 쓰지 말 것. 재번역 필수.

---

## 보존 자산 2 — `plugins/withInfoPlistLocalizations.js` 14개 언어 InfoPlist.strings 번역

**파일:** `plugins/withInfoPlistLocalizations.js`
**위치:** `TRANSLATIONS` 객체 내 각 언어별 `NSLocationWhenInUseUsageDescription` 키
**원문 (언어별):**

```js
ko: {
  NSLocationWhenInUseUsageDescription: '광고 개인화에 사용됩니다. 거부해도 앱 사용에 제약이 없습니다.',
},
en: {
  NSLocationWhenInUseUsageDescription: 'Used to provide more relevant ads. Denying does not affect app functionality.',
},
ja: {
  NSLocationWhenInUseUsageDescription: '広告のパーソナライズに使用されます。拒否してもアプリの利用に支障はありません。',
},
'zh-CN': {
  NSLocationWhenInUseUsageDescription: '用于个性化广告。拒绝不会影响应用功能。',
},
'zh-TW': {
  NSLocationWhenInUseUsageDescription: '用於個人化廣告。拒絕不會影響應用程式功能。',
},
fr: {
  NSLocationWhenInUseUsageDescription: "Utilisé pour personnaliser les publicités. Le refus n'affecte pas l'utilisation de l'application.",
},
de: {
  NSLocationWhenInUseUsageDescription: 'Wird zur Personalisierung von Anzeigen verwendet. Die Ablehnung beeinträchtigt die App-Nutzung nicht.',
},
es: {
  NSLocationWhenInUseUsageDescription: 'Se usa para personalizar anuncios. Rechazar no afecta el uso de la app.',
},
'pt-BR': {
  NSLocationWhenInUseUsageDescription: 'Usado para personalizar anúncios. A recusa não afeta o uso do app.',
},
it: {
  NSLocationWhenInUseUsageDescription: "Utilizzato per personalizzare gli annunci. Rifiutare non influisce sull'uso dell'app.",
},
tr: {
  NSLocationWhenInUseUsageDescription: 'Reklamları kişiselleştirmek için kullanılır. Reddetmek uygulama kullanımını etkilemez.',
},
ar: {
  NSLocationWhenInUseUsageDescription: 'يُستخدم لتخصيص الإعلانات. الرفض لا يؤثر على استخدام التطبيق.',
},
th: {
  NSLocationWhenInUseUsageDescription: 'ใช้เพื่อปรับโฆษณาให้เหมาะสม การปฏิเสธไม่ส่งผลต่อการใช้งานแอป',
},
id: {
  NSLocationWhenInUseUsageDescription: 'Digunakan untuk personalisasi iklan. Penolakan tidak memengaruhi penggunaan aplikasi.',
},
```

**재도입 시 가이드:** 번역 톤/스타일은 참고하되, 각 언어에 "구체적인 example" 추가 필요
(예: ko에 "예: 지역 기반 사용 통계 집계에 활용됩니다" 같은 구체 문구).

---

## 보존 자산 3 — `App.tsx` `callLocation` 블록

**파일:** `App.tsx`
**위치:** 기존 유저 대상 ATT 자동 요청 블록 내부 (`callATT` 함수 바로 아래)
**원문 (L193-L224 구간):**

```tsx
// 위치 권한 요청 — ATT 응답 직후 1회만 (AdMob 위치 기반 광고 활성)
const callLocation = async () => {
  try {
    const asked = await AsyncStorage.getItem('locationAsked');
    if (asked === 'true') {
      await appendLog('Location: already asked, skip');
      return;
    }
    await AsyncStorage.setItem('locationAsked', 'true');
    const Location = require('expo-location');
    const { status } = await Location.requestForegroundPermissionsAsync();
    await AsyncStorage.setItem('locationStatus', status);
    await appendLog(`Location request result=${status}`);
  } catch (e: any) {
    await appendLog(`ERROR in callLocation: ${e?.message || e}`);
  }
};

if (AppState.currentState === 'active') {
  await callATT();
  await callLocation();
} else {
  await appendLog(`AppState=${AppState.currentState}, waiting for active`);
  const sub = AppState.addEventListener('change', async (s) => {
    if (s === 'active') {
      sub.remove();
      await callATT();
      await callLocation();
    }
  });
}
```

**제거 시 축소 형태:** `await callLocation()` 두 곳 삭제, `callLocation` 함수 정의 전체 삭제.
`callATT`만 단독 호출로 남김.

**AsyncStorage 데드 키:**
- `locationAsked` — 중복 가드 전용
- `locationStatus` — 쓰기만 하고 읽는 곳 없음

---

## 보존 자산 4 — `src/screens/OnboardingScreen.tsx` location permission 관련

### 4-1. PermissionType 유니언

**위치:** L35
**원문:**
```tsx
type PermissionType = 'att' | 'location' | 'notification' | 'camera';
```
**제거 후:**
```tsx
type PermissionType = 'att' | 'notification' | 'camera';
```

### 4-2. slides 배열 내 location permission 슬라이드

**위치:** L123-L130 (ATT 슬라이드와 Notification 슬라이드 사이)
**원문:**
```tsx
{
  kind: 'permission',
  permission: 'location',
  icon: 'place',
  title: t('onboarding.permissionLocationTitle', { defaultValue: '지역 광고로 더 나은 경험' }),
  body: t('onboarding.permissionLocationBody', { defaultValue: '위치 정보로 더 적합한\n광고를 제공합니다.\n거부해도 앱은 정상 작동합니다.' }),
  buttonLabel: t('onboarding.permissionLocationButton', { defaultValue: '계속' }),
},
```

### 4-3. `requestPermission` 함수 내 `'location'` 분기

**위치:** L293-L297
**원문:**
```tsx
} else if (permission === 'location') {
  const Location = require('expo-location');
  const { status } = await Location.requestForegroundPermissionsAsync();
  await AsyncStorage.setItem('locationStatus', status);
  await AsyncStorage.setItem('locationAsked', 'true');
}
```

**재도입 시 주의:** 상단 주석(L1-L4)의 `권한 priming 3개 (ATT/위치/알림)` 문구도 복원 필요.

---

## 보존 자산 5 — 14개 locale JSON `permissionLocation{Title,Body,Button}`

**파일:** `src/locales/{ko,en,ja,zh-CN,zh-TW,th,id,de,fr,es,it,pt-BR,ar,tr}.json`
**위치:** 각 파일의 `onboarding` 네임스페이스 내 `permissionAttButton` 다음 ~ `permissionNotifTitle` 이전
**원문 (언어별):**

```json
// ko.json
"permissionLocationTitle": "지역 광고로 더 나은 경험",
"permissionLocationBody": "위치 정보로 더 적합한\n광고를 제공합니다.\n거부해도 앱은 정상 작동합니다.",
"permissionLocationButton": "계속",

// en.json
"permissionLocationTitle": "Better experience with local ads",
"permissionLocationBody": "Location info provides more\nrelevant ads.\nThe app works normally if denied.",
"permissionLocationButton": "Continue",

// ja.json
"permissionLocationTitle": "地域広告でより良い体験",
"permissionLocationBody": "位置情報によりより適切な\n広告を提供します。\n拒否してもアプリは動作します。",
"permissionLocationButton": "続ける",

// zh-CN.json
"permissionLocationTitle": "地区广告带来更佳体验",
"permissionLocationBody": "根据位置信息提供\n更相关的广告。\n拒绝也不影响使用。",
"permissionLocationButton": "继续",

// zh-TW.json
"permissionLocationTitle": "地區廣告帶來更佳體驗",
"permissionLocationBody": "根據位置資訊提供\n更相關的廣告。\n拒絕也不影響使用。",
"permissionLocationButton": "繼續",

// th.json
"permissionLocationTitle": "ประสบการณ์ที่ดีขึ้นด้วยโฆษณาท้องถิ่น",
"permissionLocationBody": "ข้อมูลตำแหน่งให้โฆษณา\nที่เกี่ยวข้องมากขึ้น\nแอปทำงานได้หากปฏิเสธ",
"permissionLocationButton": "ดำเนินการต่อ",

// id.json
"permissionLocationTitle": "Pengalaman lebih baik dengan iklan lokal",
"permissionLocationBody": "Informasi lokasi memberikan iklan\nyang lebih relevan.\nAplikasi tetap bekerja jika ditolak.",
"permissionLocationButton": "Lanjut",

// de.json
"permissionLocationTitle": "Bessere Erfahrung mit lokaler Werbung",
"permissionLocationBody": "Standortinfos bieten relevantere\nWerbung.\nDie App funktioniert auch ohne.",
"permissionLocationButton": "Weiter",

// fr.json
"permissionLocationTitle": "Meilleure expérience avec pubs locales",
"permissionLocationBody": "La localisation permet des\npublicités plus pertinentes.\nL'app fonctionne sans.",
"permissionLocationButton": "Continuer",

// es.json
"permissionLocationTitle": "Mejor experiencia con anuncios locales",
"permissionLocationBody": "La ubicación ofrece anuncios\nmás relevantes.\nLa app funciona si lo rechazas.",
"permissionLocationButton": "Continuar",

// it.json
"permissionLocationTitle": "Migliore esperienza con annunci locali",
"permissionLocationBody": "La posizione offre annunci\npiù pertinenti.\nL'app funziona anche senza.",
"permissionLocationButton": "Continua",

// pt-BR.json
"permissionLocationTitle": "Melhor experiência com anúncios locais",
"permissionLocationBody": "A localização oferece anúncios\nmais relevantes.\nO app funciona sem isso.",
"permissionLocationButton": "Continuar",

// ar.json
"permissionLocationTitle": "تجربة أفضل مع إعلانات محلية",
"permissionLocationBody": "الموقع يوفر إعلانات\nأكثر ملاءمة.\nالتطبيق يعمل إن رفضت.",
"permissionLocationButton": "متابعة",

// tr.json
"permissionLocationTitle": "Yerel reklamlarla daha iyi deneyim",
"permissionLocationBody": "Konum bilgisi daha alakalı\nreklamlar sunar.\nReddetsen de uygulama çalışır.",
"permissionLocationButton": "Devam",
```

**재도입 시 가이드:** 각 언어 번역을 "광고 관련성"에서 **구체 용도 example**로 개선 후 복원.

---

## 보존 자산 6 — `package.json` `expo-location` 의존성

**파일:** `package.json`
**위치:** `dependencies` 내 (expo-image-manipulator 다음 줄)
**원문:**

```json
"expo-location": "~19.0.8",
```

**재도입 시:** `npx expo install expo-location` 로 현 Expo SDK 버전에 맞춰 재설치 후
`package.json` 수동 관리 금지.

---

## 재도입 체크리스트 (v1.6+ 전용)

- [ ] 위치를 **실제로 읽어서** 의미 있게 사용하는 기능 설계 (Apple이 납득할 용도)
- [ ] purpose string을 구체 example 포함해서 재작성 (Apple Tech Talks 가이드라인 준수)
- [ ] 이 문서의 자산 1~6을 순서대로 복원
- [ ] `npx expo install expo-location` 으로 의존성 재설치
- [ ] `npx expo prebuild --clean --platform ios` 로 InfoPlist 재생성
- [ ] 14개 언어 번역 **개선**하여 적용 (원문 그대로 재사용 시 동일 리젝 위험)
- [ ] AsyncStorage 키 정책 재확인: `locationStatus` 를 실제 기능 판단에 사용하도록 개선
- [ ] 재도입 후 TestFlight 선행 검증 필수

---

## 제거 커밋 (예정)

v1.5 심사 재제출 빌드 (buildNumber 28).
파일별 변경 요약:
- `app.json`: NSLocationWhenInUseUsageDescription 제거, buildNumber 27→28
- `plugins/withInfoPlistLocalizations.js`: 14개 언어 NSLocation 키 제거
- `App.tsx`: callLocation 블록 제거
- `src/screens/OnboardingScreen.tsx`: PermissionType 'location', slides 내 location 슬라이드, requestPermission 'location' 분기 제거
- `src/locales/*.json` (14개): permissionLocation{Title,Body,Button} 42개 키 제거
- `package.json`: expo-location 의존성 제거
