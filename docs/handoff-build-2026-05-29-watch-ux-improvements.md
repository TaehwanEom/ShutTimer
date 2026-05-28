# Build 창 인계 — 2026-05-29 Watch UX 개선 4건

> 출처: Deploy 창
> 브랜치: `feature/android-support`
> HEAD: `d82dbf5` (watch bundle ID = `com.shuttimer.app.watchkitapp`)
> 대상: `targets/watch/{dial.swift, content.swift, Info.plist}` 3-파일 수정

---

## 1. 한 줄 요약

워치 v1.8.7 디버그 빌드 실기기 설치 + 시뮬레이션 검증 결과 **사용자 피드백 4건** 도출:
1. 다이얼이 작은 워치(SE 40/44mm) 화면을 넘어 잘림 → **반응형 사이즈**
2. 워치 홈에 "watch" 표시 → **"ShutTimer" displayName**
3. 터치 드래그 시 햅틱 없음 (Crown은 자동) → **iOS TimerDial 정합 햅틱**
4. idle 상태에서 설정 시간이 안 보여 몇 분 맞추는지 모름 → **idle 시간 텍스트 상시 표시**

---

## 2. 배경 (= 사용자 피드백 원본)

| 피드백 | 사용자 발언 | 근거 |
|---|---|---|
| 잘림 | "반응형 추가해야 될거 같은데" | Apple Watch SE 40mm = 162x197pt. DIAL_SIZE=195 하드코딩 → 우측 라벨/좌측 시간 텍스트 잘림 |
| displayName | "왜 영어로 샷타이머가 아니고 워치야?" | Info.plist에 CFBundleDisplayName 미명시 → @bacons/apple-targets가 디렉토리명 `watch` 그대로 사용 |
| 햅틱 | "워치 다이얼 돌릴때 진동 넣을 수 있나? 앱 타이머와 동일하게" | iOS `Haptics.selectionAsync()` (TimerDial.tsx:211, 224) ↔ 워치 터치 햅틱 없음 |
| idle 시간 | "타이머 실행하지 않아도 나오게 하자, 몇분 타이머 맞추는지 잘 안보인다" | content.swift 조건 `store.state == .running \|\| .paused` → idle 시 미표시 |

---

## 3. 권장 수정 (= 4건 통합)

### 3.1 반응형 다이얼 사이즈

**파일**: `targets/watch/dial.swift`

```swift
import SwiftUI
import WatchKit  // ← 추가

// 2026-05-29 — 반응형 (= Apple Watch SE 40/44mm + Series 46mm + Ultra 49mm 정합).
//   기준 = 화면 가로 폭 * 0.95 (= 라벨 여백 확보). 모든 사이즈 = 195 기준 비율 동적 계산.
private let DIAL_SIZE: CGFloat = WKInterfaceDevice.current().screenBounds.width * 0.95
private let CENTER: CGFloat = DIAL_SIZE / 2
private let SECTOR_RADIUS: CGFloat = DIAL_SIZE * (85.0 / 195.0)
private let LABEL_RADIUS: CGFloat = DIAL_SIZE * (95.0 / 195.0)
private let TICK_OUTER: CGFloat = DIAL_SIZE * (85.0 / 195.0)
private let TICK_INNER_MAJOR: CGFloat = DIAL_SIZE * (71.0 / 195.0)
private let TICK_INNER_MINOR: CGFloat = DIAL_SIZE * (77.0 / 195.0)
private let CENTER_DOT_RADIUS: CGFloat = DIAL_SIZE * (6.0 / 195.0)
```

**파일**: `targets/watch/content.swift`

```swift
import SwiftUI
import WatchKit
import UserNotifications

// 2026-05-29 — 반응형 다이얼 사이즈 (= dial.swift 정합 = 화면 가로 폭 * 0.95).
private let WATCH_DIAL_SIZE: CGFloat = WKInterfaceDevice.current().screenBounds.width * 0.95
```

DialWithButtonView 측 외곽 frame + 시간 capsule position 변경:
- `.frame(width: 195, height: 195)` → `.frame(width: WATCH_DIAL_SIZE, height: WATCH_DIAL_SIZE)`
- `.position(x: 195 / 2, y: 195 / 2 + 32)` → `.position(x: WATCH_DIAL_SIZE / 2, y: WATCH_DIAL_SIZE / 2 + WATCH_DIAL_SIZE * (32.0 / 195.0))`

### 3.2 displayName "ShutTimer"

**파일**: `targets/watch/Info.plist`

```xml
<dict>
	<key>CFBundleDisplayName</key>     <!-- ← 추가 -->
	<string>ShutTimer</string>          <!-- ← 추가 -->
	<key>WKApplication</key>
	<true/>
	<key>WKWatchOnly</key>
	<false/>
</dict>
```

`expo-target.config.js`의 `name` 옵션 호환 불확실 → Info.plist 직접 추가가 안전.

### 3.3 터치 드래그 햅틱 (iOS TimerDial 정합)

**파일**: `targets/watch/dial.swift`

**3.3.1 State 추가**:
```swift
struct DialView: View {
    @ObservedObject var store: TimerStore

    // 2026-05-29 — iOS TimerDial 햅틱 정합 (= 첫 터치 1회 + 분 변경 시마다).
    @State private var dragStarted: Bool = false

    private var progress: Double {
```

**3.3.2 DragGesture onEnded 추가**:
```swift
DragGesture(minimumDistance: 0)
    .onChanged { value in handleDrag(at: value.location) }
    .onEnded { _ in dragStarted = false }
```

**3.3.3 handleDrag 안 햅틱 2회 추가**:
```swift
private func handleDrag(at point: CGPoint) {
    guard store.state == .idle || store.state == .paused else { return }
    let dx = point.x - CENTER
    let dy = point.y - CENTER
    let dist = sqrt(dx * dx + dy * dy)
    guard dist > CENTER_DOT_RADIUS, dist <= SECTOR_RADIUS + 10 else { return }

    // 2026-05-29 — iOS TimerDial 정합 = 첫 터치 시점 햅틱 (= tap 자체 피드백).
    if !dragStarted {
        dragStarted = true
        WKInterfaceDevice.current().play(.click)
    }

    var angle = atan2(dy, dx) * 180 / .pi + 90
    if angle < 0 { angle += 360 }
    // ... (기존 newMinutes 계산)

    if newMinutes != store.minutes {
        // 2026-05-29 — iOS TimerDial 정합 = 분 변경 시점마다 .click 햅틱.
        WKInterfaceDevice.current().play(.click)
        store.minutes = newMinutes
    }
}
```

**정합 검증**:
| 시점 | iOS (`TimerDial.tsx:211, 224`) | 워치 (`dial.swift`) |
|---|---|---|
| 첫 터치 | `Haptics.selectionAsync()` (panResponderGrant) | `WKInterfaceDevice.current().play(.click)` (`!dragStarted` 분기) |
| 분 변경 | `if prevMinutesRef.current !== minutes` → 호출 | `if newMinutes != store.minutes` → 호출 |
| 드래그 종료 | `prevMinutesRef.current = null` | `dragStarted = false` (.onEnded) |

`Haptics.selectionAsync()` (iOS UISelectionFeedbackGenerator) ≈ `WKHapticType.click` (watchOS 가벼운 딸깍).

### 3.4 idle 시간 텍스트 상시 표시 (= iOS HomeScreen 정합)

**파일**: `targets/watch/content.swift`

**3.4.1 TimerStore.displayText 수정**:
```swift
var displayText: String {
    // 2026-05-29 — iOS HomeScreen 정합 (HomeScreen.tsx:1118-1119).
    //   idle = 설정값 (= selectedMinutes * 60 + selectedSeconds)
    //   running/paused/finished = 남은 시간 (= remainingMs / 1000)
    let totalSec: Int
    switch state {
    case .idle:
        totalSec = minutes * 60 + seconds
    case .running, .paused, .finished:
        totalSec = max(0, remainingMs / 1000)
    }
    let m = totalSec / 60
    let s = totalSec % 60
    return String(format: "%02d:%02d", m, s)
}
```

**3.4.2 DialWithButtonView 조건 제거**:
```swift
// 기존
if store.state == .running || store.state == .paused {
    Text(store.displayText)
        ...
}

// 변경 (= 모든 state 표시)
Text(store.displayText)
    .font(.system(size: 16, weight: .bold, design: .rounded))
    .monospacedDigit()
    .foregroundColor(.white)
    .padding(.horizontal, 8)
    .padding(.vertical, 3)
    .background(Capsule().fill(Color.black.opacity(0.75)))
    .position(x: WATCH_DIAL_SIZE / 2, y: WATCH_DIAL_SIZE / 2 + WATCH_DIAL_SIZE * (32.0 / 195.0))
```

---

## 4. 영향 범위

| 영역 | 영향 |
|---|---|
| 메인 앱 (`com.shuttimer.app`) | 영향 0 |
| Widget (`com.shuttimer.app.widget`) | 영향 0 |
| Watch UI 다이얼 사이즈 | 195pt 고정 → 화면 폭 95% 동적 (= 모든 Apple Watch 모델 정합) |
| Watch 홈 표시명 | "watch" → "ShutTimer" |
| Watch 터치 드래그 햅틱 | 없음 → iOS TimerDial 1:1 정합 |
| Watch idle 시간 표시 | running/paused만 → 모든 state |
| Watch state machine 로직 | 영향 0 (= displayText 함수만 변경, start/pause/resume/cancel/finish 무관) |

---

## 5. Deploy 창 사전 작업 (= ⚠️ 워크플로우 위반 사후 보고)

**위반 사항**: Deploy 창에서 §3.1, §3.2, §3.3 코드를 **사용자 "구현해" 명령에 따라 직접 수정함**. 정상 워크플로우 = 인계 문서 → Build 창 수정. 사후 보고합니다.

**현재 작업트리 상태** (= `git status`):
```
 M targets/watch/Info.plist        (§3.2 적용됨)
 M targets/watch/content.swift     (§3.1 적용됨, §3.4 미적용)
 M targets/watch/dial.swift        (§3.1 + §3.3 적용됨)
 M targets/watch/index.swift       (이전 세션 변경분, 미커밋)
 D ios/ShutTimer/AppDelegate.swift (별도 이슈 — 아래 §7)
```

**Build 창 결정 요청**:
- **옵션 A**: 변경분 그대로 검토 후 §3.4만 추가 적용 → commit/push
- **옵션 B**: 변경분 `git restore`로 되돌리고 §3.1~§3.4 전체 처음부터 적용

옵션 A가 시간 효율적이고 코드 차이 없음. 옵션 B가 워크플로우 엄격 준수.

---

## 6. 후속 절차

```bash
# (옵션 A 가정)
cd /Volumes/SeagateBac/moda/Timer

# 1. §3.4 추가 적용 (content.swift displayText + 조건 제거 = 2-spot 수정)

# 2. commit + push
git add targets/watch/Info.plist targets/watch/content.swift targets/watch/dial.swift targets/watch/index.swift
git commit -m "feat(watch): UX 개선 4건 (반응형 다이얼 + displayName + 햅틱 + idle 시간 표시)"
git push origin feature/android-support

# 3. Deploy 창 회신 → 빌드 명령 재실행
```

---

## 7. 별도 이슈 (= Build 창 판단 요청)

### 7.1 `ios/ShutTimer/AppDelegate.swift` 삭제 상태

`git status`에 ` D ios/ShutTimer/AppDelegate.swift` 표시. 이전 prebuild (`rm -rf ios`) 결과로 보이며, `.gitignore` 측 `ios/` 누락 또는 트래킹 정책 점검 필요.

**Build 창 결정 요청**: 
- 무시 (= 다음 prebuild 시 재생성됨)
- 별도 commit으로 정리 (= `.gitignore`에 `ios/` 추가)

### 7.2 `targets/watch/index.swift` 미커밋

내용 변경 = 이전 세션 작업분 (다이얼 양방향 회전 등). 본 인계와 별개 변경분. 함께 commit할지 별도 commit할지 판단 요청.

---

## 8. 검증 (= 7.1 즉시 + 7.2 빌드)

### 8.1 즉시 검증 (= Build 창 수정 후)
- `cat targets/watch/dial.swift | grep "WKInterfaceDevice\|dragStarted\|play(.click)"` → 5건 이상 출력
- `cat targets/watch/Info.plist | grep -A 1 CFBundleDisplayName` → `<string>ShutTimer</string>` 확인
- `cat targets/watch/content.swift | grep -A 3 "var displayText"` → switch state 분기 확인

### 8.2 빌드 검증 (= Deploy 창)
- 빌드 통과
- 워치 실기기 설치 후:
  - 워치 홈 = "ShutTimer" 표시 (= "watch" 아님)
  - 다이얼 시각적 잘림 X (= Apple Watch SE 40/44mm)
  - idle 상태에서 다이얼 돌리면 가운데 점 아래 시간 텍스트 실시간 갱신
  - 터치 드래그 시 매 분마다 햅틱 작동

---

## 9. 위험 / 주의

| 항목 | 위험 | 비고 |
|---|---|---|
| `WKInterfaceDevice.current()` file-level let 초기화 | 매우 낮음 | Swift lazy 초기화 + view body 그릴 때 첫 접근 = main thread + WatchKit lifecycle 시작 후 안전 |
| 햅틱 빈도 (60번/회전 1바퀴) | 낮음 | iOS도 동일 빈도. 사용자 익숙한 패턴 |
| idle 시간 텍스트 = 0:00 표시 가능성 | 0 | initialState `minutes = 5` 기본값 → "05:00" 표시 |
| CFBundleDisplayName 추가가 Apple Watch 시스템 측 이름 충돌 | 0 | 시스템 앱(Calendar, Mail 등) 동일 패턴. 충돌 사례 없음 |
| 반응형 사이즈 변경으로 NumberLabel/TickMark 측 misalignment | 0 | 모든 상수 동일 비율 (× DIAL_SIZE) 적용 → 비례 유지 |

---

## 10. 롤백

```bash
git revert HEAD  # 본 feat commit 되돌리기
```

= 195pt 하드코딩 + "watch" 표시명 + 햅틱 없음 + idle 시간 미표시 복귀.

---

## 11. Build 창 작업 결과 보고 요청

수정 완료 후 다음 정보 Deploy 창에 회신:
- 수정 commit hash
- push 완료 여부
- §5 옵션 (A or B) 선택 결과
- §7.1, §7.2 처리 결과
- `git diff HEAD~1 targets/watch/` 출력 요약 (= 변경 라인 수)
