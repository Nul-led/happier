require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'HappierActivityNotifications'
  s.version        = package['version']
  s.summary        = 'Happier native Activity remote alert consumer'
  s.description    = package['description'] || s.summary
  s.homepage       = 'https://happier.dev'
  s.license        = { :type => 'MIT' }
  s.authors        = { 'Happier' => 'dev@happier.dev' }
  s.platforms      = { :ios => '16.0' }
  s.swift_version  = '5.9'
  s.source         = { :path => '.' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES'
  }

  s.source_files = '**/*.{h,m,mm,swift}'
  # The notification service extension is compiled into its own app-extension
  # target by the config plugin. It must not link ExpoModulesCore or run inside
  # the app process.
  s.exclude_files = [
    'ActivityNotificationEnricher.swift',
    'notificationService/**/*',
  ]
end
