# fix: user message bubble square top-right corner

Status: approved

## Provenance

- main: `77a4dc661` — 2026-09-30
- upstream-rebrand: `bdc3888cf` — 2026-09-30
- upstream/main: `c481ecf3e` (v0.10.0) — 2026-09-28

## Scope

**In scope:**

1. The gray bubble behind the user's own messages in the chat view renders with all four corners rounded at the standard bubble radius.

**Not in scope:**

- Assistant/agent message bubbles — they are separate styles in the same file and were not reported broken.
- Grouping-driven corner variation (e.g. flattening corners between consecutive user messages) — grouping currently only affects container spacing and stays that way.
- Any radius token changes in the theme; any refactor of `message.tsx`.

## Acceptance criteria

1. In the chat view, the gray bubble behind the user's own messages shows all four corners visibly rounded at the same radius; no square or near-square corner at the top-right, on web.
2. Same holds on native mobile.
3. Consecutive user messages in a group keep their existing spacing; bubble padding, width behavior, and text layout are unchanged.

## Goal

Fix the user message bubble whose top-right corner renders as a near-square corner instead of the rounded corner used on the other three.

## Merge conflict mitigation

**Files this work changes:**

| File                                      | Edit                                                                 | Upstream activity       | Tag                 |
| ----------------------------------------- | -------------------------------------------------------------------- | ----------------------- | ------------------- |
| `packages/app/src/components/message.tsx` | remove the top-right corner-radius override in the user bubble style | last touched 2026-09-21 | `RAMBLA-FORK: fix:` |

**Why this shape:** a single wrong style line in upstream's stylesheet is the whole bug; a `*.rambla.*` copy of the stylesheet would cost more than the one-line conflict risk. In-place minimal edit per placement rule 4.

**Branch:** `fix/user-bubble-top-right-radius`

## Cause

The user-message bubble style in [message.tsx:347](../packages/app/src/components/message.tsx#L347) sets the full 16px bubble radius, then immediately overrides only the top-right corner to a 2px token, which renders as a square corner. The grouping props that flow into `UserMessage` (via [layout.ts:329](../packages/app/src/agent-stream/layout.ts#L329)) only influence container spacing styles, not the bubble corners, so the override applies to every user message unconditionally.

## Constraints

- No file outside the mitigation table may change.
- Grouping behavior, bubble padding, colors, and text styles may not change.
- No new components, helpers, options, or theme tokens.
- The rest of `message.tsx` (3200+ lines) may not be touched beyond the one style line.

## Steps

1. In `packages/app/src/components/message.tsx`, in the user message bubble style, delete the top-right corner-radius override so the bubble's uniform radius applies to all four corners. Tag the diverging site with the fork tag (category `fix:`, this plan file).

   **Acceptance criteria:** criteria 1–3, verified by the UI check in Verification (user reviews the rendered result before the plan continues).

## Verification

- `npm run typecheck`
- `npm run lint`
- `git grep "RAMBLA-FORK:" -- packages/app/src/components/message.tsx` — must show the tag.
- Open the chat view with at least two consecutive user messages: the user bubble shows four rounded corners, and grouped messages keep their spacing.

## Risks

- None known — the change removes one style override; no other style or component depends on it.
