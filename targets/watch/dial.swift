// ShutTimer Watch — Dial timer setup (= iOS TimerDial 측 동일 구조 워치 버전).
// 2026-05-28 신규.
//   - 원형 다이얼 + 12 분 단위 라벨 + sector progress + 가운데 시간.
//   - DragGesture 측 = 손가락 회전 → 분 선택.
//   - watchOS 측 = 화면 작음 → iOS 측 330px → 워치 측 약 140px 측 scale-down.
//   - digital crown 측 = 추가 정밀 입력 (= drag 측 = 거친 입력, crown 측 = 분/초 미세).

import SwiftUI

struct DialView: View {
    @ObservedObject var store: TimerStore

    // Dial 측 = 0~59 분 측 binding (= store.minutes 측).
    private var totalSeconds: Double {
        Double(store.minutes * 60 + store.seconds)
    }

    private var maxSeconds: Double { 60 * 60 } // 60분 측 max

    private var progress: Double {
        min(1.0, totalSeconds / maxSeconds)
    }

    var body: some View {
        ZStack {
            // 1. 배경 원형 ring
            Circle()
                .stroke(Color.gray.opacity(0.2), lineWidth: 4)

            // 2. Sector progress (= 부채꼴)
            Circle()
                .trim(from: 0, to: progress)
                .stroke(
                    Color(red: 1.0, green: 0.42, blue: 0.21),
                    style: StrokeStyle(lineWidth: 6, lineCap: .butt)
                )
                .rotationEffect(.degrees(-90))

            // 3. 12 분 단위 라벨 (= 0, 5, 10, ..., 55)
            ForEach(0..<12, id: \.self) { i in
                let label = i * 5
                let angle = Double(i) * 30.0 - 90.0 // 12시 = 0분 = -90도
                let radius: CGFloat = 56
                let x = cos(angle * .pi / 180) * radius
                let y = sin(angle * .pi / 180) * radius
                Text("\(label)")
                    .font(.system(size: 9, weight: .semibold))
                    .foregroundColor(.gray)
                    .offset(x: x, y: y)
            }

            // 4. 가운데 시간 텍스트
            VStack(spacing: 2) {
                Text(timeText)
                    .font(.system(size: 22, weight: .bold, design: .rounded))
                    .monospacedDigit()
                    .foregroundColor(.white)
                Text("MIN")
                    .font(.system(size: 7, weight: .semibold))
                    .foregroundColor(.gray.opacity(0.7))
            }
        }
        .frame(width: 140, height: 140)
        .contentShape(Circle())
        .gesture(
            DragGesture(minimumDistance: 0)
                .onChanged { value in
                    handleDrag(at: value.location)
                }
        )
        // digital crown 측 = 분 단위 미세 조정 (= 정밀 입력).
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
    }

    private var timeText: String {
        let m = store.minutes
        let s = store.seconds
        return s == 0 ? "\(m)" : String(format: "%d:%02d", m, s)
    }

    // Drag 측 = 화면 위치 → 각도 → 분 변환.
    private func handleDrag(at point: CGPoint) {
        // 중심 = (70, 70) (= 140/2)
        let dx = point.x - 70
        let dy = point.y - 70
        var angle = atan2(dy, dx) * 180 / .pi + 90 // 12시 = 0도
        if angle < 0 { angle += 360 }
        // 0~360 → 0~60분
        let newMinutes = Int((angle / 360) * 60)
        if newMinutes != store.minutes {
            store.minutes = min(59, max(0, newMinutes))
        }
    }
}
