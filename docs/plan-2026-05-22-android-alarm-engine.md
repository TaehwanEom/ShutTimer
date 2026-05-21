# 안드로이드 알람 엔진 구현 계획서 — 타이머 우선, 3단계

- **작성일:** 2026-05-22
- **작성 창:** 구현(Build) 창 — 창 역할 분리 예외, 유저 명시 승인 하에 Plan 역할 수행
- **검증:** Android 14/15 패턴은 `developer.android.com`, Expo는 `docs.expo.dev`로 확인 (2026-05 기준)

> **이 문서를 쉽게 말하면** — 안드로이드 앱은 지금 알람·타이머가 "안 울립니다". 화면은 다 있는데 *울리는 엔진*이 비어 있어요. iPhone은 애플이 만든 알람 기능을 쓰는데 안드로이드엔 그게 없어서 직접 만들어야 합니다. 이 계획서는 그 엔진을 만들고, 메인 기능인 **타이머부터** 연결하는 순서를 정리한 것입니다.

---

## 0. Governing 제약 (절대 — 전체 우선)

1. **iOS 무회귀.** 공용 파일은 `Platform.OS` 분기로만 수정. iOS 경로(AlarmKit·iOS 분기·chain)는 현행값 그대로.
2. **최신 기술/코드 준수.** Android 14/15 현행 패턴만. 레거시를 신규 위에 쌓지 않는다 (CLAUDE.md #11).
3. **알람/타이머 흐름은 iOS와 동일.** 사용자가 겪는 흐름(발화 → 전체화면 → 미션/사진 → 해제)을 iOS와 같게. 단 강건성(안 꺼짐)은 iOS보다 강하게.

### Step 0 게이트 — 코딩 착수 전 필수 (통과 못 하면 Build 금지)

- [ ] 알람/타이머는 **네이티브 엔진 단일 경로**. `expo-notifications`를 발화에 쓰지 않음 명시 (iOS에서 expo-notifications 잔존으로 이중화 → 레이스 났던 실수 반복 금지).
- [ ] 모듈 Android 스텁 코드(`hello`/`setValueAsync`/`Constant("PI")`/WebView `View`) 제거.
- [ ] Android 14/15 현행 패턴 확인 — **본 계획서 §3·§5로 완료.**

---

## 1. 큰 그림 — 3단계 분류

안드로이드엔 알람·타이머를 울리는 엔진이 없다. **엔진은 한 번만 만들면 타이머·알람이 똑같이 재사용**한다. 그래서 엔진을 먼저 만들고, 메인 기능인 타이머부터 붙인다.

| 단계 | 내용 | 쉽게 말하면 |
|---|---|---|
| **Phase 1** | **공유 엔진 + 타이머 발화** | "타이머가 끝나면 알람이 울린다"까지. 엔진을 가장 단순한 케이스(한 번 발화)로 만들고 검증 |
| **Phase 2** | **타이머 보강** — 일시정지/재개 + 진행 중 카운트다운 알림 | 타이머를 멈췄다 켜기, 잠금화면에 남은 시간 표시 |
| **Phase 3** | **알람 탭 알람** — 같은 엔진 + 반복(매일/요일) | 알람 탭 기능 |

> **왜 타이머 먼저인가** — 앱 이름이 Shut**Timer**, 메인 화면도 타이머. 알람은 5개 탭 중 하나. 메인 기능 우선. 또한 타이머 발화는 "한 번만 울림"이라 엔진 검증에 가장 단순하다. 가장 어렵고 위험한 부분(앱이 꺼져 있어도 울리나, 잠금화면을 덮나, 무음모드를 뚫나)이 전부 Phase 1에 들어간다 — **거기만 통과하면 2·3은 빠르다.**

**이 계획서의 범위** — Phase 1을 상세히, Phase 2·3은 §11에 개요. 본문(§2~§10)은 Phase 1 기준.

**Phase 1 성공 기준** — 안드로이드 기기에서 ① 타이머 시작 → 종료 시각에 발화 ② 앱 종료 상태에서도 발화 ③ 잠금화면 위 전체화면 알람 ④ 미션/사진 완료로만 해제 ⑤ 무음모드에서도 울림 + 볼륨 버튼으로 음소거 안 됨.

---

## 2. 현황

- `modules/alarmkit-bridge/android/.../AlarmkitBridgeModule.kt` — Expo 모듈 템플릿 스텁. 발화 로직 0줄.
- `modules/alarmkit-bridge/android/src/main/AndroidManifest.xml` — 빈 `<manifest></manifest>`.
- 타이머 발화는 JS에서 `AlarmkitBridge.scheduleAlarm({type:'timer_main', ...})` 경로로 예약 — 호출처: `HomeScreen.tsx`(메인 타이머), `routineScheduler.ts`(루틴 타이머). 현재 Android에선 스텁 모듈이 빈 문자열만 반환 → **아무것도 안 울림.**
- iOS는 AlarmKit으로 정상 (출시 1.8.5 심사 중).

**핵심 발견 — 발화 후 화면 흐름은 이미 플랫폼 공통이다.**
발화 시 `onAlarmStateChange` 이벤트(`state:'alerting'`) → `App.tsx` 리스너 → `navigate('Alarm')` → RN `AlarmScreen`. 이 흐름은 신호 출처를 안 따진다. **안드로이드 엔진이 `onAlarmStateChange`만 같은 모양으로 emit하면 알람 화면·미션·해제 UI는 그대로 재사용된다** → 제약 ③이 거의 공짜로 달성. 새로 만드는 건 "엔진"뿐.

---

## 3. 아키텍처 (엔진 — 타이머·알람 공용)

Android엔 통합 알람 프레임워크가 없어 표준 부품을 조립한다 (Android 공식 문서 + AOSP DeskClock 패턴).

```
1. AlarmManager.setAlarmClock(info, PendingIntent)   ← PendingIntent FLAG_IMMUTABLE
        ▼
2. AlarmReceiver  (BroadcastReceiver, manifest 등록 → 앱 죽어도 OS가 깨움)
        │  onReceive() 가볍게 — 즉시 service 시작만
        ▼
3. startForegroundService(AlarmService)   ← exact-alarm 백그라운드 start 면제(Android 14 공식 허용)
        ▼
4. AlarmService  (foregroundServiceType="mediaPlayback")
        │  startForeground() + full-screen-intent 알림 + 사운드(STREAM_ALARM)·진동·볼륨 강제
        ▼
5. Full-Screen-Intent 알림 → MainActivity 전체화면 (showWhenLocked / turnScreenOn)
        ▼
6. RN 부팅 → onAlarmStateChange('alerting') emit → App.tsx → RN AlarmScreen
        해제(미션/사진) → stopAlarm → service 중단·사운드 정지
```

> **쉽게 말하면 (호텔 모닝콜 비유)** — ① 시스템(호텔 프런트)에 "이 시각에 깨워줘" 예약을 맡긴다. ② 시각이 되면 시스템이 우리 앱 조각을 깨운다 — 앱이 꺼져 있어도. ③ 그 조각이 "알람 서비스"를 켠다. ④ 서비스가 소리·진동을 내고 화면 덮는 알림을 띄운다. ⑤ 그 알림이 앱 화면을 폰 전체에 띄운다. ⑥ 앱이 켜지면 지금 쓰는 RN 알람 화면으로 이동. — iOS는 ①~⑤를 AlarmKit이 알아서 했고, 안드로이드는 우리가 조립한다.

타이머든 알람이든 엔진 입장에선 "특정 시각에 한 번 깨워라"가 전부다. 타이머 = `now + 시간`, 알람 = `특정 시각`(+반복). 그래서 엔진은 공용.

---

## 4. 핵심 설계 결정

| # | 결정 | 이유 |
|---|------|------|
| 4.1 | **기존 `alarmkit-bridge` 모듈의 Android 측을 구현** (새 모듈 안 만듦) | JS 계약이 이미 정의돼 있고 코드가 import 중. 새 모듈 = 계약 재작성 + iOS 위험. 모듈명 `AlarmkitBridge`는 유지 (이름일 뿐, Android는 내부적으로 AlarmManager 사용) |
| 4.2 | **발화 후 UI = RN `AlarmScreen` 재사용.** FSI는 `MainActivity`를 띄움 | 제약 ③ — iOS와 동일한 화면/미션/사진 흐름 |
| 4.3 | **반복은 native가 처리, iOS chain 미적용** | iOS chain(50개 미리 예약)은 AlarmKit 반복 불안정 회피용 *workaround*. Phase 1 타이머는 one-shot이라 무관. Phase 3 알람도 `AlarmReceiver`가 발화 시 다음 1개 재예약 — workaround 안 옮김(제약 #2) |
| 4.4 | **볼륨 무력화 = `STREAM_ALARM` + 강제 최대 + 재확인.** `onKeyDown` 가로채기는 후속 하드닝 | 볼륨 재확인은 `AlarmService`(모듈 코드) 안에서 끝남 → `MainActivity` 안 건드림 |
| 4.5 | **발화 정의(타이머/알람)는 native 측에도 영속 저장** (SharedPreferences) | 재부팅 시 `BootReceiver`가 JS 없이 재예약. JS 저장이 source of truth, native는 미러링 |

### 미해결 — 구현 시 확정

- **Q1.** `MainActivity`에 `showWhenLocked`/`turnScreenOn` 부여 방법 — (a) 모듈 manifest의 merge 디렉티브로 속성 주입, (b) config plugin, (c) 런타임 코드. **권장: (a) 시도 → 안 되면 (b).** manifest-merger 리포트로 확인.

---

## 5. 권한 / Manifest

전부 **모듈의 `android/src/main/AndroidManifest.xml`** 에 선언. Expo 모듈 manifest는 빌드 시 앱 manifest에 자동 병합됨 (config plugin 불필요 — Expo 공식 권장, 빌드타임 병합이라 prebuild 누락 위험 없음).

| 항목 | 값 |
|---|---|
| 권한 | `USE_EXACT_ALARM`, `USE_FULL_SCREEN_INTENT`, `POST_NOTIFICATIONS`, `RECEIVE_BOOT_COMPLETED`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MEDIA_PLAYBACK`, `WAKE_LOCK`, `VIBRATE` |
| Receiver | `AlarmReceiver`(exported=false), `BootReceiver`(exported=true, `BOOT_COMPLETED` filter) |
| Service | `AlarmService`, `foregroundServiceType="mediaPlayback"` |
| Activity | `MainActivity`에 `showWhenLocked`/`turnScreenOn` (Q1) |

- `USE_EXACT_ALARM` — 알람 앱이라 Google Play 정책상 사용 가능. 설치 시 자동 부여, 사용자가 못 끔, 런타임 프롬프트 없음.
- `USE_FULL_SCREEN_INTENT` — Android 14+ 알람 앱 자동 부여.
- `POST_NOTIFICATIONS` — **런타임 권한**(Android 13+). 거부 시 전체화면 알림 불가 → **온보딩에서 요청 필요.**

---

## 6. 신규 / 수정 파일 (Phase 1)

### 신규 — Kotlin (모듈 `android/src/main/java/expo/modules/alarmkitbridge/`)

| 파일 | 역할 |
|---|---|
| `AlarmkitBridgeModule.kt` (스텁→재작성) | Expo Module DSL — `scheduleAlarm`/`cancelAlarm`/`stopAlarm`/`listAlarms`/`isAvailable`/권한 함수. `onAlarmStateChange` emit. timer 보강용(`pauseAlarm`/`resumeAlarm`)·iOS LA용(`writeAppGroupString` 등)은 Phase 1에선 no-op 스텁 |
| `AlarmScheduler.kt` | `setAlarmClock` 예약/취소, `PendingIntent` 생성, 발화 정의 SharedPreferences 영속 |
| `AlarmReceiver.kt` | 발화 BroadcastReceiver → `startForegroundService` |
| `BootReceiver.kt` | `BOOT_COMPLETED` → 영속 저장에서 재예약 |
| `AlarmService.kt` | FGS(mediaPlayback) — FSI 알림 + 사운드(STREAM_ALARM) + 진동 + 볼륨 강제 |

### 수정

| 파일 | 변경 |
|---|---|
| `modules/alarmkit-bridge/android/src/main/AndroidManifest.xml` | §5 권한·컴포넌트 |
| `modules/alarmkit-bridge/android/build.gradle` | 의존성 확인 (대부분 표준 Android API) |
| `AlarmkitBridgeView.kt` | WebView 스텁 — 미사용 시 제거 (Step 0) |
| **JS — 타이머 발화 경로** (`HomeScreen.tsx` 등) | Android 모듈이 실체화되면 기존 `AlarmkitBridge.scheduleAlarm` 호출이 실제 동작. 게이트가 있으면 Android 허용 분기. **정확한 touch point는 Build Step 1 영향분석에서 grep 확정** |
| `App.tsx` | 콜드스타트 경로 — 앱이 죽어있다 발화로 깨어난 경우 intent extra에서 감지 → `AlarmScreen` 이동 (Android 분기) |
| `app.json` | `POST_NOTIFICATIONS` 런타임 권한 — 기존 온보딩 권한 흐름에 추가 |

> **Phase 1은 `alarmScheduler.ts`를 안 건드린다.** chain 로직은 알람 전용이라 Phase 3에서만 손댄다 → Phase 1은 iOS 알람 chain 위험 0.

---

## 7. 단계 분해 (Phase 1 = 구현 체크리스트)

> 한 번에 하나. 네이티브 변경이라 단계마다 dev 빌드 재빌드. 단계마다 [파급 보고 → 승인 → 코드].

- [ ] **Step 0 — 게이트** (§0). expo-notifications 배제 확인, 스텁 제거.
- [ ] **Step 1 — 모듈 기반.** 스텁 Kotlin/View 제거. 모듈 manifest §5 선언. → *verify:* prebuild + 빌드 성공, manifest-merger 리포트에 병합 확인.
- [ ] **Step 2 — 엔진 코어.** `AlarmScheduler.kt` + `AlarmkitBridgeModule.kt`의 `scheduleAlarm`/`cancelAlarm`/`listAlarms`/`isAvailable`/권한 함수. `setAlarmClock` + `AlarmReceiver`(빈 골격). → *verify:* JS `scheduleAlarm` 호출 → `adb shell dumpsys alarm`에 등록 확인.
- [ ] **Step 3 — 발화 체인.** `AlarmReceiver` → `AlarmService`. FGS·FSI 알림·사운드(STREAM_ALARM)·진동·볼륨 강제. → *verify:* 발화 시 소리남, 무음모드에서도 울림.
- [ ] **Step 4 — 전체화면 + RN 연결.** FSI → `MainActivity`(showWhenLocked/turnScreenOn). `onAlarmStateChange('alerting')` emit. 콜드스타트 intent extra. → *verify:* 잠금화면 발화 → 전체화면 → RN `AlarmScreen`.
- [ ] **Step 5 — 타이머 연결.** 메인 타이머(`HomeScreen.tsx`)가 Android에서 실제 엔진 호출. → *verify:* 타이머 시작 → 종료 시각에 발화.
- [ ] **Step 6 — 재부팅 복원.** `BootReceiver`. (타이머는 짧아 재부팅 영향 적지만 엔진 차원에서 구축 — Phase 3 알람이 주 수혜.) → *verify:* 예약 → 재부팅 → 유지.
- [ ] **Step 7 — 해제/정리.** `AlarmScreen` 해제 → `stopAlarm` → service 중단, 사운드/진동 정지, 볼륨 원복. → *verify:* 미션/사진 완료 → 완전 정지.
- [ ] **Step 8 — 전체 검증** (§8).

---

## 8. 검증 방법 (Phase 1)

실기기 + 에뮬레이터.

1. 타이머 시작 → 종료 시각 발화 (앱 포그라운드)
2. 앱 백그라운드 → 발화
3. **앱 강제 종료 상태 → 발화** (manifest receiver 검증)
4. **잠금화면 → 전체화면 알람 표시**
5. **무음/진동 모드 → 울림**
6. **볼륨 다운 버튼 → 음소거 안 됨**
7. 미션/사진 완료 → 완전 정지 (사운드 잔존 없음)
8. **iOS 회귀 확인** — iOS에서 타이머·알람 정상 (제약 #1)

---

## 9. 파급 보고

**수정 레이어** — ② 네이티브(모듈 Kotlin), ④ 인프라(manifest·권한), ① 일부 JS(타이머 발화 경로·`App.tsx` 분기).

| 영향 영역 | 내용 | 위험 |
|---|---|---|
| `alarmkit-bridge` Android 측 | 전면 신규 구현. iOS Swift 안 건드림 | 낮음 — 분리됨 |
| JS 타이머 발화 경로 (`HomeScreen.tsx` 등) | Android에서 실제 동작하도록 분기/연결 | **중** — 정확한 touch point는 Build Step 1에서 grep 확정. iOS 경로 불변 |
| `App.tsx` (공용) | 콜드스타트 Android 분기 | 낮음 — 분기 격리 |
| `alarmScheduler.ts` | **Phase 1은 안 건드림** (Phase 3 영역) | 없음 |
| 앱 manifest | 권한 8개 병합 | 낮음. `USE_EXACT_ALARM`/`USE_FULL_SCREEN_INTENT`는 Play 심사 시 알람 앱 자격 확인 — 충족 |
| `MainActivity` | 잠금화면 속성 (Q1) | 낮음~중 — 방법 확정 필요 |
| 빌드 | prebuild + Android dev 재빌드 필수 | — |
| iOS | **영향 0** — 전부 Android 스코프. 공용 JS는 분기 후 iOS 검증 |
| 신규 UX | `POST_NOTIFICATIONS` 런타임 권한이 온보딩에 추가 | 낮음 — 기존 권한 흐름 활용 |

---

## 10. 리스크 / 미검증 (구현 중 재확인)

| # | 항목 | 대응 |
|---|------|------|
| 1 | `POST_NOTIFICATIONS` 거부 → 전체화면 알림 불가 | 온보딩 요청 + 거부 안내. 거부돼도 소리·진동은 FGS로 울림 |
| 2 | OEM 배터리 킬러(샤오미·삼성 등) | `setAlarmClock`+FGS가 최선. 실 OEM 기기 QA + 설정 deep-link 안내 |
| 3 | 방해금지(DnD) "알람 차단" 설정 사용자 | 일반 앱 override 불가 — 불가피한 한계, 안내만 |
| 4 | Android 15 FGS 세부 변경 | `mediaPlayback`-알람 유효. 구현 전 재확인 |
| 5 | Android 17(프리뷰) 백그라운드 오디오 강화 | `USE_EXACT_ALARM` 보유 시 면제 — 권한 유지로 충족 |
| 6 | 수용된 한계 — 전원 끄기 / 설정 강제 종료 | 막지 않음. OS 사용자 권한, 모든 앱 동일 |

---

## 11. Phase 2 / Phase 3 개요

### Phase 2 — 타이머 보강
- **일시정지/재개** — `pauseAlarm`/`resumeAlarm` Kotlin 구현. 일시정지 = 예약된 발화 취소 + 남은 시간 저장. 재개 = 새 종료 시각으로 재예약.
- **진행 중 카운트다운 알림** — 타이머가 도는 동안 잠금화면·알림창에 남은 시간 표시 (ongoing notification + chronometer). iOS Live Activity의 안드로이드 대응물.

### Phase 3 — 알람 탭 알람
- `alarmScheduler.ts` Android 분기 — `isAlarmKitAvailableSync()` Android 허용, `scheduleAlarmMain()`은 Android에서 chain 루프 없이 단발 예약 (iOS chain 불변 — `Platform.OS` 분기).
- **반복(daily/weekly)** — `AlarmReceiver`가 발화 시 다음 occurrence 1개 재예약.
- Alarm 탭 UI 연결.
- 재부팅 복원이 알람에선 핵심 (알람은 내일 아침용 등 장기 예약).

---

## 부록 — 모듈 manifest 초안

```xml
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <uses-permission android:name="android.permission.USE_EXACT_ALARM"/>
    <uses-permission android:name="android.permission.USE_FULL_SCREEN_INTENT"/>
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS"/>
    <uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED"/>
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE"/>
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK"/>
    <uses-permission android:name="android.permission.WAKE_LOCK"/>
    <uses-permission android:name="android.permission.VIBRATE"/>
    <application>
        <receiver android:name=".AlarmReceiver" android:exported="false"/>
        <receiver android:name=".BootReceiver" android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.BOOT_COMPLETED"/>
            </intent-filter>
        </receiver>
        <service android:name=".AlarmService"
                 android:foregroundServiceType="mediaPlayback"
                 android:exported="false"/>
    </application>
</manifest>
```
