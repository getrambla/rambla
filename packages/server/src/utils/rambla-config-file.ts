import { existsSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  RamblaConfigRawSchema,
  type RamblaConfigRaw,
  type RamblaConfigRevision,
  type ProjectConfigRpcError,
} from "@getpaseo/protocol/paseo-config-schema";
export {
  RamblaConfigRevisionSchema,
  ProjectConfigRpcErrorSchema,
  type RamblaConfigRevision,
  type ProjectConfigRpcError,
} from "@getpaseo/protocol/paseo-config-schema";

export const RAMBLA_CONFIG_FILE_NAME = "paseo.json";

export type ReadRamblaConfigForEditResult =
  | { ok: true; config: RamblaConfigRaw | null; revision: RamblaConfigRevision | null }
  | { ok: false; error: ProjectConfigRpcError };

export type WriteRamblaConfigForEditResult =
  | { ok: true; config: RamblaConfigRaw; revision: RamblaConfigRevision }
  | { ok: false; error: ProjectConfigRpcError };

export interface WriteRamblaConfigForEditInput {
  repoRoot: string;
  config: RamblaConfigRaw;
  expectedRevision: RamblaConfigRevision | null;
}

export function resolveRamblaConfigPath(repoRoot: string): string {
  return join(repoRoot, RAMBLA_CONFIG_FILE_NAME);
}

export function statRamblaConfigPath(repoRoot: string): RamblaConfigRevision | null {
  const configPath = resolveRamblaConfigPath(repoRoot);
  if (!existsSync(configPath)) {
    return null;
  }
  const stats = statSync(configPath);
  return {
    mtimeMs: stats.mtimeMs,
    size: stats.size,
  };
}

export function readRamblaConfigJson(repoRoot: string): unknown {
  const configPath = resolveRamblaConfigPath(repoRoot);
  if (!existsSync(configPath)) {
    return null;
  }
  return JSON.parse(readFileSync(configPath, "utf8"));
}

export function readRamblaConfigForEdit(repoRoot: string): ReadRamblaConfigForEditResult {
  try {
    const json = readRamblaConfigJson(repoRoot);
    if (json === null) {
      return { ok: true, config: null, revision: null };
    }
    return {
      ok: true,
      config: RamblaConfigRawSchema.parse(json),
      revision: statRamblaConfigPath(repoRoot),
    };
  } catch {
    return {
      ok: false,
      error: { code: "invalid_project_config" },
    };
  }
}

export function writeRamblaConfigForEdit(
  input: WriteRamblaConfigForEditInput,
): WriteRamblaConfigForEditResult {
  const parsed = RamblaConfigRawSchema.safeParse(input.config);
  if (!parsed.success) {
    return { ok: false, error: { code: "invalid_project_config" } };
  }

  const configPath = resolveRamblaConfigPath(input.repoRoot);
  const tempPath = join(
    input.repoRoot,
    `.${RAMBLA_CONFIG_FILE_NAME}.${process.pid}.${randomUUID()}.tmp`,
  );

  try {
    writeFileSync(tempPath, `${JSON.stringify(parsed.data, null, 2)}\n`);
    const currentRevision = statRamblaConfigPath(input.repoRoot);
    if (!paseoConfigRevisionsEqual(currentRevision, input.expectedRevision)) {
      removeTempRamblaConfig(tempPath);
      return {
        ok: false,
        error: { code: "stale_project_config", currentRevision },
      };
    }

    renameSync(tempPath, configPath);
    const revision = statRamblaConfigPath(input.repoRoot);
    if (!revision) {
      return { ok: false, error: { code: "write_failed" } };
    }
    return { ok: true, config: parsed.data, revision };
  } catch {
    removeTempRamblaConfig(tempPath);
    return { ok: false, error: { code: "write_failed" } };
  }
}

function paseoConfigRevisionsEqual(
  left: RamblaConfigRevision | null,
  right: RamblaConfigRevision | null,
): boolean {
  if (left === null || right === null) {
    return left === right;
  }
  return left.mtimeMs === right.mtimeMs && left.size === right.size;
}

function removeTempRamblaConfig(tempPath: string): void {
  try {
    rmSync(tempPath, { force: true });
  } catch {
    // Best-effort cleanup only; callers need the original write outcome.
  }
}
