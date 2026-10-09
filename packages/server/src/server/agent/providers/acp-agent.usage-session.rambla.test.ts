// RAMBLA-FORK: feature: 2026-10-09-merge-upstream-v0-11-1.md: ACP sessions report their provider, model, launch env, and key for usage discovery.
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { ACPAgentSession } from "./acp-agent.js";
import { createTestLogger } from "../../../test-utils/test-logger.js";

function createSession(launchEnv: Record<string, string>): ACPAgentSession {
  return new ACPAgentSession(
    { provider: "acp", cwd: "/tmp/rambla-acp-test", model: "glm-5.3" },
    {
      provider: "acp",
      logger: createTestLogger(),
      defaultCommand: ["glm-acp-agent"],
      defaultModes: [],
      capabilities: {
        supportsStreaming: true,
        supportsSessionPersistence: true,
        supportsDynamicModes: true,
        supportsMcpServers: true,
        supportsReasoningStream: true,
        supportsToolInvocations: true,
      },
      launchEnv,
    },
  );
}

describe("ACPAgentSession.usageSession", () => {
  let originalXdg: string | undefined;

  beforeEach(() => {
    originalXdg = process.env["XDG_CONFIG_HOME"];
    process.env["XDG_CONFIG_HOME"] = "/tmp/rambla-usage-session-xdg";
  });

  afterEach(() => {
    if (originalXdg === undefined) delete process.env["XDG_CONFIG_HOME"];
    else process.env["XDG_CONFIG_HOME"] = originalXdg;
  });

  test("reports the session's provider and model", () => {
    const usage = createSession({ GLM_EXTRA: "1" }).usageSession();
    expect(usage?.provider).toBe("acp");
    expect(usage?.model).toBe("glm-5.3");
  });

  test("reports the launch env overlaid on the daemon's env, the overlay winning", () => {
    const usage = createSession({ GLM_EXTRA: "1", XDG_CONFIG_HOME: "/tmp/overlay-xdg" });
    const env = usage.usageSession()?.env;
    expect(env?.["GLM_EXTRA"]).toBe("1");
    expect(env?.["HOME"]).toBe(process.env["HOME"]);
    expect(env?.["XDG_CONFIG_HOME"]).toBe("/tmp/overlay-xdg");
  });

  test("carries the daemon's XDG_CONFIG_HOME when the overlay does not set it", () => {
    const env = createSession({ GLM_EXTRA: "1" }).usageSession()?.env;
    expect(env?.["XDG_CONFIG_HOME"]).toBe("/tmp/rambla-usage-session-xdg");
  });

  test("keeps the same key across calls", () => {
    const session = createSession({});
    const first = session.usageSession()?.sessionKey;
    expect(first).toEqual(expect.any(String));
    expect(session.usageSession()?.sessionKey).toBe(first);
  });

  test("returns null after close", async () => {
    const session = createSession({});
    await session.close();
    expect(session.usageSession()).toBeNull();
  });
});
