// RAMBLA-FORK: fix: 2026-09-24-fix-subagent-default-provider-model.md: covers create_agent provider/model defaulting to the caller.
import { describe, expect, test } from "vitest";
import type { AgentSessionConfig } from "../agent-sdk-types.js";
import type { ManagedAgent } from "../agent-manager.js";
import { resolveCreateAgentProviderModel } from "./resolve-create-agent-provider.rambla.js";

function createCaller(overrides?: {
  provider?: ManagedAgent["provider"];
  config?: Partial<AgentSessionConfig>;
}): ManagedAgent {
  const config: AgentSessionConfig = {
    provider: overrides?.provider ?? "glm-acp-agent",
    cwd: "/tmp/project",
    ...overrides?.config,
  };
  return {
    id: "caller-1",
    provider: overrides?.provider ?? "glm-acp-agent",
    cwd: "/tmp/project",
    config,
  } as ManagedAgent;
}

describe("resolveCreateAgentProviderModel", () => {
  test("omitted provider inherits the caller's provider/model", async () => {
    const caller = createCaller({
      provider: "glm-acp-agent",
      config: { model: "glm-4.7" },
    });
    expect(await resolveCreateAgentProviderModel(caller, undefined)).toBe("glm-acp-agent/glm-4.7");
  });

  test("explicit provider wins over the caller's identity", async () => {
    const caller = createCaller({
      provider: "glm-acp-agent",
      config: { model: "glm-4.7" },
    });
    await expect(resolveCreateAgentProviderModel(caller, "codex/gpt-5.4")).resolves.toBe(
      "codex/gpt-5.4",
    );
  });

  test("top-level omission errors", async () => {
    await expect(resolveCreateAgentProviderModel(undefined, undefined)).rejects.toThrow(
      /provider must be provider\/model/,
    );
  });

  test("caller with unset config.model falls back to the provider's default model", async () => {
    const caller = createCaller({ provider: "glm-acp-agent" });
    expect(await resolveCreateAgentProviderModel(caller, undefined, () => "glm-4.6")).toBe(
      "glm-acp-agent/glm-4.6",
    );
  });

  test("default-model resolver returning undefined yields provider-only string", async () => {
    const caller = createCaller({ provider: "glm-acp-agent" });
    expect(await resolveCreateAgentProviderModel(caller, undefined, () => undefined)).toBe(
      "glm-acp-agent",
    );
  });
});
