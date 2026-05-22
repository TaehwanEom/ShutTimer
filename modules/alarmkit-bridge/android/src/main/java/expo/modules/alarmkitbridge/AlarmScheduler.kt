// 알람 예약/취소 + 영속 저장 — AlarmManager.setAlarmClock 래퍼. 재부팅 복원(Step 6)을 위해 SharedPreferences에 알람 정의 미러링.
package expo.modules.alarmkitbridge

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import org.json.JSONArray
import org.json.JSONObject

object AlarmScheduler {
  const val EXTRA_ALARM_ID = "alarmkit_alarm_id"
  private const val PREFS_NAME = "alarmkit_bridge_alarms"
  private const val KEY_ALARMS = "alarms"
  private const val KEY_ALERTING = "alerting_id"

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
    val stopLabel: String?
  )

  // ── 예약 / 취소 / 조회 ──

  fun schedule(context: Context, record: AlarmRecord) {
    persistUpsert(context, record)
    val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    val info = AlarmManager.AlarmClockInfo(record.fireAt, showIntent(context))
    am.setAlarmClock(info, firePendingIntent(context, record.id))
  }

  fun cancel(context: Context, alarmId: String) {
    val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    am.cancel(firePendingIntent(context, alarmId))
    persistRemove(context, alarmId)
  }

  fun list(context: Context): List<AlarmRecord> = readAll(context)

  fun get(context: Context, alarmId: String): AlarmRecord? =
    readAll(context).firstOrNull { it.id == alarmId }

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
      stopLabel = if (o.has("stopLabel") && !o.isNull("stopLabel")) o.getString("stopLabel") else null
    )
  }
}
