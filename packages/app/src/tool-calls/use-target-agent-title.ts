import type { ToolCallDetail } from "@getrambla/protocol/agent-types";
import { getRamblaToolTargetAgentId } from "@getrambla/protocol/rambla-tool-presentation/index";
import { useSessionStore } from "@/stores/session-store";

/** Title of the agent a Rambla tool call acts on, when this host knows it. */
export function useTargetAgentTitle(input: {
  serverId: string | undefined;
  toolName: string;
  detail: ToolCallDetail | undefined;
}): string | undefined {
  const agentId = getRamblaToolTargetAgentId(input.toolName, input.detail);
  const { serverId } = input;
  return useSessionStore((state) => {
    if (!serverId || !agentId) return undefined;
    const session = state.sessions[serverId];
    const agent = session?.agents.get(agentId) ?? session?.agentDetails.get(agentId);
    return agent?.title ?? undefined;
  });
}
