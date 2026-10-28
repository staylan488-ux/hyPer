Pod::Spec.new do |s|
  s.name           = 'HyperRun'
  s.version        = '1.0.0'
  s.summary        = 'The run recorder.'
  s.description    = 'Records GPS runs in the background with crash recovery, lock-screen controls, audio cues and the run Live Activity.'
  s.license        = 'UNLICENSED'
  s.author         = 'hyPer'
  s.homepage       = 'https://github.com/staylan488-ux/hyPer'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: 'https://github.com/staylan488-ux/hyPer.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # The lock-screen intent (../shared) is compiled into the app and the widget
  # extension instead, by plugins/withHyperWidgets.js.
  s.source_files = '**/*.{h,m,swift}'
  s.frameworks = 'ActivityKit', 'AVFoundation', 'CoreLocation', 'CoreMotion'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
