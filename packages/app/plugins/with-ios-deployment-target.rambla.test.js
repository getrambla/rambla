import { describe, expect, it } from "vitest";

// RAMBLA-FORK: tests for the pod iOS deployment target raise plugin
const {
  configurePodfileDeploymentTarget,
  DEPLOYMENT_TARGET_MARKER,
} = require("./with-ios-deployment-target.rambla");

const PODFILE = [
  "platform :ios, podfile_properties['ios.deploymentTarget'] || '15.1'",
  "",
  "  post_install do |installer|",
  "    react_native_post_install(",
  "      installer,",
  "      config[:reactNativePath],",
  "    )",
  "  end",
  "end",
].join("\n");

describe("configurePodfileDeploymentTarget", () => {
  it("raises pod deployment targets inside the existing post_install block", () => {
    const configured = configurePodfileDeploymentTarget(PODFILE);

    expect(configured).toContain("podfile_properties['ios.deploymentTarget']");
    expect(configured).toContain("react_native_post_install(");
    expect(configured.indexOf("post_install do |installer|")).toBeLessThan(
      configured.indexOf("react_native_post_install("),
    );
    // Upstream's template has its own `|| '15.1'` fallback on the platform line; the
    // fork hook must not add another one of its own.
    expect(configured.split(DEPLOYMENT_TARGET_MARKER)[1]).not.toContain("|| '15.1'");
  });

  it("fails loudly when the deployment target property is missing", () => {
    const configured = configurePodfileDeploymentTarget(PODFILE);

    expect(configured).toMatch(/raise 'ios\.deploymentTarget is missing/);
    expect(configured).not.toMatch(/or ['"]15\.1['"]/);
  });

  it("is idempotent", () => {
    const configured = configurePodfileDeploymentTarget(PODFILE);

    expect(configurePodfileDeploymentTarget(configured)).toBe(configured);
  });

  it("rejects a Podfile without a post_install block", () => {
    expect(() => configurePodfileDeploymentTarget("platform :ios, '15.1'\nend")).toThrow(
      "Could not add the iOS deployment target raise to the Podfile",
    );
  });

  it("only raises pods below the target", () => {
    const configured = configurePodfileDeploymentTarget(PODFILE);

    expect(configured).toContain(
      "next if current_target.nil? || current_target.to_f >= min_ios_deployment_target.to_f",
    );
  });
});
