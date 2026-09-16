import { afterEach, describe, expect, test, vi } from "vitest";
import type { SessionUpdate } from "@agentclientprotocol/sdk";

import { ACPAgentSession } from "./acp-agent.js";
import type { AgentStreamEvent } from "../agent-sdk-types.js";
import { createTestLogger } from "../../../test-utils/test-logger.js";

vi.mock("../../../utils/spawn.js", () => ({ spawn: vi.fn() }));

function createSession(): ACPAgentSession {
  return new ACPAgentSession(
    { provider: "claude-acp", cwd: "/tmp/rambla-acp-test" },
    {
      provider: "claude-acp",
      logger: createTestLogger(),
      defaultCommand: ["claude", "--acp"],
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

interface DetailInternals {
  sessionId: string | null;
}

interface EditDetailShape {
  type: "edit";
  filePath: string;
  oldString?: string;
  newString?: string;
  unifiedDiff?: string;
}

function asInternals<T>(session: ACPAgentSession): T {
  return session as unknown as T;
}

function subscribeToolCalls(session: ACPAgentSession): Array<Record<string, unknown>> {
  const items: Array<Record<string, unknown>> = [];
  session.subscribe((event) => {
    const e = event as AgentStreamEvent;
    if (e.type === "timeline" && (e.item as { type?: string }).type === "tool_call") {
      items.push(e.item as unknown as Record<string, unknown>);
    }
  });
  return items;
}

describe("acp-agent.rambla: hunk-trimmed unifiedDiff from whole-file ACP diff blocks", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("edit detail derives a trimmed unifiedDiff from whole-file oldText/newText", async () => {
    const session = createSession();
    asInternals<DetailInternals>(session).sessionId = "session-1";
    const items = subscribeToolCalls(session);

    const oldText = "alpha one\nalpha two\nalpha three\n";
    const newText = "alpha one\nalpha two EDITED\nalpha three\n";
    await session.sessionUpdate({
      sessionId: "session-1",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "t-edit",
        title: "Edit file: b.ts",
        kind: "edit",
        status: "completed",
        locations: [{ path: "/tmp/b.ts" }],
        content: [{ type: "diff", path: "/tmp/b.ts", oldText, newText }],
      } as unknown as SessionUpdate,
    });

    const detail = items[0]!.detail as EditDetailShape;
    expect(detail.type).toBe("edit");
    expect(detail.oldString).toBe(oldText);
    expect(detail.newString).toBe(newText);
    // The derived unifiedDiff carries hunk headers plus +/- lines only for the
    // changed region — every other source line appears once, as context.
    expect(detail.unifiedDiff).toBeDefined();
    expect(detail.unifiedDiff).toContain("@@");
    expect(detail.unifiedDiff).toContain("-alpha two");
    expect(detail.unifiedDiff).toContain("+alpha two EDITED");
    const removed = detail.unifiedDiff!.split("\n").filter((l) => l === "-alpha two");
    expect(removed).toHaveLength(1);
    expect(detail.unifiedDiff).not.toContain("Index:");
    expect(detail.unifiedDiff).not.toContain("===");
  });

  test("edit detail keeps three context lines around the change", async () => {
    const session = createSession();
    asInternals<DetailInternals>(session).sessionId = "session-1";
    const items = subscribeToolCalls(session);

    const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
    const oldText = `${lines.join("\n")}\n`;
    const newText = `${lines.slice(0, 10).join("\n")}\nCHANGED\n${lines.slice(11).join("\n")}\n`;
    await session.sessionUpdate({
      sessionId: "session-1",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "t-ctx",
        title: "Edit file: big.ts",
        kind: "edit",
        status: "completed",
        locations: [{ path: "/tmp/big.ts" }],
        content: [{ type: "diff", path: "/tmp/big.ts", oldText, newText }],
      } as unknown as SessionUpdate,
    });

    const detail = items[0]!.detail as EditDetailShape;
    expect(detail.unifiedDiff).toBeDefined();
    const contentLines = detail.unifiedDiff!.split("\n");
    const hunkStart = contentLines.findIndex((l) => l.startsWith("@@"));
    expect(hunkStart).toBeGreaterThanOrEqual(0);
    // 3 context + 1 remove + 1 add + 3 context = 8 hunk body lines, not 42.
    expect(contentLines.length - hunkStart - 1).toBe(8);
    // Change sits at line 11: 3 lines of trailing context end the hunk.
    expect(contentLines.at(-1)).toBe(" line 14");
  });

  test("edit detail omits unifiedDiff when old and new text are identical", async () => {
    const session = createSession();
    asInternals<DetailInternals>(session).sessionId = "session-1";
    const items = subscribeToolCalls(session);

    const same = "nothing changed\n";
    await session.sessionUpdate({
      sessionId: "session-1",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "t-same",
        title: "Edit file: c.ts",
        kind: "edit",
        status: "completed",
        content: [{ type: "diff", path: "/tmp/c.ts", oldText: same, newText: same }],
      } as unknown as SessionUpdate,
    });

    const detail = items[0]!.detail as EditDetailShape;
    expect(detail.unifiedDiff).toBeUndefined();
  });

  test("agent-supplied text content wins over the derived diff", async () => {
    const session = createSession();
    asInternals<DetailInternals>(session).sessionId = "session-1";
    const items = subscribeToolCalls(session);

    await session.sessionUpdate({
      sessionId: "session-1",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "t-agent",
        title: "Edit file: d.ts",
        kind: "edit",
        status: "completed",
        content: [
          { type: "diff", path: "/tmp/d.ts", oldText: "old\n", newText: "new\n" },
          {
            type: "content",
            content: { type: "text", text: "@@ -1,1 +1,1 @@\n-old\n+new" },
          },
        ],
      } as unknown as SessionUpdate,
    });

    const detail = items[0]!.detail as EditDetailShape;
    expect(detail.unifiedDiff).toBe("@@ -1,1 +1,1 @@\n-old\n+new");
  });

  test("write detail (whole-file overwrite) derives a trimmed unifiedDiff too", async () => {
    const session = createSession();
    asInternals<DetailInternals>(session).sessionId = "session-1";
    const items = subscribeToolCalls(session);

    const oldText = "w1\nw2\nw3\n";
    const newText = "w1\nW2 REPLACED\nw3\n";
    await session.sessionUpdate({
      sessionId: "session-1",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "t-write",
        title: "Write file: a.ts",
        kind: "edit",
        status: "completed",
        rawInput: { path: "a.ts", content: newText, overwrite: true },
        locations: [{ path: "/tmp/a.ts" }],
        content: [{ type: "diff", path: "/tmp/a.ts", oldText, newText }],
      } as unknown as SessionUpdate,
    });

    const detail = items[0]!.detail as unknown as {
      type: "write";
      unifiedDiff?: string;
    };
    expect(detail.type).toBe("write");
    expect(detail.unifiedDiff).toBeDefined();
    expect(detail.unifiedDiff).toContain("-w2");
    expect(detail.unifiedDiff).toContain("+W2 REPLACED");
  });

  test("new-file creations (no oldText) still map without a derived diff", async () => {
    const session = createSession();
    asInternals<DetailInternals>(session).sessionId = "session-1";
    const items = subscribeToolCalls(session);

    await session.sessionUpdate({
      sessionId: "session-1",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "t-new",
        title: "Write file: new.ts",
        kind: "edit",
        status: "completed",
        rawInput: { path: "new.ts", content: "fresh\n" },
        content: [{ type: "diff", path: "/tmp/new.ts", newText: "fresh\n" }],
      } as unknown as SessionUpdate,
    });

    const detail = items[0]!.detail as unknown as {
      type: "write";
      oldString?: string;
      unifiedDiff?: string;
    };
    expect(detail.type).toBe("write");
    expect(detail.oldString).toBeUndefined();
    expect(detail.unifiedDiff).toBeUndefined();
  });
});
