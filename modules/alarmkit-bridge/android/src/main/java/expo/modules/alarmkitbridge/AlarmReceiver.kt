// 알람 발화 수신기 — AlarmManager가 예약 시각에 깨우는 BroadcastReceiver. AlarmService(foreground service)를 시작.
// Phase 3-2: 발화 직후 반복 알람 측 다음 occurrence 측 재예약 (= setAlarmClock 측 단발 발화 → daily/weekly 측 OS 자동 반복 X 회피).
package expo.modules.alarmkitbridge

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build

class AlarmReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val alarmId = intent.getStringExtra(AlarmScheduler.EXTRA_ALARM_ID) ?: return
    NativeDebugLog.log(context, "AlarmkitBridge", "AlarmReceiver fired — alarmId=$alarmId → AlarmService")
    val svc = Intent(context, AlarmService::class.java).apply {
      putExtra(AlarmScheduler.EXTRA_ALARM_ID, alarmId)
    }
    // exact-alarm 백그라운드 FGS start 면제 — Android 14 공식 허용.
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      context.startForegroundService(svc)
    } else {
      context.startService(svc)
    }
    // Phase 3-2: 반복 알람 측 = 발화 직후 다음 occurrence 측 재예약.
    //   once 측 = no-op. daily 측 = +1일. weekly 측 = recurrenceDays 측 다음 요일.
    //   현 발화 record 측 = 같은 alarmId + 새 fireAt 측 schedule → persistUpsert 측 덮어쓰기 정합.
    try {
      AlarmScheduler.scheduleNextOccurrenceIfNeeded(context, alarmId)
    } catch (e: Exception) {
      NativeDebugLog.log(context, "AlarmkitBridge", "scheduleNextOccurrenceIfNeeded fail alarmId=$alarmId err=$e")
    }
  }
}
