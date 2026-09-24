// RAMBLA-FORK: fix: 2026-09-24-fix-subagent-default-provider-model.md: resolves create_agent's effective provider/model, defaulting to the caller's.
interface CallerLike {
  provider: string;
  config?: { model?: string | null };
}

export async function resolveCreateAgentProviderModel(
  callerAgent: CallerLike | undefined | null,
  callerProvider: string | undefined,
  resolveDefaultModel?: (provider: string) => string | undefined | Promise<string | undefined>,
): Promise<string> {
  if (callerProvider !== undefined && callerProvider !== null && callerProvider.trim() !== "") {
    return callerProvider.trim();
  }
  if (!callerAgent) {
    throw new Error("provider must be provider/model, for example codex/gpt-5.4");
  }
  const model =
    callerAgent.config?.model?.trim() || (await resolveDefaultModel?.(callerAgent.provider));
  return model ? `${callerAgent.provider}/${model}` : callerAgent.provider;
}
