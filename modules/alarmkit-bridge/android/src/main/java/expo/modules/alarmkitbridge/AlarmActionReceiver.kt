// Phase 3-3: AlarmService 측 FSI notification 측 secondary action button (= "다음 진행") 측 PendingIntent 수신.
//   사용자 측 잠금화면 측 secondary 버튼 탭 → 본 receiver fire → 알람 정리 (cancel + service stop) + JS 측 "secondary_action" event emit.
//   JS App.tsx 측 listener 측 = event 측 받아 meta.type 측 검사 → confirm_prompt 측 = dispatch Advance.
package expo.modules.alarmkitbridge

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

class AlarmActionReceiver : BroadcastReceiver() {
  companion object {
    const val ACTION_SECONDARY = "expo.modules.alarmkitbridge.SECONDARY_ACTION"
    private const val TAG = "AlarmkitBridge"
  }

  override fun onReceive(context: Context, intent: Intent) {
    val alarmId = intent.getStringExtra(AlarmScheduler.EXTRA_ALARM_ID) ?: return
    val action = intent.action ?: return
    Log.w(TAG, "AlarmActionReceiver — action=$action alarmId=$alarmId")
    if (action == ACTION_SECONDARY) {
      // JS 측 = "secondary_action" state 측 = listener 측 routine 측 dispatch Advance 진입.
      //   주의: emit 먼저 (= JS 측 = 상태 처리 시간 보장) → 그 다음 native cleanup (= alarm cancel + service stop).
      AlarmEventBus.emit(alarmId, "secondary_action")
      AlarmScheduler.cancel(context, alarmId)
      context.stopService(Intent(context, AlarmService::class.java))
    }
  }
}
