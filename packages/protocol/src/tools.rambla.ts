// RAMBLA-FORK: feature: 2026-10-02-feat-server-tools-install.md: request and response schemas for the daemon.tools RPCs.
import { z } from "zod";

export const DaemonToolsListRequestSchema = z.object({
  type: z.literal("daemon.tools.list.request"),
  requestId: z.string(),
});

export const DaemonToolsInstallRequestSchema = z.object({
  type: z.literal("daemon.tools.install.request"),
  requestId: z.string(),
  names: z.array(z.string()),
  version: z.string().optional(),
  latest: z.boolean().optional(),
});

export const DaemonToolsUpgradeRequestSchema = z.object({
  type: z.literal("daemon.tools.upgrade.request"),
  requestId: z.string(),
  names: z.array(z.string()),
  latest: z.boolean().optional(),
});

export const DaemonToolsUninstallRequestSchema = z.object({
  type: z.literal("daemon.tools.uninstall.request"),
  requestId: z.string(),
  names: z.array(z.string()),
});

export const DaemonToolStatusSchema = z.object({
  name: z.string(),
  pin: z.string(),
  group: z.string().nullable(),
  providerId: z.string().nullable(),
  installed: z.string().nullable(),
});

export type DaemonToolStatus = z.infer<typeof DaemonToolStatusSchema>;

const DaemonToolsResultPayloadSchema = z.object({
  requestId: z.string(),
  ok: z.boolean(),
  output: z.string(),
});

export const DaemonToolsListResponseSchema = z.object({
  type: z.literal("daemon.tools.list.response"),
  payload: DaemonToolsResultPayloadSchema.extend({ tools: z.array(DaemonToolStatusSchema) }),
});

export const DaemonToolsInstallResponseSchema = z.object({
  type: z.literal("daemon.tools.install.response"),
  payload: DaemonToolsResultPayloadSchema,
});

export const DaemonToolsUpgradeResponseSchema = z.object({
  type: z.literal("daemon.tools.upgrade.response"),
  payload: DaemonToolsResultPayloadSchema,
});

export const DaemonToolsUninstallResponseSchema = z.object({
  type: z.literal("daemon.tools.uninstall.response"),
  payload: DaemonToolsResultPayloadSchema,
});
