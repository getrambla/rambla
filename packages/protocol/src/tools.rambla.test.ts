// RAMBLA-FORK: feature: 2026-10-02-feat-server-tools-install.md: proves the tools RPCs and the toolsInstall flag parse in both directions.
import { describe, expect, test } from "vitest";
import {
  ServerInfoStatusPayloadSchema,
  SessionInboundMessageSchema,
  SessionOutboundMessageSchema,
} from "./messages.js";

const requests = [
  { type: "daemon.tools.list.request", requestId: "req-list" },
  { type: "daemon.tools.install.request", requestId: "req-install", names: ["agents", "gh"] },
  {
    type: "daemon.tools.install.request",
    requestId: "req-install-version",
    names: ["claude"],
    version: "1.2.3",
  },
  {
    type: "daemon.tools.install.request",
    requestId: "req-install-latest",
    names: ["uv"],
    latest: true,
  },
  { type: "daemon.tools.upgrade.request", requestId: "req-upgrade", names: [] },
  {
    type: "daemon.tools.upgrade.request",
    requestId: "req-upgrade-latest",
    names: ["codex"],
    latest: true,
  },
  { type: "daemon.tools.uninstall.request", requestId: "req-uninstall", names: ["pi"] },
];

const responses = [
  {
    type: "daemon.tools.list.response",
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
    type: "daemon.tools.list.response",
    payload: { requestId: "req-list", ok: false, output: "mise not found on the host", tools: [] },
  },
  {
    type: "daemon.tools.install.response",
    payload: { requestId: "req-install", ok: true, output: "mise claude@2.1.287 installed" },
  },
  {
    type: "daemon.tools.upgrade.response",
    payload: { requestId: "req-upgrade", ok: false, output: "mise ERROR failed" },
  },
  {
    type: "daemon.tools.uninstall.response",
    payload: { requestId: "req-uninstall", ok: true, output: "" },
  },
];

describe("tools wire schemas", () => {
  test.each(requests)("the inbound union accepts $type ($requestId)", (request) => {
    expect(SessionInboundMessageSchema.parse(request)).toEqual(request);
  });

  test.each(responses)("the outbound union accepts $type ($payload.requestId)", (response) => {
    expect(SessionOutboundMessageSchema.parse(response)).toEqual(response);
  });

  test("server_info keeps toolsInstall: true and still parses without it", () => {
    expect(
      ServerInfoStatusPayloadSchema.parse({
        status: "server_info",
        serverId: "new-host",
        features: { toolsInstall: true },
      }).features?.toolsInstall,
    ).toBe(true);
    expect(
      ServerInfoStatusPayloadSchema.parse({
        status: "server_info",
        serverId: "old-host",
        features: {},
      }).features?.toolsInstall,
    ).toBeUndefined();
  });
});
