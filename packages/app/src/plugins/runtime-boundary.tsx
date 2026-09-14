import { QueryClientProvider } from "@tanstack/react-query";
import { RamblaApiProvider, PluginRpcProvider } from "@getrambla/plugin/client/host";
import type { ReactNode } from "react";
import type { InstalledPlugin } from "./types";
import type { PluginSurfaceRuntime } from "./surface-runtime";

export function PluginRuntimeBoundary({
  plugin,
  runtime,
  children,
}: {
  plugin: InstalledPlugin;
  runtime: PluginSurfaceRuntime;
  children: ReactNode;
}) {
  return (
    <QueryClientProvider client={plugin.queryClient}>
      <RamblaApiProvider rambla={runtime.rambla}>
        <PluginRpcProvider invoke={runtime.invoke}>{children}</PluginRpcProvider>
      </RamblaApiProvider>
    </QueryClientProvider>
  );
}
