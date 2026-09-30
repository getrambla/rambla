# fix: thinking picker offers levels the active model doesn't support

Status: unapproved

## Provenance

- main: `51a2a40f3` — 2026-09-27
- upstream-rebrand: `20f46ddda` — 2026-09-27
- upstream/main: `30178c4f5` (untagged) — 2026-09-27

## Scope

**In scope:**

1. A new ACP catalog model resolver that, for each model in a probed ACP
   catalog, switches the probe session to that model via the standard
   `model` config option and stamps the model's real `thought_level` ladder
   (read from the re-advertised `configOptions`) on its catalog entry.
2. Per-model fallback: a model whose switch or ladder read fails keeps the
   ladder `deriveModelDefinitionsFromACP` already stamped on it.
3. Wiring the resolver into the generic ACP client path used by custom ACP
   providers, as a `catalogModelResolver`.
4. Fork tests covering the resolver: per-model ladder stamping, fallback on
   switch failure, and pass-through when no `thought_level` options exist.

**Not in scope:**

- `handleConfigOptionUpdate` in acp-agent.ts — live-session scalar state;
  the picker's list never reads it, so changing it has no user-visible
  effect.
- Any change to glm-acp-agent (including its coerce-vs-reject behavior) —
  with correct ladders advertised, the coercion becomes dead code on this
  path.
- The app-side picker, `use-agent-form-state.ts`, `agent-controls/` — they
  already render whatever the snapshot's models carry.
- The profile/schedule forms that consume snapshot models — they are fixed
  by the same corrected data, no code change there.
- Cursor and Kimi providers — they already have their own
  `catalogModelResolver`s and are not routed through the generic path.

## Acceptance criteria

1. On a custom-ACP provider whose probe reports models with divergent
   thinking ladders, each model entry in the provider snapshot advertises
   the ladder that model actually supports (verified by reading back the
   agent's re-advertised `thought_level` options after switching to it),
   observable in the app's thinking picker after a snapshot refresh.
2. On a session running a model whose ladder lacks a level advertised to it
   before this fix, selecting each level that the model's real ladder
   advertises sticks — the picker's selected value matches the pick with no
   snap-back.
3. For a catalog model whose probe switch or ladder read fails, the resolver
   leaves that model's previously derived ladder unchanged — Cursor, Kimi,
   and non-conforming ACP agents behave exactly as before the change.
4. All behavior covered by a new `*.rambla.test.ts`; no upstream test file
   edited.

## Goal

The thinking picker derives every model's options from one session-wide
`thought_level` ladder stamped at catalog time, so users see and pick levels
the active model silently rejects (the pick snaps back). Fix: derive each
model's ladder from the model itself via the standard ACP config round-trip.

## Merge conflict mitigation

**Files this work changes:**

| File                                                                             | Edit                                                                         | Upstream activity                                       | Tag                 |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------- | ------------------- |
| `packages/server/src/server/agent/providers/acp-catalog-thinking.rambla.ts`      | the resolver: per-model config switch + ladder stamping                      | new                                                     | `RAMBLA-FORK: fix:` |
| `packages/server/src/server/agent/providers/acp-catalog-thinking.rambla.test.ts` | resolver behavior per criteria 1–3                                           | new                                                     | `RAMBLA-FORK: fix:` |
| `packages/server/src/server/agent/provider-registry.ts`                          | 1 import + `catalogModelResolver:` entry in the generic `acpOptions` literal | last touched 2026-09-27 by upstream rebrand `20f46ddda` | `RAMBLA-FORK: fix:` |

**Why this shape:** the repo already solves per-model catalog correction
exactly this way for Cursor (`[cursor-acp-agent.ts:48](../packages/server/src/server/agent/providers/cursor-acp-agent.ts#L48),[102](../packages/server/src/server/agent/providers/cursor-acp-agent.ts#L102)`) and Kimi
(`[kimi-acp-agent.ts:23](../packages/server/src/server/agent/providers/kimi-acp-agent.ts#L23),[92](../packages/server/src/server/agent/providers/kimi-acp-agent.ts#L92)`); the resolver reuses that extension point
instead of editing `deriveModelDefinitionsFromACP`'s blanket stamp, so the
upstream diff is a 2-line wiring in 1 file and the entire mechanism lives
in a file upstream will never have.

**Branch:** none — 1 upstream file edited, work on main.

## Cause

The app's thinking picker reads `thinkingOptions` from the provider
snapshot's per-model entries (`[use-agent-form-state.ts:464](../packages/app/src/hooks/use-agent-form-state.ts#L464)`,
`[messages.ts:324](../packages/protocol/src/messages.ts#L324)`), and the only writer of those entries is
`refreshProvider`'s `fetchCatalog` result
(`[provider-snapshot-manager.ts:1017](../packages/server/src/server/agent/provider-snapshot-manager.ts#L1017),[1032-1038](../packages/server/src/server/agent/provider-snapshot-manager.ts#L1032)`). `fetchCatalog`
([acp-agent.ts:1039](../packages/server/src/server/agent/providers/acp-agent.ts#L1039)) opens a fresh probe session at the provider's default
model; ACP's `ModelInfo` carries no thinking data
(`[types.gen.d.ts:1900-1928](../node_modules/@agentclientprotocol/sdk/dist/schema/types.gen.d.ts#L1900)`), so `deriveModelDefinitionsFromACP`
([acp-agent.ts:775](../packages/server/src/server/agent/providers/acp-agent.ts#L775)) takes the session-wide `thought_level` ladder from
`configOptions` and stamps the identical list on every model
([acp-agent.ts:790](../packages/server/src/server/agent/providers/acp-agent.ts#L790),[802](../packages/server/src/server/agent/providers/acp-agent.ts#L802)). Every model therefore advertises the default
model's ladder — for glm-acp-agent, glm-5.3's six levels — and a session on
a narrower model (e.g. flash: `low|high|max`) shows phantom levels; picking
one makes the agent coerce it to the nearest valid value and the picker
snaps back. Per ACP, the real per-model ladder is only obtainable by
switching to the model and reading the complete re-advertised config list
the spec requires in every `setSessionConfigOption` response
(`[types.gen.d.ts:3107-3122](../node_modules/@agentclientprotocol/sdk/dist/schema/types.gen.d.ts#L3107)`).

## Constraints

- Only the 3 files in the mitigation table may change.
- acp-agent.ts, provider-snapshot-manager.ts, the app, and glm-acp-agent
  may not change.
- The resolver must not throw out of `fetchCatalog`: any per-model failure
  falls back to that model's existing ladder (criterion 3).
- No new options, feature flags, or provider-id gates; the resolver applies
  to the generic ACP path uniformly.
- Upstream tests (including `acp-agent.test.ts`,
  `cursor-acp-catalog.test.ts`) may not be edited.
- No refactoring of `deriveModelDefinitionsFromACP` or the snapshot
  manager, even where they look wrong — their blanket stamp is what the
  fallback preserves.

## Steps

0. Read the `code` skill before writing anything. If a step below turns out
   to be wrong, stop and report back to the supervisor — do not amend this
   plan and do not re-decide placement while coding.
1. Create
   `packages/server/src/server/agent/providers/acp-catalog-thinking.rambla.ts`
   exporting a resolver with the shape
   `resolvePerModelThinkingCatalog(context: ACPCatalogModelResolverContext):
Promise<AgentModelDefinition[]>`. For each model it switches the probe
   session via the `model` config option (`setSessionConfigOption`), reads
   the `thought_level` options from the response's complete
   `configOptions` list, and returns the catalog with that model's
   `thinkingOptions` / `defaultThinkingOptionId` replaced; on any failure
   for a model it returns that model's entry untouched.
   **Acceptance criteria**: delivering plan criterion 3 (fallback path
   exists and is the default on error), and the resolver compiles against
   the existing `catalogModelResolver` input
   type ([acp-agent.ts:437](../packages/server/src/server/agent/providers/acp-agent.ts#L437)).
2. Create
   `packages/server/src/server/agent/providers/acp-catalog-thinking.rambla.test.ts`
   with a fake connection/config-option harness covering: per-model ladder
   stamping for divergent models; fallback to the pre-stamped ladder when
   the switch rejects the model; and pass-through of the derived list when
   no `thought_level` options exist anywhere. **Acceptance criteria**: delivering plan criteria 1, 3, 4 (automated half).
3. Wire the resolver into `provider-registry.ts`'s generic `acpOptions`
   literal (~lines 805–813): 1 import at the end of the import block and
   one `catalogModelResolver:` line, tagged with the fork tag.
   **Acceptance criteria**: delivering plan criteria 1 and 2 (end-to-end:
   snapshot refresh now serves per-model ladders, picks stick), and 3
   (specialized clients at :810–815 untouched).
   **User reviews this step's result in the app before the plan
   continues:** refresh the provider snapshot on a glm-acp-agent session,
   confirm the flash entry shows three levels, pick each, confirm no
   snap-back.

## Verification

- `npm run typecheck`
- `npm run lint`
- `npx vitest run packages/server/src/server/agent/providers/acp-catalog-thinking.rambla.test.ts --bail=1`
- `git grep "RAMBLA-FORK:" -- packages/server/src/server/agent/provider-registry.ts` — must show the tag.
- In the app: refresh the provider snapshot, open a glm-acp-agent session on
  flash, confirm the picker offers exactly the flash ladder and every pick
  sticks (criterion 2's observable half).

## Risks

- Catalog refreshes do one extra `setSessionConfigOption` round-trip per
  model; slow or chatty agents make snapshot refreshes proportionally
  slower. The per-model try/catch bounds this to wasted time, not failure.
- Agents that mishandle `model` switches mid-probe (spec-conforming in
  name only) could return inconsistent ladders; the fallback only covers
  errors, not plausible-but-wrong data.
- The probe session used by `fetchCatalog` is transient; if the resolver's
  switches leave it on a non-default model, later probes are unaffected
  (fresh session per fetch) but the same fetch's subsequent model reads
  must not assume which model is current — the resolver sets the model
  before each read.
