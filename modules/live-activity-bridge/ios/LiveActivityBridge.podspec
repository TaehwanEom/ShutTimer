Pod::Spec.new do |s|
  s.name           = 'LiveActivityBridge'
  s.version        = '1.0.0'
  s.summary        = 'ShutTimer Live Activity bridge'
  s.description    = 'iOS 16.2+ ActivityKit bridge for routine progress display'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = {
    :ios => '16.2',
    :tvos => '16.2'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
