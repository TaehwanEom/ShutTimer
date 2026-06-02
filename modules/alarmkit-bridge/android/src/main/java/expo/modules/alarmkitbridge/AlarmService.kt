// 알람 발화 서비스 — foreground service(mediaPlayback). 알람 사운드(STREAM_ALARM)·진동 + 전체화면 알림.
//   2026-05-31: 음량 강제 제거 (= 사용자 STREAM_ALARM 셋팅 그대로).
package expo.modules.alarmkitbridge

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.os.IBinder
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager

class AlarmService : Service() {
  private var mediaPlayer: MediaPlayer? = null
  private var vibrator: Vibrator? = null
  private var currentAlarmId: String? = null

  companion object {
    private const val CHANNEL_ID = "alarmkit_alarm"
    private const val NOTIF_ID = 0xA1A2
    private const val TAG = "AlarmkitBridge"
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val alarmId = intent?.getStringExtra(AlarmScheduler.EXTRA_ALARM_ID)
    currentAlarmId = alarmId
    val record = alarmId?.let { AlarmScheduler.get(this, it) }
    NativeDebugLog.log(this, TAG, "AlarmService start — alarmId=$alarmId title=${record?.title}")

    // Phase 2-2: 발화 시점 측 = ongoing chronometer notification 측 제거 (= 알람 측 활성 상태 측 = countdown 측 표시 X).
    if (alarmId != null) {
      AlarmScheduler.stopOngoingTimerNotification(this, alarmId)
    }

    val notif = buildNotification(record)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(NOTIF_ID, notif, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
    } else {
      startForeground(NOTIF_ID, notif)
    }

    // 2026-05-31 — 사용자 STREAM_ALARM 셋팅 그대로 사용 (= max 강제 금지).
    //   직전: forceAlarmVolume()으로 max 강제 → 사용자 음량 설정 무시.
    //   정정: 호출 제거. 사용자 셋팅 0이면 못 듣는 것도 사용자 책임 (= Android 표준 + iOS 정합).
    startSound(record?.soundName)
    startVibration()

    // 발화 상태 기록 + JS emit — 콜드스타트는 listAlarms로, 앱 생존 시는 이벤트로 알람 화면 이동.
    if (alarmId != null) {
      AlarmScheduler.setAlerting(this, alarmId)
      AlarmEventBus.emit(alarmId, "alerting")
    }
    return START_REDELIVER_INTENT
  }

  override fun onDestroy() {
    stopSound()
    stopVibration()
    // 2026-05-31 — forceAlarmVolume 제거에 따라 volumeObserver/restore도 제거 (= 우리가 음량 변경 안 함).
    currentAlarmId?.let {
      AlarmScheduler.clearAlerting(this)
      AlarmEventBus.emit(it, "removed")
    }
    super.onDestroy()
  }

  // ── 전체화면 알림 (full-screen-intent) ──
  @Suppress("DEPRECATION")
  private fun buildNotification(record: AlarmScheduler.AlarmRecord?): Notification {
    val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = NotificationChannel(
        CHANNEL_ID, "알람", NotificationManager.IMPORTANCE_HIGH
      ).apply {
        setSound(null, null)        // 사운드는 서비스가 직접 재생 (채널 중복 방지)
        enableVibration(false)      // 진동도 서비스가 직접
        lockscreenVisibility = Notification.VISIBILITY_PUBLIC
      }
      nm.createNotificationChannel(channel)
    }

    // 2026-05-31 — full-screen-intent 대상 변경: MainActivity → AlarmAlertActivity.
    //   직전: MainActivity 자동 진입 = RN 앱 전체 로드 = 인앱 진입 (= iPhone 정합 X).
    //   본 정정: 가벼운 AlarmAlertActivity만 띄움 → 사용자 "끄기" 액션 후 일반 알람=종료, 미션 알람=MainActivity 진입.
    //   alarmId + endMethod = AlarmAlertActivity에서 사용 (= 라벨 조회 + 미션/일반 분기).
    val launch = Intent(this, AlarmAlertActivity::class.java).apply {
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
      putExtra(AlarmScheduler.EXTRA_ALARM_ID, record?.id)
      if (record?.endMethod != null) putExtra("alerting_end_method", record.endMethod)
      // type 전달 = AlarmAlertActivity 측 routine 'confirm_prompt' 분기 (= endMethod='tap'이어도 MainActivity 진입 필수).
      if (record?.type != null) putExtra("alerting_type", record.type)
    }
    val pending = PendingIntent.getActivity(
      this, 0, launch,
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
    )

    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(this, CHANNEL_ID)
    } else {
      Notification.Builder(this)
    }
    builder
      .setContentTitle(record?.title?.replace("\n", " ") ?: "알람")
      .setSmallIcon(applicationInfo.icon)
      .setCategory(Notification.CATEGORY_ALARM)
      .setOngoing(true)
      .setAutoCancel(false)
      .setFullScreenIntent(pending, true)
      .setContentIntent(pending)
    // Phase 3-3: secondaryLabel 측 = FSI notification 측 secondary action button.
    //   탭 시 = AlarmActionReceiver 측 broadcast → JS 측 "secondary_action" event emit + native cleanup.
    val secondaryLabel = record?.secondaryLabel
    if (!secondaryLabel.isNullOrBlank() && record != null) {
      val secondaryIntent = Intent(this, AlarmActionReceiver::class.java).apply {
        action = AlarmActionReceiver.ACTION_SECONDARY
        putExtra(AlarmScheduler.EXTRA_ALARM_ID, record.id)
        // 동일 entityId + chainIndex 측 = 다른 alarm 측 같은 request code 측 회피 → record.id (UUID) 측 + 1 (= primary 측과 구분).
      }
      val secondaryPending = PendingIntent.getBroadcast(
        this, record.id.hashCode() xor 0x1,
        secondaryIntent,
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
      )
      builder.addAction(0, secondaryLabel, secondaryPending)
    }
    return builder.build()
  }

  // ── 사운드 (알람 스트림 — 무음모드 우회). soundName → res/raw 우리 wav, 없으면 시스템 기본음 ──
  private fun startSound(soundName: String?) {
    // 2026-06-01 — 2중 재생 회피 = 기존 mediaPlayer release 후 새 instance 시작.
    //   직전 = stopSound() 호출 없이 mediaPlayer 측 덮어쓰기 → 기존 instance 계속 재생 + 새 instance 추가 = 2중 사운드.
    //   동시 alarm fire (= 같은 AlarmService onStartCommand 재호출) 측 회귀 차단.
    stopSound()
    try {
      val uri = resolveSoundUri(soundName)
      mediaPlayer = MediaPlayer().apply {
        setDataSource(this@AlarmService, uri)
        setAudioAttributes(
          AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ALARM)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build()
        )
        isLooping = true
        prepare()
        start()
      }
    } catch (e: Exception) {
      NativeDebugLog.log(this, TAG, "startSound fail: $e")
    }
  }

  // soundName("alarm_01.wav") → res/raw 리소스 URI. 미존재 시 시스템 기본 알람음 폴백.
  private fun resolveSoundUri(soundName: String?): Uri {
    if (!soundName.isNullOrBlank()) {
      val stem = soundName.substringBeforeLast('.')
      val resId = resources.getIdentifier(stem, "raw", packageName)
      if (resId != 0) {
        NativeDebugLog.log(this, TAG, "startSound — res/raw 사용 name=$soundName resId=$resId")
        return Uri.parse("android.resource://$packageName/$resId")
      }
      NativeDebugLog.log(this, TAG, "startSound — res/raw 미발견 name=$soundName → 시스템 기본음 폴백")
    }
    return RingtoneManager.getActualDefaultRingtoneUri(this, RingtoneManager.TYPE_ALARM)
      ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
  }

  private fun stopSound() {
    mediaPlayer?.let {
      try {
        if (it.isPlaying) it.stop()
      } catch (e: Exception) {
        NativeDebugLog.log(this, TAG, "stopSound fail: $e")
      }
      it.release()
    }
    mediaPlayer = null
  }

  // ── 볼륨: 우리 앱은 STREAM_ALARM 음량을 변경하지 않음. 사용자 셋팅 그대로 사용 (= Android 표준 + iOS 정합). ──
  //   2026-05-31 사용자 보고: max 강제 = 사용자 음량 셋팅 무시 회귀. forceAlarmVolume/restoreAlarmVolume/ContentObserver 전부 제거.

  // ── 진동 (반복 패턴) ──
  private fun startVibration() {
    // 2026-06-01 — 2중 진동 회피 = 기존 vibrator cancel 후 새 시작.
    stopVibration()
    val v = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      (getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager).defaultVibrator
    } else {
      @Suppress("DEPRECATION")
      (getSystemService(Context.VIBRATOR_SERVICE) as Vibrator)
    }
    vibrator = v
    val pattern = longArrayOf(0, 800, 600)
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        v.vibrate(VibrationEffect.createWaveform(pattern, 0))
      } else {
        @Suppress("DEPRECATION")
        v.vibrate(pattern, 0)
      }
    } catch (e: Exception) {
      NativeDebugLog.log(this, TAG, "vibrate fail: $e")
    }
  }

  private fun stopVibration() {
    try { vibrator?.cancel() } catch (e: Exception) {}
    vibrator = null
  }
}
