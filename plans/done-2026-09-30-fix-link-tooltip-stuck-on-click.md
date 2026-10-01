# fix: close a chat link's path tooltip when the link is clicked

Status: done

## Provenance

- main: `77a4dc661` — 2026-09-30
- upstream-rebrand: `bdc3888cf` — 2026-09-30
- upstream/main: `c481ecf3e` (v0.10.0) — 2026-09-28

## Scope

**In scope:**

1. On desktop web, clicking a chat markdown link closes its path tooltip, the same way hover-out does.
2. A fork test for that click and for unchanged hover behavior, written before the fix.

**Not in scope:**

- `packages/app/src/components/ui/tooltip.tsx` and every other tooltip caller; the user chose `link.tsx` only.
- Clicks made before the tooltip has appeared (inside the 400 ms hover delay).
- Native link behavior: the native path renders no tooltip.
- The fade-out animation and the lingering pill's internals.

## Acceptance criteria

1. A new fork test, `packages/app/src/assistant-file-links/link.rambla.test.tsx`, is written before the fix, and its click test fails on the current code.
2. On desktop web, clicking a chat link that is showing its path tooltip closes the tooltip. The test from criterion 1 passes after the fix.
3. Hovering a chat link still shows its path tooltip after the 400 ms delay, and moving the mouse away hides it. Asserted in the same test file.
4. No other tooltip changes. Only `link.tsx` and the new test file are edited.
5. In the desktop app, after the user clicks a chat link and the new tab opens, no tooltip or empty pill remains. User check.

## Goal

Clicking a chat file link leaves its hover tooltip on screen as an empty pill after the new tab opens. Close the tooltip on click.

## Merge conflict mitigation

**Files this work changes:**

| File                                                         | Edit                                                                   | Upstream activity                                                        | Tag                 |
| ------------------------------------------------------------ | ---------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------- |
| `packages/app/src/assistant-file-links/link.tsx`             | `FileLinkHoverTooltip` holds its tooltip's open state, closes on click | last change 2026-08-17 (`5ec26f0c0`), then rebrand, 10 commits this year | `RAMBLA-FORK: fix:` |
| `packages/app/src/assistant-file-links/link.rambla.test.tsx` | fork test: click closes the tooltip; hover open and close unchanged    | new                                                                      | `RAMBLA-FORK: fix:` |

**Why this shape:** A few lines in one upstream function (placement rule 4). The user chose `link.tsx` over `tooltip.tsx` so no other tooltip changes. `Tooltip` already takes a controlled `open` and `onOpenChange` ([tooltip.tsx:227-248](../packages/app/src/components/ui/tooltip.tsx#L227)), the pattern `context-window-meter.tsx` uses.

## Cause

Hovering the link schedules the tooltip to open after 400 ms ([tooltip.tsx:293-303](../packages/app/src/components/ui/tooltip.tsx#L293)). Its trigger is a plain wrapper `View` ([link.tsx:213-215](../packages/app/src/assistant-file-links/link.tsx#L213)), so the trigger's press-to-close ([tooltip.tsx:352-363](../packages/app/src/components/ui/tooltip.tsx#L352)) is merged as `onPress`, which react-native-web's `View` does not forward; the click never closes it. A bubbling `onClick` on the wrapper does not help either: the link text is a `Pressable` ([link-text.tsx:30-32](../packages/app/src/components/markdown/link-text.tsx#L30)), and react-native-web's press handling stops the click's propagation before calling `onPress`. That handling stops click and keydown, not mouse-up or pointer-up, so the close hangs off the release. The click opens a tab, and the chat panel is hidden with `display: none`, not unmounted ([retained-panel.tsx:44-46](../packages/app/src/components/retained-panel.tsx#L44)), so no hover-out ([tooltip.tsx:325-329](../packages/app/src/components/ui/tooltip.tsx#L325)) ever arrives. Why the pill shows empty is not traced; criterion 5 confirms closing on click removes it.

## Constraints

- Only the 2 files in the table may change.
- Hover open and close, the 400 ms delay, the tooltip text, and the native path stay as they are.
- No new props, helpers, or abstractions.
- The `link.tsx` edit stays inside `FileLinkHoverTooltip` plus imports at the end of the import block, tagged `// RAMBLA-FORK: fix: 2026-09-30-fix-link-tooltip-stuck-on-click.md: closes the path tooltip when the link is clicked.`

## Steps

0. Read the `code` skill before writing anything. If this plan turns out to be wrong, stop and report back to the supervisor; do not amend this plan or re-decide placement while coding.

Write `link.rambla.test.tsx` first, mounting the link on web the way `packages/app/src/components/ui/tooltip.test.tsx` does. Run it and confirm the click test fails on the current code. Then change `FileLinkHoverTooltip` in `link.tsx` so releasing the mouse on the link closes its tooltip, not pressing it. After the fix, the user checks it in the desktop app before the plan is done.

**Acceptance criteria** — criteria 1-4 pass; `npx vitest run src/assistant-file-links/link.rambla.test.tsx --bail=1` exits 0 from `packages/app`; criterion 5 confirmed by the user.

## Verification

- `npm run typecheck`
- `npm run lint`
- `npx vitest run src/assistant-file-links/link.rambla.test.tsx --bail=1` (from `packages/app`)
- `git grep "RAMBLA-FORK:" -- packages/app/src/assistant-file-links/link.tsx` shows the tag.
- Desktop app: hover a chat file link until its path tooltip shows, click it, and confirm no tooltip or empty pill remains in the new tab (criterion 5, user check).

## Risks

- The empty pill may not come from the open state. If criterion 5 fails, stop and report; do not widen the fix.
- Setting `open` to false from outside does not clear the trigger's pending open timer ([tooltip.tsx:300-303](../packages/app/src/components/ui/tooltip.tsx#L300)), so a click inside the 400 ms delay may still open the tooltip later. Out of scope.
- Upstream editing `FileLinkHoverTooltip` would conflict with the small block.
