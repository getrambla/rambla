// RAMBLA-FORK: feature: 2026-10-09-merge-upstream-v0-11-1.md: registers the Z.ai quota source for the host and the GLM agent.
import type { PluginServerContext } from "@getrambla/plugin/server";
import { inputSchema } from "./shared/input.js";
import { fetchUsage, discover } from "./server/usage.js";

export default function contribute(server: PluginServerContext) {
  server.registerUsageSource({
    id: "glm",
    label: "Z.ai",
    icon: "icon.svg",
    input: inputSchema,
    discover: (scope) => discover(scope),
    fetch: fetchUsage,
  });
  return () => {};
}
