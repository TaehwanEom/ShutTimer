package expo.modules.liveactivitybridge

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// v1.6 T3 — Live Activity 는 iOS 16.2+ 전용. Android = stub.
// autolinking 일관성 유지용 빈 Module 정의.
class LiveActivityBridgeModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("LiveActivityBridge")
  }
}
