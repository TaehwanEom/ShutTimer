# Android MainActivity 수동 편집 — 위젯 정지 방안 B (2026-06-02)

## 배경
`android/`는 `.gitignore` 대상이라 `android/app/src/main/java/com/shuttimer/app/MainActivity.kt`는 **커밋되지 않습니다.** 이 프로젝트는 MainActivity 커스텀 코드(예: `requestDismissKeyguardOnAlarmEntry`)를 config plugin이 아니라 **손으로 유지**합니다.

위젯 "정지" → 앱 진입은 **방안 B**(`AlarmScheduler.WIDGET_STOP_MODE = "B"`)로 동작하며, 이는 정지 PendingIntent가 **MainActivity를 직접** 타깃해 2차 `startActivity` BAL 차단을 회피합니다. 따라서 MainActivity에 아래 수동 편집이 **반드시 있어야** toggle=B가 정상 동작합니다. (없으면 정지 눌러도 무반응)

> prebuild를 새로 돌리거나 fresh clone 시 MainActivity가 재생성되면 아래를 다시 적용할 것.

## 적용 내용 (MainActivity.kt)

### 1) import 추가
```kotlin
import expo.modules.alarmkitbridge.AlarmEventBus
import expo.modules.alarmkitbridge.AlarmAlertActivity
import expo.modules.alarmkitbridge.AlarmScheduler
```

### 2) onCreate / onNewIntent 에 호출 추가
```kotlin
override fun onCreate(savedInstanceState: Bundle?) {
  ...
  requestDismissKeyguardOnAlarmEntry(intent)
  handleWidgetStop(intent)   // ← 추가
}

override fun onNewIntent(intent: Intent) {
  super.onNewIntent(intent)
  requestDismissKeyguardOnAlarmEntry(intent)
  handleWidgetStop(intent)   // ← 추가
}
```

### 3) handleWidgetStop 함수 추가
```kotlin
// 2026-06-02 방안 B — 위젯 "정지" → MainActivity 직접 진입 처리.
//   AlarmScheduler 측 widget_stop PendingIntent → 본 Activity launch (= 2차 startActivity 없음 = 안드로이드 BAL 차단 회피).
//   잠금 시 생체/패턴 인증 요구 + stop_action 전달 (JS alive = 직접 emit / cold start = pending-key write → bridge OnCreate emit).
private fun handleWidgetStop(intent: Intent?) {
  val id = intent?.getStringExtra(AlarmScheduler.EXTRA_WIDGET_STOP_ALARM_ID) ?: return
  if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
    val keyguardManager = getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager
    if (keyguardManager != null && keyguardManager.isKeyguardLocked) {
      keyguardManager.requestDismissKeyguard(this, null)
    }
  }
  if (AlarmEventBus.listener != null) {
    AlarmEventBus.emit(id, "stop_action")
  } else {
    val prefs = getSharedPreferences(AlarmAlertActivity.PREFS_PENDING, Context.MODE_PRIVATE)
    prefs.edit().putString(AlarmAlertActivity.KEY_PENDING_WIDGET_STOP_ALARM_ID, id).apply()
  }
}
```

## 검증 (실기기, 2026-06-02 확인 완료)
- 위젯 정지 → 앱 진입 + "루틴 종료" 모달: 일반/알람 카드 직후/연속 누름 모두 정상 (방안 A에서 발생하던 됐다-안됐다 없음).
- 방안 A(`WIDGET_STOP_MODE="A"`, AlarmAlertActivity 보이는창 후 launch)는 onResume 재호출 불안정으로 간헐 실패 → **B 채택.**
