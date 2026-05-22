// AlarmKit 브리지 모듈 (Android) — AlarmManager 기반 알람 엔진의 JS↔네이티브 진입점.
package expo.modules.alarmkitbridge

import android.app.NotificationManager
import android.content.Context
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.util.UUID

// JS scheduleAlarm 파라미터 — Android는 알람 발화 필드만 사용 (la* 필드는 iOS Live Activity 전용 → 무시).
class ScheduleAlarmParams(
  @Field val entityId: String = "",
  @Field val title: String = "",
  @Field val fireAt: Double = 0.0,
  @Field val soundName: String? = null,
  @Field val type: String? = null,
  @Field val countdownTitle: String? = null,
  @Field val stopLabel: String? = null,
  @Field val recurrence: Map<String, Any?>? = null
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
    AsyncFunction("scheduleAlarm") { params: ScheduleAlarmParams ->
      val id = params.entityId.ifBlank { UUID.randomUUID().toString() }
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
          stopLabel = params.stopLabel
        )
      )
      id
    }

    AsyncFunction("cancelAlarm") { alarmId: String ->
      AlarmScheduler.cancel(context, alarmId)
    }

    // Step 3에서 alerting 서비스 중단 로직 추가. 현재는 예약 취소와 동일.
    AsyncFunction("stopAlarm") { alarmId: String ->
      AlarmScheduler.cancel(context, alarmId)
    }

    AsyncFunction("listAlarms") {
      val alertingId = AlarmScheduler.getAlertingId(context)
      AlarmScheduler.list(context).map { r ->
        mapOf(
          "id" to r.id,
          "state" to if (r.id == alertingId) "alerting" else "scheduled",
          "fixedFireMs" to r.fireAt.toDouble()
        )
      }
    }

    // ── Phase 2 예정 (타이머 일시정지/재개) — 현재 no-op ──
    AsyncFunction("pauseAlarm") { _: String -> 0.0 }
    AsyncFunction("resumeAlarm") { _: String -> 0.0 }

    // ── iOS App Group 전용 — Android no-op ──
    Function("writeAppGroupString") { _: String, _: String? -> false }
    Function("readAppGroupString") { _: String -> null as String? }
    Function("removeAppGroupKey") { _: String -> false }
  }

  // 권한 상태 — 알림 권한 기준 (정확 알람은 USE_EXACT_ALARM으로 자동 부여).
  private fun authorizationState(): String {
    val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    return if (nm.areNotificationsEnabled()) "authorized" else "denied"
  }
}
