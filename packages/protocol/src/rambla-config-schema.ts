import { z } from "zod";

const TCP_PORT_RANGE_PATTERN = /^(\d{1,5})-(\d{1,5})$/;

export const RamblaServicePortAllocationSchema = z
  .object({
    range: z.string().trim().regex(TCP_PORT_RANGE_PATTERN).optional(),
    portScript: z.string().trim().min(1).optional(),
  })
  .strict()
  .refine(
    (value) => value.range !== undefined || value.portScript !== undefined,
    "Expected range or portScript",
  )
  .refine((value) => {
    if (!value.range) return true;
    const match = TCP_PORT_RANGE_PATTERN.exec(value.range);
    if (!match) return false;
    const start = Number(match[1]);
    const end = Number(match[2]);
    return start >= 1 && end <= 65_535 && start <= end;
  }, "Expected an inclusive TCP port range from 1-65535");

export function normalizeLifecycleCommands(commands: unknown): string[] {
  if (typeof commands === "string") {
    return commands.trim().length > 0 ? [commands] : [];
  }
  if (!Array.isArray(commands)) {
    return [];
  }
  return commands.filter((command): command is string => {
    return typeof command === "string" && command.trim().length > 0;
  });
}

export const RamblaLifecycleCommandRawSchema = z.union([z.string(), z.array(z.string())]);

export const RamblaScriptEntryRawSchema = z
  .object({
    type: z.unknown().optional(),
    command: z.unknown().optional(),
    port: z.unknown().optional(),
  })
  .passthrough();

export const RamblaWorktreeConfigRawSchema = z
  .object({
    setup: RamblaLifecycleCommandRawSchema.optional(),
    teardown: RamblaLifecycleCommandRawSchema.optional(),
    terminals: z.unknown().optional(),
    servicePorts: RamblaServicePortAllocationSchema.optional(),
  })
  .passthrough();

export const RamblaMetadataGenerationEntrySchema = z
  .object({
    instructions: z.string().optional(),
  })
  .passthrough()
  .catch({});

export const RamblaMetadataGenerationSchema = z
  .object({
    title: RamblaMetadataGenerationEntrySchema.optional(),
    branchName: RamblaMetadataGenerationEntrySchema.optional(),
    commitMessage: RamblaMetadataGenerationEntrySchema.optional(),
    pullRequest: RamblaMetadataGenerationEntrySchema.optional(),
  })
  // COMPAT(projectMetadataAgentTitle): `agentTitle` project metadata prompts were removed
  // in v0.1.96; keep legacy rambla.json parseable until 2026-12-16.
  .passthrough()
  .catch({});

export const RamblaConfigRawSchema = z
  .object({
    worktree: RamblaWorktreeConfigRawSchema.optional(),
    scripts: z.record(z.string(), RamblaScriptEntryRawSchema).optional(),
    metadataGeneration: RamblaMetadataGenerationSchema.optional(),
  })
  .passthrough();

export const WorktreeConfigSchema = RamblaWorktreeConfigRawSchema.extend({
  setup: z.unknown().optional().transform(normalizeLifecycleCommands),
  teardown: z.unknown().optional().transform(normalizeLifecycleCommands),
})
  .passthrough()
  .catch({ setup: [], teardown: [] });

export const ScriptEntrySchema = RamblaScriptEntryRawSchema.catch({});

export const RamblaConfigSchema = RamblaConfigRawSchema.extend({
  worktree: WorktreeConfigSchema.optional(),
  scripts: z.record(z.string(), ScriptEntrySchema).optional().catch({}),
  metadataGeneration: RamblaMetadataGenerationSchema.optional(),
})
  .passthrough()
  .catch({});

export const RamblaConfigRevisionSchema = z.object({
  mtimeMs: z.number(),
  size: z.number(),
});

export const ProjectConfigRpcErrorSchema = z.discriminatedUnion("code", [
  z.object({ code: z.literal("project_not_found") }),
  z.object({ code: z.literal("invalid_project_config") }),
  z.object({
    code: z.literal("stale_project_config"),
    currentRevision: RamblaConfigRevisionSchema.nullable(),
  }),
  z.object({ code: z.literal("write_failed") }),
]);

export type RamblaScriptEntryRaw = z.infer<typeof RamblaScriptEntryRawSchema>;
export type RamblaMetadataGenerationEntry = z.infer<typeof RamblaMetadataGenerationEntrySchema>;
export type RamblaMetadataGeneration = z.infer<typeof RamblaMetadataGenerationSchema>;
export type RamblaServicePortAllocation = z.infer<typeof RamblaServicePortAllocationSchema>;
export type RamblaConfigRaw = z.infer<typeof RamblaConfigRawSchema>;
export type RamblaConfig = z.infer<typeof RamblaConfigSchema>;
export type RamblaConfigRevision = z.infer<typeof RamblaConfigRevisionSchema>;
export type ProjectConfigRpcError = z.infer<typeof ProjectConfigRpcErrorSchema>;
