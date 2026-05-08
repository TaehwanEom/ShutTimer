// 앱 launch 진입점 — bundle 측 사운드 파일 진단 디버그 hook 동거
import Expo
import React
import ReactAppDependencyProvider

// v1.7 hotfix #DBG-Sound — App Group UserDefaults 측 native log 저장 helper.
// AlarmkitBridgeModule.swift / OpenAppDismissIntent.swift / NextStepIntent.swift 측 동일 정합.
fileprivate let APP_DELEGATE_DBG_GROUP = "group.com.shuttimer.app"
fileprivate let APP_DELEGATE_DBG_KEY = "native_debug_log_v1"
fileprivate let APP_DELEGATE_DBG_MAX = 300

fileprivate func appendNativeDbg(_ tag: String, _ msg: String) {
  NSLog("[\(tag)] \(msg)")
  guard let d = UserDefaults(suiteName: APP_DELEGATE_DBG_GROUP) else { return }
  let ts = ISO8601DateFormatter().string(from: Date())
  let proc = ProcessInfo.processInfo.processName
  let line = "\(ts) [\(proc)][\(tag)] \(msg)"
  let existing = d.string(forKey: APP_DELEGATE_DBG_KEY) ?? ""
  var lines = existing.isEmpty ? [] : existing.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
  lines.append(line)
  if lines.count > APP_DELEGATE_DBG_MAX { lines = Array(lines.suffix(APP_DELEGATE_DBG_MAX)) }
  d.set(lines.joined(separator: "\n"), forKey: APP_DELEGATE_DBG_KEY)
}

// v1.7 hotfix #DBG-Sound — bundle 측 사운드 wav 진단.
// (a) 파일 누락 (b) 파일 size 미정합 (c) 파일명 정합 + 내용물 미정합 root cause 추적용.
// first16hex = wav magic header ("RIFF....WAVE") + 일부 — 같은 이름 + 다른 음원 영역 식별.
fileprivate func dumpBundleSoundDiagnostics() {
  // 인수인계문 측 명시 5개 wav + JS sounds.ts 측 추가 1개 (= ringtone_12).
  let names = ["ringtone_05", "notification_alarm", "notification_alarm01", "notification_ringtone", "ringtone_12", "alarm_02", "notification_silent_vibe"]
  for name in names {
    if let path = Bundle.main.path(forResource: name, ofType: "wav") {
      let size = ((try? FileManager.default.attributesOfItem(atPath: path))?[.size] as? Int) ?? -1
      var first16hex = "(read fail)"
      if let fh = FileHandle(forReadingAtPath: path) {
        let data = fh.readData(ofLength: 16)
        first16hex = data.map { String(format: "%02x", $0) }.joined()
        fh.closeFile()
      }
      appendNativeDbg("Bundle-DBG", "\(name).wav path=\(path) size=\(size) first16=\(first16hex)")
    } else {
      appendNativeDbg("Bundle-DBG", "\(name).wav NOT FOUND in bundle")
    }
  }
  // bundle 측 .wav 전체 자동 검색 (= 명시 영역 외 dead/extra wav 영역 식별).
  if let bundleURL = Bundle.main.resourceURL,
     let urls = try? FileManager.default.contentsOfDirectory(at: bundleURL, includingPropertiesForKeys: [.fileSizeKey], options: []) {
    let wavs = urls.filter { $0.pathExtension.lowercased() == "wav" }
    appendNativeDbg("Bundle-DBG", "bundle .wav 전체 count=\(wavs.count)")
    for url in wavs {
      let size = ((try? FileManager.default.attributesOfItem(atPath: url.path))?[.size] as? Int) ?? -1
      appendNativeDbg("Bundle-DBG", "wav-list \(url.lastPathComponent) size=\(size)")
    }
  } else {
    appendNativeDbg("Bundle-DBG", "bundle resourceURL nil — wav 자동 검색 skip")
  }
}

@UIApplicationMain
public class AppDelegate: ExpoAppDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ExpoReactNativeFactoryDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    // v1.7 hotfix #DBG-Sound — bundle 측 사운드 wav 진단 (= 앱 launch 1회만).
    dumpBundleSoundDiagnostics()

    let delegate = ReactNativeDelegate()
    let factory = ExpoReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory
    bindReactNativeFactory(factory)

#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  // Linking API
  public override func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
    return super.application(app, open: url, options: options) || RCTLinkingManager.application(app, open: url, options: options)
  }

  // Universal Links
  public override func application(
    _ application: UIApplication,
    continue userActivity: NSUserActivity,
    restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void
  ) -> Bool {
    let result = RCTLinkingManager.application(application, continue: userActivity, restorationHandler: restorationHandler)
    return super.application(application, continue: userActivity, restorationHandler: restorationHandler) || result
  }
}

class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {
  // Extension point for config-plugins

  override func sourceURL(for bridge: RCTBridge) -> URL? {
    // needed to return the correct URL for expo-dev-client.
    bridge.bundleURL ?? bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    return RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: ".expo/.virtual-metro-entry")
#else
    return Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}
