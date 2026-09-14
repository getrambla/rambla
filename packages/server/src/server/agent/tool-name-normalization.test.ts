import { describe, expect, it } from "vitest";

import { getRamblaToolLeafName, isRamblaToolName } from "@getpaseo/protocol/tool-name-normalization";

describe("isRamblaToolName", () => {
  it("detects Claude Code format", () => {
    expect(isRamblaToolName("mcp__paseo__create_agent")).toBe(true);
    expect(isRamblaToolName("mcp__paseo__list_agents")).toBe(true);
  });

  it("detects paseo_voice variant", () => {
    expect(isRamblaToolName("mcp__paseo_voice__create_agent")).toBe(true);
    expect(isRamblaToolName("paseo_voice.create_agent")).toBe(true);
  });

  it("excludes speak tools", () => {
    expect(isRamblaToolName("mcp__paseo_voice__speak")).toBe(false);
    expect(isRamblaToolName("mcp__paseo__speak")).toBe(false);
    expect(isRamblaToolName("paseo.speak")).toBe(false);
  });

  it("detects Codex dot format", () => {
    expect(isRamblaToolName("paseo.create_agent")).toBe(true);
  });

  it("rejects non-paseo tools", () => {
    expect(isRamblaToolName("Bash")).toBe(false);
    expect(isRamblaToolName("Read")).toBe(false);
    expect(isRamblaToolName("mcp__other_server__some_tool")).toBe(false);
  });
});

describe("getRamblaToolLeafName", () => {
  it("extracts leaf from Claude Code format", () => {
    expect(getRamblaToolLeafName("mcp__paseo__create_agent")).toBe("create_agent");
  });

  it("extracts leaf from Codex format", () => {
    expect(getRamblaToolLeafName("paseo.create_agent")).toBe("create_agent");
    expect(getRamblaToolLeafName("paseo.list_agents")).toBe("list_agents");
  });

  it("returns null for non-paseo tools", () => {
    expect(getRamblaToolLeafName("Bash")).toBeNull();
  });
});
