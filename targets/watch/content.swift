// ShutTimer Watch App — Phase 1 UI + 로직 (= 단일 file MVP).
// 2026-05-28 신규.
//   - TimerRootView: 시간 설정 (= digital crown + 분/초 picker) + 시작 버튼.
//   - CountdownView: 카운트다운 진행 + 일시정지/취소.
//   - 알림: 종료 시 UNUserNotificationCenter local notification (= 사운드 + 진동).
//   - 백그라운드: WKExtendedRuntimeSession (= 워치 측 = 화면 끔 + 백그라운드 측 카운트다운 진행).

import SwiftUI
import WatchKit
import UserNotifications

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
    @Published var minutes: Int = 5
    @Published var seconds: Int = 0
    @Published var remainingMs: Int = 0

    private var ticker: Timer?
    private var endAt: Date?
    private var session: WKExtendedRuntimeSession?

    var totalMs: Int {
        (minutes * 60 + seconds) * 1000
    }

    var displayText: String {
        let totalSec = max(0, remainingMs / 1000)
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
        state = .finished
        // 워치 본체 측 = 진동 (= local notification 측도 진동 + 사운드 출력. 양쪽 다 OK).
        WKInterfaceDevice.current().play(.notification)
        // session = finish 후도 = 측 = AlertView 측 사용자 측 dismiss 까지 = 측 = 측 유지.
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
        case .idle:
            TimerSetupView(store: store)
        case .running, .paused:
            CountdownView(store: store)
        case .finished:
            AlertView(store: store)
        }
    }
}

struct TimerSetupView: View {
    @ObservedObject var store: TimerStore

    var body: some View {
        VStack(spacing: 8) {
            Text("ShutTimer")
                .font(.headline)
                .foregroundColor(Color(red: 1.0, green: 0.42, blue: 0.21))

            HStack {
                VStack {
                    Text("분")
                        .font(.caption2)
                    Picker("min", selection: $store.minutes) {
                        ForEach(0..<60) { Text("\($0)").tag($0) }
                    }
                    .labelsHidden()
                    .frame(width: 60)
                }
                VStack {
                    Text("초")
                        .font(.caption2)
                    Picker("sec", selection: $store.seconds) {
                        ForEach(0..<60) { Text("\($0)").tag($0) }
                    }
                    .labelsHidden()
                    .frame(width: 60)
                }
            }

            Button(action: { store.start() }) {
                Text("시작")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(Color(red: 1.0, green: 0.42, blue: 0.21))
            .disabled(store.minutes == 0 && store.seconds == 0)
        }
        .padding()
    }
}

struct CountdownView: View {
    @ObservedObject var store: TimerStore

    var body: some View {
        VStack(spacing: 12) {
            Text(store.displayText)
                .font(.system(size: 48, weight: .bold, design: .rounded))
                .monospacedDigit()
                .foregroundColor(.white)

            HStack(spacing: 12) {
                Button(action: {
                    if store.state == .running {
                        store.pause()
                    } else {
                        store.resume()
                    }
                }) {
                    Image(systemName: store.state == .running ? "pause.fill" : "play.fill")
                        .font(.title2)
                }
                .buttonStyle(.bordered)

                Button(action: { store.cancel() }) {
                    Image(systemName: "stop.fill")
                        .font(.title2)
                        .foregroundColor(.red)
                }
                .buttonStyle(.bordered)
            }
        }
        .padding()
    }
}

struct AlertView: View {
    @ObservedObject var store: TimerStore

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "bell.fill")
                .font(.largeTitle)
                .foregroundColor(Color(red: 1.0, green: 0.42, blue: 0.21))

            Text("완료")
                .font(.title2)
                .bold()

            Button(action: { store.dismissFinish() }) {
                Text("닫기")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(Color(red: 1.0, green: 0.42, blue: 0.21))
        }
        .padding()
    }
}

#Preview {
    TimerRootView()
}
