import { describe, expect, it } from "vitest";
import { availableStarterTriggerConnections } from "./starter-trigger.js";

describe("starter trigger connections", () => {
  it("returns only concrete connections that can back the generated trigger", () => {
    expect(
      availableStarterTriggerConnections(
        {
          github: [
            {
              slug: "github-getrambla",
              accountLogin: "getrambla",
              accountType: "Organization",
              repositories: ["getrambla/rambla"],
            },
          ],
          slack: [{ slug: "rambla", teamName: "Rambla" }],
          discord: [{ slug: "rambla-discord", guildName: "Rambla Discord" }],
          daemons: [],
          linear: [],
        },
        "getrambla/rambla",
      ),
    ).toEqual([
      {
        id: "github:getrambla/rambla",
        label: "GitHub — getrambla/rambla",
        provider: "github",
        filters: { connection: "github-getrambla", repo: "getrambla/rambla" },
      },
      {
        id: "slack:rambla",
        label: "Slack — Rambla",
        provider: "slack",
        filters: { connection: "rambla" },
      },
      {
        id: "discord:rambla-discord",
        label: "Discord — Rambla Discord",
        provider: "discord",
        filters: { connection: "rambla-discord" },
      },
    ]);
  });

  it("does not offer GitHub when the current repository is not connected", () => {
    expect(
      availableStarterTriggerConnections(
        {
          github: [
            {
              slug: "github-getrambla",
              accountLogin: "getrambla",
              accountType: "Organization",
              repositories: ["getrambla/hub"],
            },
          ],
          slack: [],
          discord: [],
          daemons: [],
          linear: [],
        },
        "getrambla/rambla",
      ),
    ).toEqual([]);
  });
});
