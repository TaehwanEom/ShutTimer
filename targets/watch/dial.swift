// ShutTimer Watch — Dial timer setup.
// 2026-05-28 신규 + 동일 디자인 정정.
// iOS TimerDial 측 (= src/components/TimerDial.tsx) 측 정확 동일 구조:
//   1. 회색 디스크 배경
//   2. 빨강 sector (= 0~분 측 progress)
//   3. 60개 눈금 (= 1분 단위 = 작은 + 5분 단위 = 큰)
//   4. 12개 숫자 라벨 (= 0, 5, 10, ..., 55) — 다이얼 밖
//   5. 얇은 검은 직사각형 시계 침 (= 다이얼 중간 지점)
//   6. 가운데 검은 작은 원
// + Watch 측 추가: digitalCrownRotation (= 정밀 분 입력).
//   시간 텍스트 = 다이얼 외부 (= 아래 = iOS 정합).

import SwiftUI
import WatchKit

// 2026-05-29 — 반응형 (= Apple Watch SE 40/44mm + Series 46mm + Ultra 49mm 정합).
//   기준 = 화면 가로 폭 * 0.95 (= 라벨 여백 확보). 모든 사이즈 = 195 기준 비율로 동적 계산.
//   WKInterfaceDevice.current().screenBounds = WatchKit lifecycle 시작 후 main thread 안전.
private let DIAL_SIZE: CGFloat = WKInterfaceDevice.current().screenBounds.width * 0.95
private let CENTER: CGFloat = DIAL_SIZE / 2
private let SECTOR_RADIUS: CGFloat = DIAL_SIZE * (85.0 / 195.0)
private let LABEL_RADIUS: CGFloat = DIAL_SIZE * (95.0 / 195.0)
private let TICK_OUTER: CGFloat = DIAL_SIZE * (85.0 / 195.0)
private let TICK_INNER_MAJOR: CGFloat = DIAL_SIZE * (71.0 / 195.0)
private let TICK_INNER_MINOR: CGFloat = DIAL_SIZE * (77.0 / 195.0)
private let CENTER_DOT_RADIUS: CGFloat = DIAL_SIZE * (6.0 / 195.0)

struct DialView: View {
    @ObservedObject var store: TimerStore

    // 2026-05-29 — iOS TimerDial 햅틱 정합 (= 첫 터치 1회 + 분 변경 시마다).
    @State private var dragStarted: Bool = false

    private var progress: Double {
        // 2026-05-28 — setup 시 = 입력값 기준. running/paused 시 = 남은 시간 기준 (= iOS 정합).
        switch store.state {
        case .idle:
            let total = Double(store.minutes) + Double(store.seconds) / 60.0
            return min(1.0, max(0.0, total / 60.0))
        case .running, .paused, .finished:
            let totalMs = max(1.0, Double(store.totalMs))
            let leftMs = max(0.0, Double(store.remainingMs))
            // 60분 기준 정합 (= 다이얼 1바퀴 = 60분)
            let totalMin = totalMs / 1000.0 / 60.0
            let leftMin = leftMs / 1000.0 / 60.0
            let originalProgress = min(1.0, totalMin / 60.0)
            // setup 시 비율 유지하면서 줄어듦
            guard totalMin > 0 else { return 0 }
            return originalProgress * (leftMin / totalMin)
        }
    }


    var body: some View {
        // 2026-05-28 — 사용자 피드백 반영. 시간 텍스트 capsule 제거 = 다이얼만 표시 + 화면 최대 활용.
        ZStack {
            // 1. 회색 디스크 배경
            Circle()
                .fill(Color(white: 0.92))
                .frame(width: SECTOR_RADIUS * 2, height: SECTOR_RADIUS * 2)

            // 2. 빨강 sector (= progress)
            SectorShape(progress: progress)
                .fill(Color(red: 1.0, green: 0.141, blue: 0.141))
                .frame(width: SECTOR_RADIUS * 2, height: SECTOR_RADIUS * 2)

            // 3. 60개 눈금 (= 1분 단위)
            ForEach(0..<60, id: \.self) { i in
                TickMark(index: i)
            }

            // 4. 12개 숫자 라벨 (= 다이얼 밖)
            ForEach(0..<12, id: \.self) { i in
                NumberLabel(index: i)
            }

            // 5. 얇은 검은 직사각형 시계 침
            NeedleShape(progress: progress)
                .fill(Color.black)
                .frame(width: SECTOR_RADIUS * 2, height: SECTOR_RADIUS * 2)

            // 6. 가운데 검은 작은 원
            Circle()
                .fill(Color.black)
                .frame(width: CENTER_DOT_RADIUS * 2, height: CENTER_DOT_RADIUS * 2)

            // 2026-05-28 — 가운데 시간 텍스트 제거. 시간 표시 = CountdownView 측에서 왼쪽 overlay.
        }
        .frame(width: DIAL_SIZE, height: DIAL_SIZE)
        .contentShape(Circle())
        .gesture(
            DragGesture(minimumDistance: 0)
                .onChanged { value in handleDrag(at: value.location) }
                .onEnded { _ in dragStarted = false }
        )
        .focusable()
        .digitalCrownRotation(
            Binding(
                get: { Double(store.minutes) },
                set: { newValue in
                    guard store.state == .idle || store.state == .paused else { return }
                    let newMin = min(60, max(0, Int(newValue)))
                    // 양방향 허용 = 디지털 크라운 회전 = 증가/감소 둘 다 OK
                    store.minutes = newMin
                }
            ),
            from: 0,
            through: 60,
            by: 1,
            sensitivity: .medium,
            isContinuous: false,
            isHapticFeedbackEnabled: true
        )
    }

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

        // iOS 정합 (= HomeScreen.tsx panResponder):
        //   1. 60분 도달 = 354° 이상 → 60 강제
        //   2. wrap 차단 = abs(newMinutes - prevMinutes) > 30 = 60↔0 점프 차단
        //   3. 양방향 허용 = 시계방향 (증가) + 반시계방향 (감소) 둘 다 OK
        var newMinutes = Int(angle / 6)
        if angle >= 354 { newMinutes = 60 }
        newMinutes = max(0, min(60, newMinutes))

        // wrap 차단 (= 60→0 또는 0→60 점프 방지)
        if abs(newMinutes - store.minutes) > 30 { return }

        if newMinutes != store.minutes {
            // 2026-05-29 — iOS TimerDial 정합 = 분 변경 시점마다 .click 햅틱.
            WKInterfaceDevice.current().play(.click)
            store.minutes = newMinutes
        }
    }
}

// MARK: - Sector (= 빨강 progress)

private struct SectorShape: Shape {
    var progress: Double

    func path(in rect: CGRect) -> Path {
        var path = Path()
        let center = CGPoint(x: rect.midX, y: rect.midY)
        let radius = rect.width / 2
        path.move(to: center)
        path.addArc(
            center: center,
            radius: radius,
            startAngle: .degrees(-90),
            endAngle: .degrees(-90 + progress * 360),
            clockwise: false
        )
        path.closeSubpath()
        return path
    }
}

// MARK: - Tick (= 1분 단위 60개)

private struct TickMark: View {
    let index: Int

    var body: some View {
        let isMajor = index % 5 == 0
        let angle = Double(index) * 6.0 - 90.0
        let inner = isMajor ? TICK_INNER_MAJOR : TICK_INNER_MINOR
        let outer = TICK_OUTER
        let rad = angle * .pi / 180
        Path { path in
            path.move(to: CGPoint(
                x: CENTER + cos(rad) * inner,
                y: CENTER + sin(rad) * inner
            ))
            path.addLine(to: CGPoint(
                x: CENTER + cos(rad) * outer,
                y: CENTER + sin(rad) * outer
            ))
        }
        .stroke(
            Color.black.opacity(isMajor ? 0.8 : 0.4),
            lineWidth: isMajor ? 1.5 : 0.7
        )
    }
}

// MARK: - Number Label (= 0, 5, 10, ..., 55)

private struct NumberLabel: View {
    let index: Int

    var body: some View {
        let label = index * 5
        let angle = Double(index) * 30.0 - 90.0
        let rad = angle * .pi / 180
        let x = CENTER + cos(rad) * LABEL_RADIUS
        let y = CENTER + sin(rad) * LABEL_RADIUS
        Text("\(label)")
            .font(.system(size: 9, weight: .bold))
            .foregroundColor(.black)
            .position(x: x, y: y)
    }
}

// MARK: - Needle (= 얇은 직사각형 시계 침)

private struct NeedleShape: Shape {
    var progress: Double

    func path(in rect: CGRect) -> Path {
        var path = Path()
        let center = CGPoint(x: rect.midX, y: rect.midY)
        let needleAngle = progress * 360.0 - 90.0
        let rad = needleAngle * .pi / 180
        let length: CGFloat = 17 // = iOS 측 length = 20 * sqrt(3)/2 측 정합 scale
        let width: CGFloat = 2.5
        let perp = rad + .pi / 2

        // 무게중심 (= 가운데 점 측 외곽)
        let gcx = center.x + (CENTER_DOT_RADIUS + 2) * cos(rad)
        let gcy = center.y + (CENTER_DOT_RADIUS + 2) * sin(rad)
        let tipX = gcx + (length * 2.0 / 3.0) * cos(rad)
        let tipY = gcy + (length * 2.0 / 3.0) * sin(rad)
        let bcx = gcx - (length / 3.0) * cos(rad)
        let bcy = gcy - (length / 3.0) * sin(rad)
        // 직사각형 4점
        let tipL = CGPoint(x: tipX - (width / 2) * cos(perp), y: tipY - (width / 2) * sin(perp))
        let tipR = CGPoint(x: tipX + (width / 2) * cos(perp), y: tipY + (width / 2) * sin(perp))
        let baseR = CGPoint(x: bcx + (width / 2) * cos(perp), y: bcy + (width / 2) * sin(perp))
        let baseL = CGPoint(x: bcx - (width / 2) * cos(perp), y: bcy - (width / 2) * sin(perp))
        path.move(to: tipL)
        path.addLine(to: tipR)
        path.addLine(to: baseR)
        path.addLine(to: baseL)
        path.closeSubpath()
        return path
    }
}
