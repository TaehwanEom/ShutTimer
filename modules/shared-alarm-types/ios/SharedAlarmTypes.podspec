Pod::Spec.new do |s|
  s.name           = 'SharedAlarmTypes'
  s.version        = '1.0.0'
  s.summary        = 'Shared AlarmKit metadata types for ShutTimer'
  s.description    = 'AlarmAttributes metadata struct shared between AlarmkitBridge Pod and widget extension target. Enables ActivityKit type identity match.'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = {
    :ios => '26.0',
    :tvos => '26.0'
  }
  s.source         = { git: '' }
  s.static_framework = true

  # v1.7 hotfix #LATypeLookup-Fix — module identity 명시화 영역.
  #   직전 상태 = `s.static_framework = true` + `DEFINES_MODULE = YES` 측 자동 module name.
  #   단 = main app target + widget extension target 측 = 자체 module instance 측 build 영역 가능 (= CocoaPods 알려진 문제).
  #   본 정정 = module_name + header_dir + PRODUCT_MODULE_NAME 명시 → 두 target 측 = 동일 module identity 보장 시도 영역.
  #   증거 = nilcoalescing.com 측 AlarmKit 공식 권장 = "single Swift file assigned to both targets" 정합.
  s.module_name    = 'SharedAlarmTypes'
  s.header_dir     = 'SharedAlarmTypes'

  # Swift module identity 통합 위해 DEFINES_MODULE 필수 + PRODUCT_MODULE_NAME 명시.
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'PRODUCT_MODULE_NAME' => 'SharedAlarmTypes',
    'SWIFT_INSTALL_OBJC_HEADER' => 'YES',
  }

  s.source_files = '*.swift'
end
