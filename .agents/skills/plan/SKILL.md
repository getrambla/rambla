---
name: plan
description: Plan a fix, feature, or refactor for the Rambla fork of upstream Paseo. Every plan opens with a merge-conflict mitigation section that decides, per file, whether code goes in a new *.rambla.ts module or as a minimal tagged edit inside an upstream file. Use whenever the user asks to plan work in this repo, or before writing code for a fix or feature here.
---

# Planning work on the Rambla fork

## Where the code is

**All of it is in `rambla/`.** Every package, test, and npm script lives
there, and that is where commands run. The outer repo you start in — whatever
it happens to be called — holds no application code. It's the container:
plans, research, notes, tooling, and `rambla/` as a submodule. Don't go
hunting for source at the top level; there isn't any.

## What this repo is

`rambla/` is a permanent, terminal fork of `getpaseo/paseo`, rebranded by
script. Facts that change how you plan:

- **Nothing is ever contributed upstream.** Do not shape code for a pull
  request, do not preserve upstream style for their benefit, do not rebase.
- **Upstream is merged in forever**, roughly weekly. Every line we touch in
  an upstream file is a line that can conflict on every future merge.
- **`rambla/fork/rebrand.sh` blanket-renames `paseo` → `rambla`** (three
  case-sensitive passes) on a mirror branch before each merge. It never
  renames `*.paseo.ts` / `*.paseo.test.ts`, so `*.rambla.ts` and
  `*.rambla.test.ts` are permanently ours and can never collide with a file
  upstream creates.
- **Both extremes are wrong.** Copying every upstream module to avoid
  conflicts gives us zero merge pain and zero upstream fixes, plus dead code
  that rots. Editing everything in place gives us every upstream fix and
  endless conflicts. Each change picks a point between them, deliberately.

Source of truth, read when the answer isn't here:

| File                     | What it owns                                            |
| ------------------------ | ------------------------------------------------------- |
| `STRATEGY.md`            | Merge model, the numbered rules, sync-day steps         |
| `PATCHES.md`             | Every existing divergence + the `RAMBLA-FORK:` tag list |
| `rambla/fork/rebrand.sh` | What the rename does and does not touch                 |
| `rambla/CLAUDE.md`       | Fork-specific coding rules inside the app repo          |

## Who does what

Three roles, kept separate so that no single context holds both the whole
codebase and the decisions.

- **Supervisor** — holds the user's request, the plan file, and the
  reviewer's verdict. Don't go exploring the codebase; your context fills
  with source and the thread is lost. **But never relay a constraint you
  haven't seen.** When a subagent reports "this can't go there because X",
  open that file and check X before it becomes a premise. One targeted read,
  one file at a time. A constraint you pass on unverified becomes the thing
  every later decision is built on.
- **Planner** (a subagent) — reads the code and writes the plan file. Its
  context is supposed to fill with source. It gets thrown away afterwards.
- **Reviewer** (a separate subagent) — gets the user's request verbatim and
  the plan file, checks every claim against the code, reports what's wrong.
  Never the agent that wrote the plan.

Small enough to plan from a couple of file reads? Write it yourself and still
send it to a reviewer.

**There is no coder in the planning phase.** Don't spawn one, don't ask one
to fix anything. Planning writes exactly one file — the plan — and no code,
no tests, no branch, no edit to any other file. When the plan needs changing,
the planner changes it.

## The plan defines the scope

The scope is exactly what the user asked for — not more, not less. Read the
request and write down what it delivers. Don't round it up to the feature
you think they meant, and don't quietly leave out the part that's awkward.

The Scope section is what the coder is held to, and the mitigation table is
its file list: **the files named there are the only files that may change.**
So the table has to be complete before the work starts. A file you'd need to
touch but didn't list is a hole in the plan, not a detail for later.

If the request is ambiguous about what's included, ask before writing the
plan. Two readings of a request are two different scopes.

**Other agents work in this checkout at the same time.** Uncommitted changes
and new files you didn't make are someone else's job in progress — not your
problem, not a bug, not something to plan around or mention. Ignore them.

**NEVER run a command that discards work you didn't write.** Not
`git checkout -- <file>`, not `git restore`, not `git stash`, not
`git reset --hard`, not `git clean`, and never an edit to a file that isn't
part of this task. Planning writes one file: the plan. Uncommitted work has
no undo — one `git checkout` on another agent's file destroys hours
permanently, and this has happened.

If uncommitted work does touch a file your plan needs, check before reacting
— `git status --porcelain` and `git diff -- <file>` — and confirm it really
overlaps. Then ask the user what to do and wait. Don't route the plan around
it on your own judgment.

## A conflict is sometimes what you want

Not conflicting is not the same as winning. A file we copied is silent
forever: upstream improves their version, fixes a bug in it, adds a feature
to it, and we are never told. No conflict, no notice, no chance to take it.

**Silence is the failure mode nobody sees.** A conflict is the alarm bell
that upstream touched something we care about. Forking a screen to avoid
three conflicts means never hearing about that screen again.

Two opposite mistakes, and the job is to sit between them:

- Copy everything → zero conflicts, zero upstream improvements, and dead
  code rotting in the tree next to ours.
- Edit everything in place → every upstream fix reaches us, and every merge
  is a fight.

Which side to lean on depends on the file, and it is not your call. See
"Copying upstream code is the user's decision".

## Get the approach approved before writing the plan

Research first: read enough code to know what the real options are. Then
**ask the user with the question tool**, offering two or three approaches.
Not three sentences of prose — actual alternatives they can choose between.

Each option says: what it touches, what it gives up, and what we stop
hearing about from upstream if we take it. If one option means copying
upstream code, say plainly that their future changes to it go unseen.

Wait for the answer. No plan file is written until the approach is chosen.

This is the cheapest gate in the whole process. A wrong approach dies in
thirty seconds here; the same approach dies after a full plan, a full
review, and however long it takes the user to read both.

## Copying upstream code is the user's decision

**Never decide on your own to copy an upstream file, screen, or component
into a `*.rambla.*` module.** Ask, every time, with the question tool.

Show both paths and what each costs. Editing theirs: some of their lines
change, and those lines can conflict later. Copying theirs: nothing
conflicts, their version sits unused in the tree, and the user never finds
out when they improve it.

Replacing the composer outright and replacing a settings screen look
identical in a diff and are completely different decisions. Only the user
can tell them apart, because it depends on whether they want upstream's
future work on that file at all.

This does not apply to genuinely new code with no upstream counterpart —
that goes in a new file without asking.

## Numbers are digits when they are data

A number that is **data** — a count, a measurement, a limit, a version, a
date — is a digit. `5 sites`, `3 files`, `25 words`, `2 of 7 items`. Never
`five sites`. This holds at 1 as well: `1 upstream file`, not `one upstream
file`.

The test: **would the user want to spot it at a glance?** They read with a
screen reader; a digit is findable, a spelled-out number has to be read
through.

A number that is part of an English phrase rather than a quantity stays a
word: "one at a time", "one another", "no one", "one of them", "on the one
hand". Nothing is being counted there.

Applies in the plan, in chat, and in commit messages.

## File links

**Never write a bare path.** Every file reference, everywhere, is a markdown
link with the line as `#L<n>`. Link text is always `name.ts:120`.

| Where the text is read  | Target starts with           |
| ----------------------- | ---------------------------- |
| Chat with the user      | `rambla/`                    |
| A file inside `rambla/` | a path relative to that file |

```markdown
chat: [en.ts:2207](rambla/packages/app/src/i18n/resources/en.ts#L2207)
plan: [en.ts:2207](../packages/app/src/i18n/resources/en.ts#L2207)
```

Why they differ: the user runs this project from a workspace folder that
holds the fork in a subfolder named `rambla/`, so paths in chat resolve from
that workspace root. A file committed in the repo has no `rambla/` above it —
on GitHub and in a clone, the repo root _is_ the fork — so links written into
a file are relative to that file. A plan in `rambla/plans/` is one level down,
hence `../`.

`#L<n>` is the GitHub form and it works in both places, so the line syntax
never changes. Only the prefix does.

A bare `path:line` renders as plain text. The user cannot open it, and this
user reads with a screen reader — an unclickable path costs them a manual
lookup every time.

## Filling in Provenance

Three bullets, no prose — everything below is predicated on this state, down
to the line numbers. Run these from `rambla/`:

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

## Nothing unchecked goes in a plan

Every claim in a plan is one you verified before writing it down. No
exceptions, no hedges, no caveats, no "I haven't checked" anywhere in the
file.

Verify it, or you don't have a plan yet. If something can't be settled from
the code, ask the user in chat and wait for the answer before the plan is
finished.

**Go and check.** Open and read every file the plan touches: the module you
are designing against, the component whose render path you describe, the
store you are adding a key to, each upstream file in the mitigation table.
Reading them is the work of planning. A plan assembled from search hits and
filenames is a guess wearing a plan's formatting.

**Claims that a decision rests on carry a citation, as a markdown link.**
Not "returns null outside Electron" but "returns null outside Electron
([desktop-notifications-section.tsx:34](../packages/app/src/desktop/components/desktop-notifications-section.tsx#L34))".
You can't write the citation without opening the file, and the reviewer can
check the load-bearing facts in one pass. An uncited claim that a decision
rests on is a rejected claim.

Citations are markdown links — see "File links".

Background description doesn't need a citation, because it doesn't belong in
the plan at all. If a sentence isn't justifying a choice — this file, this
placement, why not smaller — cut it. A long plan full of verified citations
is not a rigorous plan; it's an over-built one wearing the costume.

What counts as unchecked:

- Designing against a store, hook, or module you haven't opened.
- Describing a conditional, prop, or render path from a component's name.
- Platform, OS, browser, or API behavior you didn't look up.
- Line counts and file lists estimated rather than read.

## Every plan is reviewed

No plan reaches the user unreviewed. Every time, no exceptions, however small
the change.

**Before sending it, run the style checker and fix whatever it reports:**

```bash
node fork/check-plan.mjs plans/YYYY-MM-DD-fix-slug.md
```

It checks section shape and order, the title, link form, bare paths, digits,
and whether Provenance still matches main. Fix silently — none of it is worth
the user's attention, and none of it is a reviewer's job.

The reviewer gets exactly 3 things: **the user's request verbatim as the user
wrote it** (never your summary), the plan file, and the codebase.

**Never give the reviewer this skill.** A reviewer holding a style guide
audits conformance to it, because those checks are easy, unambiguous and
always yield a finding — while judging a design is hard, ambiguous, and
yields nothing when the design is fine. It will drift to the checklist every
time. Style is not its job and it must not be able to see the rules.

**The reviewer judges the design first.** Attack the shape of the solution,
not the accuracy of its claims. Two questions, before anything else: is this
the simplest approach that satisfies the request, and is it the way this
codebase already does this kind of thing? If either answer is no, REJECT
there and don't check a single citation. A placement is not a claim, so
claim-checking will never catch a wrong one. Accurate citations for
a design that shouldn't exist is a failed review, not a passed one — volume
of verified detail is not evidence of a good plan, and it reads like one.

Only once the approach survives that does the reviewer check the plan against
the code.

**It opens every file in the mitigation table.** Not just the lines the
citations point at — the whole surrounding function. For each described edit:
do the names it introduces already exist in that scope, do the signatures
match, is what it needs already imported, does the thing it says it will
change actually sit where it says. A plan that reads correctly and won't
compile is the failure this catches, and following citations alone will never
find it — every citation can be accurate while the edit still collides with a
name 4 lines up.

Then the claims: does that function do what the plan says, does that
component render where the plan says, does the mitigation table match what
the edit actually requires.

**The reviewer reports only what would make the work wrong.** Never a link
format, a spelled-out number, a section heading, a wording mismatch. Those
are caught by `fork/check-plan.mjs` and fixed without ever being announced.
A numbered list the user reads should never contain a compile error and a
formatting nit as items 1 and 6.

It reports what's wrong. Fix and re-review.

**Report every change to the plan as it happens, one line each:** what
changed and why. The user is watching a loop they can't see inside; a summary
at the end is a summary of a process they had no chance to stop.

## Planning ends when the user approves

An ACCEPT from the reviewer is not the finish line. Bring the user the plan
and the verdict, and **stop there**. Nothing gets written — no code, no
tests, no branch, no "while you look at this" head start — until they say go.

Moving on to the `code` skill is a separate act the user triggers. Waiting is
the job.

## Reporting to the user

**Report decided things. Never reason at the user.** "The copy is gone, and
the settings-screen file should drop off the list" is thinking out loud
wearing a report's clothes — it names things only you can see and describes
what ought to happen rather than what was done. Decide first, then say what
was decided.

Banned outright: "should", "turns out", "it assumed", "it seems", and any
account of a wrong turn you already corrected. The user does not need your
journey.

**Every thing you name must exist outside your own head.** Each noun in each
sentence has to be a file path, a UI element the user has seen, or a heading
in the plan. If you cannot attach one, you cannot write the sentence —
rewrite it until you can.

"The copy is gone" fails this. A copy of what? A deleted file, deleted code,
deleted text in the plan, an abandoned idea? The user cannot tell, so it
reads as damage. "`settings-screen.rambla.tsx` is no longer in the plan"
passes.

This binds every message on its own, including short ones. "It's only a
status update, not a report" is not an exemption — a sentence the user can't
resolve is worse in a quick update, because there's no surrounding text to
work it out from.

**Every change comes with what it means for the user**: what they will see,
what they stop hearing about from upstream, what they now have to decide. A
change reported without its consequence is work handed back to them.

**Never report effort.** What a reviewer tried, examined, pushed on, or
couldn't find is not a result. Report findings and what changed because of
them. Nothing found is one clause — "the reviewer found nothing" — with no
language that dresses an empty result as an achievement.

**No line counts**, and no revising a count you gave earlier. Conflict risk
comes from which files change and how active upstream is in them, never from
how many lines we wrote. Same rule as the mitigation table.

**Land every report.** However many one-line changes you have reported along
the way, end with where the plan now stands, written as if the user had read
none of them. A stream of deltas with no current state is unreadable.

Concerns first: if something is risky, unresolved, or outside what they
asked, that's the first sentence — not the last line after the updates. Read
git and test output yourself and say what it means in one line; never paste
raw output.

### Review round templates

Use these exactly. They are the only thing the user gets between rounds.

**Link the plan file in exactly 3 places, and nowhere else:** when you send
it for review, when the reviewer rejects, and when the reviewer accepts. The
user cannot watch a subagent edit the file, and a review takes long enough
that they lose their place in the chat. Linking it anywhere else is clutter.

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

Never reproduce the reviewer's own words. It writes for whoever fixes the
problem; the user is at 50,000 feet and wants the shape, not the argument.
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

## Where the plan goes

One file, in `rambla/plans/` — the fork repo, not the outer folder. Plans are
part of the public record.

```
rambla/plans/YYYY-MM-DD-fix-<slug>.md
rambla/plans/YYYY-MM-DD-feat-<slug>.md
```

Because they're public, a plan never references anything outside `rambla/`.
No paths into the outer workspace, no notes, no research files, no handoff
docs — those don't exist to anyone reading the repo.

Today's date, `fix` or `feat`, then a short hyphenated slug. Nothing else
lives in that file — no notes to Tom, no "run this", no TODO markers. State
facts and steps.

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

**New module:** `path/to/thing.rambla.ts` — <what lives there, and why it is
large/novel enough to earn its own file. "None" if nothing new.>

**Upstream files touched:**

| File                  | Edit                                      | Upstream activity                         | Tag                 |
| --------------------- | ----------------------------------------- | ----------------------------------------- | ------------------- |
| `packages/.../foo.ts` | one import + one call into the new module | last touched 3 weeks ago, twice this year | `RAMBLA-FORK: fix:` |

Fill the activity column from `git log upstream-rebrand -- <path>` — when
upstream last touched the file and how often. **Line counts are not in this
table and are not the measure.** Git decides conflicts by where changes land
relative to each other, not by how many lines we wrote. One line in a file
upstream edits weekly is riskier than thirty in one they haven't opened in a
year.

**Why this shape:** <one or two sentences — the judgment call, stated so a
reviewer can disagree with it. What we'd lose by copying more, what we'd risk
by editing more.>

**Tests:** `path/to/thing.rambla.test.ts` (new). Upstream tests modified:
none.

**Branch:** `fix/<slug>` — required, N upstream files edited.
<or: "none — 1 upstream file edited, work on main.">

## Cause

<Only for a fix. Two to four sentences: what actually goes wrong, in the
code, with `file.ts:120` references. Traced, not guessed — if you haven't
found it yet, you aren't ready to write the plan.>

## Steps

0. Read the `code` skill before writing anything. If a step below turns out
   to be wrong, stop and amend this plan — do not re-decide placement while
   coding.
1. <One action per step. Name the file. Say what changes.>
2. ...

## Verification

- `npm run typecheck`
- `npm run lint`
- `npm run format`
- `npx vitest run <the one test file> --bail=1`
- `git grep "RAMBLA-FORK:" -- <each upstream file edited>` — every one must
  show a tag.
- `just trial-merge` (see below)
- <Anything that has to be seen working in the app, named specifically.>

## Ledger

<The `PATCHES.md` entry this work adds, written out: what diverges, which
files, the standing resolution rule, and the "Drops when: ..." condition.
Written into `PATCHES.md` as the last step of implementation, not before.>

## Risks

<Bullets. What could break elsewhere. "None known" is a valid answer if
you've actually looked.>
```

A plan contains steps, files, and facts the implementer needs, and nothing
else. One sentence of "why" at most, at the top — longer rationale belongs in
an issue doc, not a plan.

If the plan needs a merge-conflict decision you cannot make, say so in the
mitigation section instead of guessing, and stop for the user.

## Follow the codebase's own convention

**Before deciding where code goes, find out how this app already does this
kind of thing** — how other settings are read, how other features are gated,
how other components get their state. Say so in the plan, with a citation,
and use it.

Departing from the established way needs a reason written down in the plan.
"It's DRY", "it's a single chokepoint", "nothing can bypass it" are not
reasons — they're the instinct that causes this failure. A chokepoint in the
wrong layer wins the argument on the whiteboard and then needs a cache, a
copy, and a crash fix to survive contact with the code.

The practical test: **if a step exists only to make an earlier choice work,
the earlier choice is wrong.** Needing a cache to read settings somewhere
settings don't belong, needing a copy of a component to dodge a crash your
placement caused — stop and go back to the placement. Don't solve forward.

Using what the app already has is also what keeps upstream's fixes flowing
to us for free.

## Placement decision

Walk this in order. First match wins.

1. **Brand-new code with no upstream counterpart** — a new function, type,
   React component, hook, constant table, class → **new `*.rambla.ts(x)`
   file.** No exceptions for size; a one-function file is fine.
2. **We are replacing most of an upstream function or component** → **stop
   and ask the user first** (see "Copying upstream code is the user's
   decision"). If they say copy: our version goes in a `*.rambla.ts(x)` file
   under a different name, called from the upstream site, with the
   provenance header (`STRATEGY.md` rule 1). If they say edit: edit theirs.
   This branch is never taken on your own judgment.
3. **We are changing some of upstream's logic** → extract our logic into a
   `*.rambla.ts` helper and call it in **one line** at the upstream site.
   Twenty lines of new logic inside an upstream function is twenty lines of
   future conflict; one call is one.
4. **We are changing a handful of lines and extraction would be sillier than
   the edit** (a missing `catch` log, a wrong default, an added guard clause)
   → edit in place, minimally.

Never reformat, reorder, rename, or tidy upstream code you are not fixing.
Keep upstream's lines in upstream's order.

**Write the minimum code that makes the fix or feature work.** No extra
abstraction, no options nobody asked for, no "while we're here." This applies
to production code only — tests live in our own files and can be as thorough
as you like.

## Edit rules inside upstream files

- **New imports go at the END of the import block, after a blank line.**
  Upstream edits the top of files constantly; the block end is the coldest
  spot. This rule exists because of a real conflict (`PATCHES.md`, standing
  rule on cold paths).
- **Every diverging site carries a tag comment** on the line above:
  `// RAMBLA-FORK: <category>: <what and why>.` Categories are the fixed
  list at the top of `PATCHES.md` — use one of those, never invent one.
  The tag is how a future merge finds our code; untagged divergence is lost
  divergence.
- **Prefer cold seams:** function entry, function exit, an early return, the
  end of a body. Avoid landing next to lines upstream is actively working
  on.
- **Prefer reusing upstream's helpers** over writing our own equivalents, so
  their fixes reach us for free.

## Tests

- **Our tests go in `*.rambla.test.ts`.** These never conflict. Default to a
  new file even when an upstream suite covers the same module.
- **Editing an upstream test requires the user's explicit approval, asked
  before you write it.** Raise it loudly in the plan.
- **A failing upstream test is a signal that our change broke something
  real.** Never "fix" it by editing the assertion, deleting the case, or
  skipping it. That is the single most damaging thing an agent does in this
  repo.
- `.skip` on an upstream test is allowed only for suites testing
  infrastructure the fork does not have (npm publishing, upstream's website,
  external services), only with approval, and with a
  `// RAMBLA-FORK: skip-test:` comment giving the restore condition.

## Branch or not

Count the **upstream files you will edit**, tests excluded.

- **1-3 files:** no branch needed. Work in the main checkout.
- **4 or more:** branch first (`fix/<slug>` or `feat/<slug>`), and the plan
  must run the trial merge before the work is called done.

New `*.rambla.ts` files don't count toward the total — they cannot conflict.

## Formatting is not optional

The whole repo is Biome-formatted, and so is the rebranded upstream branch we
merge against. Unformatted code differs from upstream's copy in whitespace on
lines nobody meaningfully changed, and whitespace-only differences conflict
exactly like real ones. So:

```
npm run typecheck
npm run lint
npm run format
```

Run them from `rambla/`, before the trial merge and before any commit. Never
hand-fix formatting; let Biome do it. (This is also why the rebrand script is
followed by `npm run format` — one more letter in "Rambla" than "Paseo"
reflows lines across the tree.)

## Trial merge — rehearse the conflict before it happens

From `rambla/`:

```
just trial-merge          # syncs upstream-rebrand, merges it into HEAD in a
                          # throwaway worktree at rambla/.trial-merge
just trial-merge drop     # remove the worktree when done
```

It never touches the real checkout. Clean run = our edits currently sit
somewhere upstream isn't working. Conflicts = it prints the conflicted files.

**When conflicts come back, the answer is usually to move our code, not to
resolve them.** Read the conflict, work out which of our lines sit in
upstream's way, and re-place them per "Where conflicts come from" below. Then
re-run. Resolving is the fallback when the collision is genuine — upstream
changed the same behavior we changed.

What a clean trial merge does not prove: upstream may not have touched that
file _yet_. A clean run means no conflict today, not no conflict ever. The
placement rules are what protect us from tomorrow.

If upstream turns out to have already fixed the same bug a different way,
stop and tell the user in plain English what upstream did and how it differs.
Do not silently keep ours.

## Where conflicts come from

This is how git actually decides. Verified against git's own source
(`xdiff/xmerge.c`, `xdiff/xdiffi.c`, `merge-ort.c`, `merge-ll.c`); full
write-up with line numbers in `research/git-merge-hunk-algorithm.md`. Don't
fetch anything unless that file can't answer the question.

**The engine.** A merge diffs base→ours and base→theirs, turning each side
into a list of changed line-ranges (a "hunk" is one unbroken run of changed
lines, nothing more). It then walks both lists in lockstep by base-file
position.

**The one rule that decides everything:**

- Our changed range and their changed range separated by **at least one
  unchanged line of the base file** → both applied silently. No conflict,
  ever, regardless of content.
- Ranges **touching (zero lines apart) or overlapping** → conflict, unless
  both sides made the byte-identical change to the byte-identical range.

There is no context window. It is not `diff -U3`. One unchanged base line is
the entire margin.

**Why markers cover lines nobody touched.** After conflicts are found, git
(at its hardcoded default "zealous" level) fuses any two conflict blocks
separated by **3 or fewer clean lines** into a single marker block, gap
included, unconditionally. Clean lines inside that gap end up between the
`<<<<<<<` markers even though neither side edited them.

**Pseudocode:**

```
for each pair of hunks, by base position:
    ours ends before theirs starts   -> apply ours, advance
    theirs ends before ours starts   -> apply theirs, advance
    ranges touch or overlap:
        identical edit on both sides -> apply once, silently
        otherwise                    -> CONFLICT over the union
then: shrink each conflict to the lines that actually differ
then: any two conflicts <= 3 clean lines apart -> fuse into one
```

### What this means for how we write code

1. **Keep our edits in one contiguous block per file.** Four scattered
   one-line edits are four independent chances to land next to an upstream
   edit — and once two of them conflict within 3 lines of each other, they
   fuse into one wide marker block. One block has one boundary to worry
   about.
2. **Distance from upstream's hot lines is the only real protection.** There
   is no safe constant; the further our range sits from wherever upstream
   edits, the more unchanged lines separate them.
3. **A new file cannot conflict at all.** The line-level engine only runs
   when both sides modify the same path. That makes new files free for
   genuinely new code — and makes a _copy_ of upstream's code permanently
   deaf to their changes, which is a cost, not a win. See "A conflict is
   sometimes what you want".
4. **One call line into a helper is the smallest possible exposure.** The
   helper's body lives in a file upstream never diffs. Only the call site is
   exposed.
5. **Blank lines are not a buffer.** They do not create separation in any
   rule above. A blank line around our block is cosmetic; do not treat it as
   protection. (What blank lines _do_ affect is where an ambiguous insertion
   point slides to, which is unpredictable — not a tool.)
6. **Guard clause at function entry beats an edit mid-function** — purely
   because it is further from where upstream usually works, not because entry
   is special.
7. **Never rename or move upstream code.** A move is a delete at the old
   spot plus an insert at the new one. The delete guarantees a conflict every
   time upstream touches those lines, forever.
8. **A reflow of a whole file is the worst case.** A formatter run that
   reflows lines we didn't mean to change makes our changed range cover
   nearly everything, so nearly any upstream edit now touches it. This is why
   we run the same `npm run format` upstream runs — matching their output
   keeps our changed range small; diverging from it makes it huge.

The user's earlier hunch — "four inserts at lines 1, 3, 5, 7 become one
11-line conflicting region" — is not how it works mechanically, but the
conclusion it leads to is right: keep edits together, don't scatter them.

### Two more facts worth knowing

- **Merges use the histogram diff algorithm**, not myers (that's `git diff`'s
  default). Histogram is better at not matching generic lines like a lone
  `}` or a blank line across unrelated code, so it produces fewer bogus
  alignments. Nothing to configure; ort sets it.
- **`rerere` remembers a resolution by hashing the exact text of both
  conflict sides.** One byte different — including whitespace — and the
  memory doesn't match. That is another reason to keep formatting identical
  to upstream's.

## Stop and ask the user

- An upstream test would have to change.
- A change needs an identifier rename that upstream also names.
- Upstream already fixed the same bug a different way (explain, in plain
  English, what they did and how it differs).
- The mitigation choice is close and the wrong pick is expensive — present
  both options in two sentences each, with a recommendation.
- **Anything else this skill doesn't clearly cover.** These four are the
  obvious cases, not the whole list. When a choice isn't covered here, ask;
  don't pick and move on. Being slow and asking is the intended pace.

## After the plan

The plan's mitigation table is the contract the implementer follows — it
goes to the implementer whole, not summarized.

The plan has been reviewed before it reaches the user — see "Every plan is
reviewed". No code is written until that verdict is in.

When the work lands, the divergence gets its `PATCHES.md` entry from the
plan's Ledger section. A divergence with no entry is a divergence we lose
track of at the next merge.
