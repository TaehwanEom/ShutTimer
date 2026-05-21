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

  companion object {
    private const val CHANNEL_ID = "alarmkit_alarm"
    private const val NOTIF_ID = 0xA1A2
    private const val TAG = "AlarmkitBridge"
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val alarmId = intent?.getStringExtra(AlarmScheduler.EXTRA_ALARM_ID)
    val record = alarmId?.let { AlarmScheduler.get(this, it) }
    Log.w(TAG, "AlarmService start — alarmId=$alarmId title=${record?.title}")

    val notif = buildNotification(record)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(NOTIF_ID, notif, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
    } else {
      startForeground(NOTIF_ID, notif)
    }

    forceAlarmVolume()
    startSound()
    startVibration()
    return START_REDELIVER_INTENT
  }

  override fun onDestroy() {
    stopSound()
    stopVibration()
    unregisterVolumeObserver()
    restoreAlarmVolume()
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
    return builder
      .setContentTitle(record?.title?.replace("\n", " ") ?: "알람")
      .setSmallIcon(applicationInfo.icon)
      .setCategory(Notification.CATEGORY_ALARM)
      .setOngoing(true)
      .setAutoCancel(false)
      .setFullScreenIntent(pending, true)
      .setContentIntent(pending)
      .build()
  }

  // ── 사운드 (알람 스트림 — 무음모드 우회). 커스텀 사운드 매핑은 후속 ──
  private fun startSound() {
    try {
      val uri = RingtoneManager.getActualDefaultRingtoneUri(this, RingtoneManager.TYPE_ALARM)
        ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
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

  // ── 볼륨 강제 (최대 + 볼륨 버튼으로 내려도 즉시 재확인 → 음소거 불가) ──
  private fun audioManager() = getSystemService(Context.AUDIO_SERVICE) as AudioManager

  private fun forceAlarmVolume() {
    val am = audioManager()
    if (priorAlarmVolume < 0) priorAlarmVolume = am.getStreamVolume(AudioManager.STREAM_ALARM)
    am.setStreamVolume(
      AudioManager.STREAM_ALARM, am.getStreamMaxVolume(AudioManager.STREAM_ALARM), 0
    )
    val observer = object : ContentObserver(Handler(Looper.getMainLooper())) {
      override fun onChange(selfChange: Boolean) {
        val a = audioManager()
        val max = a.getStreamMaxVolume(AudioManager.STREAM_ALARM)
        if (a.getStreamVolume(AudioManager.STREAM_ALARM) < max) {
          a.setStreamVolume(AudioManager.STREAM_ALARM, max, 0)
        }
      }
    }
    volumeObserver = observer
    contentResolver.registerContentObserver(Settings.System.CONTENT_URI, true, observer)
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
