Pod::Spec.new do |s|
  s.name           = 'HyperHealth'
  s.version        = '1.0.0'
  s.summary        = 'Body-weight reading from Apple Health.'
  s.description    = 'Asks for read access to body mass, reads weight samples and reports new ones.'
  s.license        = 'UNLICENSED'
  s.author         = 'hyPer'
  s.homepage       = 'https://github.com/staylan488-ux/hyPer'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: 'https://github.com/staylan488-ux/hyPer.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'HealthKit'

  s.source_files = '**/*.{h,m,swift}'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
