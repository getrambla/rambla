// RAMBLA-FORK: fix: 2026-09-30-fix-thinking-picker-stale-list.md: per-model thinking ladders on the generic ACP catalog path.
import type { SessionConfigOption } from "@agentclientprotocol/sdk";
import { afterEach, describe, expect, test, vi } from "vitest";

import { createTestLogger } from "../../test-utils/test-logger.js";
import type { AgentModelDefinition } from "./agent-sdk-types.js";
import { buildProviderRegistry } from "./provider-registry.js";
import { ACPAgentClient, type SpawnedACPProcess } from "./providers/acp-agent.js";

const PROVIDER_ID = "glm-like";
const DEFAULT_MODEL = "glm-5.3";
const FLASH_MODEL = "glm-flash";
const AIR_MODEL = "glm-air";

const LADDERS: Record<string, { levels: string[]; current: string }> = {
  [DEFAULT_MODEL]: { levels: ["off", "minimal", "low", "medium", "high", "max"], current: "high" },
  [FLASH_MODEL]: { levels: ["low", "high", "max"], current: "low" },
  [AIR_MODEL]: { levels: ["off", "medium"], current: "medium" },
};

interface ProbeHooks {
  spawnProcess(): Promise<SpawnedACPProcess>;
  closeProbe(): Promise<void>;
}

interface FakeAgent {
  setSessionConfigOption: ReturnType<typeof vi.fn>;
  extMethod: ReturnType<typeof vi.fn>;
}

/** Builds the model selector config option the fake agent advertises. */
function modelOption(currentValue: string): SessionConfigOption {
  return {
    id: "model",
    name: "Model",
    category: "model",
    type: "select",
    currentValue,
    options: Object.keys(LADDERS).map((value) => ({ value, name: value })),
  };
}

/** Builds the thought_level config option the fake agent advertises for a model. */
function thoughtOption(modelId: string): SessionConfigOption {
  const ladder = LADDERS[modelId];
  return {
    id: "effort",
    name: "Effort",
    category: "thought_level",
    type: "select",
    currentValue: ladder.current,
    options: ladder.levels.map((value) => ({ value, name: value })),
  };
}

/** Installs a fake ACP agent behind every ACP client's probe, failing switches to the given models. */
function installFakeAgent(failingModels: string[] = []): FakeAgent {
  const setSessionConfigOption = vi.fn(async ({ value }: { value: string }) => {
    if (failingModels.includes(value)) {
      throw new Error(`agent rejected switch to ${value}`);
    }
    return { configOptions: [modelOption(value), thoughtOption(value)] };
  });
  const extMethod = vi.fn(async () => ({
    models: Object.keys(LADDERS).map((value) => ({
      value,
      name: value,
      configOptions: [thoughtOption(value)],
    })),
  }));
  const hooks = ACPAgentClient.prototype as unknown as ProbeHooks;
  vi.spyOn(hooks, "spawnProcess").mockImplementation(
    async () =>
      ({
        child: { kill: vi.fn(), exitCode: 0, signalCode: null, once: vi.fn() },
        connection: {
          newSession: vi.fn().mockResolvedValue({
            sessionId: "probe-session",
            configOptions: [modelOption(DEFAULT_MODEL), thoughtOption(DEFAULT_MODEL)],
          }),
          setSessionConfigOption,
          extMethod,
        },
        initialize: { agentCapabilities: {} },
      }) as unknown as SpawnedACPProcess,
  );
  vi.spyOn(hooks, "closeProbe").mockResolvedValue(undefined);
  return { setSessionConfigOption, extMethod };
}

/** Fetches the catalog for one ACP provider through the real provider registry. */
async function fetchModels(providerId: string, command: [string, ...string[]]) {
  const logger = createTestLogger();
  const registry = buildProviderRegistry(logger, {
    providerOverrides: { [providerId]: { extends: "acp", label: providerId, command } },
  });
  const catalog = await registry[providerId].fetchCatalog({
    scope: "workspace",
    cwd: "/tmp/acp-thinking-ladders",
    force: false,
  });
  return catalog.models;
}

/** Returns the thinking option ids a model entry advertises, or undefined when it has none. */
function ladderOf(models: AgentModelDefinition[], modelId: string): string[] | undefined {
  return models.find((model) => model.id === modelId)?.thinkingOptions?.map((option) => option.id);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("custom ACP provider catalog thinking ladders", () => {
  test("each model advertises the ladder the agent re-advertises after switching to it", async () => {
    const agent = installFakeAgent();

    const models = await fetchModels(PROVIDER_ID, ["glm-like-agent", "--acp"]);

    for (const modelId of Object.keys(LADDERS)) {
      expect(agent.setSessionConfigOption).toHaveBeenCalledWith({
        sessionId: "probe-session",
        configId: "model",
        value: modelId,
      });
    }
    expect(ladderOf(models, DEFAULT_MODEL)).toEqual(LADDERS[DEFAULT_MODEL].levels);
    expect(ladderOf(models, FLASH_MODEL)).toEqual(["low", "high", "max"]);
    expect(ladderOf(models, AIR_MODEL)).toEqual(["off", "medium"]);
    expect(models.find((model) => model.id === FLASH_MODEL)?.defaultThinkingOptionId).toBe("low");
  });

  test("a non-default model whose switch fails advertises no thinking levels", async () => {
    installFakeAgent([FLASH_MODEL]);

    const models = await fetchModels(PROVIDER_ID, ["glm-like-agent", "--acp"]);

    const flash = models.find((model) => model.id === FLASH_MODEL);
    expect(flash?.thinkingOptions).toBeUndefined();
    expect(flash?.defaultThinkingOptionId).toBeUndefined();
    expect(ladderOf(models, AIR_MODEL)).toEqual(["off", "medium"]);
    expect(ladderOf(models, DEFAULT_MODEL)).toEqual(LADDERS[DEFAULT_MODEL].levels);
  });

  test("the default model keeps the probe session's ladder when its own switch fails", async () => {
    installFakeAgent([DEFAULT_MODEL, FLASH_MODEL, AIR_MODEL]);

    const models = await fetchModels(PROVIDER_ID, ["glm-like-agent", "--acp"]);

    expect(ladderOf(models, DEFAULT_MODEL)).toEqual(LADDERS[DEFAULT_MODEL].levels);
    expect(models.find((model) => model.id === DEFAULT_MODEL)?.defaultThinkingOptionId).toBe(
      "high",
    );
    expect(ladderOf(models, FLASH_MODEL)).toBeUndefined();
    expect(ladderOf(models, AIR_MODEL)).toBeUndefined();
  });
});

describe("named ACP providers keep their own catalog behavior", () => {
  test.each([
    { providerId: "kiro", command: ["kiro-cli", "acp"] as [string, ...string[]] },
    { providerId: "traecli", command: ["traecli", "acp", "serve"] as [string, ...string[]] },
  ])(
    "$providerId stamps the probe session's ladder on every model without switching",
    async ({ providerId, command }) => {
      const agent = installFakeAgent();

      const models = await fetchModels(providerId, command);

      expect(agent.setSessionConfigOption).not.toHaveBeenCalled();
      for (const modelId of Object.keys(LADDERS)) {
        expect(ladderOf(models, modelId)).toEqual(LADDERS[DEFAULT_MODEL].levels);
      }
    },
  );

  test("cursor reads per-model ladders from its extension without switching", async () => {
    const agent = installFakeAgent();

    const models = await fetchModels("cursor", ["cursor-agent", "acp"]);

    expect(agent.extMethod).toHaveBeenCalledWith("cursor/list_available_models", {});
    expect(agent.setSessionConfigOption).not.toHaveBeenCalled();
    expect(ladderOf(models, FLASH_MODEL)).toEqual(["low", "high", "max"]);
  });

  test("kimi switches to each model and reads back its ladder", async () => {
    const agent = installFakeAgent();

    const models = await fetchModels("kimi", ["kimi", "acp"]);

    expect(agent.setSessionConfigOption).toHaveBeenCalledTimes(Object.keys(LADDERS).length);
    expect(ladderOf(models, FLASH_MODEL)).toEqual(["low", "high", "max"]);
  });
});
