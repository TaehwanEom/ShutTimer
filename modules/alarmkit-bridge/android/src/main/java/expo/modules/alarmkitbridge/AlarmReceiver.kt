// 알람 발화 수신기 — AlarmManager가 예약 시각에 깨우는 BroadcastReceiver. AlarmService(foreground service)를 시작.
package expo.modules.alarmkitbridge

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log

class AlarmReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val alarmId = intent.getStringExtra(AlarmScheduler.EXTRA_ALARM_ID) ?: return
    Log.w("AlarmkitBridge", "AlarmReceiver fired — alarmId=$alarmId → AlarmService")
    val svc = Intent(context, AlarmService::class.java).apply {
      putExtra(AlarmScheduler.EXTRA_ALARM_ID, alarmId)
    }
    // exact-alarm 백그라운드 FGS start 면제 — Android 14 공식 허용.
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      context.startForegroundService(svc)
    } else {
      context.startService(svc)
    }
  }
}
