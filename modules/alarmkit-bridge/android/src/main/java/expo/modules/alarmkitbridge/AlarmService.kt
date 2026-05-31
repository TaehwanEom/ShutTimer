// 알람 발화 서비스 — foreground service(mediaPlayback). 알람 사운드(STREAM_ALARM)·진동·볼륨 강제 + 전체화면 알림.
package expo.modules.alarmkitbridge

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.database.ContentObserver
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.provider.Settings
import android.util.Log

class AlarmService : Service() {
  private var mediaPlayer: MediaPlayer? = null
  private var vibrator: Vibrator? = null
  private var priorAlarmVolume: Int = -1
  private var volumeObserver: ContentObserver? = null
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
    Log.w(TAG, "AlarmService start — alarmId=$alarmId title=${record?.title}")

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

    forceAlarmVolume()
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
    unregisterVolumeObserver()
    restoreAlarmVolume()
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

    val launch = (packageManager.getLaunchIntentForPackage(packageName) ?: Intent()).apply {
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      putExtra("alerting_alarm_id", record?.id)
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
      Log.w(TAG, "startSound fail: $e")
    }
  }

  // soundName("alarm_01.wav") → res/raw 리소스 URI. 미존재 시 시스템 기본 알람음 폴백.
  private fun resolveSoundUri(soundName: String?): Uri {
    if (!soundName.isNullOrBlank()) {
      val stem = soundName.substringBeforeLast('.')
      val resId = resources.getIdentifier(stem, "raw", packageName)
      if (resId != 0) {
        Log.w(TAG, "startSound — res/raw 사용 name=$soundName resId=$resId")
        return Uri.parse("android.resource://$packageName/$resId")
      }
      Log.w(TAG, "startSound — res/raw 미발견 name=$soundName → 시스템 기본음 폴백")
    }
    return RingtoneManager.getActualDefaultRingtoneUri(this, RingtoneManager.TYPE_ALARM)
      ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
  }

  private fun stopSound() {
    mediaPlayer?.let {
      try {
        if (it.isPlaying) it.stop()
      } catch (e: Exception) {
        Log.w(TAG, "stopSound fail: $e")
      }
      it.release()
    }
    mediaPlayer = null
  }

  // ── 볼륨 초기 설정 (시작 시 max로 설정, 사용자 음량 버튼 조절 허용) ──
  //   2026-05-31 — iOS 정합. 직전 = ContentObserver로 음량 변경 즉시 max 강제 복원
  //   → 사용자가 음량 버튼으로 줄여도 1초 안에 max로 돌아감 → 인앱 음량 조절 불가 버그.
  //   정정 = 시작 시 max만 설정 (= 못 듣는 사고 방지), 그 후 사용자 자유 조절 허용 (= Android 표준).
  private fun audioManager() = getSystemService(Context.AUDIO_SERVICE) as AudioManager

  private fun forceAlarmVolume() {
    val am = audioManager()
    if (priorAlarmVolume < 0) priorAlarmVolume = am.getStreamVolume(AudioManager.STREAM_ALARM)
    am.setStreamVolume(
      AudioManager.STREAM_ALARM, am.getStreamMaxVolume(AudioManager.STREAM_ALARM), 0
    )
    // ContentObserver 등록 X — 사용자가 음량 버튼으로 조절 시 변경 즉시 반영 (= iOS 동일).
  }

  private fun unregisterVolumeObserver() {
    volumeObserver?.let {
      try { contentResolver.unregisterContentObserver(it) } catch (e: Exception) {}
    }
    volumeObserver = null
  }

  private fun restoreAlarmVolume() {
    if (priorAlarmVolume >= 0) {
      try {
        audioManager().setStreamVolume(AudioManager.STREAM_ALARM, priorAlarmVolume, 0)
      } catch (e: Exception) {}
      priorAlarmVolume = -1
    }
  }

  // ── 진동 (반복 패턴) ──
  private fun startVibration() {
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
      Log.w(TAG, "vibrate fail: $e")
    }
  }

  private fun stopVibration() {
    try { vibrator?.cancel() } catch (e: Exception) {}
    vibrator = null
  }
}
