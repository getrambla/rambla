import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ACPAgentClient, ACPAgentSession } from "./acp-agent.js";
import {
  createCaptureLogger,
  type CreateCaptureLoggerResult,
} from "../../../test-utils/capture-logger.js";

const STUB_AGENT = "#!/bin/sh\necho 'stub agent: simulated startup failure' >&2\nsleep 30\n";

describe("acp-agent.rambla: ACP probe failure logging", () => {
  let stubDir: string;
  let stubAgentPath: string;
  let capture: CreateCaptureLoggerResult;

  beforeAll(() => {
    stubDir = mkdtempSync(join(tmpdir(), "rambla-acp-probe-log-"));
    stubAgentPath = join(stubDir, "stub-acp-agent");
    writeFileSync(stubAgentPath, STUB_AGENT);
    chmodSync(stubAgentPath, 0o755);
  });

  afterAll(() => {
    rmSync(stubDir, { recursive: true, force: true });
  });

  afterEach(() => {
    capture?.logger.flushSync?.();
  });

  function createSession(command: string = stubAgentPath): ACPAgentClient {
    capture = createCaptureLogger();
    return new ACPAgentClient({
      provider: "claude-acp",
      logger: capture.logger,
      defaultCommand: [command],
      defaultModes: [],
      capabilities: {
        supportsStreaming: true,
        supportsSessionPersistence: true,
        supportsDynamicModes: true,
        supportsMcpServers: true,
        supportsReasoningStream: true,
        supportsToolInvocations: true,
      },
    });
  }

  test("fetchCatalog logs agent stderr at error level when the probe never completes initialize", async () => {
    const session = createSession();
    const controller = new AbortController();
    const abort = setTimeout(() => controller.abort(new Error("refresh deadline")), 5_000);
    await expect(
      session.fetchCatalog(
        { scope: "workspace", cwd: "/tmp/rambla-acp-probe-log-test" },
        {
          signal: controller.signal,
          runActivity: (_name, operation) => operation(),
        },
      ),
    ).rejects.toThrow();
    clearTimeout(abort);
    const stderrErrors = capture.calls.filter(
      (call) =>
        call.level.label === "error" &&
        call.message === "ACP agent produced stderr but never completed initialize",
    );
    console.log("CALLS:", JSON.stringify(capture.calls, null, 1));
    expect(stderrErrors).toHaveLength(1);
    expect(stderrErrors[0]?.details.provider).toBe("claude-acp");
    expect(String(stderrErrors[0]?.details.stderr)).toContain(
      "stub agent: simulated startup failure",
    );
  }, 30_000);
});

describe("acp-agent.rambla: ACP session initialization failure logging (resume without handle)", () => {
  let capture: CreateCaptureLoggerResult;

  function createSessionWithoutHandle(): ACPAgentSession {
    capture = createCaptureLogger();
    return new ACPAgentSession(
      { provider: "claude-acp", cwd: "/tmp/rambla-acp-init-log-test" },
      {
        provider: "claude-acp",
        logger: capture.logger,
        defaultCommand: ["/bin/true"],
        defaultModes: [],
        capabilities: {
          supportsStreaming: true,
          supportsSessionPersistence: true,
          supportsDynamicModes: true,
          supportsMcpServers: true,
          supportsReasoningStream: true,
          supportsToolInvocations: true,
        },
      },
    );
  }

  test("initializeResumedSession logs the failure at error level and rethrows", async () => {
    const session = createSessionWithoutHandle();
    await expect(session.initializeResumedSession()).rejects.toThrow(
      "Resume requested without persistence handle",
    );
    const initErrors = capture.calls.filter(
      (call) =>
        call.level.label === "error" && call.message === "ACP session initialization failed",
    );
    expect(initErrors).toHaveLength(1);
    expect(initErrors[0]?.details.provider).toBe("claude-acp");
  });
});

describe("acp-agent.rambla: ACP availability check failure logging", () => {
  let capture: CreateCaptureLoggerResult;

  function createMissingBinaryClient(): ACPAgentClient {
    capture = createCaptureLogger();
    return new ACPAgentClient({
      provider: "claude-acp",
      logger: capture.logger,
      defaultCommand: ["/tmp/rambla-does-not-exist-xyz"],
      defaultModes: [],
      capabilities: {
        supportsStreaming: true,
        supportsSessionPersistence: true,
        supportsDynamicModes: true,
        supportsMcpServers: true,
        supportsReasoningStream: true,
        supportsToolInvocations: true,
      },
    });
  }

  test("isAvailable returns false and logs the launch resolution failure", async () => {
    const client = createMissingBinaryClient();
    await expect(client.isAvailable()).resolves.toBe(false);
    const errors = capture.calls.filter(
      (call) =>
        call.level.label === "error" && call.message === "ACP provider availability check failed",
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]?.details.provider).toBe("claude-acp");
  });
});
