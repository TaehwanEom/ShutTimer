# 2026-05-28 디버그 빌드 핸드오프 (= 최종)

> 본 문서: 본일 4중 안전망 fix 측 빌드 + TestFlight 배포 + D+1 검증 절차.
> 직전 빌드 통과 = ed4b998 시점. 본 빌드 = +4건 추가 fix 측 = 새 binary 필요.

---

## 1. 한 줄 요약

본일 추가 fix 4건 (= 3aa0529 + 7842d30 + b809f2c + d61236b) 측 = **새 디버그 빌드 + TestFlight 업로드 + 24h~3일 검증** 필요.

---

## 2. 빌드 전 체크

```bash
cd "/Volumes/SeagateBac/moda/Timer"
git status   # = clean 확인 (= uncommitted X)
git log --oneline -15   # = 14건 commit 측 정합 확인
npx tsc --noEmit   # = 0 error 확인
```

= 모두 정상 → 빌드 진행.

---

## 3. 빌드 명령

### Option A — Expo Prebuild + Xcode (= 일반)
```bash
cd "/Volumes/SeagateBac/moda/Timer"
npx expo prebuild --platform ios   # = ios/ 폴더 생성
cd ios
pod install
open ShutTimer.xcworkspace   # = Xcode 진입
```

Xcode 측:
1. Scheme = ShutTimer (= Debug)
2. Destination = "Any iOS Device (arm64)"
3. Product → Archive
4. Organizer 측 = "Distribute App" → "App Store Connect"
5. TestFlight 측 = 자동 분배

### Option B — EAS Build (= 권장)
```bash
cd "/Volumes/SeagateBac/moda/Timer"
eas build --platform ios --profile preview   # = TestFlight 빌드
```

= 클라우드 빌드 + TestFlight 자동 업로드.

---

## 4. TestFlight 배포

### 빌드 완료 후
1. App Store Connect → TestFlight → 본 빌드 확인 (= "처리 중" → "테스트 준비됨")
2. **내부 테스트 그룹 측 = 본인 + 테스터 측 자동 분배**
3. iPhone 측 = TestFlight 앱 → ShutTimer 업데이트

### 디버그 심사 (= 필요 시)
- 본 빌드 = 직전 통과 빌드 측 정합 = **빠른 통과 예상** (= 1~2일)
- 단 = 신규 fix 측 측 = 측 재심사 시간 측 변동 가능

---

## 5. D+1 검증 시나리오

### 🔴 시나리오 1: 즉시 검증 (= 2분, 코드 동작 확인)
**목표**: L1+L3 fix 정상 동작 = 로그로 확인.

**단계**:
1. TestFlight 빌드 설치 + 실행
2. daily 알람 등록:
   - 시각 = 현재 + 2분
   - 반복 = 매일
3. 2분 기다림 → 알람 울림
4. **dismiss 누름** (= 미션 풀고)
5. 설정 → "로그 공유" 열기
6. 다음 메시지 검색:
   ```
   cancelSafetyChain-DBG done ... chain0Preserved=true
   ```

**판정**:
- ✅ 메시지 있음 = **L1+L3 PASS** (= 본 fix 정상 적용)
- ❌ 메시지 없음 = 빌드 측 fix 미반영 (= 재빌드 확인)

---

### 🟡 시나리오 2: 익일 검증 (= 24h, 실 발화)
**목표**: 다음날 OS 자동 발화 확인 = 한계 5 해결 측 50% 보증.

**단계**:
1. 시나리오 1 후 = 폰 그대로 두기 (= 앱 X)
2. 다음날 같은 시각에 알람 자동 발화 확인
3. 발화 OK = L1+L2 측 .relative(daily) 측 정상 보존 확인

**판정**:
- ✅ 다음날 발화 = **한계 5 50% PASS**
- ❌ 발화 안 함 = iOS framework 측 이슈 (= 별도 조사 필요)

---

### 🟢 시나리오 3: 사용자 보고 케이스 재현 (= 3일, 완전 보증)
**목표**: 사용자 보고 측 정확한 시나리오 재현 = 100% 보증.

**단계**:
1. daily 알람 등록 + Day 0 fire + dismiss
2. **Day 1, 2, 3 측 = 앱 절대 안 켬** (= 폰만 사용, ShutTimer 미실행)
3. Day 1, 2, 3 측 = 매일 같은 시각 알람 자동 발화 확인

**판정**:
- ✅ 3일 매일 발화 = **한계 5 100% 차단 확인** = 출시 가능
- ❌ 일부 day 미발화 = 추가 조사 (= 정말 드문 케이스)

---

## 6. 검증 통과 후

### 정식 출시 측 권장
1. 본 fix 측 = 안정성 확인 완료
2. App Store Connect → 정식 버전 측 새 빌드 제출
3. App Review 측 = 일반 1~2일

### 워치 앱 Phase 1 시작
- D+1 검증 PASS 시 = 워치 앱 측 별도 사이클 시작
- 본 plan 정합: [docs/plan-2026-05-28-watch-app.md](docs/plan-2026-05-28-watch-app.md)

---

## 7. 롤백 (= 만약 회귀 시)

### 부분 롤백
- L4만 (= d61236b) = `git revert d61236b`
- L3+L4 (= b809f2c + d61236b) = `git revert b809f2c d61236b`
- 전체 본일 fix 측 = `git revert d61236b b809f2c 7842d30 3aa0529`

### 빌드 측
- 직전 통과 빌드 (= ed4b998 시점) 측 = `git checkout ed4b998` → 재빌드

---

## 8. 잔여 사항

- [ ] TestFlight 빌드 + 업로드
- [ ] 시나리오 1 (= 즉시) 측 = 본인 확인
- [ ] 시나리오 2 (= D+1) 측 = 24h 후 확인
- [ ] 시나리오 3 (= D+3) 측 = 3일 후 확인
- [ ] 정상 시 = 정식 출시 측 진행
- [ ] 또는 = 워치 앱 Phase 1 시작

---

## 9. 본일 fix 적용 영역 (= 사용자 시나리오별)

| 사용자 시나리오 | 본일 fix 측 영향 |
|----------------|----------------|
| **iOS daily 알람 dismiss 후 며칠 미실행** | 🎯 **완전 차단** (= 4중 안전망) |
| iOS once 알람 dismiss | 무관 (= 기존 동작 보존) |
| iOS routine 측 dismiss | L1+L3 적용 (= chain[0] 보존) |
| iOS routine + 마지막 step 완료 | L1 적용 (= Advance lastStep 측 보존) |
| Android (모든 시나리오) | 회귀 0 (= Platform 가드) + L4 안전망 강화 |
| 무음 모드 + alerting | AlarmKit 측 강제 (= 영향 무관) |

---

## 10. 본 빌드 측 핵심 변경

```diff
+ src/utils/alarmScheduler.ts
  + cancelSafetyChainPreservingDaily 신규 함수
  + rebalanceAllChains preserve 가드
  + syncAllAlarms 분기 B-skip deleted filter
+ src/state/SessionController.ts
  + CancelSafetyChainOnly effect 신규
  + Dismiss / Advance lastStep 측 = 신규 effect dispatch
+ src/state/effectRunner.ts
  + CancelSafetyChainOnly 분기 신규
~ src/screens/AlarmScreen.tsx
  ~ stopAudioAndVibration 측 = cancelAlarmsForEntity → cancelSafetyChainPreservingDaily 교체
```

= **4파일, ~150 line 변경**.

---

## 결론

본 빌드 = **iOS daily dismiss 측 한계 5 완전 차단 측 첫 빌드**. TestFlight 업로드 + 3단계 검증 (= 즉시/24h/3일) 측 = 사용자 보고 root cause 측 완전 확인.
