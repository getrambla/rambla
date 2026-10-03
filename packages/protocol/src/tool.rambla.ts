// RAMBLA-FORK: feature: 2026-10-02-feat-server-tool-install.md: request and response schemas for the daemon.tool RPCs.
import { z } from "zod";

export const DaemonToolListRequestSchema = z.object({
  type: z.literal("daemon.tool.list.request"),
  requestId: z.string(),
});

export const DaemonToolInstallRequestSchema = z.object({
  type: z.literal("daemon.tool.install.request"),
  requestId: z.string(),
  names: z.array(z.string()),
  version: z.string().optional(),
  latest: z.boolean().optional(),
});

export const DaemonToolUpgradeRequestSchema = z.object({
  type: z.literal("daemon.tool.upgrade.request"),
  requestId: z.string(),
  names: z.array(z.string()),
  latest: z.boolean().optional(),
});

export const DaemonToolUninstallRequestSchema = z.object({
  type: z.literal("daemon.tool.uninstall.request"),
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

const DaemonToolResultPayloadSchema = z.object({
  requestId: z.string(),
  ok: z.boolean(),
  output: z.string(),
});

export const DaemonToolListResponseSchema = z.object({
  type: z.literal("daemon.tool.list.response"),
  payload: DaemonToolResultPayloadSchema.extend({ tools: z.array(DaemonToolStatusSchema) }),
});

export const DaemonToolInstallResponseSchema = z.object({
  type: z.literal("daemon.tool.install.response"),
  payload: DaemonToolResultPayloadSchema,
});

export const DaemonToolUpgradeResponseSchema = z.object({
  type: z.literal("daemon.tool.upgrade.response"),
  payload: DaemonToolResultPayloadSchema,
});

export const DaemonToolUninstallResponseSchema = z.object({
  type: z.literal("daemon.tool.uninstall.response"),
  payload: DaemonToolResultPayloadSchema,
});
