// AlarmKit 브리지 모듈 (Android) — AlarmManager 기반 알람 엔진의 JS↔네이티브 진입점.
package expo.modules.alarmkitbridge

import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.util.UUID

// JS scheduleAlarm 파라미터 — Android는 알람 발화 필드만 사용 (la* 필드는 iOS Live Activity 전용 → 무시).
// Phase 3-3 (2026-05-26): secondaryLabel 측 추가. AlarmService 측 = FSI notification 측 secondary action button.
//   사용자 측 = 잠금화면 측 = secondary 버튼 탭 → AlarmActionReceiver → JS 측 "secondary_action" event.
//   routine confirm_prompt 측 "다음 진행" 측 = 본 path 측 = JS dispatch Advance 정합 (App.tsx 측 listener).
class ScheduleAlarmParams(
  @Field val entityId: String = "",
  @Field val title: String = "",
  @Field val fireAt: Double = 0.0,
  @Field val soundName: String? = null,
  @Field val type: String? = null,
  @Field val countdownTitle: String? = null,
  @Field val stopLabel: String? = null,
  @Field val secondaryLabel: String? = null,
  @Field val recurrence: Map<String, Any?>? = null,
  // 2026-05-31 — endMethod 전달 (= iOS 정합 = 미션 알람 잠금 해제 강제).
  //   'tap' = 일반 알람 (= 잠금 위 표시 가능)
  //   'shake' | 'camera' | 'math' | 'typing' | 'random' = 미션 알람 (= 잠금 해제 강제)
  //   null = 기본 'tap' 동작.
  @Field val endMethod: String? = null
) : Record

class AlarmkitBridgeModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("AlarmkitBridge")
    Events("onAlarmStateChange")

    // 모듈 생존 동안 AlarmService 발화 콜백 연결 — 발화 시 onAlarmStateChange emit (앱 살아있을 때).
    OnCreate {
      AlarmEventBus.listener = { alarmId, state ->
        sendEvent("onAlarmStateChange", mapOf("alarmId" to alarmId, "state" to state))
      }
      // 2026-05-31 — cold start 정합 (= AlarmAlertActivity 도입 후 필수).
      //   흐름: AlarmAlertActivity "끄기 → 미션" → SharedPreferences pending_mission_alarm_id 저장 + stopAlarmService + MainActivity launch
      //         → JS RN 앱 시작 → 본 OnCreate → pending 키 확인 → emit "alerting" → JS 알람 화면 mount.
      //   주의: stopAlarmService → AlarmService.onDestroy → clearAlerting → getAlertingId null이므로 별도 키 사용.
      try {
        val prefs = context.getSharedPreferences(
          AlarmAlertActivity.PREFS_PENDING,
          Context.MODE_PRIVATE
        )
        val pendingSecondaryId = prefs.getString(AlarmAlertActivity.KEY_PENDING_SECONDARY_ACTION_ID, null)
        val pendingMissionId = prefs.getString(AlarmAlertActivity.KEY_PENDING_MISSION_ALARM_ID, null)
        val pendingWidgetStopId = prefs.getString(AlarmAlertActivity.KEY_PENDING_WIDGET_STOP_ALARM_ID, null)
        if (pendingWidgetStopId != null) {
          // 2026-06-02 방안 B — 위젯 "정지" → MainActivity 직접 진입 cold start = emit "stop_action" → JS confirm modal.
          sendEvent("onAlarmStateChange", mapOf("alarmId" to pendingWidgetStopId, "state" to "stop_action"))
          prefs.edit().remove(AlarmAlertActivity.KEY_PENDING_WIDGET_STOP_ALARM_ID).apply()
        } else if (pendingSecondaryId != null) {
          // confirm_prompt "다음 진행" 우선 처리 (= JS dispatch Advance, routine 다음 step).
          sendEvent("onAlarmStateChange", mapOf("alarmId" to pendingSecondaryId, "state" to "secondary_action"))
          prefs.edit().remove(AlarmAlertActivity.KEY_PENDING_SECONDARY_ACTION_ID).apply()
        } else if (pendingMissionId != null) {
          // 미션 알람 = emit "alerting" → JS AlarmScreen mount.
          sendEvent("onAlarmStateChange", mapOf("alarmId" to pendingMissionId, "state" to "alerting"))
          prefs.edit()
            .remove(AlarmAlertActivity.KEY_PENDING_MISSION_ALARM_ID)
            .remove(AlarmAlertActivity.KEY_PENDING_END_METHOD)
            .apply()
        } else {
          // 폴백: AlarmAlertActivity 우회 경로(= 외부 trigger 등) 대비 = getAlertingId도 확인.
          val alertingId = AlarmScheduler.getAlertingId(context)
          if (alertingId != null) {
            sendEvent("onAlarmStateChange", mapOf("alarmId" to alertingId, "state" to "alerting"))
          }
        }
      } catch (e: Exception) {
        // context 미확보 등 silent skip
      }
    }
    OnDestroy {
      AlarmEventBus.listener = null
    }

    // ── 가용성 / 권한 ──
    Function("isAvailable") { true }

    AsyncFunction("getAuthorizationState") { authorizationState() }

    // Step 2 — 현재 상태 반환. POST_NOTIFICATIONS 런타임 요청은 온보딩(후속 Step)에서.
    AsyncFunction("requestAuthorization") { authorizationState() }

    // ── 알람 예약 / 취소 / 조회 ──
    // Phase 3-1: 항상 UUID 발급 (= iOS AlarmKit 패턴 정합).
    //   직전 = `entityId.ifBlank { UUID }` 측 = entityId 측 직접 alarmId 측 사용 →
    //     chain (= 같은 entityId 측 30개 schedule) 측 = firePendingIntent 측 `alarmId.hashCode()` 측 같음 →
    //     PendingIntent.FLAG_UPDATE_CURRENT 측 = 직전 측 덮어쓰기 → chain 측 1개만 잔존 회귀.
    //   정정 = 매 schedule 측 새 UUID 발급 → request code (hashCode) 측 unique 보장 → chain 측 30개 측 독립.
    //   호환 = JS 측 = `scheduleAlarm` 반환 id 측 받아 mapping table 측 alarmId 저장. entityId 측 별도 추적.
    AsyncFunction("scheduleAlarm") { params: ScheduleAlarmParams ->
      val id = UUID.randomUUID().toString()
      val recMode = params.recurrence?.get("mode") as? String ?: "never"
      val recDays = (params.recurrence?.get("days") as? List<*>)
        ?.mapNotNull { (it as? Number)?.toInt() } ?: emptyList()
      AlarmScheduler.schedule(
        context,
        AlarmScheduler.AlarmRecord(
          id = id,
          fireAt = params.fireAt.toLong(),
          title = params.title,
          soundName = params.soundName,
          type = params.type ?: "alarm_main",
          entityId = params.entityId,
          recurrenceMode = recMode,
          recurrenceDays = recDays,
          countdownTitle = params.countdownTitle,
          stopLabel = params.stopLabel,
          secondaryLabel = params.secondaryLabel,
          endMethod = params.endMethod
        )
      )
      id
    }

    AsyncFunction("cancelAlarm") { alarmId: String ->
      AlarmScheduler.cancel(context, alarmId)
      // 취소 대상이 발화 중이면 AlarmService(소리·진동)도 중단.
      if (AlarmScheduler.getAlertingId(context) == alarmId) stopAlarmService()
    }

    // 발화 중인 알람 정지 — 예약 취소 + AlarmService(소리·진동) 중단.
    // JS(AlarmScreen)가 alerting 알람에 호출. 정리(사운드·진동·볼륨·alerting)는 서비스 onDestroy가 수행.
    AsyncFunction("stopAlarm") { alarmId: String ->
      AlarmScheduler.cancel(context, alarmId)
      stopAlarmService()
    }

    AsyncFunction("listAlarms") {
      val alertingId = AlarmScheduler.getAlertingId(context)
      val active = AlarmScheduler.list(context).map { r ->
        mapOf(
          "id" to r.id,
          "state" to if (r.id == alertingId) "alerting" else "scheduled",
          "fixedFireMs" to r.fireAt.toDouble()
        )
      }
      // Phase 2-1: paused 알람 측 = state="paused" + 현 fireAt = now + remainingMs (= JS 측 표시 정합).
      val now = System.currentTimeMillis()
      val paused = AlarmScheduler.listPaused(context).map { p ->
        mapOf(
          "id" to p.record.id,
          "state" to "paused",
          "fixedFireMs" to (now + p.remainingMs).toDouble()
        )
      }
      active + paused
    }

    // ── Phase 2-1: 타이머 일시정지/재개 ──
    //   AlarmScheduler.pauseAlarm — native 측 예약 cancel + 잔여 시간 paused map 영속 + event emit("paused").
    //   AlarmScheduler.resumeAlarm — paused map 측 record + remainingMs 측 = now + remainingMs 측 새 fireAt 측 schedule.
    //   반환 = ms timestamp (= iOS 시그니처 정합). 실패 시 = 0.
    AsyncFunction("pauseAlarm") { alarmId: String ->
      val ts = AlarmScheduler.pauseAlarm(context, alarmId)
      if (ts > 0L) AlarmEventBus.emit(alarmId, "paused")
      ts.toDouble()
    }

    AsyncFunction("resumeAlarm") { alarmId: String ->
      val ts = AlarmScheduler.resumeAlarm(context, alarmId)
      if (ts > 0L) AlarmEventBus.emit(alarmId, "scheduled")
      ts.toDouble()
    }

    // 2026-06-01 — iOS App Group UserDefaults 1:1 정합 = Android SharedPreferences 기반 구현.
    //   JS 측 = native_debug_log_v1 / routine_snapshot / la_control_signal 등 = iOS와 같은 키로 read/write.
    //   직전 = stub (= 항상 false/null) → JS 측 native 데이터 접근 X.
    Function("writeAppGroupString") { key: String, value: String? ->
      val prefs = context.getSharedPreferences(APP_GROUP_PREFS, Context.MODE_PRIVATE)
      val editor = prefs.edit()
      if (value != null) editor.putString(key, value) else editor.remove(key)
      editor.apply()
      true
    }
    Function("readAppGroupString") { key: String ->
      context.getSharedPreferences(APP_GROUP_PREFS, Context.MODE_PRIVATE).getString(key, null)
    }
    Function("removeAppGroupKey") { key: String ->
      context.getSharedPreferences(APP_GROUP_PREFS, Context.MODE_PRIVATE).edit().remove(key).apply()
      true
    }
  }

  companion object {
    // iOS App Group 'group.com.shuttimer.app' 정합 = Android SharedPreferences 파일명.
    private const val APP_GROUP_PREFS = "shuttimer_app_group"
  }

  // 권한 상태 — 알림 권한 기준 (정확 알람은 USE_EXACT_ALARM으로 자동 부여).
  private fun authorizationState(): String {
    val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    return if (nm.areNotificationsEnabled()) "authorized" else "denied"
  }

  // 실행 중인 AlarmService 중단 → onDestroy에서 사운드·진동 정지, 볼륨 원복, alerting 클리어.
  private fun stopAlarmService() {
    context.stopService(Intent(context, AlarmService::class.java))
  }
}
