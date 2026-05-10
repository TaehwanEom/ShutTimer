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

  # Swift module identity 통합 위해 DEFINES_MODULE 필수
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = '*.swift'
end
