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

private let DIAL_SIZE: CGFloat = 140
private let CENTER: CGFloat = DIAL_SIZE / 2
private let SECTOR_RADIUS: CGFloat = 60
private let LABEL_RADIUS: CGFloat = 70
private let TICK_OUTER: CGFloat = 60
private let TICK_INNER_MAJOR: CGFloat = 50
private let TICK_INNER_MINOR: CGFloat = 54
private let CENTER_DOT_RADIUS: CGFloat = 5

struct DialView: View {
    @ObservedObject var store: TimerStore

    private var progress: Double {
        let total = Double(store.minutes) + Double(store.seconds) / 60.0
        return min(1.0, max(0.0, total / 60.0))
    }

    var body: some View {
        VStack(spacing: 4) {
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
            }
            .frame(width: DIAL_SIZE, height: DIAL_SIZE)
            .contentShape(Circle())
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { value in handleDrag(at: value.location) }
            )
            .focusable()
            .digitalCrownRotation(
                Binding(
                    get: { Double(store.minutes) },
                    set: { newValue in
                        store.minutes = min(59, max(0, Int(newValue)))
                    }
                ),
                from: 0,
                through: 59,
                by: 1,
                sensitivity: .medium,
                isContinuous: false,
                isHapticFeedbackEnabled: true
            )

            // 7. 시간 텍스트 (= 다이얼 밖 = iOS 측 동일)
            Text(timeText)
                .font(.system(size: 14, weight: .bold, design: .rounded))
                .monospacedDigit()
                .foregroundColor(.white)
                .padding(.horizontal, 10)
                .padding(.vertical, 2)
                .overlay(
                    Capsule().stroke(Color(red: 1.0, green: 0.141, blue: 0.141).opacity(0.4), lineWidth: 1)
                )
        }
    }

    private var timeText: String {
        String(format: "%02d : %02d", store.minutes, store.seconds)
    }

    private func handleDrag(at point: CGPoint) {
        let dx = point.x - CENTER
        let dy = point.y - CENTER
        let dist = sqrt(dx * dx + dy * dy)
        // 중심 측 = 측 = drag 측 무시 (= 측 = 정밀 X)
        guard dist > CENTER_DOT_RADIUS, dist <= SECTOR_RADIUS + 10 else { return }
        var angle = atan2(dy, dx) * 180 / .pi + 90
        if angle < 0 { angle += 360 }
        let newMinutes = Int((angle / 360) * 60)
        if newMinutes != store.minutes {
            store.minutes = min(59, max(0, newMinutes))
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
