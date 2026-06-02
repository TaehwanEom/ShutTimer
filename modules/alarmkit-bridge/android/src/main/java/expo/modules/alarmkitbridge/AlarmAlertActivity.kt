// 알람 발화 전용 Activity — 잠금/홈 위 가벼운 화면. iPhone 정합 (= 사용자 액션 후 앱 진입).
//   직전 = AlarmService가 full-screen-intent로 MainActivity를 자동 띄움 → RN 앱 전체 로드 → 사용자 액션 없이 인앱 진입.
//   본 정정 = AlarmService → 본 Activity 띄움 → 사용자 "끄기" 누름 → 일반 알람은 잠금 화면 복귀, 미션 알람은 MainActivity 진입.
//   Native UI minimal (= 시간/라벨/끄기 버튼). RN 미사용 = 즉시 표시.
package expo.modules.alarmkitbridge

import android.app.Activity
import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView

class AlarmAlertActivity : Activity() {
  companion object {
    private const val TAG = "AlarmkitBridge"
    private const val EXTRA_END_METHOD = "alerting_end_method"
    private const val EXTRA_TYPE = "alerting_type"
    // SharedPreferences 키 = AlarmkitBridgeModule.OnCreate에서 읽어 emit "alerting" 트리거 후 즉시 삭제.
    //   AlarmAlertActivity → MainActivity launch 사이 = stopAlarmService → clearAlerting → getAlertingId null
    //   → 본 별도 키로 신호 전달 (= 미션 알람 cold start emit 정합).
    const val PREFS_PENDING = "alarmkit_pending"
    const val KEY_PENDING_MISSION_ALARM_ID = "pending_mission_alarm_id"
    const val KEY_PENDING_END_METHOD = "pending_end_method"
    // confirm_prompt "다음 진행" 측 = AlarmActionReceiver secondary_action과 동등.
    //   JS onAlarmStateChange listener 측 event.state === 'secondary_action' 분기 → dispatch Advance.
    const val KEY_PENDING_SECONDARY_ACTION_ID = "pending_secondary_action_id"
    // 2026-06-02 — 방안 B: 위젯 "정지" → MainActivity 직접 진입 cold-start 신호 키. bridge OnCreate 측 read → emit "stop_action".
    const val KEY_PENDING_WIDGET_STOP_ALARM_ID = "pending_widget_stop_alarm_id"
    // 2026-06-02 — 잠금화면 위젯 "정지" 버튼 측 = stop 처리 후 앱 진입 (= iOS LA StopRoutineIntent .openAppWhenRun 정합).
    //   AlarmActionReceiver.handleStop 측 = stop 처리 후 본 Activity launchMainOnly mode 측 trigger.
    //   본 mode 측 = UI 빌드 X. 즉시 KeyguardManager dismiss → MainActivity launch + finish.
    const val EXTRA_LAUNCH_MAIN_ONLY = "launch_main_only"
  }

  private var alarmId: String? = null
  private var endMethod: String? = null
  private var alarmType: String? = null
  private lateinit var titleTextView: TextView
  private lateinit var stopButton: TextView
  // 2026-06-02 fix(방안 A) — launchMainOnly 진입 시 onResume까지 MainActivity launch 지연 플래그.
  private var pendingLaunchMainAfterResume = false

  // iOS SwiftUI systemRed 정합 = #FF3B30 (= AlarmAttributes tintColor = Color.red).
  private val ACCENT_RED = Color.parseColor("#FF3B30")
  private val DIM_GRAY = Color.parseColor("#8E8E93")  // iOS systemGray 정합 (= secondary 라벨)
  private val ON_SURFACE = Color.parseColor("#1A1C1F")  // 라벨 검정

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)

    // 잠금 위 + 화면 켜기 — 알람 표준 패턴 (= Samsung Clock / Google Clock 동일).
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      setShowWhenLocked(true)
      setTurnScreenOn(true)
    } else {
      @Suppress("DEPRECATION")
      window.addFlags(
        WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
        WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
      )
    }
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

    // 2026-06-02 — launchMainOnly mode 분기 (= 잠금화면 위젯 "정지" 버튼 측 stop 처리 후 앱 진입 경로).
    //   2026-06-02 fix(방안 A + 수정①) — onCreate/onNewIntent 공통 처리 + 보이는 창 확보 후 onResume에서 MainActivity launch.
    //     원인: 직전 = 콘텐츠 뷰 없는 투명 Activity가 startActivity(MainActivity) 호출 → "보이는 창 없음" → 안드로이드 BAL 차단 → 앱 진입 X.
    //     정정: 빈 콘텐츠 뷰로 보이는 창 확보 + 창이 실제로 그려진 onResume 이후로 launch 지연 (= BAL "visible window" 조건 충족).
    if (intent.getBooleanExtra(EXTRA_LAUNCH_MAIN_ONLY, false)) {
      enterLaunchMainOnly(intent)
      return
    }

    parseIntentExtras(intent)
    setContentView(buildUI())
    NativeDebugLog.log(this, TAG, "AlarmAlertActivity onCreate — alarmId=$alarmId endMethod=$endMethod")
  }

  // 2026-06-02 fix(방안 A + 수정①) — 위젯 "정지" launchMainOnly 진입 공통 처리.
  //   onCreate(인스턴스 없음) / onNewIntent(인스턴스 살아있음 = singleInstance 재사용) 양쪽에서 호출 → 수정① (재사용 시 무시 회귀 해소).
  //   보이는 창 확보 후 onResume에서 performLaunchMainOnly 호출 → 방안 A (BAL "visible window" 조건 충족).
  private fun enterLaunchMainOnly(src: Intent) {
    val widgetAlarmId = src.getStringExtra(AlarmScheduler.EXTRA_ALARM_ID)
    NativeDebugLog.log(this, TAG, "AlarmAlertActivity launchMainOnly mode (= 위젯 정지 앱 진입) alarmId=$widgetAlarmId")
    // 보이는 창 확보 — 빈 투명 콘텐츠 뷰 (= BAL "visible window" 조건. 직전 = 콘텐츠 뷰 없어 차단됨).
    setContentView(FrameLayout(this))
    // JS emit (= App.tsx stop_action listener → confirm modal). JS alive = emit, dead = signal write fallback.
    if (widgetAlarmId != null) {
      if (AlarmEventBus.listener != null) {
        NativeDebugLog.log(this, TAG, "launchMainOnly → emit stop_action alarmId=$widgetAlarmId (JS alive)")
        AlarmEventBus.emit(widgetAlarmId, "stop_action")
      } else {
        val prefs = getSharedPreferences("shuttimer_app_group", Context.MODE_PRIVATE)
        val snapshotRaw = prefs.getString("routine_snapshot", null)
        val routineId = if (snapshotRaw != null) {
          try { org.json.JSONObject(snapshotRaw).optString("routineId", "") } catch (_: Exception) { "" }
        } else ""
        val signal = org.json.JSONObject().apply {
          put("action", "stop")
          put("timestamp", System.currentTimeMillis().toDouble())
          put("routineId", routineId)
        }
        prefs.edit().putString("la_control_signal", signal.toString()).apply()
        NativeDebugLog.log(this, TAG, "launchMainOnly → stop signal write alarmId=$widgetAlarmId (JS dead)")
      }
    }
    // 창이 실제로 보이는 onResume 이후로 launch 지연 (= visible window 확정 후 BAL 통과).
    pendingLaunchMainAfterResume = true
  }

  override fun onResume() {
    super.onResume()
    if (pendingLaunchMainAfterResume) {
      pendingLaunchMainAfterResume = false
      // 창이 그려진 다음 프레임에 launch (= visible window 확정 후 BAL 통과).
      window.decorView.post { performLaunchMainOnly() }
    }
  }

  // 2026-06-02 — 위젯 "정지" 측 = stop 처리 후 앱 진입 (= iOS LA StopRoutineIntent .openAppWhenRun 정합).
  //   잠금 시 = KeyguardManager dismiss → 패턴/지문/Face ID 인증 → onDismissSucceeded → MainActivity launch + finish.
  //   잠금 해제 또는 SDK < O = 즉시 launch.
  private fun performLaunchMainOnly() {
    fun doLaunchMain() {
      val launch = packageManager.getLaunchIntentForPackage(packageName)
      if (launch != null) {
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        startActivity(launch)
        NativeDebugLog.log(this, TAG, "launchMainOnly → MainActivity launch")
      } else {
        NativeDebugLog.log(this, TAG, "launchMainOnly FAIL — getLaunchIntentForPackage null")
      }
    }
    val km = getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager
    if (km != null && km.isKeyguardLocked && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      km.requestDismissKeyguard(this, object : KeyguardManager.KeyguardDismissCallback() {
        override fun onDismissSucceeded() {
          NativeDebugLog.log(this@AlarmAlertActivity, TAG, "launchMainOnly keyguard dismiss success → launch")
          doLaunchMain(); finish()
        }
        override fun onDismissCancelled() {
          NativeDebugLog.log(this@AlarmAlertActivity, TAG, "launchMainOnly keyguard dismiss cancelled — finish")
          finish()
        }
        override fun onDismissError() {
          NativeDebugLog.log(this@AlarmAlertActivity, TAG, "launchMainOnly keyguard dismiss error → fallback launch")
          doLaunchMain(); finish()
        }
      })
    } else {
      doLaunchMain(); finish()
    }
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    // 2026-06-02 fix(수정①) — 인스턴스 살아있을 때(singleInstance 재사용) 위젯 정지가 onNewIntent로 들어와도 launchMainOnly 처리.
    //   직전 = onNewIntent가 launchMainOnly 무시 → 알람 카드만 갱신 → 앱 진입 X 회귀.
    if (intent.getBooleanExtra(EXTRA_LAUNCH_MAIN_ONLY, false)) {
      enterLaunchMainOnly(intent)
      return
    }
    // singleInstance launchMode → 다른 알람 fire 시 같은 Activity 재사용. Intent extras 갱신.
    parseIntentExtras(intent)
    refreshTitle()
    refreshStopButtonLabel()
    NativeDebugLog.log(this, TAG, "AlarmAlertActivity onNewIntent — alarmId=$alarmId endMethod=$endMethod")
  }

  // back button 무시 = Samsung Clock 측 정합. 사용자 "끄기" 버튼 액션만 알람 종료.
  //   직전 = back button → finish() → AlarmService 계속 사운드/진동 → 알람 안 꺼짐 회귀.
  @Suppress("MissingSuperCall")
  override fun onBackPressed() {
    NativeDebugLog.log(this, TAG, "onBackPressed ignored — use 끄기 button to dismiss alarm")
  }

  private fun parseIntentExtras(src: Intent) {
    alarmId = src.getStringExtra(AlarmScheduler.EXTRA_ALARM_ID)
    endMethod = src.getStringExtra(EXTRA_END_METHOD)
    alarmType = src.getStringExtra(EXTRA_TYPE)
  }

  // ShutTimer ActiveRoutineSection 표준 모달 디자인 + iOS systemRed 컬러 정합.
  //   구조: 반투명 dim 배경 + 흰 카드 + 빨강 원(체크) + "다음"/step명/부제 + 빨강 pill 버튼 + 빨강 정지 텍스트.
  private fun buildUI(): View {
    // 외곽 = 반투명 dim 배경 (= iOS sheet 측 검정 0.4 정합).
    val root = FrameLayout(this).apply {
      setBackgroundColor(Color.parseColor("#66000000"))
      setPadding(dp(24), dp(24), dp(24), dp(24))
    }

    // 흰 카드 = ActiveRoutineSection borderRadius 24 정합.
    val card = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER_HORIZONTAL
      val cardBg = GradientDrawable().apply {
        shape = GradientDrawable.RECTANGLE
        setColor(Color.WHITE)
        cornerRadius = dp(24).toFloat()
      }
      background = cardBg
      setPadding(dp(28), dp(40), dp(28), dp(32))
    }
    val cardParams = FrameLayout.LayoutParams(
      ViewGroup.LayoutParams.MATCH_PARENT,
      ViewGroup.LayoutParams.WRAP_CONTENT
    ).apply {
      gravity = Gravity.CENTER
    }
    root.addView(card, cardParams)

    // 가운데 빨강 원 + 흰 체크 (= MaterialIcons check 56 정합, Unicode ✓로 대체).
    val circle = TextView(this).apply {
      val circleBg = GradientDrawable().apply {
        shape = GradientDrawable.OVAL
        setColor(ACCENT_RED)
      }
      background = circleBg
      text = "✓"
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 48f)
      setTextColor(Color.WHITE)
      gravity = Gravity.CENTER
    }
    val circleSize = dp(112)
    val circleParams = LinearLayout.LayoutParams(circleSize, circleSize).apply {
      bottomMargin = dp(24)
    }
    card.addView(circle, circleParams)

    // "다음" (= confirm_prompt) 또는 "알람" (= 기타) 작은 회색 라벨.
    val prefixLabel = TextView(this).apply {
      text = if (alarmType == "confirm_prompt") "다음" else "알람"
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
      setTextColor(DIM_GRAY)
      gravity = Gravity.CENTER
      setPadding(0, 0, 0, dp(6))
    }
    card.addView(prefixLabel)

    // step 이름 / 알람 제목 = 28sp '800' onBackground.
    titleTextView = TextView(this).apply {
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 28f)
      setTypeface(typeface, android.graphics.Typeface.BOLD)
      setTextColor(ON_SURFACE)
      gravity = Gravity.CENTER
      setPadding(0, 0, 0, dp(16))
    }
    card.addView(titleTextView)
    refreshTitle()

    // 부제 = 14sp 회색.
    val question = TextView(this).apply {
      text = if (alarmType == "confirm_prompt") "다음 루틴 진행하겠습니까?" else "알람이 울리고 있습니다"
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
      setTextColor(DIM_GRAY)
      gravity = Gravity.CENTER
      setPadding(0, 0, 0, dp(24))
    }
    card.addView(question)

    // pill 버튼 = 빨강 + 흰 텍스트 + cornerRadius 14.
    stopButton = TextView(this).apply {
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
      setTypeface(typeface, android.graphics.Typeface.BOLD)
      setTextColor(Color.WHITE)
      gravity = Gravity.CENTER
      val pillBg = GradientDrawable().apply {
        shape = GradientDrawable.RECTANGLE
        setColor(ACCENT_RED)
        cornerRadius = dp(14).toFloat()
      }
      background = pillBg
      setPadding(0, dp(16), 0, dp(16))
      isClickable = true
      setOnClickListener { handleStop() }
    }
    val btnParams = LinearLayout.LayoutParams(
      ViewGroup.LayoutParams.MATCH_PARENT,
      ViewGroup.LayoutParams.WRAP_CONTENT
    ).apply {
      bottomMargin = dp(16)
    }
    card.addView(stopButton, btnParams)
    refreshStopButtonLabel()

    // 2026-06-01 — iOS = AlarmKit 알람 화면 측 = stopButton + secondaryButton 두 개만. "정지" UI 없음.
    //   iOS 정합 = AlarmAlertActivity 측도 "정지" 링크 제거. routine 정지 = 사용자 앱 진입 후 ActiveRoutineSection 측에서 처리.
    //   [[feedback_ios_is_standard]] 정합 = iOS에 없는 UI 절대 추가 금지.

    return root
  }

  private fun refreshTitle() {
    if (!::titleTextView.isInitialized) return
    val record = alarmId?.let { AlarmScheduler.get(this, it) }
    titleTextView.text = record?.title?.takeIf { it.isNotBlank() } ?: "알람"
  }

  private fun refreshStopButtonLabel() {
    if (!::stopButton.isInitialized) return
    // iOS 정합 = stopLabel / secondaryLabel 두 라벨만. "끄기 → 미션" 같은 분기 라벨 절대 금지.
    // 마지막 step ("루틴 완료") = secondaryLabel null → stopLabel ("확인") 표시. JS routineScheduler 측 isLastStep 분기 정합.
    val record = alarmId?.let { AlarmScheduler.get(this, it) }
    val secondaryLabel = record?.secondaryLabel?.takeIf { it.isNotBlank() }
    stopButton.text = if (alarmType == "confirm_prompt") {
      secondaryLabel ?: (record?.stopLabel?.takeIf { it.isNotBlank() } ?: "확인")
    } else {
      record?.stopLabel?.takeIf { it.isNotBlank() } ?: "끄기"
    }
  }

  // 끄기/다음 진행 액션 = iOS .foreground(.immediate) + .alwaysAllowed 정합.
  //   일반/미션 알람 ("끄기") = .foreground(.immediate) 정합 = SharedPreferences pending key 저장 + MainActivity launch + Face ID 요구.
  //   confirm_prompt ("다음 진행") = NextStepIntent .alwaysAllowed + .background 정합 = MainActivity launch X = Face ID 요구 X.
  //     2026-06-01 — 결함 수정: 직전 confirm_prompt 측도 MainActivity launch → Face ID 요구 → 인증 X 측 = 다음 step 진행 X 회귀.
  //     정정: AlarmActionReceiver ACTION_SECONDARY broadcast 측 routing (= JS alive → emit + cleanup, dead → advanceRoutineNative).
  //   JS RN 앱 시작 → AlarmkitBridgeModule.OnCreate → pending key read → emit (alerting | secondary_action).
  private fun handleStop() {
    val id = alarmId
    if (id == null) {
      NativeDebugLog.log(this, TAG, "handleStop — alarmId null, finish only")
      stopAlarmService()
      finish()
      return
    }

    // confirm_prompt "다음 진행" 측 = iOS NextStepIntent .alwaysAllowed + .background 정합.
    //   Face ID 요구 X = MainActivity launch X = AlarmActionReceiver broadcast 측 routing.
    //   AlarmActionReceiver 측 = JS alive → emit("secondary_action") + AlarmScheduler.cancel + stopService.
    //                          = JS dead → advanceRoutineNative (= SharedPreferences snapshot + 다음 step schedule).
    //   AlarmAlertActivity finish() = 잠금 화면 복귀. 다음 step fire 측 = singleInstance onNewIntent 측 재표시.
    if (alarmType == "confirm_prompt") {
      // 마지막 step ("루틴 완료") = secondaryLabel null → STOP broadcast (= routine 종료). JS dispatch Stop 측 routineClearedExternally 처리.
      // 그 외 confirm_prompt = SECONDARY broadcast (= "다음 진행" → JS dispatch Advance 측 routine 다음 step).
      val record = AlarmScheduler.get(this, id)
      val isLastStep = record?.secondaryLabel.isNullOrBlank()
      val broadcastAction = if (isLastStep) AlarmActionReceiver.ACTION_STOP else AlarmActionReceiver.ACTION_SECONDARY
      val broadcast = Intent(this, AlarmActionReceiver::class.java).apply {
        action = broadcastAction
        putExtra(AlarmScheduler.EXTRA_ALARM_ID, id)
      }
      sendBroadcast(broadcast)
      NativeDebugLog.log(this, TAG, "handleStop confirm_prompt → $broadcastAction broadcast alarmId=$id isLastStep=$isLastStep (Face ID 요구 X)")
      finish()
      return
    }

    // 일반/미션 알람 측 = "끄기" 측 = pending key + MainActivity launch + Face ID 요구.
    val prefs = getSharedPreferences(PREFS_PENDING, Context.MODE_PRIVATE)
    val editor = prefs.edit()
    editor.putString(KEY_PENDING_MISSION_ALARM_ID, id)
    editor.putString(KEY_PENDING_END_METHOD, endMethod)
    editor.apply()
    NativeDebugLog.log(this, TAG, "handleStop → pending key saved alarmId=$id endMethod=$endMethod type=$alarmType")

    stopAlarmService()

    // 잠금 해제 인증 → 인증 성공 시 자동으로 MainActivity launch.
    // 직전 = startActivity 직접 호출 → 잠금 화면 위에서 launch intent가 OS 측에 묻혀 사용자가 직접 앱 아이콘 눌러야 했던 회귀.
    // 정정 = KeyguardManager.requestDismissKeyguard → onDismissSucceeded 콜백에서 startActivity 호출.
    fun doLaunchMain() {
      val launch = packageManager.getLaunchIntentForPackage(packageName)
      if (launch != null) {
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        launch.putExtra("alerting_alarm_id", id)
        startActivity(launch)
        NativeDebugLog.log(this, TAG, "handleStop → MainActivity launch alarmId=$id")
      } else {
        NativeDebugLog.log(this, TAG, "handleStop FAIL — getLaunchIntentForPackage null")
      }
    }

    val km = getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager
    if (km != null && km.isKeyguardLocked && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      km.requestDismissKeyguard(this, object : KeyguardManager.KeyguardDismissCallback() {
        override fun onDismissSucceeded() {
          NativeDebugLog.log(this@AlarmAlertActivity, TAG, "keyguard dismiss success → MainActivity launch")
          doLaunchMain()
          finish()
        }
        override fun onDismissCancelled() {
          NativeDebugLog.log(this@AlarmAlertActivity, TAG, "keyguard dismiss cancelled — AlarmAlertActivity 유지")
        }
        override fun onDismissError() {
          NativeDebugLog.log(this@AlarmAlertActivity, TAG, "keyguard dismiss error → fallback startActivity")
          doLaunchMain()
          finish()
        }
      })
    } else {
      // 잠금 해제 상태 또는 SDK < O = 즉시 launch.
      doLaunchMain()
      finish()
    }
  }

  private fun stopAlarmService() {
    val svc = Intent(this, AlarmService::class.java)
    stopService(svc)
  }

  private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()
}
