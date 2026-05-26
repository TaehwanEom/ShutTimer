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
          secondaryLabel = params.secondaryLabel
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

  // 실행 중인 AlarmService 중단 → onDestroy에서 사운드·진동 정지, 볼륨 원복, alerting 클리어.
  private fun stopAlarmService() {
    context.stopService(Intent(context, AlarmService::class.java))
  }
}
