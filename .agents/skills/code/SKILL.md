---
name: code
description: Implement a fix or feature in the Rambla fork of upstream Paseo, following an approved plan's merge-conflict mitigation table. Covers where code is allowed to go, how small an edit in an upstream file has to be, tagging divergences, which tests to run, and when to stop and ask. Use when writing or changing code in this repo, or when implementing a plan from the plan skill.
---

# Writing code in the Rambla fork

## Where the code is

**All of it is in `rambla/`** — a permanent, terminal fork of upstream
`getpaseo/paseo`, rebranded by script. Every package, test, and npm script
lives there, and that is where commands run. The outer repo you start in —
whatever it happens to be called — holds no application code. It's the
container: plans, research, notes, tooling, and `rambla/` as a submodule.
Don't go hunting for source at the top level; there isn't any.

Nothing is ever contributed upstream and the fork is never rebased. Upstream
is merged in, roughly weekly, forever.

## Who does what

Three roles, kept separate.

- **Supervisor** — holds the user's request, the plan, and the reviewer's
  verdicts. Doesn't read the codebase; that's what the subagents are for.
- **Coder** (a subagent) — writes the tests and the code. Edits code only.
- **Reviewer** (a separate subagent) — checks the work against the plan and
  against this skill's rules. Never the agent that wrote the code. Reviewing
  is read-only: it reports, it does not fix.

**Accept/reject loop, every time.** The reviewer returns ACCEPT or REJECT.
ACCEPT means all three: the work matches the plan, the reviewer ran the tests
itself and saw them pass, and nothing changed outside the plan's scope.
REJECT is a numbered list of deficiencies, sent to the coder only. Re-review
is blind — re-send the same original instructions, never a summary of what
was fixed. Third REJECT on the same deficiency: stop and go to the user.

**The plan file is read-only.** The coder and the reviewer may read it.
Neither may edit it, and neither may quietly work around it. Once a plan is
reviewed and approved it is fixed — see "Stop and ask the user".

## Step 0 — read these first

1. **The plan** for this work, in `rambla/plans/`. Its merge conflict
   mitigation table is a contract, not a suggestion. Its Provenance section
   says which commit of main the plan was written against — if main has moved
   since, every line number in it is suspect, so say so before starting.
2. **The `plan` skill**, sections "Nothing unchecked goes in a plan",
   "Placement decision", "Edit rules inside upstream files", and "Where
   conflicts come from". Those are the rules. This skill is how you apply
   them while coding, and does not repeat the reasoning behind them. The
   verification rule holds while coding exactly as it does while planning:
   read it, cite it, or don't claim it.

No plan exists? Stop and ask whether to write one. Fixes of one or two lines
can skip a plan; anything larger should not.

## The placement rules, in one screen

The `plan` skill has the mechanism. The short form you work from:

- New function, type, component, hook, constant table → **new
  `*.rambla.ts(x)` file.** Any size. A new file cannot conflict, ever.
- Replacing most of an upstream function or component → our version in a
  `*.rambla.ts(x)` file, under a different name, called from the upstream
  site. Their signature and call sites stay untouched.
- Changing some of upstream's logic → put the logic in a `*.rambla.ts`
  helper, call it in **one line**. Twenty lines inside their function is
  twenty lines of future conflict.
- Changing a handful of lines where extracting would be sillier than the
  edit → edit in place, minimally.

Plus:

- **Keep our edits in one contiguous block per file.** Scattered one-line
  edits multiply the chances of colliding with upstream.
- **New imports go at the END of the import block, after a blank line.**
- **Every diverging site gets a tag comment on the line above:**
  `// RAMBLA-FORK: <category>: <what and why>.` Categories are the fixed list
  at the top of `PATCHES.md`. Never invent one.
- **Never reformat, reorder, rename, or tidy upstream code you aren't
  fixing.** Keep their lines in their order.
- **Never rename or move upstream code.** A move is a delete plus an insert,
  and the delete conflicts forever.

## Before you touch any upstream file

```
git diff HEAD upstream-rebrand -- <path>
```

**Always `upstream-rebrand`, never `upstream/main`.** `upstream/main` is
unrebranded: every line mentioning the brand differs, and a path we renamed
doesn't exist there at all, so the diff is either noise or empty. The
rebrand branch is upstream's tree with the rename already applied, so a diff
against it shows only differences that are real.

If upstream already fixed this, **port their fix verbatim.** Do not invent a
parallel solution — an invented fix conflicts with theirs on the next merge
and we get the worst of both.

Also check whether the file is even upstream's:

```
git log upstream-rebrand -- <path>      # any history = upstream's
```

## Write the minimum code that works

- No extra abstraction, no configuration nobody asked for, no error handling
  for cases that can't happen, no "while I'm here" cleanups.
- If the fix is three lines, it's three lines. Do not grow it into a module
  because a module feels tidier.
- This applies to production code only. Tests are ours, in our own files,
  and can be as thorough as you like.

## Tests

**Write the failing test first**, then the code that makes it pass.

- **Our tests go in `*.rambla.test.ts`.** New file, even when an upstream
  suite covers the same module. These never conflict.
- Keep the category suffix last: `foo.rambla.e2e.test.ts`,
  `foo.rambla.browser.test.ts`.
- **Never edit, delete, or skip an upstream test.** Not to make your change
  pass, not because the assertion looks outdated. A failing upstream test
  means your change broke behavior someone deliberately asserted. Bring it
  to the user with what you think is causing it.
- A `.skip` that carries a `RAMBLA-FORK: skip-test:` comment is a deliberate
  divergence the user already approved. Leave it.

### Which tests to run

Only the tests that intersect what you changed, plus your own:

```
npx vitest run <your test file> --bail=1
npx vitest run <the upstream test file covering the module you edited> --bail=1
```

Pipe to a file and read the file if the output is long.

**Never run the full suite.** No `npm run test` at the workspace or repo
level, no `test:e2e*`, no `test:integration*`, no Playwright, no Maestro.
They will freeze the machine — several agents may be running at once. Full
verification happens in CI, not here.

## When you're done

```
npm run typecheck
npm run lint
npm run format
```

Never hand-fix formatting; Biome owns it. Formatting that diverges from
upstream's output widens every future conflict.

Then:

- `git grep "RAMBLA-FORK:" -- <each upstream file you edited>` — every one
  must show a tag. An untagged divergence is one we lose at the next merge.
- **4 or more upstream files edited** (tests excluded): you should be on a
  branch, and you run `just trial-merge` from `rambla/` before calling it
  done. Conflicts usually mean move our code, not resolve them. `just
trial-merge drop` cleans up.
- Add the `PATCHES.md` entry from the plan's Ledger section. Last step.

## Stop and ask the user

- **The plan turns out to be wrong, incomplete, or inconsistent with the
  code.** Stop and ask the user what to do. Do not edit the plan, do not
  re-decide placement mid-edit, do not work around it. The plan was reviewed
  and approved; changing it is the user's call, not yours.
- An upstream test fails, or would have to change.
- Upstream already fixed this a different way (say in plain English what they
  did and how it differs).
- The change needs an identifier rename that upstream also names.
- **Anything else this skill doesn't clearly cover.** These are the obvious
  cases, not the whole list. Ask rather than pick. Slow and asking is the
  intended pace.

## The scope is the plan's scope

Do exactly what the plan says. Not more, not less. Not the obvious
improvement next to it, not the half of it that seems sufficient.

**The mitigation table is the complete list of files that may change.** No
file outside it gets created or edited — not a config line, not a one-line
import fix somewhere else, not a rename that "has to happen anyway". If the
work appears to need a file that isn't listed, stop and ask the user. That
is a hole in an approved plan, and only they can widen it.

The reviewer rejects on any file outside the table, whatever the reason.

**Other agents work in this checkout at the same time.** Uncommitted changes
and new files you didn't make are someone else's job in progress. If they
don't touch your files, they don't exist as far as you're concerned.

**NEVER run a command that discards work you didn't write.** Not
`git checkout -- <file>`, not `git restore`, not `git stash`, not
`git reset --hard`, not `git clean`, and never an edit or a write to any
file that isn't in the plan's mitigation table. **Read anything you like —
reading is free and encouraged. Writing is confined to the table.**
Uncommitted work has no undo — one
`git checkout` on another agent's file destroys hours of work permanently,
and this has happened. There is no situation in this task where discarding
someone else's changes is the right move. If a file you didn't write is in
your way, stop and ask.

Beyond that: don't fix them, don't stage them, don't tidy them, don't report
them as problems.

If something uncommitted does touch a file in your mitigation table, check
before reacting — `git status --porcelain` and `git diff -- <file>` — and
confirm it's really another agent's change and really overlaps yours. Then
ask the user what to do and wait. Never resolve an overlap on your own
judgment.

**Something worth fixing that's out of scope? Stop and raise it now.** Don't
bank it for the end, don't fix it, don't write it into any file. Say what you
found in a sentence and wait. The user decides whether it becomes its own
plan or waits.

## Reporting

Concerns first, always — if something is risky, unresolved, or out of scope,
that's the first sentence.

**Check every claim before you make it, and cite it.** Anything you say about
the code — in chat, in a commit message, in the `PATCHES.md` entry — is
something you opened and read, carrying a `file.ts:120` reference. Not
inferred from a name, not a mechanism that sounds right. If you can't cite
it, you haven't checked it, and you don't say it yet.

Read test and git output yourself and say what it
means in one line; never paste raw output or tell the user to go look at it.
Use the file-reading and file-editing tools, not shell commands like `cat`,
`sed`, or `python`, for reading and editing files.

**Report decided things. Never reason at the user.** No "should", no "turns
out", no "it assumed", no account of a wrong turn you already corrected.

**Every thing you name must exist outside your own head** — a file path, a UI
element the user has seen, a heading in the plan. If you can't attach one,
rewrite the sentence until you can. "The copy is gone" is unresolvable: a
deleted file, deleted code, an abandoned idea? It reads as damage. This binds
short status messages too; "it's only an update" is not an exemption.

**Never report effort** — what a reviewer tried, examined, or couldn't find
is not a result. Report findings and what changed because of them.

**No line counts**, and no revising a count you gave earlier. Risk comes from
which files change and how active upstream is in them.

**Land every report**: end with where the work now stands, written as if the
user had read none of the updates before it.

### Review round templates

Use these exactly. They are the only thing the user gets between rounds.

**Reviewer rejected:**

```markdown
The reviewer accepted 6 of 7 items. Rejected:

1. [os-notifications.ts:42](rambla/packages/app/src/utils/os-notifications.ts#L42) — <the specific problem, briefly — 25 words maximum>
2. ...
```

Never reproduce the reviewer's own words; it writes for whoever fixes the
problem. Don't say what happens next — going back for a fix is understood.

**Reviewer accepted:**

```markdown
The reviewer accepted all 7 items:

1. <what the item is — 25 words maximum>
2. ...

Files changed:

- [settings-screen.tsx:120](rambla/packages/app/src/screens/settings-screen.tsx#L120) — <what changed there>
- ...

Conflict mitigation: <the approach in 25 words or less>
```

Code findings always have a location, so every rejected item carries a link —
see "File links".

## Numbers are digits when they are data

A number that is **data** — a count, a measurement, a limit, a version, a
date — is a digit. `5 sites`, `3 files`, `2 of 7 items`. Never `five sites`.
This holds at 1 as well: `1 upstream file`, not `one upstream file`.

The test: **would the user want to spot it at a glance?** They read with a
screen reader; a digit is findable, a spelled-out number has to be read
through.

A number that is part of an English phrase rather than a quantity stays a
word: "one at a time", "one another", "no one", "one of them".

Applies in chat, in commit messages, in `PATCHES.md` and in code comments.

## File links

**Never write a bare path.** Every file reference, everywhere, is a markdown
link with the line as `#L<n>`. Link text is always `name.ts:120`.

| Where the text is read  | Target starts with           |
| ----------------------- | ---------------------------- |
| Chat with the user      | `rambla/`                    |
| A file inside `rambla/` | a path relative to that file |

```markdown
chat: [en.ts:2207](rambla/packages/app/src/i18n/resources/en.ts#L2207)
PATCHES.md: [en.ts:2207](packages/app/src/i18n/resources/en.ts#L2207)
```

Why they differ: the user runs this project from a workspace folder that
holds the fork in a subfolder named `rambla/`, so paths in chat resolve from
that workspace root. A file committed in the repo has no `rambla/` above it —
on GitHub and in a clone, the repo root _is_ the fork — so links written into
a file are relative to that file. `PATCHES.md` sits at the fork root, so it
needs no prefix at all; a plan in `rambla/plans/` needs `../`.

`#L<n>` is the GitHub form and it works in both places, so the line syntax
never changes. Only the prefix does.

A bare `path:line` renders as plain text. The user cannot open it, and this
user reads with a screen reader — an unclickable path costs them a manual
lookup every time.
