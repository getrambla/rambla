import { createRamblaApi, type RamblaApi } from "@getrambla/client";
import type { DaemonClient } from "@getrambla/client/internal/daemon-client";

export interface PluginSurfaceRuntime {
  rambla: RamblaApi;
  invoke(method: string, input: unknown): Promise<unknown>;
}

export function createPluginSurfaceRuntime(
  client: DaemonClient | null,
  pluginId: string,
): PluginSurfaceRuntime | null {
  if (!client) return null;
  return {
    rambla: createRamblaApi(client),
    invoke: (method, input) => client.invokePluginRpc(pluginId, method, input),
  };
}
