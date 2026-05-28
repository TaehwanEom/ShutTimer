# 안드로이드 알람시스템 심층검증 후속 수정 계획 (2026-05-28)

> 본 문서: 계획만. 코드 수정 X. 별도 승인 후 실행.
> 전 단계 문서: `plan-2026-05-28-precision-fix.md` (= iOS chain ghost fire fix 완료)
> 검증 기반: 본일 안드로이드 6회차 심층검증 결과 (= 5건 잠재 한계 발견)

---

## 1. 한 줄 요약

안드로이드 측 5건 잠재 한계 중 **3건 코드 수정 가능** (Direct Boot / SharedPreferences race / 동시 발화 누수). 2건은 변경 불가 (Force-stop = OS 동작, dismiss 후 다음날 누락 = 양 플랫폼 공통 설계).

= **쉽게 말하면**: 안드로이드만의 문제 3개 고치는 작업. iOS는 안 건드림.

---

## 2. 발견된 한계 (= 6회차 검증 결과 재정리)

| # | 한계 | iOS 영향 | 우선순위 | 수정 가능 |
|---|------|---------|---------|----------|
| 1 | Direct Boot 미지원 (= 재부팅 후 잠금 해제 전 알람 누락) | ✅ 무관 | 🔴 높음 | ✓ |
| 2 | SharedPreferences 동시쓰기 race | ✅ 무관 | 🟡 중간 | ✓ |
| 3 | 동시 발화 시 MediaPlayer 누수 + NOTIF_ID 충돌 | ✅ 무관 | 🟡 중간 | ✓ |
| 4 | Force-stop = PendingIntent 전부 cancel | ✅ 무관 | 🟢 변경 불가 | ✗ |
| 5 | 일일 알람 dismiss 후 다음날 누락 (= 사용자 앱 미실행 시) | ⚠️ 공통 | 🟢 별도 plan | ✗ |

---

## 3. 수정 대상 (= 본 plan 측 범위)

### 3-1. 한계 1 — Direct Boot 미지원 🔴

#### 현 상태
- 파일: `modules/alarmkit-bridge/android/src/main/AndroidManifest.xml`
- 미지원: `android:directBootAware="true"` + `LOCKED_BOOT_COMPLETED` action filter
- 영향: 새벽 재부팅 → 잠금 해제 전까지 BootReceiver 미실행 → 그 사이 fireAt 도래 알람 영구 누락

#### 수정안
1. `BootReceiver` 측 `android:directBootAware="true"` 추가
2. `intent-filter` 측 `android.intent.action.LOCKED_BOOT_COMPLETED` action 추가
3. `BootReceiver.kt` 측 = 두 action 모두 처리 (= BOOT_COMPLETED + LOCKED_BOOT_COMPLETED)
4. `AlarmScheduler` 측 = Direct Boot 모드에서도 동작하도록 Device Encrypted (DE) storage 측 알람 record 미러 (= `Context.createDeviceProtectedStorageContext()` 사용)
5. 미러 시점: `schedule()` / `cancel()` 호출 시 = CE (Credential Encrypted) + DE 양쪽 동시 쓰기

#### 영향 범위
- 신규 파일: 0
- 수정 파일: `BootReceiver.kt`, `AlarmScheduler.kt`, `AndroidManifest.xml`
- 신규 의존성: 0
- 회귀 위험: 낮음 (= 기존 BOOT_COMPLETED 경로 보존, LOCKED_BOOT_COMPLETED 측만 추가)

#### iOS↔Android 충돌 위험
- ✅ **iOS 무관**. AlarmKit framework 측 OS-level persistence 측 자동 복원.
- Android 측 단일 작업.

#### 작업량
중 (~4~6시간) — DE storage 측 SharedPreferences API 측 신규 핸들링 + 마이그레이션 (= 기존 CE 측 record 측 DE 미러 1회성)

---

### 3-2. 한계 2 — SharedPreferences 동시쓰기 race 🟡

#### 현 상태
- 파일: `modules/alarmkit-bridge/android/src/main/java/expo/modules/alarmkitbridge/AlarmScheduler.kt`
- 미지원: `synchronized` / `Mutex` / `ReentrantLock` 등 동기화 primitive 0건
- 영향: read-modify-write 측 lost-update → SharedPreferences 측 알람 record 누락 → BootReceiver 측 복원 누락
- iOS 비교: iOS 측 `runMappingExclusive` mutex 보유. Android만 미보호

#### 수정안
1. `AlarmScheduler` object 측 module-level lock 신규: `private val lock = Any()`
2. `persistUpsert` / `persistRemove` / `writeAll` / `readAll` / `pausedUpsert` / `pausedRemove` / `writeAllPaused` / `readAllPaused` 측 `synchronized(lock) { ... }` 블록 감쌈
3. `schedule()` / `cancel()` / `pauseAlarm()` / `resumeAlarm()` / `rescheduleAllFromBoot()` 측 read-modify-write path 측 = 본 함수 호출만으로 atomic 보장

#### 영향 범위
- 수정 파일: `AlarmScheduler.kt` 단일
- 회귀 위험: 0 (= 단순 mutex 추가, 동작 변경 X)
- 성능 영향: 무시 가능 (= SharedPreferences 측 자체 측 < 5ms 작업)

#### iOS↔Android 충돌 위험
- ✅ **iOS 무관**. iOS 측 = 이미 mutex 보유. Android 측만 동일 패턴 적용.

#### 작업량
소 (~1~2시간)

---

### 3-3. 한계 3 — 동시 발화 시 MediaPlayer 누수 + NOTIF_ID 충돌 🟡

#### 현 상태
- 파일: `modules/alarmkit-bridge/android/src/main/java/expo/modules/alarmkitbridge/AlarmService.kt`
- 문제 1: `NOTIF_ID = 0xA1A2` 하드코딩 (line 37). 두 알람 동시 발화 = 같은 ID → 두 번째 알림 측 첫 번째 덮어쓰기
- 문제 2: `mediaPlayer` 인스턴스 변수 (line 29). `startSound()` 측 = 기존 인스턴스 release 없이 새 할당 → 메모리 누수 + 사운드 중복 재생
- 문제 3: `volumeObserver` 중복 등록 가능 (= 옛 옵저버 unregister 없이 새 등록)
- 보호: `SessionController.ts` line 256-268 측 STEP_ALERTING + simple_alarm 동시 발화 reject 가드. 단 JS 측만 차단, native 측 이미 실행됨

#### 수정안
1. `NOTIF_ID` 측 = 동적 산출 변경: `private fun notifIdFor(alarmId: String): Int` (= alarmId.hashCode() 측 짝수화, 충돌 회피)
2. `onStartCommand` 측 = 새 알람 시작 전 = `stopSound()` + `stopVibration()` + `unregisterVolumeObserver()` 호출 (= 기존 자원 정리)
3. `currentAlarmId` 변경 시점 측 = 이전 alarmId 측 알림 측 `nm.cancel(notifIdFor(prevId))` 호출

#### 영향 범위
- 수정 파일: `AlarmService.kt` 단일
- 회귀 위험: 낮음 (= 단일 알람 발화 측 = 기존 동작 동일)
- 성능 영향: 무시 가능

#### iOS↔Android 충돌 위험
- ✅ **iOS 무관**. iOS 측 = AlarmKit framework 측 자동 처리.

#### 작업량
소 (~2~3시간)

---

## 4. 수정 제외 항목 (= 본 plan 측 범위 X)

### 4-1. 한계 4 — Force-stop
- **사유**: Android OS 동작 (= 사용자가 설정 > 앱 > 강제종료 누르면 PendingIntent 전부 cancel). 앱 측 코드 측 우회 불가.
- **대응**: 사용자 교육 (= help 문서 측 안내). 본 plan 측 작업 X.

### 4-2. 한계 5 — 일일 알람 dismiss 후 다음날 누락
- **사유**: 양 플랫폼 공통 설계 선택. iOS 측 `.relative(daily)` cancel 시 daily 사라짐. Android 측 daily PendingIntent cancel 시 사라짐.
- **대응**: 변경 시 별도 plan 필요 (= 양 플랫폼 일관성 검토 + dismiss 의미 재정의). 본 plan 측 작업 X.

---

## 5. 단계별 실행 순서 (= 권장)

### Step A (= 우선순위 🔴) — 한계 1: Direct Boot
- 단독 작업. 본 fix 측 = 사용자 영향 가장 큼 (= 새벽 재부팅 시 알람 손실 차단)
- 검증: 에뮬레이터 측 = 재부팅 + 잠금 해제 X 상태 측 알람 fire 도래 → AlarmReceiver 측 fire 확인

### Step B (= 우선순위 🟡) — 한계 2: SharedPreferences race
- 단독 작업. 작업량 가장 작음
- 검증: 코드 review만 (= race window 매우 짧아 재현 어려움)

### Step C (= 우선순위 🟡) — 한계 3: 동시 발화 누수
- 단독 작업
- 검증: 에뮬레이터 측 = 알람 2개 같은 시각 설정 → 발화 → 알림 2개 표시 확인 + mediaPlayer 측 single 인스턴스 확인

### 통합 빌드 + 디버그 심사 제출
- A/B/C 측 = 각 단독 commit + 검증 → 통합 빌드 → TestFlight + Internal Testing 배포

---

## 6. 안 건드릴 파일 (= 명시 선언)

- ❌ `App.tsx` (= 본일 직전 fix 측 = 검증 완료)
- ❌ `src/utils/alarmScheduler.ts` (= 본일 직전 fix 측 = 검증 완료, JS 측 변경 X)
- ❌ `src/state/effectRunner.ts` (= 본일 직전 fix 측 = 검증 완료)
- ❌ `src/state/SessionController.ts` (= 한계 5 측 = 별도 plan)
- ❌ iOS 측 모든 파일 (= modules/alarmkit-bridge/ios/ 측 = 무관)

---

## 7. 위험 평가

| 항목 | 위험도 | 비고 |
|------|--------|------|
| Step A — Direct Boot DE storage 마이그레이션 | 낮음 | 기존 CE storage 측 record 유지 + DE 측 미러만 추가 |
| Step B — SharedPreferences synchronized 추가 | 0 | 단순 mutex 추가 |
| Step C — NOTIF_ID 동적 산출 | 낮음 | 기존 단일 알람 측 = hashCode 결과 측 안정적 |
| iOS 회귀 | 0 | 본 plan 측 = 안드로이드 측 단일 작업 |
| 디버그 심사 영향 | 0 | 본 fix 측 = 안드로이드 측 별도 작업 → iOS 디버그 심사 측 무관 |

---

## 8. 실행 결정 대기 항목

- [ ] Step A 진행 여부 (= 작업량 중. 가장 영향 큼)
- [ ] Step B 진행 여부 (= 작업량 소. 발생률 매우 낮음)
- [ ] Step C 진행 여부 (= 작업량 소. 일반 사용자 회피 가능)
- [ ] 통합 빌드 시점 (= 3건 모두 완료 후 vs 단계별)

---

## 9. 본 plan 측 범위 명시

- ✓ 본 plan = 한계 1/2/3 측 수정 계획만 작성
- ✗ 본 plan = 한계 4/5 측 수정 계획 X
- ✗ 본 plan = 코드 수정 X (= 별도 승인 후 실행)
- ✗ 본 plan = iOS 측 수정 X
- ✗ 본 plan = 기존 fix 측 (= App.tsx / alarmScheduler.ts / effectRunner.ts) 추가 변경 X
