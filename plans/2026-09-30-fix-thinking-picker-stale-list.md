# fix: thinking picker offers levels the active model doesn't support

Status: approved

## Provenance

- main: `01f83a7bf` — 2026-09-30
- upstream-rebrand: `bdc3888cf` — 2026-09-30
- upstream/main: `c481ecf3e` (v0.10.0) — 2026-09-28

## Scope

**In scope:**

1. Wiring upstream's existing `resolveKimiCatalogModels`
   ([kimi-acp-agent.ts:23](../packages/server/src/server/agent/providers/kimi-acp-agent.ts#L23))
   into the generic ACP client path used by custom ACP providers, as its
   `catalogModelResolver`. It switches the probe session to each model and
   stamps that model's re-advertised `thought_level` ladder on its entry.
2. A fork test covering per-model ladders on the generic path and the
   switch-failure behavior.

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
- Cursor, Kimi, Kiro, and Trae providers — they build their own options
  and never receive the generic literal's resolver.
- Any copy or change of `resolveKimiCatalogModels` — the user chose to reuse
  it as is.

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
3. If switching to a non-default model fails, that model advertises no
   thinking levels; the default model keeps the probe session's levels.
   Cursor, Kimi, Kiro, and Trae behave exactly as before the change.
4. All behavior covered by a new `*.rambla.test.ts`; no upstream test file
   edited.

## Goal

The thinking picker derives every model's options from one session-wide
`thought_level` ladder stamped at catalog time, so users see and pick levels
the active model silently rejects (the pick snaps back). Fix: derive each
model's ladder from the model itself by reusing upstream's Kimi resolver,
which already does that config round-trip.

## Merge conflict mitigation

**Files this work changes:**

| File                                                                             | Edit                                                                         | Upstream activity                                       | Tag                 |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------- | ------------------- |
| `packages/server/src/server/agent/provider-registry.ts`                          | 1 import + `catalogModelResolver:` entry in the generic `acpOptions` literal | last touched 2026-09-27 by upstream rebrand `20f46ddda` | `RAMBLA-FORK: fix:` |
| `packages/server/src/server/agent/provider-registry-acp-thinking.rambla.test.ts` | generic ACP client's per-model ladders, criteria 1 and 3                     | new                                                     | `RAMBLA-FORK: fix:` |

**Why this shape:** upstream's `resolveKimiCatalogModels`
([kimi-acp-agent.ts:23-81](../packages/server/src/server/agent/providers/kimi-acp-agent.ts#L23))
already does the per-model switch and ladder read, and the generic client
already accepts a `catalogModelResolver`
([generic-acp-agent.ts:53](../packages/server/src/server/agent/providers/generic-acp-agent.ts#L53),[81](../packages/server/src/server/agent/providers/generic-acp-agent.ts#L81)).
Reusing it keeps upstream's future fixes; the user accepted its
drop-on-failure behavior over copying it into a `.rambla.` file.

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

- Only the 2 files in the mitigation table may change.
- acp-agent.ts, kimi-acp-agent.ts, generic-acp-agent.ts,
  provider-snapshot-manager.ts, the app, and glm-acp-agent may not change.
- No new options, feature flags, or provider-id gates; the resolver applies
  to the generic ACP path uniformly.
- Upstream tests (including `acp-agent.test.ts`,
  `cursor-acp-catalog.test.ts`) may not be edited.
- No refactoring of `deriveModelDefinitionsFromACP` or the snapshot
  manager, even where they look wrong.

## Steps

0. Read the `code` skill before writing anything. If a step below turns out
   to be wrong, stop and report back to the supervisor — do not amend this
   plan and do not re-decide placement while coding.

- Write
  `packages/server/src/server/agent/provider-registry-acp-thinking.rambla.test.ts`
  first, failing: a custom ACP provider's generic client, probed against a
  fake agent with divergent per-model ladders, serves each model's own
  ladder; a non-default model whose switch fails serves none; the default
  model keeps the probe session's ladder. Then wire
  `resolveKimiCatalogModels` into the generic `acpOptions` literal
  ([provider-registry.ts:796-803](../packages/server/src/server/agent/provider-registry.ts#L796)):
  1 import at the end of the import block, and 1 tagged
  `catalogModelResolver:` line placed right after `logger,`, away from
  `providerParams:`, which upstream/main `29c198f95` deletes. Tag:
  `RAMBLA-FORK: fix:` with this plan's file name.
  **Acceptance criteria**: plan criteria 1, 3, and 4 asserted by the new
  test and passing; the Cursor, Kimi, Kiro, and Trae branches
  ([provider-registry.ts:804-815](../packages/server/src/server/agent/provider-registry.ts#L804))
  unchanged.
  **User reviews the result in the app before the plan is done:** refresh
  the provider snapshot on a glm-acp-agent session, confirm the flash entry
  shows three levels, pick each, confirm no snap-back (criterion 2).

## Verification

- `npm run typecheck`
- `npm run lint`
- `npx vitest run packages/server/src/server/agent/provider-registry-acp-thinking.rambla.test.ts --bail=1`
- `git grep "RAMBLA-FORK:" -- packages/server/src/server/agent/provider-registry.ts` — must show the tag.
- In the app: refresh the provider snapshot, open a glm-acp-agent session on
  flash, confirm the picker offers exactly the flash ladder and every pick
  sticks (criterion 2's observable half).

## Risks

- Catalog refreshes do one extra `setSessionConfigOption` round-trip per
  model; slow or chatty agents make snapshot refreshes proportionally
  slower.
- Agents that reject `model` switches during the probe lose thinking
  levels on every non-default model.
- Upstream may later change `resolveKimiCatalogModels` for Kimi-only
  reasons; those changes reach the generic path too.
