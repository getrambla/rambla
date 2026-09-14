import { describe, expect, test } from "vitest";
import type { ProviderRamblaToolsPolicy } from "@getpaseo/protocol/provider-config";

import { isRamblaToolEnabled, resolveRamblaToolPolicy } from "./paseo-tool-policy.js";

describe("Rambla tool policy", () => {
  test("defaults to all Rambla tools and resolves only the exact provider ID", () => {
    const customPolicy = {
      enabled: true,
      disabledTools: ["list_agents"],
    } satisfies ProviderRamblaToolsPolicy;

    expect(
      resolveRamblaToolPolicy("custom-claude", {
        claude: { paseoTools: { enabled: false } },
        "custom-claude": { paseoTools: customPolicy },
      }),
    ).toBe(customPolicy);
    expect(resolveRamblaToolPolicy("other-custom", { claude: { paseoTools: customPolicy } })).toBe(
      undefined,
    );
    expect(isRamblaToolEnabled(undefined, "list_agents")).toBe(true);
  });

  test("applies the provider gate and sparse disabled tools without filtering speak", () => {
    expect(isRamblaToolEnabled({ enabled: false }, "list_agents")).toBe(false);
    expect(isRamblaToolEnabled({ enabled: false }, "speak")).toBe(true);
    expect(
      isRamblaToolEnabled({ enabled: true, disabledTools: ["list_agents"] }, "list_agents"),
    ).toBe(false);
    expect(
      isRamblaToolEnabled({ enabled: true, disabledTools: ["list_agents"] }, "create_agent"),
    ).toBe(true);
  });
});
