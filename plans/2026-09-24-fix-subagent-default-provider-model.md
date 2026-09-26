# fix: create_agent defaults to the caller's provider/model

Status: Done - last commit: 73aa827ec

## Provenance

- main: `3e5566f2b` — 2026-09-24
- upstream-rebrand: `61b044d8b` — 2026-09-21
- upstream/main: `135a3b4c9` (untagged) — 2026-09-21

## Scope

**In scope:**

1. In the `create_agent` tool's agent-scoped path, make `provider` optional; when the calling agent omits it, the server resolves the caller's own provider and current model and uses that.
2. A top-level (non-agent-scoped) `create_agent` call with no `provider` is rejected with a clear error, as today.
3. An explicit `provider/model` argument always wins; no restriction on which providers may be named.
4. Rewrite the tool `description` and the `provider` argument description: no vendor examples, no "call list_providers first" nudge. New wording tells the model its own provider/model is the default and to use the provider-listing tools only to verify a model the user asked for.
5. A `*.rambla.test.ts` covering: omitted provider inherits caller's provider/model; explicit provider wins; top-level omission errors.

**Not in scope:**

- Reordering `AGENT_PROVIDER_DEFINITIONS` or any UI-facing provider ordering.
- The glm-acp-agent system-prompt change (separate plan in that repo).
- Changes to `resolveInheritedProviderConfig` or mode/feature inheritance.
- Any client (app) code.

## Goal

When a model spawns a subagent without naming a provider, the subagent runs on the same provider and model as the caller, without an extra lookup turn.

## Merge conflict mitigation

This is a permanent fork of upstream Paseo. Nothing goes upstream; upstream is merged in weekly. Code below follows the fork's placement rules.

**Files this work changes:**

| File                                                                                  | Edit                                                                                                                 | Upstream activity                                         | Tag                 |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ------------------- |
| `packages/server/src/server/agent/tools/rambla-tools.ts`                              | agent-scoped schema: `provider` optional; handler: 1-line fallback to caller's provider/model; description rewording | hot — rebranded 2026-09-23, 2 upstream commits this month | `RAMBLA-FORK: fix:` |
| `packages/server/src/server/agent/tools/resolve-create-agent-provider.rambla.ts`      | new helper: given the parsed args and caller agent, returns the effective provider/model string                      | new                                                       | `RAMBLA-FORK: fix:` |
| `packages/server/src/server/agent/tools/resolve-create-agent-provider.rambla.test.ts` | covers the 3 behaviors in scope item 5                                                                               | new                                                       | `RAMBLA-FORK: fix:` |

**Why this shape:** the decision logic lives in a `*.rambla.ts` helper so future changes to the defaulting rule never touch the hot upstream file again; the upstream file takes only a schema tweak, a 1-line call, and the description text, kept as one contiguous tagged block.

**Branch:** none — 1 upstream file edited, work on main.

## Cause

The `create_agent` tool requires a `provider/model` string and its handler uses only what the caller passed ([rambla-tools.ts:1440](../packages/server/src/server/agent/tools/rambla-tools.ts#L1440), resolved via `resolveRequiredProviderModel` in [mcp-shared.ts:68](../packages/server/src/server/agent/mcp-shared.ts#L68)). Nothing inherits the caller's identity: the parent's provider and model are available on the resolved caller agent (`resolveCallerAgent`, [rambla-tools.ts:635](../packages/server/src/server/agent/tools/rambla-tools.ts#L635) — `callerAgent.provider`, `callerAgent.config.model`) but never consulted. The tool description's vendor example and its "call list_providers first" instruction push the model toward reading the provider list, which is ordered claude-first from `AGENT_PROVIDER_DEFINITIONS` ([provider-manifest.ts:197](../packages/protocol/src/provider-manifest.ts#L197)) — so the model names Claude.

## Constraints

- No file outside the mitigation table changes.
- The non-agent-scoped schema variant keeps `provider` required.
- No changes to `list_providers`, `list_models`, the provider registry, or the snapshot manager.
- No new config, env var, or user-facing setting.
- Upstream tests untouched; no edits inside upstream test files.
- The description rewrite removes vendor examples entirely — no "codex/gpt-5.4" or similar anywhere in the tool text.

## Steps

0. Read the `code` skill before writing anything. If a step below turns out to be wrong, stop and report back to the supervisor — do not amend this plan and do not re-decide placement while coding.
1. Create `resolve-create-agent-provider.rambla.ts`: export a helper taking the caller agent (or undefined) and the caller-supplied provider string (or undefined); return the effective `provider/model` string, or throw the existing "provider must be provider/model"-style error when both are absent (top-level case). Caller fields read: `provider`, `config.model`.
2. In `rambla-tools.ts`, agent-scoped `create_agent`: make `provider` optional in the agent-scoped schema variant, replace the direct `resolveRequiredProviderModel(parsedArgs.provider)` call with 1 call into the new helper, and rewrite the tool `description` and `provider` argument description per scope item 4. Keep all 3 edits as one contiguous tagged block with the plan's fork tag.
3. Create `resolve-create-agent-provider.rambla.test.ts` with the 3 cases from scope item 5.

## Verification

- `npm run typecheck`
- `npm run lint`
- `npx vitest run packages/server/src/server/agent/tools/resolve-create-agent-provider.rambla.test.ts --bail=1`
- `git grep "RAMBLA-FORK:" -- packages/server/src/server/agent/tools/rambla-tools.ts` — must show the tag.
- In a running session on the GLM provider, ask the agent to spawn a subagent with no provider named; the new agent's provider/model must match the caller's, visible in `list_agents`.

## Risks

- Models that previously relied on `provider` being required may omit it unintentionally; they now get the caller's provider/model, which is the intended behavior.
- If the caller's `config.model` is unset (possible for some session types), the helper must fall back to the provider's default model via the existing `resolveDefaultModel` path — covered in the helper, not a new mechanism.
