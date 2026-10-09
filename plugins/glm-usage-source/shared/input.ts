// RAMBLA-FORK: feature: 2026-10-09-merge-upstream-v0-11-1.md: the Z.ai token lives in an env var or the glm-acp-agent credentials file.
import { z } from "zod";
export const inputSchema = z
  .object({
    store: z.enum(["env", "file"]),
    locator: z.string().min(1),
  })
  .strict();
export type UsageInput = z.infer<typeof inputSchema>;
