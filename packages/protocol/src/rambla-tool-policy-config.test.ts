import { describe, expect, test } from "vitest";

import { MutableDaemonConfigPatchSchema, MutableDaemonConfigSchema } from "./messages.js";
import { ProviderOverrideSchema, ProviderRamblaToolsPolicySchema } from "./provider-config.js";

describe("provider Rambla-tool policy", () => {
  test("accepts arbitrary tool IDs and leaves an empty policy enabled by default", () => {
    expect(
      ProviderRamblaToolsPolicySchema.parse({
        disabledTools: ["future_tool", "browser_future_tool"],
      }),
    ).toEqual({
      disabledTools: ["future_tool", "browser_future_tool"],
    });
    expect(ProviderRamblaToolsPolicySchema.parse({})).toEqual({});
    expect(ProviderOverrideSchema.parse({}).ramblaTools).toBeUndefined();
  });

  test("accepts ramblaTools on persisted provider overrides", () => {
    expect(
      ProviderOverrideSchema.parse({
        extends: "claude",
        ramblaTools: {
          enabled: false,
          disabledTools: ["create_workspace"],
        },
      }).ramblaTools,
    ).toEqual({
      enabled: false,
      disabledTools: ["create_workspace"],
    });
  });

  test("accepts ramblaTools when reading and patching mutable daemon providers", () => {
    expect(
      MutableDaemonConfigSchema.parse({
        mcp: { injectIntoAgents: true },
        providers: {
          codex: {
            ramblaTools: { enabled: false, disabledTools: ["future_tool"] },
          },
        },
      }).providers.codex?.ramblaTools,
    ).toEqual({
      enabled: false,
      disabledTools: ["future_tool"],
    });

    expect(
      MutableDaemonConfigPatchSchema.parse({
        providers: {
          codex: {
            ramblaTools: { disabledTools: ["browser_future_tool"] },
          },
        },
      }).providers?.codex?.ramblaTools,
    ).toEqual({ disabledTools: ["browser_future_tool"] });
  });
});
