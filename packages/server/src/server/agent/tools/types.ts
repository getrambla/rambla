import type { z } from "zod";
import type { ProviderRamblaToolsPolicy } from "@getpaseo/protocol/provider-config";

export interface RamblaToolExecutionContext {
  signal?: AbortSignal;
  sendUpdate?: (update: RamblaToolResult) => void;
}

export interface RamblaToolResult {
  content: Array<{ type: string; text?: string; [key: string]: unknown }>;
  structuredContent?: unknown;
  isError?: boolean;
}

export interface RamblaToolConfig {
  title?: string;
  description?: string;
  inputSchema?: z.ZodRawShape | z.ZodType;
  outputSchema?: z.ZodRawShape;
}

export interface RamblaToolDefinition extends RamblaToolConfig {
  name: string;
  description: string;
  handler: (input: unknown, context: RamblaToolExecutionContext) => Promise<RamblaToolResult>;
}

export interface RamblaToolCatalog {
  tools: ReadonlyMap<string, RamblaToolDefinition>;
  getTool(name: string): RamblaToolDefinition | undefined;
  executeTool(
    name: string,
    input: unknown,
    context?: RamblaToolExecutionContext,
  ): Promise<RamblaToolResult>;
}

export interface RamblaToolRuntimeContext {
  callerAgentId?: string;
  paseoToolPolicy?: ProviderRamblaToolsPolicy;
  enableVoiceTools?: boolean;
  voiceOnly?: boolean;
}

export type RamblaToolCatalogFactory = (
  context: RamblaToolRuntimeContext,
) => RamblaToolCatalog | Promise<RamblaToolCatalog>;
