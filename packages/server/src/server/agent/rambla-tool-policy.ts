import type { ProviderRamblaToolsPolicy } from "@getpaseo/protocol/provider-config";

interface ProviderRamblaToolSettings {
  paseoTools?: ProviderRamblaToolsPolicy;
}

export function resolveRamblaToolPolicy(
  providerId: string,
  providerSettings: Readonly<Record<string, ProviderRamblaToolSettings>> | undefined,
): ProviderRamblaToolsPolicy | undefined {
  return providerSettings?.[providerId]?.paseoTools;
}

export function isRamblaToolEnabled(
  policy: ProviderRamblaToolsPolicy | undefined,
  toolName: string,
): boolean {
  if (toolName === "speak") {
    return true;
  }
  if (!isRamblaToolPolicyEnabled(policy)) {
    return false;
  }
  return !policy?.disabledTools?.includes(toolName);
}

export function isRamblaToolPolicyEnabled(policy: ProviderRamblaToolsPolicy | undefined): boolean {
  return policy?.enabled !== false;
}
