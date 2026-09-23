---
name: plan
description: Plan a fix, feature, or refactor for the Rambla fork of upstream Paseo. Every plan opens with a merge-conflict mitigation section that decides, per file, whether code goes in a new *.rambla.ts module or as a minimal tagged edit inside an upstream file. Use whenever the user asks to plan work in this repo, or before writing code for a fix or feature here.
---

# Planning work on the Rambla fork

`rambla/` is a permanent fork of upstream Paseo. Nothing is contributed
upstream; upstream merges in weekly, forever, so every line we touch in an
upstream file can conflict on every future merge. All code lives in the `rambla/` subfolder of this workspace.

## The one rule: the plan stays short

Before writing any sentence, ask: **does this sentence make the finished work
bigger or smaller?** Keep only what the scope requires. Cut background,
rationale, prose, and anything the coder already knows. A routine plan over
~500 words of your own prose — the skeleton's fixed text and the mitigation
section's table don't count; the section's prose does — means you are
implementing inside the plan file: stop
and strip it back to scope, files, and steps.

## What a plan is

- **A constraint on the coder, not a script for one.** It states the outcome,
  the scope, the files, and the limits. More prohibitions than freedoms.
  Specificity belongs in scope and placement — that is what keeps the code
  small — never in implementation detail.
- **No implementation code.** No function bodies, no JSX, no exact import
  lines, nothing the coder could paste. If a shape is truly hard to describe
  in words, sketch it: a type or signature only, at most 5 lines, no bodies,
  no defaults, no inline comments. The plan never reproduces library, React,
  or API documentation; the coder may search docs while implementing.
- **Citations only for load-bearing facts.** A claim about how this repo or
  its code works that a placement or scope decision rests on is cited as a
  markdown link with `file.ts:120` text. Nothing else gets a citation, and no
  unverified claim goes in.
- **Public record.** Written to `rambla/plans/YYYY-MM-DD-fix-<slug>.md` (or
  `feat-`), 1 file, nothing else in it. The plan never links outside the
  fork repo.

## Who does what

- **Supervisor — you, the planner.** You hold the user's request, decide
  scope and placement, ask the user, write the plan, and report. You are the
  only writer of the plan file.
- **Researcher — a subagent, mandatory.** A fact gatherer. It runs the
  repository searches, names the files and line numbers a request touches,
  and returns facts with citations. No placement opinions, ever.
- **Reviewer — 1 subagent, blind.** Spawned with the fixed prompt below,
  never this skill.

No planner subagent, no coder. Planning writes the plan and no code, no
tests, no branch.

**NEVER run a command that discards work you didn't write** — no `git
checkout`, `restore`, `stash`, `reset --hard`, or `clean`. Other agents work
in this checkout; uncommitted changes you didn't make are theirs. If one
overlaps a file your plan needs, ask the user and wait. Uncommitted work has
no undo — one `git checkout` on another agent's file destroys hours of work
permanently, and this has happened.

## Reading rules

- **The supervisor never searches the repository.** Repo-wide grep and
  exploration are researcher tasks. You may open only files the researcher
  has named, and only targeted reads: ±30 lines around a load-bearing spot.
  Treat a file the researcher flags as large (2000+ lines) as ranges only:
  ask the researcher for the exact line ranges. A read tool on a whole large
  file fills your context and degrades the plan.
- **Never read or grep a minified file — not even partially.** They are 1
  line and hundreds of KB; any read or grep returns the whole line and
  buries the context. To
  learn what a bundled library does, search that library's documentation.
  Report a minified file as minified and move on.
- A researcher is reusable: send it follow-up questions as they come up. When
  its context is bloated by a broad search and the next question is narrower,
  spawn a fresh researcher for that question instead. Reuse when you can,
  replace when you must.

## Workflow

1. **Frame the request.** Restate it as a scope guess in chat — 2 lines, not
   a plan.
2. **Spawn the researcher** with the fixed prompt below. It returns file
   paths, line numbers, quotes of at most 3 lines. Its findings count as
   verified — they carry citations the reviewer re-checks.
3. **Spot-check and decide.** Open the named regions, decide placement per
   the rules below. More research needed? Back to the researcher, never your
   own searching.
4. **Confirm with the user.** The researcher's file list is input to the
   scope decision, not the scope itself — confirm scope, then propose the
   shape (see "Ask the user"). Skip the shape question only when the
   placement rules yield exactly 1 path and no upstream code is copied —
   scope is always confirmed.
5. **Write the plan.** Run the style checker, spawn the blind reviewer, fix
   and re-review — at most 2 rounds, then bring both positions to the user.
   Report and stop. The `code` skill is a separate act the user triggers.

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

The scope is exactly what the user asked — not rounded up to the feature you
think they meant, not quietly trimmed where it is awkward. The mitigation
table is the contract: it is the complete list of files that may change; no
file outside it may change. A file you would need to touch but did not list
is a hole in the plan.

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
at the END of the import block; every diverging site tagged
`// RAMBLA-FORK: <category>: <what and why>` with a category from the fixed
list at the top of `PATCHES.md`; never reformat, rename, or move upstream
code you are not changing. `npm run format` in Verification only ever
touches the files this work changed — the repo is already Biome-formatted,
so it never disturbs untouched upstream lines. If upstream already fixed the
same problem, say
so in plain English and cite the upstream commit; the coder ports the fix
verbatim during implementation — its code never enters the plan.

Upstream activity for the table comes from
`git log upstream-rebrand -- <path>`. **Always `upstream-rebrand`, never
`upstream/main`** — main is unrebranded, so the diff is noise or empty.

## How git decides conflicts — do not relitigate this

Verified against git's source; do not research it again. Per file, git merges
both sides' changed line ranges silently when even 1 unchanged base line
separates them; touching or overlapping ranges conflict. New files never
conflict. The entire strategy: keep our edits in 1 block per file, prefer new
files for new code, edit at calm seams (function entry/exit), never move
upstream code. Line counts are not the measure — which files change, and how
active upstream is in them, is.

**Branch:** 4 or more upstream files edited (upstream tests never count;
new `*.rambla.*` files never
count) → `feat/<slug>` or `fix/<slug>`,
and the work is not done until `just trial-merge` runs clean (or the
conflicts are resolved deliberately). 1-3 files → work on main.

## Provenance

3 bullets, no prose — everything below is predicated on this state, down to
the line numbers. Run these from `rambla/`:

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
`git describe` can't name it. One network call gets it —
`git ls-remote --tags --refs upstream` — and if nothing contains that commit,
write `(untagged)`. Never leave the field blank and never guess a tag.

## Required output

The plan uses this exact skeleton, in this order.

```markdown
# fix: <short title> <- or "feat: <short title>"

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

## Goal

<One or two sentences: what bug is fixed or what feature is added.>

## Merge conflict mitigation

This is a permanent fork of upstream Paseo. Nothing goes upstream; upstream
is merged in weekly. Code below follows the fork's placement rules.

**Files this work changes:**

| File                  | Edit                                      | Upstream activity                         | Tag                 |
| --------------------- | ----------------------------------------- | ----------------------------------------- | ------------------- |
| `packages/.../foo.ts` | one import + one call into the new module | last touched 3 weeks ago, twice this year | `RAMBLA-FORK: fix:` |
| `packages/.../thing.rambla.ts` | <what lives there>               | new                                       | (none)              |

Fill the activity column from `git log upstream-rebrand -- <path>`. This
table is the complete list of production files the coder may create or edit.
Each row implies its companion `*.rambla.test.ts` — `.rambla.test.ts` files
are ours,
always, never upstream, and never need a row. Tests never go inside
upstream test files.

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
be touched. The plan's prohibitions live here — more of these than freedoms.>

## Steps

0. Read the `code` skill before writing anything. If a step below turns out
   to be wrong, stop and report back to the planner — do not amend this plan
   and do not re-decide placement while coding.
1. <One action per step. Name the file. Say what changes — never how.>
2. ...

## Verification

- `npm run typecheck`
- `npm run lint`
- `npm run format`
- `npx vitest run <the one test file> --bail=1`
- `git grep "RAMBLA-FORK:" -- <each upstream file edited>` — every one must
  show a tag.
- `just trial-merge` (branched work only; see "How git decides conflicts")
- <Anything that has to be seen working in the app, named specifically.>

## Ledger

<The `PATCHES.md` entry this work adds, written out: what diverges, which
files, the standing resolution rule, and the "Drops when: ..." condition.
Written into `PATCHES.md` as the last step of implementation, not before.>

## Risks

<Bullets. What could break elsewhere. "None known" is a valid answer if
you've actually looked.>
```

If the plan needs a merge-conflict decision you cannot make, say so in the
table's place instead of guessing, and stop for the user.

## Every plan is reviewed

Before sending for review, run the style checker and fix silently — style is
never the reviewer's job and never the user's:

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
function not where the plan says. "Does it compile" is not your job — the
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
instead (`../packages/app/...`). Same link text either way: `name.ts:120`.

## Reporting to the user

Report every plan change as it happens, 1 line each — the user is watching a
loop they cannot see inside. Then land the report: end with where the plan
now stands, written as if the user had read none of the updates.

Report decided things, never reasoning. No "should", no "turns out", no
account of a wrong turn already corrected. Every noun in every sentence is a
file path, a UI element the user has seen, or a heading in the plan. Concerns
first. Never report effort, and no line counts. Read git and test output
yourself and say what it means in 1 line; never paste raw output.

Style details (digits for counted numbers, `file.ts:120` link form, chat
links starting `rambla/`) are enforced by the checker — fix silently, never
discuss them.

## Planning ends when the user approves

An ACCEPT from the reviewer is not the finish line. Bring the user the plan
and the verdict, and **stop there**. Nothing gets written — no code, no
tests, no branch, no head start — until they say go.
