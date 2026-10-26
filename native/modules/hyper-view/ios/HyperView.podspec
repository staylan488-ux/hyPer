Pod::Spec.new do |s|
  s.name           = 'HyperView'
  s.version        = '1.0.0'
  s.summary        = 'Where a view really sits on screen.'
  s.description    = 'Reads a view frame in window points, as UIKit laid it out.'
  s.license        = 'UNLICENSED'
  s.author         = 'hyPer'
  s.homepage       = 'https://github.com/staylan488-ux/hyPer'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: 'https://github.com/staylan488-ux/hyPer.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '**/*.{h,m,swift}'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
