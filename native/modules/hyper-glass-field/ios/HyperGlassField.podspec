Pod::Spec.new do |s|
  s.name           = 'HyperGlassField'
  s.version        = '1.0.0'
  s.summary        = 'The molten-glass field behind the app.'
  s.description    = 'A stable-fluids simulation (advect, vorticity, pressure) on half-float Metal textures, drawn as thin edges of light.'
  s.license        = 'UNLICENSED'
  s.author         = 'hyPer'
  s.homepage       = 'https://github.com/staylan488-ux/hyPer'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: 'https://github.com/staylan488-ux/hyPer.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'Metal', 'QuartzCore'

  s.source_files = '**/*.{h,m,swift}'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
