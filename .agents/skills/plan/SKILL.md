---
name: plan
description: Plan a fix, feature, or refactor in Rambla. Every plan opens with a merge-conflict mitigation section that keeps continual merges from upstream small and conflict-free. Use whenever the user asks to plan work in this repo, or before writing code for a fix or feature here.
---

# Planning work on Rambla

Rambla is its own product, permanently forked from upstream Paseo. Continual merges come from upstream, nothing goes back, so every line we touch in an upstream file can conflict on every future merge. All code lives in the `rambla/` subfolder of this workspace.

## When rules conflict

If any rules conflict or one cannot be followed, stop and ask the user — never improvise an exception.

## The plan stays short

Past ~500 words of your own prose on a routine plan, you are implementing inside the plan file: stop and strip back to scope, files, and steps.

## What a plan is

- **A constraint on the coder, not a script for one.** It states the outcome,
  the scope, the files, and the limits.
- **Acceptance criteria at both levels.** A numbered `## Acceptance criteria`
  section the user approved, and criteria ending every step. Criteria are
  what coder and reviewer check against; instructions are hints — when a
  result contradicts a criterion, the criterion wins. A step with
  instructions but no criteria is incomplete.
- **No implementation code.** No function bodies, no JSX, no exact import
  lines, nothing the coder could paste. A hard-to-describe shape is sketched
  as a type or signature: at most 5 lines, no bodies, no defaults, no inline
  comments. Never reproduce library, React, or API documentation; the coder
  may search docs.
- **Citations only for load-bearing facts.** A claim about this repo's code
  that a placement or scope decision rests on is a `file.ts:120` link.
  Nothing else gets a citation; no unverified claim goes in.
- **Public record.** Written to `rambla/plans/YYYY-MM-DD-fix-<slug>.md` (or
  `feat-`), 1 file, nothing else in it. The plan never links outside the
  fork repo.

## Who does what

- **Supervisor — you, the planner.** Hold the request, decide scope and
  placement, ask the user, write the plan, report. The only writer of the
  plan file.
- **Researcher — a subagent, mandatory.** Runs the repository searches;
  returns files, line numbers, citations. No placement opinions, ever.
- **Reviewer — 1 subagent, blind.** Spawned with the fixed prompt below,
  never this skill.

Subagents run the same model as you, unless the user says otherwise — omit
`provider`/`model` when spawning; pass one only if the user asked.

**NEVER run a command that discards work you didn't write** — no `git
checkout`, `restore`, `stash`, `reset --hard`, or `clean`. Other agents
work in this checkout; uncommitted changes are theirs. If one overlaps a
file your plan needs, ask the user and wait — uncommitted work has no undo,
and one `git checkout` has destroyed hours of another agent's work here.

## Reading rules

- **The supervisor never searches the repository.** Repo-wide grep is
  researcher work. Open only files the researcher named, ±30 lines around a
  load-bearing spot; files flagged large (2000+ lines) as exact ranges only.
  Reading a whole large file fills your context and degrades the plan.
- **Never read or grep a minified file — not even partially.** They are 1
  line and hundreds of KB; any read or grep returns the whole line and
  buries the context. To learn what a bundled library does, search that
  library's documentation. Report a minified file as minified and move on.
- A researcher is reusable: send it follow-up questions as they come up. When
  its context is bloated by a broad search and the next question is narrower,
  spawn a fresh researcher for that question instead.

## Workflow

1. **Frame the request.** Restate it as a scope guess in chat — 2 lines, not
   a plan.
2. **Spawn the researcher** with the fixed prompt below. It returns file
   paths and line numbers.
3. **Spot-check and decide.** Open the named regions, decide placement per
   the rules below. More research needed? Back to the researcher, never your
   own searching.
4. **Confirm with the user.** Confirm scope, then propose the shape (see
   "Ask the user"): the design or architecture, the step breakdown or the
   decision to have 1 step, and the numbered acceptance criteria. The user
   may approve, edit, or replace the criteria; approval is explicit and
   precedes writing the plan. Skip the shape question only when the
   placement rules yield exactly 1 path and no upstream code is copied —
   scope is always confirmed, criteria never skipped.
5. **Write the plan.** Run the style checker, spawn the blind reviewer, fix
   and re-review (see "Every plan is reviewed"). Report and stop.

### Researcher prompt — fill the blank, change nothing

```markdown
You are a fact gatherer for a plan in this repo. Find where <REQUEST> lives:
which files, modules, and line numbers are involved. Return facts only —
paths, line numbers, quotes of at most 3 lines. No placement opinions, no
recommendations. Never read or grep a minified or 1-line file — not even
partially; report it as minified and move on. If the question is about a
bundled library, search its documentation instead. Flag any file over 2000
lines.
```

## Ask the user when a decision is theirs

Ask in plain English, multiple choice, at most 3 options, your recommendation
first, each option's cost in 1 line. Wait for the answer before writing.

- **Copying upstream code into a `*.rambla.*` module always goes to the
  user.** Editing their file keeps their future fixes and risks conflicts;
  copying ours conflicts never and hears from upstream never.
- **If the request needs no decision, do not ask and do not invent
  alternatives.** Adding a switch to an existing settings section never means
  proposing a new settings page — that is scope invention.
- Anything else this skill does not clearly cover: ask.

## Scope

The scope is exactly what the user asked — not rounded up, not trimmed
where it is awkward. The mitigation
table is binding: every file this work may create or edit gets a row —
tests included. No file outside the table may change.

## Acceptance criteria

Propose them with the shape of the plan, before breaking work into steps
(workflow step 4). Draft them yourself; restating the user's own criteria
still counts as a proposal. Numbered — the user approves by number, steps
cite by number.

- Testable: an automated test can assert it, or a named UI check can. For
  visual design, "the user likes it" is valid — it means the step ships a
  build the user can try before the plan can finish.
- Observable through the real interface, not implementation-internal.
- No section, or unapproved criteria, means no plan.

## Plan status

The first line under the title is one line:

```
Status: unapproved | approved | coding | done
```

No other statuses, no timeline, no dates — the file date and git history
cover that. `unapproved` on write. The user approving criteria + plan, plus
the reviewer's ACCEPT, make it `approved`. The coder sets `coding` and
appends the last commit hash and steps completed
(`Status: coding — 3f2a1b9, completed through step 2`); a single-step plan
finishes in one sitting and just says `done`. Never code a plan that is not
`approved`.

## Steps and the accept-reject loop

- **Large plans are broken into steps; small plans are not.** You decide
  from the research, and say so when proposing the shape; the user can
  override. A 1-step plan is a single work item, never labeled "step 1";
  the plan-level criteria are its criteria. Only multi-step plans number
  their steps.
- **Steps are closed.** Each step ends with its tests written and passing,
  the step's code working, a commit, and the status line updated. The app
  may be mid-feature between steps; the step itself works.
- **Each step runs its own accept-reject loop with a fresh coder and a
  fresh reviewer** — never reuse a coder across steps. The reviewer checks
  the code against that step's criteria, you present the step to the user
  (what was done, what it looks like, how it was tested), then the next
  step starts.
- **Decide where the user weighs in, and write it into the plan.** Mark
  the steps where the user reviews the result before the plan continues.
  Err toward more user involvement when the step touches UI or UX design.

## Merge conflict mitigation

Every file gets a deliberate placement decision. Decide with the rules
below, record in the skeleton's mitigation table. A revision gets better,
never longer.

## Placement decision

First match wins.

1. **New code with no upstream counterpart** → new `*.rambla.ts(x)` file. Any
   size; a new file can never conflict.
2. **Replacing most of an upstream function or component** → ask the user
   first (see above). Never on your own judgment.
3. **Changing some of upstream's logic** → our logic in a `*.rambla.ts`
   helper, called in 1 line at the upstream site.
4. **At most 5 changed lines** (a guard clause, a wrong default) → edit in
   place, minimally.

Before deciding, ask the researcher how this app already does this kind of
thing, and say so in the plan with a citation when it drives the placement.

Inside upstream files: our edits in 1 contiguous block per file; new imports
at the END of the import block; every diverging site tagged with the one-line
fork tag (format in the `code` skill — category and plan file name are
decided here, so write the tag into the plan's step for that edit); never
reformat, rename, or move upstream code you are not changing. If upstream
already fixed the same problem, say so and cite the upstream commit; the
coder ports it verbatim — its code never enters the plan.

Upstream activity for the table comes from
`git log upstream-rebrand -- <path>`. **Always `upstream-rebrand`, never
`upstream/main`** — main is unrebranded, so the diff shows every rebrand
line as a change, or is empty.

**Branch:** 4 or more upstream files edited (rows with `.rambla.` in the
name never count) → `feat/<slug>` or `fix/<slug>`.
1-3 files → work on main.

## How git decides conflicts — do not relitigate this

Per file, git merges both sides' changed line ranges silently when even
1 unchanged base line separates them; touching or overlapping ranges
conflict. New files never conflict. A `.rambla.` file is ours alone —
upstream never has it, so it never conflicts. Every other file, including
upstream's test files, can conflict. Line counts are not the measure —
which files change, and how active upstream is in them, is.

## Provenance

3 bullets, no prose — everything below is predicated on this state. From `rambla/`:

```bash
# 1. main — what the plan is written against
git log -1 --format='%h — %cs' main

# 2. upstream-rebrand — the rebrand commit main last merged
m=$(git rev-list --first-parent --merges -1 main)
git log -1 --format='%h — %cs' "$m^2"

# 3. upstream/main — the upstream commit that rebrand commit was made from.
#    Its subject reads "rebrand upstream through <short hash>".
git log -1 --format='%s' "$m^2"
git log -1 --format='%h — %cs' <that short hash>
```

For the tag on bullet 3: upstream is fetched with `--no-tags`, so
`git describe` can't name it — `git ls-remote --tags --refs upstream` gets
it in 1 network call; if nothing contains that commit, write `(untagged)`.
Never blank, never guessed.

## Required output

The plan uses this exact skeleton, in this order.

```markdown
# fix: <short title> <- or "feat: <short title>"

Status: unapproved

## Provenance

- main: `d89926e8a` — 2026-09-22
- upstream-rebrand: `61b044d8b` — 2026-09-21
- upstream/main: `135a3b4c9` (untagged) — 2026-09-21

## Scope

**In scope:**

1. <Each thing this work delivers, one per line. Nothing vague.>
2. ...

**Not in scope:**

- <Each adjacent thing this work deliberately does not touch. Name the
  tempting ones — the neighbouring bug, the refactor the file is begging
  for, the second platform. If it isn't listed here and isn't in the list
  above, it isn't happening.>

## Acceptance criteria

1. <Numbered, testable, observable through the real interface. The user
   approved this exact list before the plan was written; steps cite these
   numbers.>
2. ...

## Goal

<One or two sentences: what bug is fixed or what feature is added.>

## Merge conflict mitigation

**Files this work changes:**

| File                                | Edit                                      | Upstream activity                         | Tag                 |
| ----------------------------------- | ----------------------------------------- | ----------------------------------------- | ------------------- |
| `packages/.../foo.ts`               | one import + one call into the new module | last touched 3 weeks ago, twice this year | `RAMBLA-FORK: fix:` |
| `packages/.../thing.rambla.ts`      | <what lives there>                        | new                                       | `RAMBLA-FORK: fix:` |
| `packages/.../thing.rambla.test.ts` | <what it covers>                          | new                                       | `RAMBLA-FORK: fix:` |

Fill the activity column from `git log upstream-rebrand -- <path>` for every
file without `.rambla.` in its name. Files with `.rambla.` in the name are ours alone
and can never conflict, so their activity entry is just `new` or `existing`.
The Tag column states the fork tag's category for that file; the coder
writes the full tag (category, plan file name, one clause) per block.

**Why this shape:** <one or two sentences — the judgment call, stated so a
reviewer can disagree with it. What we'd lose by copying more, what we'd risk
by editing more.>

**Branch:** `fix/<slug>` — required, N upstream files edited.
<or: "none — N upstream files edited, work on main.">

## Cause

<Only for a fix. Two to four sentences, in prose, never as a code quote:
what actually goes wrong, in the
code, with `file.ts:120` references. Traced, not guessed — if you haven't
found it yet, you aren't ready to write the plan.>

## Constraints

<The coder's limits, as bullets: files that may not change beyond the table,
behavior that may not change, code that may not be added (abstractions,
options, error handling for impossible cases), upstream tests that may not
be touched.>

## Steps

0. Read the `code` skill before writing anything. If a step below turns out
   to be wrong, stop and report back to the supervisor — do not amend this plan
   and do not re-decide placement while coding.
1. <One action per step. Name the file. Say what changes — never how.
   End the step with its **Acceptance criteria** — testable conditions the
   step's code must satisfy, citing the plan-level criteria it delivers
   where it does. When the user reviews this
   step's result before the plan continues, say so here.>
2. ...

## Verification

- `npm run typecheck`
- `npm run lint`
- `npx vitest run <your .rambla.test.ts> --bail=1`
- `git grep "RAMBLA-FORK:" -- <each upstream file edited>` — every one must
  show a tag.
- <Anything that has to be seen working in the app, named specifically.>

## Risks

<Bullets. What could break elsewhere. "None known" is a valid answer if
you've actually looked.>
```

If the plan needs a merge-conflict decision you cannot make, say so in the
table's place instead of guessing, and stop for the user.

## Every plan is reviewed

Before review, run the style checker and fix silently — style is never the
reviewer's job and never the user's:

```bash
node fork/check-plan.mjs plans/YYYY-MM-DD-fix-slug.md
```

### Reviewer prompt — fill the 2 blanks, change nothing

```markdown
You are reviewing a plan for the Rambla fork. Do not trust it.

The user's request, verbatim: <REQUEST>

The plan: rambla/plans/<FILE>

Read the plan, then open every file in its mitigation table — created or
edited, all rows. Never
read a minified file; for files over 2000 lines, read the cited
regions plus the edit sites, not the whole file. Judge errors in this order: 0. implementation code in the plan — function bodies, JSX, import lines,
pasteable snippets; the only allowed sketch is a type or signature of at
most 5 lines; 1. a placement decision the user was
never asked; 2. a claim the code does not support; 3. a file the edit needs
that the mitigation table misses; 4. scope beyond the request; 5. a
described edit that cannot fit the current code — a name already taken, a
function not where the plan says; 6. a step without acceptance criteria,
or criteria too vague for a test to assert; 7. a status line that is not
`approved`. "Does it compile" is not your job — the
code does not exist yet. Style, wording, and link format are not your
job. Reply ACCEPT, or REJECT with a numbered list, each item backed by
file.ts:120 evidence you opened yourself.
```

**Fix and re-review, at most 2 rounds.** Still rejected after that: stop and
bring both positions to the user to decide.

## Review round templates

Use these exactly. They are the only thing the user gets between rounds.

**Link the plan file in exactly 3 places, and nowhere else:** when you send
it for review, when the reviewer rejects, and when the reviewer accepts.
Change reports never link it.

The link is chat, so the target starts with `rambla/`, and the link text is
the filename:

```markdown
Sent [2026-09-22-feat-os-notification-toggle.md](rambla/plans/2026-09-22-feat-os-notification-toggle.md) for review.
```

**Reviewer rejected:**

```markdown
The reviewer rejected [2026-09-22-feat-os-notification-toggle.md](rambla/plans/2026-09-22-feat-os-notification-toggle.md).

Accepted 6 of 7 items. Rejected:

1. <the specific thing, and briefly why — 25 words maximum>
2. ...
```

Never reproduce the reviewer's own words.
Don't say what happens next — going back for a fix is understood.

**Reviewer accepted:**

```markdown
The reviewer accepted [2026-09-22-feat-os-notification-toggle.md](rambla/plans/2026-09-22-feat-os-notification-toggle.md), all 7 items:

1. <what the item is — 25 words maximum>
2. ...

Files to change:

- [settings-screen.tsx:120](rambla/packages/app/src/screens/settings-screen.tsx#L120) — <what changes there>
- ...

Conflict mitigation: <the approach in 25 words or less>
```

File references here are **chat**, so the target starts with `rambla/` —
`rambla/packages/app/...#L120`. Inside the plan file they're relative
instead (`../packages/app/...`).

## Reporting to the user

Report every plan change as it happens, 1 line each. Close with a final
report: where the plan stands, for a reader who saw none of the updates.
Decided things, never reasoning. Concerns first. No effort, no line counts.
Read git and test output yourself; say what it means in 1 line.

## Planning ends when the user approves

The status line stays `unapproved` until both have accepted: the reviewer,
then the user. Then flip it to `approved` — the one
edit allowed to you. Bring the user the plan and the verdict, and **stop
there**: no code, no tests, no branch, no head start. The `code` skill runs
from an `approved` plan and owns the status from there (`coding`, `done`).
