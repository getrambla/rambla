# RAMBLA-FORK: feature: 2026-10-01-feat-webrtc-p2p-upgrade.md: iOS pod for the phone module over the libdatachannel CocoaPod.
Pod::Spec.new do |s|
  s.name           = 'RamblaDataChannel'
  s.version        = '0.1.0'
  s.summary        = 'WebRTC DataChannel peers for Rambla'
  s.description    = 'WebRTC DataChannel peers for Rambla'
  s.license        = 'Apache-2.0'
  s.author         = 'Rambla'
  s.homepage       = 'https://rambla.sh'
  s.platforms      = { :ios => '13.4' }
  s.swift_version  = '5.4'
  s.source         = { :path => '.' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.dependency 'libdatachannel', '0.24.4'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "*.swift"

  s.test_spec 'Tests' do |test_spec|
    test_spec.source_files = 'Tests/*.swift'
  end
end
