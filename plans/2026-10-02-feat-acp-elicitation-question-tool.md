# feat: question tool for generic ACP agents via session/elicitation

Status: unapproved

## Provenance

- main: `9a06266aa` — 2026-10-02
- upstream-rebrand: `bdc3888cf` — 2026-09-30
- upstream/main: `c481ecf3e` (v0.10.0) — 2026-09-28

## Goal

Let any generic ACP agent (e.g. `glm-acp-agent`) ask the user a structured
question mid-turn, like Claude Code's `AskUserQuestion`, by implementing the
ACP elicitation client method and routing it through the existing question
permission pipeline.

## Scope

**In scope:**

1. `ACPAgentClient` advertises the ACP elicitation form capability at initialize
   and implements the `sessionElicitation` Client method (SDK 0.17.1 wire name
   `session/elicitation`, types `ElicitationRequest`/`ElicitationResponse`).
2. Form-mode elicitations are mapped into the existing
   `AgentPermissionRequest` pipeline with `kind: "question"` and
   `input.questions`, so the app renders them with the existing
   `QuestionFormCard` — zero `packages/app` and zero `packages/protocol`
   changes.
3. The user's card answer resolves the pending elicitation with
   `{ action: "accept", content }`; session cancel resolves it with
   `{ action: "cancel" }`.
4. A standalone `*.rambla.ts` module holds all mapping/pending logic; the
   upstream driver gets only small tagged wiring blocks.

**Not in scope:**

- The GLM subprocess's `question` tool itself (the `glm-acp-agent` repo pins a
  compatible SDK and sends form-mode elicitations — prerequisite, not planned
  here).
- URL-mode elicitation rendering (declined with a reason; see criterion 4).
- Bumping `@agentclientprotocol/sdk` in `packages/server` (stays `^0.17.1`;
  the stable `elicitation/create` names of 1.4.0 are a separate future plan).
- App-side rendering changes (`QuestionFormCard` already renders
  `kind: "question"` transport-agnostically).
- Resume/snapshot persistence of pending elicitations.

## Acceptance criteria

1. A generic ACP agent subprocess that sends a form-mode `session/elicitation`
   request containing a questions schema causes the app to render the existing
   question card (`QuestionFormCard`) for that session — options with
   labels/descriptions, multi-select via array properties, and free-text
   "Other" — with no `packages/app` changes in this plan.
2. Submitting answers in the card resolves the pending elicitation and the
   subprocess receives the answer content (single value for string properties,
   arrays for multi-select, free text for "Other"), observable by the agent
   continuing its turn.
3. The elicitation is classified internally as `kind: "question"`; existing
   `session/request_permission` behavior (tool permissions, mode switches,
   auto-accept paths) is unchanged.
4. URL-mode elicitations are not silently swallowed: the provider resolves
   them (decline/cancel) and emits no question card.
5. Cancelling the agent's session while a question is pending clears it from
   the app and resolves the elicitation with `action: "cancel"`.
6. New `*.rambla.test.ts` tests cover: form-elicitation →
   `AgentPermissionRequest` mapping, answer → elicitation resolution mapping,
   URL-mode decline, and cancel handling.

## Merge conflict mitigation

**Files this work changes:**

| File                                                                            | Edit                                                                                                                                                                                                                                                                                                                                                                                                   | Upstream activity                                                                      | Tag                  |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- | -------------------- |
| `packages/server/src/server/agent/providers/acp/acp-elicitation.rambla.ts`      | all logic: schema→questions mapping, answer→content mapping, own pending map (separate from `pendingPermissions`, Codex `async-questions.ts` pattern)                                                                                                                                                                                                                                                  | new                                                                                    | `RAMBLA-FORK: feat:` |
| `packages/server/src/server/agent/providers/acp/acp-elicitation.rambla.test.ts` | unit tests for the module: mappings, resolution, cancel                                                                                                                                                                                                                                                                                                                                                | new                                                                                    | `RAMBLA-FORK: feat:` |
| `packages/server/src/server/agent/providers/acp-agent.ts`                       | (1) ~1 line adding `elicitation: { form: {} }` in `BASE_ACP_CLIENT_CAPABILITIES` (line 274); (2) one contiguous ~15-line `sessionElicitation` Client method; (3) a small branch in `respondToPermission` (line 2370) + merge into `getPendingPermissions` (line 2366); (4) ~2 lines clearing pending elicitations in the cancel path (~line 2428); (5) elicitation type imports at end of import block | last upstream touches 2026-09-30 (rebrand merges + occasional fixes, ~2 commits/month) | `RAMBLA-FORK: feat:` |
| `packages/server/src/server/agent/providers/acp-agent.rambla.test.ts`           | integration test driving `sessionElicitation` directly, modeled on the existing permission tests (lines 1262–1296)                                                                                                                                                                                                                                                                                     | existing (ours)                                                                        | `RAMBLA-FORK: feat:` |

**Why this shape:** every other provider keeps question logic in standalone
modules/functions with one-line call sites (Claude's `resolvePermissionKind`,
Codex's `async-questions.ts`); an elicitation response (`{ action, content }`)
does not type-fit the option-based `pendingPermissions`, so a separate pending
map merged at `getPendingPermissions`/`respondToPermission` follows Codex's
proven split. Copying more or editing the driver deeper only widens the
merge surface without changing behavior.

## Constraints

- No file changes outside the mitigation table.
- `packages/server/package.json` dependency versions may not change.
- Upstream `requestPermission` (line 2487), `mapPermissionRequest` (line
  3904), and all permission auto-accept logic may not be modified.
- `packages/app` and `packages/protocol` may not change.
- No resume/snapshot persistence, no URL-mode rendering, no new config
  options or feature flags.
- The `sessionElicitation` Client method must not be added to the probe
  client (`buildProbeClient`, line 1428) unless the SDK's probe requires it;
  do not touch it preemptively.
- Existing upstream tests may not be edited.

## Steps

0. Read the `code` skill before writing anything. If a step below turns out
   to be wrong, stop and report back to the supervisor — do not amend this
   plan and do not re-decide placement while coding.
   - **Acceptance criteria** no code written in this step; questions go to
     the supervisor instead of improvised answers.
1. Create `packages/server/src/server/agent/providers/acp/acp-elicitation.rambla.ts`
   exporting: a schema→`input.questions` mapper, an answer→`content` mapper,
   and a small pending-store class with add/resolve/cancel keyed by request
   id (module holds no agent imports beyond agent-sdk types). Write
   `acp-elicitation.rambla.test.ts` covering the mappers, accept resolution,
   and cancel.
   - **Acceptance criteria** mapping tests pass (criterion 6); the module
     compiles without importing anything from `acp-agent.ts`.
2. Wire the module into `acp-agent.ts`: capability line, `sessionElicitation`
   Client method (build `AgentPermissionRequest` with `kind: "question"` via
   the mapper, store in the pending store, `pushEvent` `permission_requested`),
   the `respondToPermission` branch (question kind → answer mapper →
   `resolve({ action: "accept", content })`; non-question falls through to
   upstream behavior), merge into `getPendingPermissions`, and cancel-path
   clearing with `action: "cancel"`. Every block gets the fork tag. URL-mode
   requests resolve with decline and no card.
   - **Acceptance criteria** criteria 1–5 hold at the provider boundary;
     existing permission tests still pass (criterion 3).
3. Add the integration test to `acp-agent.rambla.test.ts` driving
   `sessionElicitation` directly on a mocked-spawn session (harness per
   existing permission tests), asserting the emitted `permission_requested`
   event, resolution content, and cancel behavior.
   - **Acceptance criteria** criterion 6 is fully satisfied; `npm run
typecheck` and the new/adjacent vitest files pass.

Steps 2–3: no user review gate — the user reviews the whole plan result at
the end of the single accept-reject loop, since there is no new UI to design.

## Verification

- `npm run typecheck`
- `npm run lint`
- `npx vitest run packages/server/src/server/agent/providers/acp/acp-elicitation.rambla.test.ts packages/server/src/server/agent/providers/acp-agent.rambla.test.ts --bail=1`
- `npx vitest run packages/server/src/server/agent/providers/acp-agent.test.ts --bail=1` (upstream tests untouched, must stay green)
- `git grep "RAMBLA-FORK:" -- packages/server/src/server/agent/providers/acp-agent.ts` — must show tags.
- In-app check: run `glm-acp-agent` with a build that sends a form-mode
  elicitation and see the question card render and answer round-trip.

## Risks

- The wire method name is 0.17.1's unstable `session/elicitation`; a
  subprocess built on SDK ≥1.4.0 sends `elicitation/create` and will not be
  understood — the glm-acp-agent repo must pin a compatible SDK (documented
  prerequisite, not fixable here).
- The probe client (diagnostics path) does not implement the new method; if
  the SDK's probe enumerates all client methods this could surface as a
  diagnostic-only error — verify in step 2, escalate to supervisor if real.
- Cancelling mid-question while the card is open depends on existing
  permission-cancel plumbing (lines 2428–2450) emitting
  `permission_resolved` for our merged pending entries; if the app only
  clears pendings for entries that came through the original event, the
  card could linger — covered by criterion 5's test.
