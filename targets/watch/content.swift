// ShutTimer Watch App — Phase 1 UI + 로직 (= 단일 file MVP).
// 2026-05-28 신규.
//   - TimerRootView: 시간 설정 (= digital crown + 분/초 picker) + 시작 버튼.
//   - CountdownView: 카운트다운 진행 + 일시정지/취소.
//   - 알림: 종료 시 UNUserNotificationCenter local notification (= 사운드 + 진동).
//   - 백그라운드: WKExtendedRuntimeSession (= 워치 측 = 화면 끔 + 백그라운드 측 카운트다운 진행).

import SwiftUI
import WatchKit
import UserNotifications

// 2026-05-29 — 반응형 다이얼 사이즈 (= dial.swift 정합 = 화면 가로 폭 * 0.95).
private let WATCH_DIAL_SIZE: CGFloat = WKInterfaceDevice.current().screenBounds.width * 0.95

// MARK: - Timer 상태

enum TimerState {
    case idle      // = 시간 설정 화면
    case running   // = 카운트다운 진행 중
    case paused    // = 일시정지
    case finished  // = 종료 알림 진입
}

@MainActor
final class TimerStore: ObservableObject {
    @Published var state: TimerState = .idle
    // 2026-05-28 — paused 시 minutes/seconds 변경 시 = remainingMs 자동 동기 (= iOS 정합 = 다이얼 회전 재설정).
    @Published var minutes: Int = 5 {
        didSet { syncRemainingIfPaused() }
    }
    @Published var seconds: Int = 0 {
        didSet { syncRemainingIfPaused() }
    }
    @Published var remainingMs: Int = 0

    private var ticker: Timer?
    private var endAt: Date?
    private var session: WKExtendedRuntimeSession?

    var totalMs: Int {
        (minutes * 60 + seconds) * 1000
    }

    private func syncRemainingIfPaused() {
        guard state == .paused else { return }
        let newMs = (minutes * 60 + seconds) * 1000
        remainingMs = newMs
        // endAt 갱신은 resume 시점에서 새로 계산. notification은 미리 cancel.
        cancelFinishNotification()
    }

    var displayText: String {
        // 2026-05-29 — iOS HomeScreen 정합 (HomeScreen.tsx:1118-1119).
        //   idle = 설정값 (= minutes * 60 + seconds)
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

    func start() {
        guard totalMs > 0 else { return }
        remainingMs = totalMs
        state = .running
        endAt = Date().addingTimeInterval(Double(totalMs) / 1000.0)
        startTicker()
        startExtendedRuntimeSession()
        scheduleFinishNotification()
    }

    func pause() {
        state = .paused
        ticker?.invalidate()
        ticker = nil
        cancelFinishNotification()
    }

    func resume() {
        guard remainingMs > 0 else { return }
        state = .running
        endAt = Date().addingTimeInterval(Double(remainingMs) / 1000.0)
        startTicker()
        scheduleFinishNotification()
    }

    func cancel() {
        state = .idle
        ticker?.invalidate()
        ticker = nil
        remainingMs = 0
        endAt = nil
        session?.invalidate()
        session = nil
        cancelFinishNotification()
    }

    func dismissFinish() {
        state = .idle
        remainingMs = 0
        endAt = nil
        session?.invalidate()
        session = nil
    }

    // MARK: - Internal

    private func startTicker() {
        ticker?.invalidate()
        ticker = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in
                self?.tick()
            }
        }
    }

    private func tick() {
        guard state == .running, let endAt else { return }
        let leftMs = Int(endAt.timeIntervalSinceNow * 1000.0)
        if leftMs <= 0 {
            remainingMs = 0
            finish()
        } else {
            remainingMs = leftMs
        }
    }

    private func finish() {
        ticker?.invalidate()
        ticker = nil
        // 앱 활성 상태 측 finish 시 = scheduled notification 측 cancel (= 중복 진동 차단).
        //   notification 측 = 백그라운드 측 = 앱 suspended 측 fire 보장 의도.
        //   앱 활성 측 = play(.notification) 측 = 즉시 진동 + AlertView 진입. notification 측 불필요.
        cancelFinishNotification()
        state = .finished
        WKInterfaceDevice.current().play(.notification)
        // session = finish 후도 = AlertView 측 사용자 측 dismiss 까지 유지.
    }

    private func startExtendedRuntimeSession() {
        // 워치 측 백그라운드 측 1초 tick 측 지속 측 = WKExtendedRuntimeSession 측 (= max 30분).
        session?.invalidate()
        let new = WKExtendedRuntimeSession()
        new.start()
        session = new
    }

    private func scheduleFinishNotification() {
        let content = UNMutableNotificationContent()
        content.title = "타이머 완료"
        content.body = "설정한 시간이 끝났습니다"
        content.sound = .default

        let trigger = UNTimeIntervalNotificationTrigger(
            timeInterval: max(1.0, Double(remainingMs) / 1000.0),
            repeats: false
        )
        let req = UNNotificationRequest(
            identifier: "shuttimer.watch.finish",
            content: content,
            trigger: trigger
        )
        UNUserNotificationCenter.current().add(req)
    }

    private func cancelFinishNotification() {
        UNUserNotificationCenter.current().removePendingNotificationRequests(
            withIdentifiers: ["shuttimer.watch.finish"]
        )
    }
}

// MARK: - Views

struct TimerRootView: View {
    @StateObject private var store = TimerStore()

    var body: some View {
        switch store.state {
        case .idle, .running, .paused:
            // 2026-05-28 — 사용자 분노 fix: idle/running/paused 측 = 동일 View 사용 (= 버튼 위치/크기 일관 보장).
            DialWithButtonView(store: store)
        case .finished:
            AlertView(store: store)
        }
    }
}

// MARK: - Setup Views (= 두 가지 디자인: 다이얼 + picker)

// 2026-05-28 — 사용자 분노 fix: idle/running/paused 측 = 단일 View = 버튼 위치/크기 100% 일관 보장.
//   iOS 앱 정합:
//     - 단일 토글 버튼 (= state 측 action 분기)
//     - 짧게 탭 = idle→start / running→pause / paused→resume
//     - 길게 누름 (= 1.3초) = cancel (= running/paused 시만)
//     - 게이지 = running/paused 시만 표시
//     - 버튼 크기 = 항상 34x34 고정 (= 외곽 43x43)
//     - 위치 = ZStack(alignment: .bottomTrailing) = 모든 state 동일
struct DialWithButtonView: View {
    @ObservedObject var store: TimerStore

    @State private var pressProgress: Double = 0
    @State private var pressDelayTimer: Timer?
    @State private var pressCancelTimer: Timer?
    // iOS HomeScreen.tsx:1071 정합. 길게 누름 cancel 후 release 시 = button.action 측 차단.
    @State private var longPressFired = false

    private func startLongPress() {
        guard store.state == .running || store.state == .paused else { return }
        pressDelayTimer?.invalidate()
        pressCancelTimer?.invalidate()
        pressDelayTimer = Timer.scheduledTimer(withTimeInterval: 0.3, repeats: false) { _ in
            DispatchQueue.main.async {
                withAnimation(.linear(duration: 1.0)) {
                    pressProgress = 1.0
                }
                pressCancelTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: false) { _ in
                    DispatchQueue.main.async {
                        longPressFired = true  // ← release 시 button.action 차단
                        store.cancel()
                        pressProgress = 0
                    }
                }
            }
        }
    }

    private func cancelLongPress() {
        pressDelayTimer?.invalidate()
        pressCancelTimer?.invalidate()
        pressDelayTimer = nil
        pressCancelTimer = nil
        withAnimation(.linear(duration: 0.15)) {
            pressProgress = 0
        }
        // longPressFired reset X (= handleTap 측 release 후 1회 차단 후 reset)
    }

    private var iconName: String {
        switch store.state {
        case .idle, .paused, .finished: return "play.fill"
        case .running: return "pause.fill"
        }
    }

    private func handleTap() {
        // iOS HomeScreen.tsx:1261 정합. 길게 누름 cancel 후 release 시 = 1회 차단 + reset.
        if longPressFired {
            longPressFired = false
            return
        }
        switch store.state {
        case .idle: store.start()
        case .running: store.pause()
        case .paused: store.resume()
        case .finished: break
        }
    }

    var body: some View {
        // 2026-05-28 — 사용자 fix: ZStack 크기 = 다이얼 크기 강제 고정 (= 시간 capsule 측 .frame(maxWidth: .infinity)
        // 측 = ZStack 측 무한대 확장 → bottomTrailing 위치 변동 → 버튼 움직임). 측 = 측 = 측 = 측 = 측 (측 X)
        // 외곽 frame = 195x195 (= DialView size 정합) → 모든 state 측 = 동일 영역 → 버튼 위치 고정.
        ZStack(alignment: .bottomTrailing) {
            DialView(store: store)

            // 2026-05-29 — iOS HomeScreen 정합 = 모든 state(idle 포함) 시간 텍스트 상시 표시.
            //   idle 시 = displayText 측 setup 값 (= minutes*60+seconds) 반환.
            //   .position 측 = ZStack center 기준 = 가운데 점 아래.
            Text(store.displayText)
                .font(.system(size: 16, weight: .bold, design: .rounded))
                .monospacedDigit()
                .foregroundColor(.white)
                .padding(.horizontal, 8)
                .padding(.vertical, 3)
                .background(Capsule().fill(Color.black.opacity(0.75)))
                .position(x: WATCH_DIAL_SIZE / 2, y: WATCH_DIAL_SIZE / 2 + WATCH_DIAL_SIZE * (32.0 / 195.0))

            // 우하단 = 토글 버튼 + 게이지 (= 모든 state 동일 위치/크기)
            ZStack {
                Color.clear.frame(width: 43, height: 43)

                if store.state == .running || store.state == .paused {
                    Circle()
                        .stroke(Color.gray.opacity(0.3), lineWidth: 2)
                        .frame(width: 43, height: 43)
                    Circle()
                        .trim(from: 0, to: pressProgress)
                        .stroke(
                            Color(red: 1.0, green: 0.141, blue: 0.141),
                            style: StrokeStyle(lineWidth: 2, lineCap: .round)
                        )
                        .rotationEffect(.degrees(-90))
                        .frame(width: 43, height: 43)
                }

                Button(action: handleTap) {
                    Image(systemName: iconName)
                        .font(.system(size: 14, weight: .bold))
                        .foregroundColor(.white)
                        .frame(width: 34, height: 34)
                        .background(Circle().fill(Color(red: 1.0, green: 0.141, blue: 0.141)))
                }
                .buttonStyle(.plain)
                .disabled(store.state == .idle && store.minutes == 0 && store.seconds == 0)
                .onLongPressGesture(minimumDuration: 1.3, maximumDistance: 50) {
                    store.cancel()
                    pressProgress = 0
                } onPressingChanged: { pressing in
                    if pressing { startLongPress() } else { cancelLongPress() }
                }
            }
        }
        .frame(width: WATCH_DIAL_SIZE, height: WATCH_DIAL_SIZE)  // ← 반응형 다이얼 크기 = 화면 비율
    }
}

// 2026-05-28 — CountdownView 측 = DialWithButtonView 측 통합 = 제거.

struct AlertView: View {
    @ObservedObject var store: TimerStore

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "bell.fill")
                .font(.largeTitle)
                .foregroundColor(Color(red: 1.0, green: 0.141, blue: 0.141))

            Text("완료")
                .font(.title2)
                .bold()

            Button(action: { store.dismissFinish() }) {
                Text("닫기")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(Color(red: 1.0, green: 0.141, blue: 0.141))
        }
        .padding()
    }
}

#Preview {
    TimerRootView()
}
