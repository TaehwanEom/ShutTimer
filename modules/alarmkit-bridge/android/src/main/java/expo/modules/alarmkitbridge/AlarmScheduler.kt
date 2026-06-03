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
import android.os.SystemClock
import android.widget.RemoteViews
import java.util.Calendar
import org.json.JSONArray
import org.json.JSONObject

object AlarmScheduler {
  const val EXTRA_ALARM_ID = "alarmkit_alarm_id"
  // 2026-06-02 — 위젯 "정지" → 앱 진입 방식 토글.
  //   "A" = AlarmAlertActivity launchMainOnly (보이는 창 확보 후 MainActivity launch).
  //   "B" = MainActivity 직접 launch (= 알림 PendingIntent 1차 hop만 사용 → 2차 startActivity BAL 차단 회피).
  const val WIDGET_STOP_MODE = "B"
  const val EXTRA_WIDGET_STOP_ALARM_ID = "widget_stop_alarm_id"
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
    val secondaryLabel: String? = null,
    // 2026-05-31 — endMethod (= iOS 정합 = 미션 알람 잠금 해제 강제).
    //   'tap' / null = 일반 알람. 그 외 = 미션 알람 = MainActivity 측 KeyguardManager 호출.
    val endMethod: String? = null
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
    // 잠금화면 측 ongoing chronometer notification 표시 (= iOS Live Activity 대응).
    //   timer_main = 단일 타이머. confirm_prompt = routine step 진행 중 잔여 시간 위젯.
    //   2026-06-01: confirm_prompt 측 추가 (= routine 측 잠금화면 잔여 타이머 위젯 차단 결함 해소).
    if (record.type == "timer_main" || record.type == "confirm_prompt") {
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
    // 2026-06-02 — iOS LA 정합 = pause 시 위젯 유지 + paused 상태 재렌더링.
    //   직전 = stopOngoingTimerNotification 호출 → 위젯 사라짐 → 사용자 시각 "일시정지 안 됨" 항의.
    //   정정 = paused map 등록 후 startOngoingTimerNotification 재호출 = isPaused=true 분기 → chronometer GONE + paused TextView VISIBLE + 버튼 "▶ 플레이" 토글.
    if (record.type == "timer_main" || record.type == "confirm_prompt") {
      startOngoingTimerNotification(context, record)
    } else {
      stopOngoingTimerNotification(context, alarmId)
    }
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
      var rec = record
      // 2026-06-03 fix(#DailyAlarmBootRevive) — 반복 알람(daily/weekly)의 발화 시각이 재부팅 다운타임 중 지나간 경우,
      //   버리지 말고 다음 미래 발생 시각으로 굴려서 유지. (= 데일리 알람의 반복 심장 chain[0] 보존)
      //   직전: fireAt <= now 면 무조건 영속에서 삭제 → 폰이 알람 시각에 꺼져 있다 재부팅하면 데일리 알람 영구 소실
      //         (복구는 syncAllAlarms = cold start 한정이라, 앱을 며칠 안 켜면 토글 ON인데 영영 안 울림).
      //   iOS는 AlarmKit가 OS 차원에서 재부팅을 넘겨 반복을 유지하므로, 본 정정으로 Android 동작을 iOS 표준에 맞춤.
      //   안전체인(chainIndex 1+, recurrenceMode='never')은 단발 백업이므로 기존대로 과거 건 폐기.
      if (rec.fireAt <= now && rec.recurrenceMode != "never") {
        var guard = 0
        while (rec.fireAt <= now && guard < 1000) {
          val next = computeNextOccurrence(rec) ?: break
          rec = rec.copy(fireAt = next)
          guard++
        }
      }
      if (rec.fireAt > now) {
        am.setAlarmClock(
          AlarmManager.AlarmClockInfo(rec.fireAt, showIntent(context)),
          firePendingIntent(context, rec.id)
        )
        survivors.add(rec)
      }
      // fireAt <= now 이면서 비반복(once) = 다운타임 중 놓친 일회성 → 재등록 안 함 (survivors 제외 = 영속 정리).
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
    if (r.endMethod != null) put("endMethod", r.endMethod)
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
      secondaryLabel = if (o.has("secondaryLabel") && !o.isNull("secondaryLabel")) o.getString("secondaryLabel") else null,
      endMethod = if (o.has("endMethod") && !o.isNull("endMethod")) o.getString("endMethod") else null
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
    // 2026-06-01: confirm_prompt (= routine step) 측도 허용 = routine 진행 중 잠금화면 잔여 타이머 위젯 표시.
    if (record.type != "timer_main" && record.type != "confirm_prompt") return
    val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      // IMPORTANCE_DEFAULT = 잠금화면 측 카드 형태로 표시 강도 높임. 사운드/진동은 setSound(null,null) + enableVibration(false)로 무력화.
      // (직전 LOW = 잠금화면 측 collapsed 작게만 표시되는 한계 회피 시도)
      val channel = NotificationChannel(
        ONGOING_CHANNEL_ID, "Timer countdown", NotificationManager.IMPORTANCE_DEFAULT
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
      .setCategory(Notification.CATEGORY_ALARM)
      .setOngoing(true)
      .setAutoCancel(false)
      .setVisibility(Notification.VISIBILITY_PUBLIC)
      .setContentIntent(pending)
    // 잠금화면 측 expanded 형태 우선 표시 강도 높임. 사운드/진동은 채널에서 무력화됨.
    @Suppress("DEPRECATION")
    builder.setPriority(Notification.PRIORITY_HIGH)

    // 2026-06-01 — iOS Live Activity 컨셉 정합 = Custom RemoteViews 측 큰 글자 위젯 + 액션 버튼 단일 카드.
    //   잠금화면 + 알림창 측 = 자체 layout = chronometer 글자 크기 56sp + 액션 버튼 동일 카드.
    //   ProgressStyle / setRequestPromotedOngoing / setShortCriticalText 측 = customContentView 측과 호환 X → 제거.
    //   confirm_prompt = "다음 진행" + "정지" 버튼. timer_main = "정지"만.
    val advanceLabel = record.secondaryLabel
    // 모달 측 stopLabel = "확인" (= step 완료 confirm 의미, AlarmAlertActivity 측). 잠금화면 위젯 측 = iOS LA StopRoutineIntent 정합 = "정지".
    //   record.stopLabel 값이 "확인"인 경우 = ko 측 routine.confirmPromptStop / routine.prealertStop = 위젯 측만 "정지" 변환.
    //   그 외 locale (en="OK" / ja="OK" / zh="确定") = stopLabel 값 그대로 (= 다국어 회귀 X).
    val modalStopLabel = record.stopLabel?.takeIf { it.isNotBlank() } ?: "정지"
    val widgetStopLabel = if (modalStopLabel == "확인") "정지" else modalStopLabel
    val titleText = record.title.replace("\n", " ")
    // Chronometer.setBase 측 = SystemClock.elapsedRealtime() 기준 시각 (= System.currentTimeMillis() 측 아님).
    //   잔여 ms = fireAt - now → elapsedRealtime + 잔여 ms = chronometer base.
    val nowMs = System.currentTimeMillis()
    val remainingMs = (record.fireAt - nowMs).coerceAtLeast(0L)
    val chronoBase = SystemClock.elapsedRealtime() + remainingMs

    val advancePending = if (!advanceLabel.isNullOrBlank()) {
      val advanceIntent = Intent(context, AlarmActionReceiver::class.java).apply {
        action = AlarmActionReceiver.ACTION_SECONDARY
        putExtra(EXTRA_ALARM_ID, record.id)
      }
      PendingIntent.getBroadcast(
        context, record.id.hashCode() xor 0x100,
        advanceIntent,
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
      )
    } else null

    // 2026-06-02 — Android 12+ background activity launch 제한 우회.
    //   직전 = PendingIntent.getBroadcast → AlarmActionReceiver.handleStop → startActivity → OS 차단 (앱 진입 X + 모달 X).
    //   정정 = PendingIntent.getActivity → AlarmAlertActivity launchMainOnly mode 직접 launch (= 사용자 탭 trigger 측 정합 = OS 허용).
    //   AlarmAlertActivity.onCreate launchMainOnly 분기 측 = AlarmEventBus.emit("stop_action") + Keyguard dismiss + MainActivity launch + finish.
    val stopPending = if (WIDGET_STOP_MODE == "B") {
      // 방안 B — MainActivity 직접 launch. 알림 PendingIntent 1차 hop만 사용 = 2차 startActivity BAL 차단 회피.
      //   MainActivity 측 = widget_stop extra 감지 → KeyguardManager dismiss + (JS alive emit / JS dead pending-key write).
      val mainIntent = Intent().apply {
        setClassName(context, "com.shuttimer.app.MainActivity")
        action = "expo.modules.alarmkitbridge.WIDGET_STOP_LAUNCH"  // unique action = PendingIntent 캐시 충돌 회피
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        putExtra(EXTRA_WIDGET_STOP_ALARM_ID, record.id)
      }
      PendingIntent.getActivity(
        context, record.id.hashCode() xor 0x200,
        mainIntent,
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
      )
    } else {
      // 방안 A — AlarmAlertActivity launchMainOnly mode (보이는 창 확보 후 MainActivity launch).
      val stopIntent = Intent(context, AlarmAlertActivity::class.java).apply {
        action = "expo.modules.alarmkitbridge.WIDGET_STOP_LAUNCH"  // unique action = PendingIntent 캐시 충돌 회피
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        putExtra(EXTRA_ALARM_ID, record.id)
        putExtra(AlarmAlertActivity.EXTRA_LAUNCH_MAIN_ONLY, true)
      }
      PendingIntent.getActivity(
        context, record.id.hashCode() xor 0x200,
        stopIntent,
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
      )
    }

    // iOS LA PauseRoutineIntent / ResumeRoutineIntent 정합 = isPaused 토글.
    val pausedEntry = pausedGet(context, record.id)
    val isPaused = pausedEntry != null
    val pauseResumeAction = if (isPaused) AlarmActionReceiver.ACTION_RESUME else AlarmActionReceiver.ACTION_PAUSE
    val pauseResumeLabel = if (isPaused) "▶ 플레이" else "❚❚ 일시정지"
    // paused 측 정적 잔여 시간 텍스트 (= chronometer 측 setBase 측 paused 상태 표현 한계 회피).
    //   pausedEntry.remainingMs 측 = pauseAlarm 측 계산된 잔여 ms (= alarm cancel 시점 기준).
    val pausedRemainingText = if (isPaused) {
      val totalSec = ((pausedEntry?.remainingMs ?: 0L) / 1000L).coerceAtLeast(0L)
      val mm = totalSec / 60L
      val ss = totalSec % 60L
      String.format("%02d:%02d", mm, ss)
    } else ""
    val pauseResumeIntent = Intent(context, AlarmActionReceiver::class.java).apply {
      action = pauseResumeAction
      putExtra(EXTRA_ALARM_ID, record.id)
    }
    val pauseResumePending = PendingIntent.getBroadcast(
      context, record.id.hashCode() xor 0x300,
      pauseResumeIntent,
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
    )

    fun buildExpandedRemoteViews(): RemoteViews {
      // iOS Live Activity 정합 = routine step 카운트다운 중 위젯 = "정지" + "일시정지/플레이" toggle (= 2개 버튼).
      // "다음 진행"은 step 알람 fire 시점 AlarmAlertActivity 측에서만 가능 (= 위젯 측 노출 X).
      val rv = RemoteViews(context.packageName, R.layout.notification_routine_widget)
      rv.setTextViewText(R.id.widget_title, titleText)
      if (isPaused) {
        // paused 측 = chronometer 측 setBase 측 elapsedRealtime 기준 측 = 멈춤 불가 → GONE 후 정적 TextView 표시.
        rv.setViewVisibility(R.id.widget_chronometer, android.view.View.GONE)
        rv.setViewVisibility(R.id.widget_paused_text, android.view.View.VISIBLE)
        rv.setTextViewText(R.id.widget_paused_text, pausedRemainingText)
      } else {
        rv.setViewVisibility(R.id.widget_chronometer, android.view.View.VISIBLE)
        rv.setViewVisibility(R.id.widget_paused_text, android.view.View.GONE)
        rv.setChronometer(R.id.widget_chronometer, chronoBase, null, true)
        rv.setChronometerCountDown(R.id.widget_chronometer, true)
      }
      // 일시정지/플레이 toggle (= iOS LA AlarmKitPauseResumeButton 정합)
      rv.setTextViewText(R.id.widget_btn_pause_resume, pauseResumeLabel)
      rv.setOnClickPendingIntent(R.id.widget_btn_pause_resume, pauseResumePending)
      rv.setViewVisibility(R.id.widget_btn_pause_resume, android.view.View.VISIBLE)
      // 정지 (= iOS LA StopRoutineIntent 정합 = widgetStopLabel 측 "정지" 변환).
      rv.setTextViewText(R.id.widget_btn_stop, widgetStopLabel)
      rv.setOnClickPendingIntent(R.id.widget_btn_stop, stopPending)
      return rv
    }

    fun buildCollapsedRemoteViews(): RemoteViews {
      // 잠금화면 기본 표시 (= OS 높이 제한 ~48dp). 제목 + 카운트다운만 가로 배치.
      val rv = RemoteViews(context.packageName, R.layout.notification_routine_widget_collapsed)
      rv.setTextViewText(R.id.widget_title, titleText)
      if (isPaused) {
        rv.setViewVisibility(R.id.widget_chronometer, android.view.View.GONE)
        rv.setViewVisibility(R.id.widget_paused_text, android.view.View.VISIBLE)
        rv.setTextViewText(R.id.widget_paused_text, pausedRemainingText)
      } else {
        rv.setViewVisibility(R.id.widget_chronometer, android.view.View.VISIBLE)
        rv.setViewVisibility(R.id.widget_paused_text, android.view.View.GONE)
        rv.setChronometer(R.id.widget_chronometer, chronoBase, null, true)
        rv.setChronometerCountDown(R.id.widget_chronometer, true)
      }
      return rv
    }

    builder.setCustomContentView(buildCollapsedRemoteViews())
    builder.setCustomBigContentView(buildExpandedRemoteViews())
    // heads-up popup 측에도 expanded view 적용 (= priority HIGH 시 OneUI 측 펼친 상태가 heads-up view로 처리되는 경로 차단).
    builder.setCustomHeadsUpContentView(buildExpandedRemoteViews())
    builder.style = Notification.DecoratedCustomViewStyle()

    // 2026-06-02 — addAction fallback 제거 (= iOS LA 정합 = 위젯 카드 안 버튼 1개만).
    //   직전 = customView 측 "정지" + addAction 측 "확인" 라벨 = 카드 안 + 카드 아래 = 확인/정지 버튼 2개 노출 = 사용자 항의.
    //   정정 = customView 측 widgetStopLabel "정지" 1개만 노출. customView 미지원 디바이스 = OS 측 자동 폴백 표시.

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
