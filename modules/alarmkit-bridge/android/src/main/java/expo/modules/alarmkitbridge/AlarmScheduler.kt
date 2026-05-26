// 알람 예약/취소 + 영속 저장 — AlarmManager.setAlarmClock 래퍼. 재부팅 복원(Step 6)을 위해 SharedPreferences에 알람 정의 미러링.
// Phase 2-1: pause/resume 측 = paused map 측 별도 영속 (cancel 측 alarm 측 = 잔여 시간 + record 측 보존).
// Phase 2-2: type='timer_main' 측 = 잠금화면 측 ongoing chronometer notification (= iOS Live Activity 측 대응물).
// Phase 3-2: 반복 알람 측 = 발화 시 다음 occurrence 측 재예약 로직 (AlarmReceiver 측 호출).
package expo.modules.alarmkitbridge

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import java.util.Calendar
import org.json.JSONArray
import org.json.JSONObject

object AlarmScheduler {
  const val EXTRA_ALARM_ID = "alarmkit_alarm_id"
  private const val PREFS_NAME = "alarmkit_bridge_alarms"
  private const val KEY_ALARMS = "alarms"
  private const val KEY_ALERTING = "alerting_id"
  private const val KEY_PAUSED = "paused_alarms"
  // Phase 2-2: ongoing chronometer notification 측 채널/ID.
  //   채널 = IMPORTANCE_LOW (= 소리 X, 진동 X, 그러나 잠금화면 측 표시).
  //   ID = alarmId.hashCode() 측 짝수화 (= AlarmService FSI 측 NOTIF_ID=0xA1A2 측 충돌 회피).
  private const val ONGOING_CHANNEL_ID = "alarmkit_timer_progress"

  // 알람 한 건의 영속 정의.
  data class AlarmRecord(
    val id: String,
    val fireAt: Long,
    val title: String,
    val soundName: String?,
    val type: String,
    val entityId: String,
    val recurrenceMode: String,
    val recurrenceDays: List<Int>,
    val countdownTitle: String?,
    val stopLabel: String?,
    // Phase 3-3: AlarmService 측 FSI notification 측 secondary action button label.
    //   null = secondary 측 표시 X. 비어있지 않은 값 측 = "다음 진행" 측 routine 측 사용.
    val secondaryLabel: String? = null
  )

  // Phase 2-1: 일시정지 상태 알람 — 잔여 시간 + 원본 record 보존. resume 시 = now + remainingMs 측 재예약.
  data class PausedAlarm(
    val record: AlarmRecord,
    val remainingMs: Long,
    val pausedAt: Long
  )

  // ── 예약 / 취소 / 조회 ──

  fun schedule(context: Context, record: AlarmRecord) {
    persistUpsert(context, record)
    val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    val info = AlarmManager.AlarmClockInfo(record.fireAt, showIntent(context))
    am.setAlarmClock(info, firePendingIntent(context, record.id))
    // Phase 2-2: timer_main 측 = 잠금화면 측 ongoing chronometer notification 표시.
    if (record.type == "timer_main") {
      startOngoingTimerNotification(context, record)
    }
  }

  fun cancel(context: Context, alarmId: String) {
    val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    am.cancel(firePendingIntent(context, alarmId))
    persistRemove(context, alarmId)
    // Phase 2-1: paused 상태 측도 함께 정리 (= 사용자 측 = pause 후 cancel 호출 시 잔존 영구화 회피).
    pausedRemove(context, alarmId)
    // Phase 2-2: ongoing chronometer 측 정리 (= type 검사 없이 항상 호출 — notify 측 ID 없을 시 no-op).
    stopOngoingTimerNotification(context, alarmId)
  }

  fun list(context: Context): List<AlarmRecord> = readAll(context)

  fun get(context: Context, alarmId: String): AlarmRecord? =
    readAll(context).firstOrNull { it.id == alarmId }

  // ── Phase 2-1: pause / resume ──

  /**
   * 알람 일시정지 — native 측 예약 cancel + 잔여 시간 + 원본 record 측 paused map 측 영속.
   * 반환 = pause 호출 시점 ms (= JS 측 = pause 시점 측정용). 실패 시 = 0.
   * cancel 측 = persistRemove + pausedRemove 둘 다 호출하므로 본 함수 측 = readAllPaused 측 직접 put.
   */
  fun pauseAlarm(context: Context, alarmId: String): Long {
    val record = get(context, alarmId) ?: return 0L
    val now = System.currentTimeMillis()
    val remainingMs = (record.fireAt - now).coerceAtLeast(0L)
    val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    am.cancel(firePendingIntent(context, alarmId))
    persistRemove(context, alarmId)
    pausedUpsert(context, PausedAlarm(record, remainingMs, now))
    // Phase 2-2: pause 시 ongoing chronometer 측 제거 (= resume 시 새 fireAt 측 schedule → ongoing 재시작).
    stopOngoingTimerNotification(context, alarmId)
    return now
  }

  /**
   * 알람 재개 — paused map 측 record 측 lookup + now + remainingMs 측 새 fireAt 측 schedule.
   * 반환 = resume 호출 시점 ms. 실패 시 = 0.
   */
  fun resumeAlarm(context: Context, alarmId: String): Long {
    val paused = pausedGet(context, alarmId) ?: return 0L
    val now = System.currentTimeMillis()
    val newFireAt = now + paused.remainingMs
    pausedRemove(context, alarmId)
    schedule(context, paused.record.copy(fireAt = newFireAt))
    return now
  }

  fun listPaused(context: Context): List<PausedAlarm> = readAllPaused(context)

  fun pausedGet(context: Context, alarmId: String): PausedAlarm? =
    readAllPaused(context).firstOrNull { it.record.id == alarmId }

  // ── Phase 3-2: 반복 알람 측 다음 occurrence 재예약 ──

  /**
   * AlarmReceiver 측 fire 직후 호출. record.recurrenceMode != "never" 시 = 다음 occurrence 측 setAlarmClock 재예약.
   * once 측 = no-op. daily 측 = +1일. weekly 측 = recurrenceDays 측 다음 요일 (0=일~6=토).
   */
  fun scheduleNextOccurrenceIfNeeded(context: Context, alarmId: String) {
    val record = get(context, alarmId) ?: return
    if (record.recurrenceMode == "never") return
    val nextFireAt = computeNextOccurrence(record) ?: return
    schedule(context, record.copy(fireAt = nextFireAt))
  }

  // 다음 occurrence 시각 산출. daily 측 = +1일. weekly 측 = recurrenceDays 측 다음 요일 (= 같은 시/분 측 유지).
  private fun computeNextOccurrence(record: AlarmRecord): Long? {
    val cal = Calendar.getInstance().apply { timeInMillis = record.fireAt }
    when (record.recurrenceMode) {
      "daily" -> {
        cal.add(Calendar.DAY_OF_YEAR, 1)
        return cal.timeInMillis
      }
      "weekly" -> {
        // 요일 비어 있으면 = 매주 같은 요일 (= +7일).
        if (record.recurrenceDays.isEmpty()) {
          cal.add(Calendar.DAY_OF_YEAR, 7)
          return cal.timeInMillis
        }
        // Calendar.SUNDAY=1, recurrenceDays 측 convention = 0=일~6=토 → -1 변환.
        val nowDow = cal.get(Calendar.DAY_OF_WEEK) - 1
        val sortedDays = record.recurrenceDays.sorted()
        // 오늘 이후 첫 요일. 없으면 = 다음 주 첫 요일 (= +7).
        val nextDayInWeek = sortedDays.firstOrNull { it > nowDow }
        val offset = if (nextDayInWeek != null) nextDayInWeek - nowDow else (7 - nowDow) + sortedDays.first()
        cal.add(Calendar.DAY_OF_YEAR, offset)
        return cal.timeInMillis
      }
      else -> return null
    }
  }

  // ── 발화 중(alerting) 상태 — AlarmService가 set/clear, listAlarms·콜드스타트가 조회 ──

  fun setAlerting(context: Context, alarmId: String) {
    prefs(context).edit().putString(KEY_ALERTING, alarmId).apply()
  }

  fun clearAlerting(context: Context) {
    prefs(context).edit().remove(KEY_ALERTING).apply()
  }

  fun getAlertingId(context: Context): String? = prefs(context).getString(KEY_ALERTING, null)

  // ── 재부팅 복원 ──

  // 재부팅 후 호출 (BootReceiver) — AlarmManager 예약은 재부팅 시 전부 소실되므로,
  // 영속된 레코드 중 아직 미래(fireAt > now)인 알람을 다시 등록. 과거 건은 영속에서 정리.
  fun rescheduleAllFromBoot(context: Context): Int {
    val now = System.currentTimeMillis()
    val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    val survivors = mutableListOf<AlarmRecord>()
    for (record in readAll(context)) {
      if (record.fireAt > now) {
        am.setAlarmClock(
          AlarmManager.AlarmClockInfo(record.fireAt, showIntent(context)),
          firePendingIntent(context, record.id)
        )
        survivors.add(record)
      }
      // fireAt <= now = 다운타임 중 놓친 알람 → 재등록 안 함 (survivors 제외 = 영속 정리).
    }
    writeAll(context, survivors)
    clearAlerting(context)  // 재부팅 = 발화 중인 알람 없음.
    return survivors.size
  }

  // ── PendingIntent ──

  // 발화용 — AlarmReceiver로 broadcast.
  private fun firePendingIntent(context: Context, alarmId: String): PendingIntent {
    val intent = Intent(context, AlarmReceiver::class.java).apply {
      putExtra(EXTRA_ALARM_ID, alarmId)
    }
    return PendingIntent.getBroadcast(
      context, alarmId.hashCode(), intent,
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
    )
  }

  // setAlarmClock의 show intent — 상태바 알람 아이콘 탭 시 앱 실행.
  private fun showIntent(context: Context): PendingIntent {
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: Intent()
    return PendingIntent.getActivity(
      context, 0, launch,
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
    )
  }

  // ── SharedPreferences 영속 (JSON) ──

  private fun prefs(context: Context) =
    context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

  private fun persistUpsert(context: Context, record: AlarmRecord) {
    writeAll(context, readAll(context).filter { it.id != record.id } + record)
  }

  private fun persistRemove(context: Context, alarmId: String) {
    writeAll(context, readAll(context).filter { it.id != alarmId })
  }

  private fun readAll(context: Context): List<AlarmRecord> {
    val raw = prefs(context).getString(KEY_ALARMS, null) ?: return emptyList()
    return try {
      val arr = JSONArray(raw)
      (0 until arr.length()).map { fromJson(arr.getJSONObject(it)) }
    } catch (e: Exception) {
      emptyList()
    }
  }

  private fun writeAll(context: Context, records: List<AlarmRecord>) {
    val arr = JSONArray()
    records.forEach { arr.put(toJson(it)) }
    prefs(context).edit().putString(KEY_ALARMS, arr.toString()).apply()
  }

  private fun toJson(r: AlarmRecord): JSONObject = JSONObject().apply {
    put("id", r.id)
    put("fireAt", r.fireAt)
    put("title", r.title)
    if (r.soundName != null) put("soundName", r.soundName)
    put("type", r.type)
    put("entityId", r.entityId)
    put("recurrenceMode", r.recurrenceMode)
    put("recurrenceDays", JSONArray(r.recurrenceDays))
    if (r.countdownTitle != null) put("countdownTitle", r.countdownTitle)
    if (r.stopLabel != null) put("stopLabel", r.stopLabel)
    if (r.secondaryLabel != null) put("secondaryLabel", r.secondaryLabel)
  }

  private fun fromJson(o: JSONObject): AlarmRecord {
    val daysArr = o.optJSONArray("recurrenceDays") ?: JSONArray()
    return AlarmRecord(
      id = o.getString("id"),
      fireAt = o.getLong("fireAt"),
      title = o.optString("title", ""),
      soundName = if (o.has("soundName") && !o.isNull("soundName")) o.getString("soundName") else null,
      type = o.optString("type", "alarm_main"),
      entityId = o.optString("entityId", ""),
      recurrenceMode = o.optString("recurrenceMode", "never"),
      recurrenceDays = (0 until daysArr.length()).map { daysArr.getInt(it) },
      countdownTitle = if (o.has("countdownTitle") && !o.isNull("countdownTitle")) o.getString("countdownTitle") else null,
      stopLabel = if (o.has("stopLabel") && !o.isNull("stopLabel")) o.getString("stopLabel") else null,
      secondaryLabel = if (o.has("secondaryLabel") && !o.isNull("secondaryLabel")) o.getString("secondaryLabel") else null
    )
  }

  // ── Phase 2-1: paused map SharedPreferences 영속 (JSON) ──

  private fun readAllPaused(context: Context): List<PausedAlarm> {
    val raw = prefs(context).getString(KEY_PAUSED, null) ?: return emptyList()
    return try {
      val arr = JSONArray(raw)
      (0 until arr.length()).map { pausedFromJson(arr.getJSONObject(it)) }
    } catch (e: Exception) {
      emptyList()
    }
  }

  private fun writeAllPaused(context: Context, items: List<PausedAlarm>) {
    val arr = JSONArray()
    items.forEach { arr.put(pausedToJson(it)) }
    prefs(context).edit().putString(KEY_PAUSED, arr.toString()).apply()
  }

  private fun pausedUpsert(context: Context, item: PausedAlarm) {
    writeAllPaused(context, readAllPaused(context).filter { it.record.id != item.record.id } + item)
  }

  private fun pausedRemove(context: Context, alarmId: String) {
    writeAllPaused(context, readAllPaused(context).filter { it.record.id != alarmId })
  }

  private fun pausedToJson(p: PausedAlarm): JSONObject = JSONObject().apply {
    put("record", toJson(p.record))
    put("remainingMs", p.remainingMs)
    put("pausedAt", p.pausedAt)
  }

  private fun pausedFromJson(o: JSONObject): PausedAlarm = PausedAlarm(
    record = fromJson(o.getJSONObject("record")),
    remainingMs = o.getLong("remainingMs"),
    pausedAt = o.getLong("pausedAt")
  )

  // ── Phase 2-2: ongoing chronometer notification (= timer_main 측 잠금화면 카운트다운) ──

  /**
   * type='timer_main' 측 schedule 시 호출. 잠금화면 + 알림창 측 = 남은 시간 카운트다운 표시.
   * 채널 = LOW priority (= 소리/진동 X). chronometer countdown = setWhen(fireAt) + setChronometerCountDown(true).
   * 사용자 측 = 알림 측 long press 측 = "Hide" 측 = 채널 측 권한 측 = 시스템 측 제어.
   */
  fun startOngoingTimerNotification(context: Context, record: AlarmRecord) {
    if (record.type != "timer_main") return
    val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = NotificationChannel(
        ONGOING_CHANNEL_ID, "Timer countdown", NotificationManager.IMPORTANCE_LOW
      ).apply {
        setSound(null, null)
        enableVibration(false)
        lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        setShowBadge(false)
      }
      nm.createNotificationChannel(channel)
    }
    // 알림 탭 시 = MainActivity 진입.
    val launch = (context.packageManager.getLaunchIntentForPackage(context.packageName) ?: Intent()).apply {
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }
    val pending = PendingIntent.getActivity(
      context, 0, launch,
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
    )
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(context, ONGOING_CHANNEL_ID)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(context)
    }
    builder
      .setContentTitle(record.title.replace("\n", " "))
      .setSmallIcon(context.applicationInfo.icon)
      .setCategory(Notification.CATEGORY_STOPWATCH)
      .setOngoing(true)
      .setAutoCancel(false)
      .setUsesChronometer(true)
      .setVisibility(Notification.VISIBILITY_PUBLIC)
      .setShowWhen(true)
      .setWhen(record.fireAt)
      .setContentIntent(pending)
    // setChronometerCountDown = API 24+ 측 지원 (= chronometer 측 fireAt 측 향해 카운트다운).
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
      builder.setChronometerCountDown(true)
    }
    nm.notify(ongoingNotifId(record.id), builder.build())
  }

  fun stopOngoingTimerNotification(context: Context, alarmId: String) {
    try {
      val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      nm.cancel(ongoingNotifId(alarmId))
    } catch (_: Exception) {}
  }

  // ongoing notification ID 측 = alarmId.hashCode() 측 짝수화 (= FSI NOTIF_ID=0xA1A2 측 충돌 회피).
  //   AlarmService 측 FSI ID 측 = 모든 알람 측 공용 단일 ID (= 동시 alerting 1개 가정 정합).
  //   ongoing 측 = 각 timer 측 별도 ID 필요 (= timer 측 동시 1개 가정이지만 safe하게 hash 기반).
  private fun ongoingNotifId(alarmId: String): Int {
    val h = alarmId.hashCode() and 0x7FFFFFFE
    return if (h == 0xA1A2) h or 2 else h  // FSI 측 ID 측 충돌 회피
  }
}
