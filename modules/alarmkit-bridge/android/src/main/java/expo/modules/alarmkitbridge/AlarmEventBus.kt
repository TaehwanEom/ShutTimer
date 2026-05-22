// 알람 발화 이벤트 버스 — AlarmService(발화) → AlarmkitBridgeModule(JS emit) 동일 프로세스 콜백 전달.
package expo.modules.alarmkitbridge

object AlarmEventBus {
  // 모듈이 살아있을 때만 설정됨. (alarmId, state) — state: "alerting" / "removed".
  @Volatile
  var listener: ((alarmId: String, state: String) -> Unit)? = null

  fun emit(alarmId: String, state: String) {
    listener?.invoke(alarmId, state)
  }
}
