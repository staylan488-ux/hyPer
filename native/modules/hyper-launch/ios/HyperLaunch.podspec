Pod::Spec.new do |s|
  s.name           = 'HyperLaunch'
  s.version        = '1.0.0'
  s.summary        = 'Presses from outside the app.'
  s.description    = 'Keeps a press of the Snap a meal control, an App Shortcut or a Home Screen quick action for the app.'
  s.license        = 'UNLICENSED'
  s.author         = 'hyPer'
  s.homepage       = 'https://github.com/staylan488-ux/hyPer'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: 'https://github.com/staylan488-ux/hyPer.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # ios/ only: the intents in ../shared go into the app and the widget
  # extension (plugins/withHyperWidgets.js), never into a pod.
  s.source_files = '**/*.{h,m,swift}'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
