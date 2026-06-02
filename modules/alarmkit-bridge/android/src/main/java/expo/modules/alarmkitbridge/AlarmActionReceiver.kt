// AlarmService 측 FSI notification 측 secondary action button (= "다음 진행") 측 broadcast 수신.
//   2026-06-01 — iOS AdvanceNextStepIntent.perform 1:1 정합 = native 측 직접 routine 다음 step 진행.
//     직전 = JS emit + cancel + stopService만 → JS 죽으면 routine 진행 X 결함 #A.
//     정정 = SharedPreferences "routine_snapshot" read → 현재 alarm cancel → 다음 step AlarmRecord schedule → snapshot 갱신 → advance_done signal write.
//     iOS 측 = .alwaysAllowed + .background = Face ID 0 + 앱 진입 0 + native 직접 진행.
//     Android 측도 = Face ID 0 + 앱 진입 0 + native 직접 진행 (= 사용자 baseline 동작).
package expo.modules.alarmkitbridge

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import java.util.UUID
import org.json.JSONArray
import org.json.JSONObject

class AlarmActionReceiver : BroadcastReceiver() {
  companion object {
    const val ACTION_SECONDARY = "expo.modules.alarmkitbridge.SECONDARY_ACTION"
    // 2026-06-01 — 잠금화면 ongoing chronometer notification 측 액션 버튼 (= "정지") 추가.
    //   iOS LA 측 stop 액션 정합 = routine 진행 중 잠금화면 위젯에서 직접 routine 종료.
    //   JS alive = AlarmEventBus 측 emit("stop_action") → App.tsx 측 routineClearedExternally 처리.
    //   JS dead = native 측 = SharedPreferences la_control_signal {action:'stop'} write → 다음 active 시 ActionDispatcher onLAControlSignal 측 처리.
    const val ACTION_STOP = "expo.modules.alarmkitbridge.STOP_ACTION"
    // iOS LA 측 PauseRoutineIntent / ResumeRoutineIntent 정합.
    //   JS alive = emit("pause_action" / "resume_action") → App.tsx 측 listener 측 dispatchPause / dispatchResume.
    //   JS dead = SharedPreferences la_control_signal {action:'pause'/'resume', routineId} write → 다음 active 시 ActionDispatcher 측 처리.
    const val ACTION_PAUSE = "expo.modules.alarmkitbridge.PAUSE_ACTION"
    const val ACTION_RESUME = "expo.modules.alarmkitbridge.RESUME_ACTION"
    private const val TAG = "AlarmkitBridge"
    private const val APP_GROUP_PREFS = "shuttimer_app_group"
    private const val KEY_ROUTINE_SNAPSHOT = "routine_snapshot"
    private const val KEY_LA_CONTROL_SIGNAL = "la_control_signal"

    // iOS AdvanceNextStepIntent ADVANCE_DEBOUNCE_MS 1.5초 정합 = 중복 perform 차단.
    private const val ADVANCE_DEBOUNCE_MS = 1500L
    @Volatile private var lastAdvancePerformAt: MutableMap<String, Long> = mutableMapOf()
    private val advanceDebounceLock = Any()

    private fun shouldDebounceAdvance(entityId: String): Boolean {
      synchronized(advanceDebounceLock) {
        val now = System.currentTimeMillis()
        val last = lastAdvancePerformAt[entityId]
        if (last != null && now - last < ADVANCE_DEBOUNCE_MS) return true
        lastAdvancePerformAt[entityId] = now
        return false
      }
    }
  }

  override fun onReceive(context: Context, intent: Intent) {
    val alarmId = intent.getStringExtra(AlarmScheduler.EXTRA_ALARM_ID) ?: return
    val action = intent.action ?: return
    NativeDebugLog.log(context, TAG, "AlarmActionReceiver — action=$action alarmId=$alarmId")

    when (action) {
      ACTION_SECONDARY -> handleSecondary(context, alarmId)
      ACTION_STOP -> handleStop(context, alarmId)
      ACTION_PAUSE -> handlePauseResume(context, alarmId, isPause = true)
      ACTION_RESUME -> handlePauseResume(context, alarmId, isPause = false)
      else -> return
    }
  }

  // iOS LA PauseRoutineIntent / ResumeRoutineIntent 1:1 정합.
  //   iOS 측 = Intent.perform 측 자체 AlarmKit framework 측 pause/resume 호출 = native 측 자체 처리.
  //   Android 측도 = native 측 AlarmScheduler.pauseAlarm/resumeAlarm 측 직접 호출 = alarm cancel/reschedule + paused map 갱신 + 위젯 재렌더링.
  //   SessionController 측 source='la' 측 = PauseAlarmNative effect 생략 (= 이중 호출 방지) → 본 receiver 측 책임 = native 측 직접 처리.
  //
  // 2026-06-02 root cause fix — 직전 = emit/signal만 호출 → AlarmScheduler.pauseAlarm 측 호출 X →
  //   alarm cancel X + paused map 등록 X + ongoing notification 재렌더링 X → 위젯 일시정지 시각 변화 X 항의.
  //   정정 = native 측 pauseAlarm/resumeAlarm 측 먼저 호출 (= alarm cancel + paused 등록 + 위젯 isPaused=true 재렌더링) + 그 후 JS 측 emit/signal (= state 동기화).
  private fun handlePauseResume(context: Context, alarmId: String, isPause: Boolean) {
    // 1) native 측 alarm pause/resume 직접 호출 (= 위젯 상태 즉시 갱신).
    if (isPause) {
      val now = AlarmScheduler.pauseAlarm(context, alarmId)
      NativeDebugLog.log(context, TAG, "handlePauseResume — native pauseAlarm result=$now alarmId=$alarmId")
    } else {
      val now = AlarmScheduler.resumeAlarm(context, alarmId)
      NativeDebugLog.log(context, TAG, "handlePauseResume — native resumeAlarm result=$now alarmId=$alarmId")
    }

    // 2) JS 측 state 동기화 (= source='la' 측 reducer 측 paused 토글 + native effect 생략 정합).
    val prefs = context.getSharedPreferences(APP_GROUP_PREFS, Context.MODE_PRIVATE)
    val snapshotRaw = prefs.getString(KEY_ROUTINE_SNAPSHOT, null)
    val routineId = if (snapshotRaw != null) {
      try { JSONObject(snapshotRaw).optString("routineId", "") } catch (_: Exception) { "" }
    } else ""

    val eventState = if (isPause) "pause_action" else "resume_action"
    val signalAction = if (isPause) "pause" else "resume"

    if (AlarmEventBus.listener != null) {
      NativeDebugLog.log(context, TAG, "$eventState — JS alive, emit routineId=$routineId")
      AlarmEventBus.emit(alarmId, eventState)
    } else {
      NativeDebugLog.log(context, TAG, "$eventState — JS dead, native signal write routineId=$routineId")
      val signal = JSONObject().apply {
        put("action", signalAction)
        put("timestamp", System.currentTimeMillis().toDouble())
        put("routineId", routineId)
      }
      prefs.edit().putString(KEY_LA_CONTROL_SIGNAL, signal.toString()).apply()
    }
  }

  // "다음 진행" 액션 = 알람 모달 측 + 잠금화면 ongoing chronometer notification 측 양쪽 사용.
  //   race 회피 = JS 살아있으면 JS dispatch Advance만 routine 진행 (= 새 alarm schedule).
  //   JS 죽으면 native 직접.
  //     주의 = JS 측 onAlarmStateChange "secondary_action" 처리 코멘트: "alarm cancel + service stop = native 이미 처리".
  //     따라서 JS 살아있을 때도 = emit + AlarmScheduler.cancel + stopService 측 native cleanup 필수.
  private fun handleSecondary(context: Context, alarmId: String) {
    if (AlarmEventBus.listener != null) {
      NativeDebugLog.log(context, TAG, "secondary_action — JS alive, emit + cleanup (= JS dispatch Advance가 routine 진행)")
      AlarmEventBus.emit(alarmId, "secondary_action")
      AlarmScheduler.cancel(context, alarmId)
      context.stopService(Intent(context, AlarmService::class.java))
    } else {
      NativeDebugLog.log(context, TAG, "secondary_action — JS dead, native 직접 routine 진행")
      advanceRoutineNative(context, alarmId)
    }
  }

  // 2026-06-01 — "정지" 액션 = 잠금화면 ongoing chronometer notification 측 "정지" 버튼 측.
  //   JS alive = emit("stop_action") → App.tsx 측 onAlarmStateChange listener 측 routine stop dispatch.
  //   JS dead = SharedPreferences la_control_signal {action:'stop', routineId} write → 다음 active 시 ActionDispatcher 측 처리.
  //   양쪽 = AlarmScheduler.cancel + stopService 측 native cleanup + ongoing chronometer notification 측 자동 cancel.
  private fun handleStop(context: Context, alarmId: String) {
    val prefs = context.getSharedPreferences(APP_GROUP_PREFS, Context.MODE_PRIVATE)
    val snapshotRaw = prefs.getString(KEY_ROUTINE_SNAPSHOT, null)
    val routineId = if (snapshotRaw != null) {
      try { JSONObject(snapshotRaw).optString("routineId", "") } catch (_: Exception) { "" }
    } else ""

    if (AlarmEventBus.listener != null) {
      NativeDebugLog.log(context, TAG, "stop_action — JS alive, emit + cleanup routineId=$routineId")
      AlarmEventBus.emit(alarmId, "stop_action")
    } else {
      NativeDebugLog.log(context, TAG, "stop_action — JS dead, native signal write routineId=$routineId")
      val signal = JSONObject().apply {
        put("action", "stop")
        put("timestamp", System.currentTimeMillis().toDouble())
        put("routineId", routineId)
      }
      prefs.edit().putString(KEY_LA_CONTROL_SIGNAL, signal.toString()).apply()
    }

    // 2026-06-02 — 사용자 항의 fix: 위젯 "정지" 즉시 누름 = 위젯 사라짐 = 실수 클릭 측 routine 종료 회귀.
    //   정정 = native 측 cancel/stopService 호출 X = 위젯 + alarm 그대로 유지.
    //   대신 = 앱 진입 + confirmation modal 표시 (= "종료하시겠습니까?" / [취소, 종료]).
    //   사용자 "종료" 선택 시 = JS 측 dispatch Stop → reducer effect → AlarmkitBridge.cancelAlarm + stopService 측 정리.
    //   사용자 "취소" 선택 시 = modal 닫기 + routine + 위젯 그대로.
    //
    // AlarmAlertActivity launchMainOnly mode 측 trigger = 잠금 시 KeyguardManager dismiss → 패턴/지문/Face ID 인증 → MainActivity launch + finish.
    // 잠금 해제 시 = 즉시 MainActivity launch.
    val launchIntent = Intent(context, AlarmAlertActivity::class.java).apply {
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      putExtra(AlarmAlertActivity.EXTRA_LAUNCH_MAIN_ONLY, true)
    }
    try {
      context.startActivity(launchIntent)
      NativeDebugLog.log(context, TAG, "stop_action → AlarmAlertActivity launchMainOnly trigger (= 앱 진입 + confirm modal 대기)")
    } catch (e: Exception) {
      NativeDebugLog.log(context, TAG, "stop_action — AlarmAlertActivity launchMainOnly FAIL: $e")
    }
  }

  // iOS AdvanceNextStepIntent.perform Swift 1:1 정합 Kotlin 구현.
  private fun advanceRoutineNative(context: Context, alarmId: String) {
    val prefs = context.getSharedPreferences(APP_GROUP_PREFS, Context.MODE_PRIVATE)
    val snapshotRaw = prefs.getString(KEY_ROUTINE_SNAPSHOT, null)
    if (snapshotRaw == null) {
      NativeDebugLog.log(context, TAG, "advanceRoutineNative — snapshot null, fallback signal only")
      writeAdvanceFallbackSignal(prefs, "")
      cleanupAlarm(context, alarmId)
      return
    }

    val snapshot = try {
      JSONObject(snapshotRaw)
    } catch (e: Exception) {
      NativeDebugLog.log(context, TAG, "advanceRoutineNative — snapshot parse fail: $e")
      writeAdvanceFallbackSignal(prefs, "")
      cleanupAlarm(context, alarmId)
      return
    }

    val routineId = snapshot.optString("routineId", "")
    if (shouldDebounceAdvance(routineId.ifEmpty { "__empty__" })) {
      NativeDebugLog.log(context, TAG, "advanceRoutineNative — debounce skip routineId=$routineId")
      return
    }

    val currentAlarmId = snapshot.optString("currentAlarmId", "")
    if (currentAlarmId.isNotEmpty()) {
      AlarmScheduler.cancel(context, currentAlarmId)
    }
    // 현재 fire alarm record 측도 cancel (= alarmId == currentAlarmId 같은 경우 = no-op, 다르면 cleanup).
    if (alarmId != currentAlarmId) {
      AlarmScheduler.cancel(context, alarmId)
    }
    context.stopService(Intent(context, AlarmService::class.java))

    val completedIdx = snapshot.optInt("currentStepIndex", 0)
    val nextIdx = completedIdx + 1
    val totalSteps = snapshot.optInt("totalSteps", 0)

    // 마지막 step 도달 = routineEnded=true 표시 + signal write (= RN sync가 cleanup).
    if (nextIdx >= totalSteps) {
      val completedArr = snapshot.optJSONArray("completedStepIndices") ?: JSONArray()
      completedArr.put(completedIdx)
      snapshot.put("completedStepIndices", completedArr)
      snapshot.put("routineEnded", true)
      snapshot.put("savedAt", System.currentTimeMillis().toDouble())
      prefs.edit().putString(KEY_ROUTINE_SNAPSHOT, snapshot.toString()).apply()
      writeAdvanceDoneSignal(prefs, routineId)
      NativeDebugLog.log(context, TAG, "advanceRoutineNative — last step reached, routineEnded routineId=$routineId")
      return
    }

    // 다음 step alarm schedule (= iOS scheduleNextStepAlarm 1:1 정합).
    val steps = snapshot.optJSONArray("steps") ?: JSONArray()
    if (nextIdx >= steps.length()) {
      writeAdvanceFallbackSignal(prefs, routineId)
      NativeDebugLog.log(context, TAG, "advanceRoutineNative — nextIdx out of bounds, fallback signal")
      return
    }

    val nextStep = steps.getJSONObject(nextIdx)
    val nextStepName = nextStep.optString("name", "")
    val nextStepDurationSec = nextStep.optDouble("durationSec", 0.0)
    val nextStepSoundName = nextStep.optString("soundName", "")

    val isLastStep = nextIdx + 1 >= totalSteps
    val confirmPromptTitle = snapshot.optString("i18nConfirmPromptTitle", "다음 루틴")
    val routineCompleteTitle = snapshot.optString("i18nRoutineCompleteTitle", "루틴 완료")
    val advanceLabel = snapshot.optString("i18nAdvanceLabel", "다음 진행")
    val confirmPromptStop = snapshot.optString("i18nConfirmPromptStop", "정지")

    val alertTitle: String = if (isLastStep) {
      routineCompleteTitle
    } else {
      val nextNextStepName = steps.optJSONObject(nextIdx + 1)?.optString("name", "") ?: ""
      "$confirmPromptTitle $nextNextStepName".trim()
    }

    val newAlarmId = UUID.randomUUID().toString()
    val nowMs = System.currentTimeMillis()
    val durationMs = (nextStepDurationSec * 1000.0).toLong().coerceAtLeast(1L)

    val newRecord = AlarmScheduler.AlarmRecord(
      id = newAlarmId,
      fireAt = nowMs + durationMs,
      title = alertTitle,
      soundName = if (nextStepSoundName.isNotEmpty()) nextStepSoundName else null,
      type = "confirm_prompt",
      entityId = routineId,
      recurrenceMode = "never",
      recurrenceDays = emptyList(),
      countdownTitle = alertTitle,
      stopLabel = confirmPromptStop,
      secondaryLabel = if (isLastStep) null else advanceLabel,
      endMethod = null
    )
    AlarmScheduler.schedule(context, newRecord)

    // snapshot 갱신.
    val completedArr = snapshot.optJSONArray("completedStepIndices") ?: JSONArray()
    completedArr.put(completedIdx)
    snapshot.put("completedStepIndices", completedArr)
    snapshot.put("currentStepIndex", nextIdx)
    snapshot.put("currentAlarmId", newAlarmId)
    snapshot.put("stepEndAt", (nowMs + durationMs).toDouble())
    snapshot.put("savedAt", nowMs.toDouble())
    prefs.edit().putString(KEY_ROUTINE_SNAPSHOT, snapshot.toString()).apply()

    writeAdvanceDoneSignal(prefs, routineId)
    NativeDebugLog.log(context, TAG, "advanceRoutineNative — next step scheduled idx=$nextIdx alarmId=$newAlarmId")
  }

  private fun cleanupAlarm(context: Context, alarmId: String) {
    AlarmScheduler.cancel(context, alarmId)
    context.stopService(Intent(context, AlarmService::class.java))
  }

  private fun writeAdvanceDoneSignal(prefs: android.content.SharedPreferences, routineId: String) {
    val signal = JSONObject().apply {
      put("action", "advance_done")
      put("timestamp", System.currentTimeMillis().toDouble())
      put("routineId", routineId)
    }
    prefs.edit().putString(KEY_LA_CONTROL_SIGNAL, signal.toString()).apply()
  }

  private fun writeAdvanceFallbackSignal(prefs: android.content.SharedPreferences, routineId: String) {
    val signal = JSONObject().apply {
      put("action", "advance")
      put("timestamp", System.currentTimeMillis().toDouble())
      put("routineId", routineId)
    }
    prefs.edit().putString(KEY_LA_CONTROL_SIGNAL, signal.toString()).apply()
  }
}
