import { describe, expect, it } from "vitest";

import { getRamblaToolLeafName, isRamblaToolName } from "@getrambla/protocol/tool-name-normalization";

describe("isRamblaToolName", () => {
  it("detects Claude Code format", () => {
    expect(isRamblaToolName("mcp__rambla__create_agent")).toBe(true);
    expect(isRamblaToolName("mcp__rambla__list_agents")).toBe(true);
  });

  it("detects rambla_voice variant", () => {
    expect(isRamblaToolName("mcp__rambla_voice__create_agent")).toBe(true);
    expect(isRamblaToolName("rambla_voice.create_agent")).toBe(true);
  });

  it("excludes speak tools", () => {
    expect(isRamblaToolName("mcp__rambla_voice__speak")).toBe(false);
    expect(isRamblaToolName("mcp__rambla__speak")).toBe(false);
    expect(isRamblaToolName("rambla.speak")).toBe(false);
  });

  it("detects Codex dot format", () => {
    expect(isRamblaToolName("rambla.create_agent")).toBe(true);
  });

  it("rejects non-rambla tools", () => {
    expect(isRamblaToolName("Bash")).toBe(false);
    expect(isRamblaToolName("Read")).toBe(false);
    expect(isRamblaToolName("mcp__other_server__some_tool")).toBe(false);
  });
});

describe("getRamblaToolLeafName", () => {
  it("extracts leaf from Claude Code format", () => {
    expect(getRamblaToolLeafName("mcp__rambla__create_agent")).toBe("create_agent");
  });

  it("extracts leaf from Codex format", () => {
    expect(getRamblaToolLeafName("rambla.create_agent")).toBe("create_agent");
    expect(getRamblaToolLeafName("rambla.list_agents")).toBe("list_agents");
  });

  it("returns null for non-rambla tools", () => {
    expect(getRamblaToolLeafName("Bash")).toBeNull();
  });
});
