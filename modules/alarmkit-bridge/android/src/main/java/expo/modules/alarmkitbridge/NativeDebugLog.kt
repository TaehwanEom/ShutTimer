// Native 디버그 로그 helper — iOS appendNativeDbg 1:1 정합.
//   iOS 측 = App Group UserDefaults "group.com.shuttimer.app" → key "native_debug_log_v1" 측 append.
//   Android 측 = SharedPreferences "shuttimer_app_group" → key "native_debug_log_v1" 측 append.
//   JS 측 = SettingsScreen "최근 로그 공유" → AlarmkitBridge.readAppGroupString("native_debug_log_v1") → 합쳐 공유.
//   format = ISO8601 timestamp + [process name] + [tag] + msg (= iOS와 동일).
//   max 300줄 (= 초과 시 최근 300줄만 유지).
package expo.modules.alarmkitbridge

import android.content.Context
import android.util.Log
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

object NativeDebugLog {
  private const val PREFS_NAME = "shuttimer_app_group"
  private const val KEY = "native_debug_log_v1"
  private const val MAX_LINES = 300

  private val iso8601 = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSXXX", Locale.US).apply {
    timeZone = TimeZone.getTimeZone("UTC")
  }
  private val lock = Any()

  fun log(context: Context, tag: String, msg: String) {
    // 1. adb logcat 출력 (= 개발 중 확인용).
    Log.w(tag, msg)
    // 2. SharedPreferences append (= JS 측 read 대상).
    try {
      synchronized(lock) {
        val prefs = context.applicationContext
          .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val ts = iso8601.format(Date())
        val proc = context.packageName
        val line = "$ts [$proc][$tag] $msg"
        val existing = prefs.getString(KEY, "") ?: ""
        val lines = if (existing.isEmpty()) {
          mutableListOf<String>()
        } else {
          existing.split("\n").toMutableList()
        }
        lines.add(line)
        val trimmed = if (lines.size > MAX_LINES) {
          lines.subList(lines.size - MAX_LINES, lines.size)
        } else {
          lines
        }
        prefs.edit().putString(KEY, trimmed.joinToString("\n")).apply()
      }
    } catch (e: Exception) {
      Log.w(tag, "NativeDebugLog write fail: $e")
    }
  }
}
