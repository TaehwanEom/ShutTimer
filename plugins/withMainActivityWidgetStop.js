// MainActivity 측 위젯 "정지"(방안 B) 처리 코드를 prebuild 때마다 자동 주입하는 config plugin.
//   배경: android/ 는 .gitignore + expo prebuild 가 MainActivity.kt 를 기본 템플릿으로 재생성 →
//        수동 편집(handleWidgetStop / requestDismissKeyguardOnAlarmEntry)이 매 prebuild 마다 소실.
//   해결: 본 plugin 이 단일 진실원천 = 재생성된 기본 MainActivity 에 아래를 idempotent 하게 주입.
//        ① import 6개 ② onCreate 내 호출 2개 ③ onNewIntent + handleWidgetStop + requestDismissKeyguardOnAlarmEntry
//   안전장치: 상단 가드 — contents 에 이미 handleWidgetStop 존재(수동수정본 또는 이전 주입)면 그대로 두고 skip → 중복 선언 방지.
//   대응 네이티브: modules/alarmkit-bridge/android/.../AlarmScheduler.kt (WIDGET_STOP_MODE="B", EXTRA_WIDGET_STOP_ALARM_ID)
//                 + AlarmAlertActivity.kt (PREFS_PENDING, KEY_PENDING_WIDGET_STOP_ALARM_ID).

const { withMainActivity } = require('expo/config-plugins');
const { mergeContents } = require('@expo/config-plugins/build/utils/generateCode');

// ① 추가 import (기본 템플릿엔 android.os.Build / android.os.Bundle 만 있음)
const IMPORTS = `import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import expo.modules.alarmkitbridge.AlarmEventBus
import expo.modules.alarmkitbridge.AlarmAlertActivity
import expo.modules.alarmkitbridge.AlarmScheduler`;

// ② onCreate 내부 (super.onCreate(null) 직후) 호출 — iOS Face ID / 위젯 정지 진입 정합
const ONCREATE_CALLS = `    // 알람 진입 시 잠금 해제 요구 + 위젯 "정지" 처리 (방안 B). 자세한 설명은 아래 메서드 주석 참고.
    requestDismissKeyguardOnAlarmEntry(intent)
    handleWidgetStop(intent)`;

// ③ onNewIntent override + 두 헬퍼 메서드 (클래스 멤버)
const METHODS = `  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    requestDismissKeyguardOnAlarmEntry(intent)
    handleWidgetStop(intent)
  }

  // 2026-06-02 방안 B — 위젯 "정지" -> MainActivity 직접 진입 처리 (2차 startActivity 없음 = Android BAL 차단 회피).
  //   잠금 시 생체/패턴 인증 요구 + stop_action 전달 (JS alive = 직접 emit / cold start = pending-key write -> bridge OnCreate emit).
  private fun handleWidgetStop(intent: Intent?) {
    val id = intent?.getStringExtra(AlarmScheduler.EXTRA_WIDGET_STOP_ALARM_ID) ?: return
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val keyguardManager = getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager
      if (keyguardManager != null && keyguardManager.isKeyguardLocked) {
        keyguardManager.requestDismissKeyguard(this, null)
      }
    }
    if (AlarmEventBus.listener != null) {
      AlarmEventBus.emit(id, "stop_action")
    } else {
      val prefs = getSharedPreferences(AlarmAlertActivity.PREFS_PENDING, Context.MODE_PRIVATE)
      prefs.edit().putString(AlarmAlertActivity.KEY_PENDING_WIDGET_STOP_ALARM_ID, id).apply()
    }
  }

  // 2026-06-01 — 알람 "끄기" 진입 시 잠금 화면 위 생체/패턴 인증 요구 (iOS .foreground Face ID 정합).
  //   인증 cancel/fail = MainActivity 종료(잠금 복귀). chain alarm 측 2분 후 재발화 = 안전망.
  private fun requestDismissKeyguardOnAlarmEntry(intent: Intent?) {
    if (intent?.getStringExtra("alerting_alarm_id") == null) return
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val keyguardManager = getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager ?: return
    if (!keyguardManager.isKeyguardLocked) return
    keyguardManager.requestDismissKeyguard(this, object : KeyguardManager.KeyguardDismissCallback() {
      override fun onDismissCancelled() {
        finish()
      }
      override fun onDismissError() {
        finish()
      }
      override fun onDismissSucceeded() {
      }
    })
  }`;

// 순수 변환 함수 (테스트 가능) — 기본 MainActivity.kt 문자열을 받아 주입된 문자열 반환. idempotent.
function transformContents(contents) {
  // 가드 — 이미 주입/수동수정으로 handleWidgetStop 존재하면 중복 선언 방지 위해 그대로 둠.
  if (contents.includes('handleWidgetStop')) {
    return contents;
  }

  {
    const imports = mergeContents({
      tag: 'shuttimer-alarm-imports',
      src: contents,
      newSrc: IMPORTS,
      anchor: /import android\.os\.Bundle/,
      offset: 1,
      comment: '//',
    });
    if (!imports.didMerge) {
      throw new Error(
        'withMainActivityWidgetStop: import 앵커(import android.os.Bundle) 를 못 찾음.'
      );
    }
    contents = imports.contents;

    const onCreate = mergeContents({
      tag: 'shuttimer-alarm-oncreate',
      src: contents,
      newSrc: ONCREATE_CALLS,
      anchor: /super\.onCreate\(null\)/,
      offset: 1,
      comment: '//',
    });
    if (!onCreate.didMerge) {
      throw new Error(
        'withMainActivityWidgetStop: onCreate 앵커(super.onCreate(null)) 를 못 찾음.'
      );
    }
    contents = onCreate.contents;

    const methods = mergeContents({
      tag: 'shuttimer-alarm-methods',
      src: contents,
      newSrc: METHODS,
      anchor: /override fun getMainComponentName\(\): String = "main"/,
      offset: 1,
      comment: '//',
    });
    if (!methods.didMerge) {
      throw new Error(
        'withMainActivityWidgetStop: 메서드 앵커(getMainComponentName) 를 못 찾음.'
      );
    }
    contents = methods.contents;
  }

  return contents;
}

const withMainActivityWidgetStop = (config) => {
  return withMainActivity(config, (config) => {
    if (config.modResults.language !== 'kt') {
      throw new Error(
        `withMainActivityWidgetStop: Kotlin MainActivity 만 지원 (현재: ${config.modResults.language}).`
      );
    }
    config.modResults.contents = transformContents(config.modResults.contents);
    return config;
  });
};

module.exports = withMainActivityWidgetStop;
module.exports.transformContents = transformContents;
