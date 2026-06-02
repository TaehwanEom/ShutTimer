// 재부팅 복원 수신기 — 부팅 완료 시 AlarmManager 예약이 모두 소실되므로,
// 영속된 알람 레코드 중 미래 시각인 것을 다시 등록한다. (Phase 1 Step 6)
package expo.modules.alarmkitbridge

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class BootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent?) {
    // BOOT_COMPLETED 만 처리 (Phase 1 — 잠금 해제 전 direct boot 단계는 Phase 3).
    if (intent?.action != Intent.ACTION_BOOT_COMPLETED) return
    val restored = AlarmScheduler.rescheduleAllFromBoot(context)
    NativeDebugLog.log(context, "AlarmkitBridge", "BootReceiver — BOOT_COMPLETED restored=$restored alarms")
  }
}
