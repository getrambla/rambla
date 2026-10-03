// RAMBLA-FORK: feature: 2026-10-02-feat-server-tool-install.md: proves the daemon.tool RPCs and the toolInstall flag parse in both directions.
import { describe, expect, test } from "vitest";
import {
  ServerInfoStatusPayloadSchema,
  SessionInboundMessageSchema,
  SessionOutboundMessageSchema,
} from "./messages.js";

const requests = [
  { type: "daemon.tool.list.request", requestId: "req-list" },
  { type: "daemon.tool.install.request", requestId: "req-install", names: ["agents", "gh"] },
  {
    type: "daemon.tool.install.request",
    requestId: "req-install-version",
    names: ["claude"],
    version: "1.2.3",
  },
  {
    type: "daemon.tool.install.request",
    requestId: "req-install-latest",
    names: ["uv"],
    latest: true,
  },
  { type: "daemon.tool.upgrade.request", requestId: "req-upgrade", names: [] },
  {
    type: "daemon.tool.upgrade.request",
    requestId: "req-upgrade-latest",
    names: ["codex"],
    latest: true,
  },
  { type: "daemon.tool.uninstall.request", requestId: "req-uninstall", names: ["pi"] },
];

const responses = [
  {
    type: "daemon.tool.list.response",
    payload: {
      requestId: "req-list",
      ok: true,
      output: "",
      tools: [
        {
          name: "claude",
          pin: "2.1.287",
          group: "agents",
          providerId: "claude",
          installed: "2.1.287",
        },
        { name: "gh", pin: "2.102.0", group: null, providerId: null, installed: null },
      ],
    },
  },
  {
    type: "daemon.tool.list.response",
    payload: { requestId: "req-list", ok: false, output: "mise not found on the host", tools: [] },
  },
  {
    type: "daemon.tool.install.response",
    payload: { requestId: "req-install", ok: true, output: "mise claude@2.1.287 installed" },
  },
  {
    type: "daemon.tool.upgrade.response",
    payload: { requestId: "req-upgrade", ok: false, output: "mise ERROR failed" },
  },
  {
    type: "daemon.tool.uninstall.response",
    payload: { requestId: "req-uninstall", ok: true, output: "" },
  },
];

describe("daemon.tool wire schemas", () => {
  test.each(requests)("the inbound union accepts $type ($requestId)", (request) => {
    expect(SessionInboundMessageSchema.parse(request)).toEqual(request);
  });

  test.each(responses)("the outbound union accepts $type ($payload.requestId)", (response) => {
    expect(SessionOutboundMessageSchema.parse(response)).toEqual(response);
  });

  test("server_info keeps toolInstall: true and still parses without it", () => {
    expect(
      ServerInfoStatusPayloadSchema.parse({
        status: "server_info",
        serverId: "new-host",
        features: { toolInstall: true },
      }).features?.toolInstall,
    ).toBe(true);
    expect(
      ServerInfoStatusPayloadSchema.parse({
        status: "server_info",
        serverId: "old-host",
        features: {},
      }).features?.toolInstall,
    ).toBeUndefined();
  });
});
