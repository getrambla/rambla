---
name: code
description: Implement a fix or feature in the Rambla fork of upstream Paseo, following an approved plan's merge-conflict mitigation table. Covers where code is allowed to go, how small an edit in an upstream file has to be, tagging divergences, which tests to run, and when to stop and ask. Use when writing or changing code in this repo, or when implementing a plan from the plan skill.
---

# Writing code in the Rambla fork

## Where the code is

**All of it is in `rambla/`** — a permanent, terminal fork of upstream
`getpaseo/paseo`, rebranded by script. Every package, test, and npm script
lives there, and that is where commands run. The outer repo holds plans,
research, notes, and tooling only — no application code.

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
itself and saw them pass, and nothing changed outside the mitigation table —
`.rambla.test.ts` files excepted, they are always ours.
REJECT is a numbered list of deficiencies, sent to the coder only. Re-review
is blind — re-send the same original instructions, never a summary of what
was fixed. **At most 2 fix-and-rereview rounds**; still rejected after that,
stop and bring both positions to the user to decide.

**The plan file is read-only.** The coder and the reviewer may read it.
Neither may edit it, and neither may quietly work around it. When the plan
turns out wrong, incomplete, or inconsistent with the code: stop and report
back to the supervisor — do not re-decide placement mid-edit, do not work
around it. The supervisor asks the user; changing a reviewed plan is the
user's call. A plan exists for every task sent to implementation; whether
one is needed is never the coder's call.

## Step 0 — read these first

1. **The plan** for this work, in `rambla/plans/`. Its mitigation table is
   the complete list of files that may be created or edited — a contract,
   not a suggestion. Its Provenance section
   says which commit of main the plan was written against — if main has moved
   since, every line number in it is suspect, so say so before starting.
2. **The `plan` skill**, sections "What a plan is" (the citation rule) and
   "How git decides conflicts — do not relitigate this". This skill is how
   you apply them while coding, and does not repeat the reasoning behind
   them.

## Reading rules

- **Never read or grep a minified file — not even partially.** They are 1
  line and hundreds of KB; any read returns the whole line and buries your
  context. To learn what a bundled library does, search its documentation.
- **Files over 2000 lines are named ranges only.** Read the regions the plan
  cites, not the file.
- **Targeted reads only — ±30 lines around the spot the plan touches.** A
  whole-file read needs the supervisor's say-so.
- Read what you need to verify a claim — but a whole-file read of a large
  file is how a coder's context dies. Scope reads to what the plan touches.

These rules bind the coder AND the reviewer.

## The placement rules, in one screen

The plan skill's "Placement decision" is authoritative. The coder's working
form:

- New function, type, component, hook, constant table → **new
  `*.rambla.ts(x)` file.** Any size. A new file cannot conflict, ever.
- Replacing most of an upstream function or component → our version in a
  `*.rambla.ts(x)` file, under a different name, called from the upstream
  site. Their signature and call sites stay untouched.
- Changing some of upstream's logic → put the logic in a `*.rambla.ts`
  helper, call it in **one line**.
- Changing a few lines where extracting would be sillier than the
  edit → edit in place, minimally. At most 5 changed lines.

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
git log upstream-rebrand -- <path>      # any history = upstream's
```

**Always `upstream-rebrand`, never `upstream/main`** — it is unrebranded, so
the diff is noise or empty (see the plan skill, "How git decides conflicts").

If the plan names an upstream fix, **port it verbatim.** Do not invent a
parallel solution — an invented fix conflicts with theirs on the next merge
and we get the worst of both. If you find an upstream fix the plan didn't
name, stop and report to the supervisor.

## Write the minimum code that works

- No extra abstraction, no configuration nobody asked for, no error handling
  for cases that can't happen, no "while I'm here" cleanups.
- If the fix is three lines, it's three lines. Do not grow it into a module
  because a module feels tidier.
- This applies to production code only. Tests are ours, in our own
  `.rambla.test.ts` files,
  and can be as thorough as you like.

## Tests

**Write the failing test first**, then the code that makes it pass.

- `.rambla.test.ts` files are ours, always — never upstream's. Each upstream
  file the
  plan edits implies its companion `*.rambla.test.ts`, created or extended
  as the work needs. They never need a table row.
- **Never add tests to upstream test files, and never edit, delete, or skip
  an upstream test.** Not to make your change
  pass, not because the assertion looks outdated. When one fails:
  1. **If your code caused it** — a bug in your change, a wrong assumption
     about existing behavior — fix your code. Do not report it; it is yours.
  2. **If your feature or fix genuinely conflicts with the test** — the
     behavior the change requires is not what the test asserts — **stop all
     work**, and report to the supervisor: the test name, the failure
     output, and why you believe the change conflicts. The supervisor shows
     the failure to the user and asks what to do. Work stops until the user
     decides. Never edit, delete, or skip the test — not on your judgment,
     only on the user's explicit decision.
- A `.skip` that carries a `RAMBLA-FORK: skip-test:` comment is an approved
  divergence the user already made. Leave it.

### Which tests to run

Only the tests that intersect what you changed, plus your own:

```
npx vitest run <your test file> --bail=1
npx vitest run <the upstream test file covering the module you edited> --bail=1
```

Pipe to a file and read the file if the output is long.

**Never run the full suite.** No `npm run test` at the workspace or repo
level, no `test:e2e*`, no `test:integration*`, no Playwright, no Maestro.
This binds the coder AND the reviewer. Several agents may be running at
once; full verification happens in CI, not here.

## When you're done

```
npm run typecheck
npm run lint
npm run format
```

Never hand-fix formatting; Biome owns it.

**A verification command that fails on a file in the table:
fix it and rerun. It fails on a file outside the table: stop and report —
that is not yours to fix.**

Then:

- `git grep "RAMBLA-FORK:" -- <each upstream file you edited>` — every one
  must show a tag. An untagged divergence is one we lose at the next merge.
- Branch: 4 or more upstream files edited (upstream tests never count;
  new `*.rambla.*` files never count) → the work is on
  `fix/<slug>` or `feat/<slug>`, and you run `just trial-merge` from
  `rambla/` before calling it done. Conflicts mean move our code, not
  resolve them. `just trial-merge drop` cleans up. 1-3 files → main, no
  branch.
- **Commit only after ACCEPT**, on the branch the plan names, staging only
  files in the table — never another agent's files.
- Add the `PATCHES.md` entry from the plan's Ledger section. Last step.

## Stop and ask

- **The plan turns out to be wrong, incomplete, or inconsistent with the
  code.** Stop and report to the supervisor, who asks the user. Do not edit
  the plan, do not re-decide placement mid-edit, do not work around it.
- **An upstream test fails and the change conflicts with what it asserts** —
  stop all
  work and report to the supervisor: the test name, the failure output, why
  the change conflicts. The supervisor shows the failure to the user and
  asks. Work stops until the user decides. (A failure your own code caused
  is not this: fix your code.) Never edit, delete, or skip an upstream test
  on your own judgment.
- Upstream already fixed this a different way (say in plain English what
  they did and how it differs).
- The change needs an identifier rename that upstream also names.
- **Anything else this skill doesn't clearly cover.** Ask rather than pick.

## The scope is the plan's scope

Do exactly what the plan says. Not more, not less. Not the obvious
improvement next to it, not the half of it that seems sufficient.

**The mitigation table is the complete list of production files that may be
created or
edited** — `.rambla.test.ts` files are always ours: each edited
upstream file implies its companion `.rambla.test.ts`, no row needed. No other file
gets created or edited — not a config line, not a one-line
import fix somewhere else, not a rename that "has to happen anyway". If the
work appears to need a file that isn't listed, stop and report to the
supervisor. That is a hole in an approved plan, and only the user can widen
it. The reviewer rejects on any file outside the table, whatever the reason.

**Other agents work in this checkout at the same time.** Uncommitted changes
and new files you didn't make are someone else's job in progress. If they
don't touch your files, they don't exist as far as you're concerned.

**NEVER run a command that discards work you didn't write.** Not
`git checkout -- <file>`, not `git restore`, not `git stash`, not
`git reset --hard`, not `git clean`, and never an edit or a write to any
file outside the table. **Read anything you like — reading is
free and encouraged, within the Reading rules above. Writing is
confined to the table.** Uncommitted work has no undo — one
`git checkout` on another agent's file destroys hours of work permanently,
and this has happened. If a file you didn't write is in
your way, stop and ask.

Beyond that: don't fix them, don't stage them, don't tidy them, don't report
them as problems.

If something uncommitted does touch a file in the table, check
before reacting — `git status --porcelain` and `git diff -- <file>` — and
confirm it's really another agent's change and really overlaps yours. Then
ask the supervisor what to do and wait. Never resolve an overlap on your own
judgment.

**Something worth fixing that's out of scope? Stop and raise it now.** Don't
bank it for the end, don't fix it, don't write it into any file. Say what you
found in a sentence and wait. The user decides whether it becomes its own
plan or waits.

## Reporting

Concerns first, always — if something is risky, unresolved, or out of scope,
that's the first sentence.

**Check every claim before you make it, and cite it.** Anything you say
about the code — in chat, in a commit message, in the `PATCHES.md` entry —
is something you opened and read, carrying a `file.ts:120` reference. Not
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
rewrite the sentence until you can.

**Never report effort** — what a reviewer tried, examined, or couldn't find
is not a result. Report findings and what changed because of them.

**No line counts**, and no revising a count you gave earlier. Risk comes from
which files change and how active upstream is in them.

**Land every report**: end with where the work now stands, written as if the
user had read none of the updates before it.

The plan skill's 3-place plan-link rule is planning-phase only; code-phase
reports never link the plan file. File references in chat start with
`rambla/`; inside committed files (`PATCHES.md`) they are relative to the
fork root. Link text is always `name.ts:120`. Digits for counted numbers,
words for numbers inside English phrases. A bare path renders as plain text
the user cannot open — they read with a screen reader.

### Review round templates

Use these exactly. They are the only thing the user gets between rounds.

**Reviewer rejected:**

```markdown
The reviewer accepted 6 of 7 items. Rejected:

1. [os-notifications.ts:42](rambla/packages/app/src/utils/os-notifications.ts#L42) — <the specific problem, briefly — 25 words maximum>
2. ...
```

Never reproduce the reviewer's own words. Don't say what happens next —
going back for a fix is understood.

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

Code findings always have a location, so every rejected item carries a link.
