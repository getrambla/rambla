# fix: question card text not selectable on web

Status: approved

## Provenance

- main: `16c54c44e` — 2026-10-02
- upstream-rebrand: `bdc3888cf` — 2026-09-30
- upstream/main: `c481ecf3e` (v0.10.0) — 2026-09-28

## Scope

**In scope:**

1. On web/desktop, the question text, option labels, and option descriptions
   in the agent question card (`QuestionFormCard`) become user-selectable, so
   a selection can be read by a screen reader.
2. A fork test asserting the selection styles land on those three texts on
   web and are absent off-web.

**Not in scope:**

- iOS multi-paragraph selection limits (native renders one UITextView per
  paragraph by design; separate plan if ever wanted).
- The panel-wide `userSelect: "none"` default in `agent-panel.tsx` and any
  other agent-stream chrome.
- Any cursor change — react-native-web defaults stay.
- Question nav buttons and dismiss chrome labels.
- The "Other" free-text input (already a editable TextInput).

## Acceptance criteria

1. On the web app, with a question card showing, the question text can be
   selected by mouse drag starting on it, and selected text is readable by
   the user's screen reader.
2. Option labels and descriptions can be selected the same way, and clicking
   a row still toggles the answer exactly as before.
3. A selection started on the question text extends across the option labels
   beneath it in one continuous drag.
4. The mouse cursor stays a pointer over answer rows and default arrow over
   the question text on web.
5. On native/iOS nothing changes: no selection styles are emitted off-web,
   and native card behavior is untouched.
6. `npm run typecheck` and `npm run lint` pass; no upstream test file is
   modified.

## Goal

Make the question tool's text selectable on web so screen readers can read
the question and the answers; clicks still answer.

## Merge conflict mitigation

**Files this work changes:**

| File                                                            | Edit                                                                                                                                             | Upstream activity                                                           | Tag                 |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- | ------------------- |
| `packages/app/src/components/question-form-card.tsx`            | three one-line `userSelect` additions inside existing style compositions (`questionText`, `optionLabel`, `optionDescription`), fork tag per site | last touched 2026-09-23; upstream PRs #5320, #4587, #3517 in recent history | `RAMBLA-FORK: fix:` |
| `packages/app/src/components/question-form-card.rambla.test.ts` | new fork test: styles present on web, absent off-web                                                                                             | new                                                                         | `RAMBLA-FORK: fix:` |

**Why this shape:** three static style literals in the file's own web-gating
idiom (`IS_WEB` at
[question-form-card.tsx:31](../packages/app/src/components/question-form-card.tsx#L31),
same pattern at
[:297](../packages/app/src/components/question-form-card.tsx#L297)); a
helper would add import-and-wiring upstream edits without shrinking the
diff. The test file is ours alone and can never conflict.

## Cause

[`agent-panel.tsx:1740-1744`](../packages/app/src/panels/agent-panel.tsx#L1740)
(`contentContainer`, applied at
[:1275](../packages/app/src/panels/agent-panel.tsx#L1275) around the whole
`AgentStreamView`) sets web `userSelect: "none"` on the entire agent stream.
Assistant messages opt back in locally
([`message.tsx:332`](../packages/app/src/components/message.tsx#L332) and
:765/:1199, isWeb-gated), but `question-form-card.tsx` sets no `userSelect`
anywhere, so its texts inherit `user-select: none` — no selection, and
screen readers that rely on selection read nothing. The pointer cursor over
answers is react-native-web's Pressable default — `cursor: "pointer"` on
every enabled Pressable (upstream issue
[necolas/react-native-web#1784](https://github.com/necolas/react-native-web/issues/1784)) —
not repo code. RN 0.81.5 maps `userSelect` to `selectable` on native
([`Libraries/Text/Text.js:151`](https://github.com/facebook/react-native/blob/v0.81.5/Libraries/Text/Text.js#L151)),
which is why the repo gates every
`userSelect` with `isWeb`.

## Constraints

- Only the 2 files in the table may change; do not touch
  `agent-panel.tsx`, `message.tsx`, or any upstream test file.
- No cursor styles, no new imports, components, helpers, or options; the
  3 edits fold into the existing style compositions using the file's
  own `IS_WEB` spread idiom.
- Every `userSelect` addition must stay isWeb-gated (criterion 5).
- Fork tag per site: category `fix:`, plan file
  `2026-10-02-fix-question-card-text-selection`, clause "enable question
  card text selection on web".

## Steps

0. Read the `code` skill before writing anything. If a step below turns out
   to be wrong, stop and report back to the supervisor — do not amend this
   plan and do not re-decide placement while coding.

Single work item (1-step plan):

Edit `packages/app/src/components/question-form-card.tsx`: add one
web-gated selectable-text line into each of the 3 existing style
compositions — `questionText` (stylesheet entry at
[question-form-card.tsx:648](../packages/app/src/components/question-form-card.tsx#L648),
composed at
[:499](../packages/app/src/components/question-form-card.tsx#L499)),
`optionLabel`
([:698](../packages/app/src/components/question-form-card.tsx#L698),
composed at
[:83](../packages/app/src/components/question-form-card.tsx#L83)), and
`optionDescription`
([:703](../packages/app/src/components/question-form-card.tsx#L703),
composed at
[:90](../packages/app/src/components/question-form-card.tsx#L90)) — and
tag each site per Constraints. Then create
`packages/app/src/components/question-form-card.rambla.test.ts` asserting:
each composed style carries `userSelect: "text"` under web and nothing
off-web, and no `cursor` property appears in the changed styles.

**Acceptance criteria:** 1–2 (automated part: styles present), 4 (no cursor
property added), 5 (isWeb-gated, native styles untouched), 6 (typecheck,
lint, upstream tests unmodified and green). **User review:** the plan
finishes only after the user confirms criteria 1–3 in the running web app
with their screen reader; the coder reports and stops before `done`.

## Verification

- `npm run typecheck`
- `npm run lint`
- `npx vitest run question-form-card --bail=1` — the new fork test plus
  upstream's browser and core tests all green.
- `git grep "RAMBLA-FORK:" -- packages/app/src/components/question-form-card.tsx`
  — three tags, one per edited style site.
- In the running web app: drag-select from question text through the option
  labels (criteria 1–3), screen reader reads the selection, pointer cursor
  over answer rows, row click still toggles (criterion 4).

## Risks

- A drag that starts on the question text and ends on a Pressable row could
  register as a row click on mouse-up; if the user's hands-on check
  reproduces that, stop and report — do not patch around it.
- None otherwise known: the added properties are the codebase's established
  pattern, and native is untouched by construction.
