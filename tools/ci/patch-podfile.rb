# Run after `expo prebuild`: compile ExpoModulesJSI in Swift 5 language mode so the Swift 6.2
# strict-concurrency "sending ... risks causing data races" errors (expo/expo#50470) become warnings.
podfile = File.read("ios/Podfile")
inject = <<~RUBY
  post_install do |installer|
    installer.pods_project.targets.each do |t|
      next unless %w[ExpoModulesJSI ExpoModulesCore].include?(t.name)
      t.build_configurations.each do |c|
        c.build_settings["SWIFT_VERSION"] = "5.0"
        c.build_settings["SWIFT_STRICT_CONCURRENCY"] = "minimal"
      end
    end
RUBY
abort("post_install hook not found in ios/Podfile") unless podfile.include?("post_install do |installer|")
File.write("ios/Podfile", podfile.sub("post_install do |installer|\n", inject))
puts "Podfile patched: ExpoModulesJSI/Core → Swift 5 mode, minimal concurrency checks"
