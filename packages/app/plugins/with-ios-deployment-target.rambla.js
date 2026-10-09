const { withPodfile } = require("expo/config-plugins");

// RAMBLA-FORK: fix (no-plan) raise pod iOS deployment targets to the configured minimum
const POST_INSTALL_ANCHOR = "  post_install do |installer|";
const DEPLOYMENT_TARGET_MARKER = "# RAMBLA-FORK: raise pod iOS deployment targets";
const PODFILE_DEPLOYMENT_TARGET_HOOK = [
  `    ${DEPLOYMENT_TARGET_MARKER} (source of truth: ios.deploymentTarget in app.config.js)`,
  "    min_ios_deployment_target = podfile_properties['ios.deploymentTarget']",
  "    raise 'ios.deploymentTarget is missing from Podfile.properties.json; set ios.deploymentTarget via expo-build-properties in app.config.js' unless min_ios_deployment_target",
  "    installer.pods_project.targets.each do |target|",
  "      target.build_configurations.each do |build_configuration|",
  "        current_target = build_configuration.build_settings['IPHONEOS_DEPLOYMENT_TARGET']",
  "        next if current_target.nil? || current_target.to_f >= min_ios_deployment_target.to_f",
  "        build_configuration.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = min_ios_deployment_target",
  "      end",
  "    end",
].join("\n");

function configurePodfileDeploymentTarget(contents) {
  if (contents.includes(DEPLOYMENT_TARGET_MARKER)) {
    return contents;
  }
  if (!contents.includes(POST_INSTALL_ANCHOR)) {
    throw new Error("Could not add the iOS deployment target raise to the Podfile");
  }
  return contents.replace(
    POST_INSTALL_ANCHOR,
    `${POST_INSTALL_ANCHOR}\n${PODFILE_DEPLOYMENT_TARGET_HOOK}`,
  );
}

function withIosDeploymentTarget(config) {
  return withPodfile(config, (modConfig) => {
    modConfig.modResults.contents = configurePodfileDeploymentTarget(modConfig.modResults.contents);
    return modConfig;
  });
}

module.exports = withIosDeploymentTarget;
module.exports.configurePodfileDeploymentTarget = configurePodfileDeploymentTarget;
module.exports.DEPLOYMENT_TARGET_MARKER = DEPLOYMENT_TARGET_MARKER;
