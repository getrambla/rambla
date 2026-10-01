import { QueryClientProvider } from "@tanstack/react-query";
import { RamblaApiProvider, PluginRpcProvider } from "@getrambla/plugin/client/host";
import React, { type ReactNode } from "react";
import type { InstalledPlugin } from "./types";

/** Every plugin surface renders under its installation: one query cache, one Rambla client, RPCs. */
export function PluginInstallationProvider({
  plugin,
  children,
}: {
  plugin: InstalledPlugin;
  children: ReactNode;
}) {
  return (
    <QueryClientProvider client={plugin.queryClient}>
      <RamblaApiProvider rambla={plugin.rambla}>
        <PluginRpcProvider invoke={plugin.invoke}>{children}</PluginRpcProvider>
      </RamblaApiProvider>
    </QueryClientProvider>
  );
}
