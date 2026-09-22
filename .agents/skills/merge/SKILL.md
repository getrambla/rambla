---
name: merge
description: Merge rebranded upstream (getpaseo/paseo) into the Rambla fork's main, resolve any conflicts, and land the result. Checks what main is based on versus upstream's newest tag, rehearses the merge in a throwaway worktree, runs a green-before/red-after test comparison, and walks each conflict past the user in plain English. Use when the user says "merge", "merge upstream", "sync upstream", or "/merge".
---

# Merging upstream into the fork

**The repo being merged is `rambla/`** — a permanent, terminal fork of
upstream `getpaseo/paseo`, rebranded by script. Every command in this skill
runs from there. The outer repo you start in — whatever it happens to be
called — holds no application code; it's the container that carries
`rambla/` as a submodule, plus plans, research and notes.

You are the supervisor for this run. Never hand the whole merge to one
subagent — you own the decisions, and the user owns the calls you can't make.

Read the `plan` skill's "Where conflicts come from" section before resolving
anything. It explains how git decides a conflict; resolutions that ignore it
create the next merge's conflicts.

## Hard nos

- **Never edit, delete, or skip an upstream test to make a merge pass.**
  Forbidden during a merge, with no exceptions and no judgment call. A
  failing upstream test means the merge broke behavior — bring it to the
  user.
- **Never force-push. Never rebase. Never rewrite main's history.** This
  fork only ever merges.
- **Never run end-to-end, integration, browser, Playwright, or Maestro
  suites.** They will freeze the machine. Unit suites only, listed below.
- **Never merge upstream/main directly.** Only `upstream-rebrand` is ever
  merged — it carries the rebrand, so the merge base stays rebranded. This
  is the whole reason the branch exists.
- **Never resolve a conflict by deleting our side** because upstream's looks
  cleaner. Every `RAMBLA-FORK:` tag marks something we chose on purpose.

## The run

### 0. Preflight

Work in `rambla/`. Confirm, and say so in one line each:

```
git status --porcelain          # must be empty
git fetch origin
git status -sb                  # main vs origin/main
```

- Dirty tree → stop, tell the user what's uncommitted.
- Main behind origin/main → `git pull --ff-only`. If that isn't a fast
  forward, stop: main and origin/main have diverged, and that is its own
  problem to fix before any upstream merge.

### 1. Report the three facts, then ask

Refresh upstream and the rebrand branch first:

```
git fetch upstream --quiet --no-tags
git fetch origin upstream-rebrand
```

`upstream-rebrand` has two writers, this machine and the CI bot that syncs
daily. If local and `origin/upstream-rebrand` differ, reconcile before
anything else: fast-forward if you can, and if you can't, stop and explain.
A diverged rebrand branch is how an unrebranded commit gets into the merge
base, which costs hours.

Then report exactly these three, in this order:

```
Main is based on:      <tag or short SHA> — <N days> ago
Rebrand branch tip:    <tag or "untagged" + short SHA> — <N days> ago
Upstream's newest tag: <tag> — <N days> ago
```

Use "3 days ago" style, not dates. Tag names for anything tagged; short SHA
plus the word "untagged" otherwise.

How to get each:

```bash
# What main is based on — newest upstream tag that is an ancestor of main.
git ls-remote --tags --refs upstream 'refs/tags/v*' | sed 's/-/~/' |
  sort -V -k2 | sed 's/~/-/' | while read -r sha ref; do
    git merge-base --is-ancestor "$sha" main 2>/dev/null &&
      echo "${ref#refs/tags/} $(git log -1 --format='%cr' "$sha")"
  done | tail -1

# Rebrand branch tip.
git log -1 --format='%h %cr %s' upstream-rebrand

# Upstream's newest tag, betas included (tilde swap fixes sort -V's
# backwards ordering of prereleases).
git ls-remote --tags --refs upstream 'refs/tags/v*' |
  awk -F'refs/tags/' '{print $2}' | sed 's/-/~/' | sort -V | tail -1 |
  sed 's/~/-/'
```

**Then ask the user, and wait.** Recommend the newest tag — betas count as
releases here; `just merge-upstream --release` picks them up. Offer the tip
of upstream's main as the second option, and say plainly that untagged main
fails upstream's CI about a quarter of the time.

If the rebrand branch tip is untagged and the user picks a tag, say so —
`--release` handles it, advancing the branch to the tag itself.

If the newest tag is already an ancestor of main, there is nothing to merge.
Say that and stop.

### 2. Green baseline — before the merge

Run these from `rambla/`, output to a file, and read the file:

```
npm run typecheck
npm run lint
npm run test:unit --workspace=@getrambla/server
npm run test:unit --workspace=@getrambla/cli
npm run test --workspace=@getrambla/protocol
npm run test --workspace=@getrambla/client
```

- **Typecheck fails → stop. Do not merge.** A broken tree before a merge is
  a separate problem; merging on top of it makes the cause unfindable.
- Tests failing → write down exactly which ones. That list is the baseline.
  A test that was already red is not a regression; a test that goes red
  after the merge is.

### 3. Trial merge

```
just trial-merge          # throwaway worktree, never touches the checkout
just trial-merge drop     # clean it up when done
```

Clean → go to 4a. Conflicts → go to 4b. Report the conflicted file list in
plain English either way; don't paste raw git output.

### 4a. Clean path

```
git checkout -b merge/<tag>
just merge-upstream --release      # or --main, per the user's choice
git commit --no-edit               # the script stages, it does not commit
```

Re-run everything from step 2. Compare against the baseline. Then go to 5.

### 4b. Conflict path

```
git checkout -b merge/<tag>
just merge-upstream --release
```

The merge is now staged with conflicts in the working tree.

**Enumerate the conflicts for the user, numbered, in plain English, before
touching anything.** One entry each:

```
3. [composer.tsx](rambla/packages/app/src/components/composer.tsx)
   Ours: RAMBLA-FORK: fix: dictation tail-trim on submit.
   Upstream: "add chat search", Sep 18 — wrapped the component in a search
     provider, reindenting the body.
   Collides? No — mechanical, their reindent moved our lines.
   Plan: re-apply our block inside their new wrapper, unchanged.
```

For each one say: what our side is (name the `RAMBLA-FORK:` tag; if there
isn't one, say the divergence is untagged), what upstream changed, whether
the two actually collide in behavior or only in text, and your proposed
resolution. Check `PATCHES.md` for the standing rule on that divergence.

**Trace upstream's change. Every conflict, no exceptions.** Never describe
their intent from the shape of the diff:

```
git log upstream-rebrand -1 --format='%s — %cr' -L <start>,<end>:<path> | head -1
```

`-L` always prints a diff after the subject line; `head -1` drops it. Verified
in this repo — it returns one line like
`chore: finalize electron desktop migration — 6 months ago`.

Report the commit's **subject line and how long ago**, never the hash. "Their
'add chat search' commit from Sep 18 wrapped this component" is what you
write. If a trace comes back empty or ambiguous, say so in that entry — an
untraced conflict is a fact about the conflict, not a gap to fill in with
something plausible.

Then stop and let the user pick. They will typically say "do 1, 3, 4, 5;
let's talk about 2."

For each approved conflict, run the coder/reviewer loop: `coder` resolves it,
`reviewer` re-verifies blind against the original conflict, never told what
was changed. Third reject on the same deficiency → stop and escalate.

**One conflict at a time.** Resolve it, run the unit tests that cover it,
report back in a sentence, then start the next. Never resolve a batch and
review the batch at the end — that is how a bad resolution gets buried under
four good ones.

**When a choice isn't clearly covered by this skill, ask.** The stop-and-ask
cases listed here are the obvious ones, not the whole list. Slow and asking
is the intended pace.

### 5. Land it

Once every conflict is resolved:

```
git commit --no-edit
```

Re-run everything from step 2 and compare against the baseline:

- Same failures as baseline → no regression. Say so.
- New failures → the merge caused them. **Show the failure before naming a
  cause.** In this order: the test's name, what it expected and what it got,
  and the `file.ts:120` the assertion failed on. Then the cause, with its own
  citation. A cause offered without the failure shown first is a guess, and
  you can't tell the difference afterwards. Do not touch a test.

  Quote only the expected/actual values and the one failing line — never
  paste the raw test output. It's unreadable with a screen reader, and
  summarizing it is your job.

- Typecheck newly failing → the classic silent break: upstream changed a
  prop or signature in a way git merged cleanly but TypeScript rejects. Fix
  the call site, minimally.

Then fast-forward main and drop the branch — no second merge commit:

```
git checkout main
git merge --ff-only merge/<tag>
git branch -d merge/<tag>
```

`--ff-only` is the point: the branch tip becomes main's tip, nothing new is
recorded. If it refuses to fast-forward, main moved underneath you — stop
and say so.

**Then ask before pushing.** Summarize: what came in, what conflicted, what
you resolved, anything still uncertain. Wait for a yes.

```
git push
```

### 6. Update the ledger

Before the push, go through `PATCHES.md`:

- **Entries that drop.** Any divergence where upstream fixed it properly and
  we took theirs — mark it DROPPED with the date and what upstream did.
- **Conflict history.** Any entry that conflicted this round gets a line:
  what upstream changed and how it was resolved. That line is what makes the
  same conflict cheap next time.
- **Untagged divergences you hit.** If a conflict landed on fork code with
  no `RAMBLA-FORK:` tag, add the tag while you're in there and give it an
  entry. Untagged divergence is divergence we lose.

### 7. Propose what should become a rule

Last step, every time: was there anything here that would have been cheaper
if a rule had existed? A placement that caused a conflict, an upstream habit
worth knowing, a resolution that took three tries.

**Propose it in one or two sentences. Do not write it into any file.** The
user decides whether it becomes a `PATCHES.md` entry, a line in a skill, or
nothing. "Nothing to propose" is a normal answer — don't manufacture one.

## Resolving a conflict

The goal: keep every one of our fixes and features, take every one of
upstream's, and make the smallest edit that achieves both.

1. **Read both sides and work out whether they actually collide.** Most
   conflicts are textual — upstream moved, reindented, or wrapped code our
   patch sits inside. Those aren't decisions, they're re-application.
2. **Preserve every `RAMBLA-FORK:` tag and the code under it.** The tag is
   why the code exists. If a resolution would drop one, that's a decision
   for the user, not for you.
3. **A `RAMBLA-FORK: skip-test:` comment with a `.skip` always survives.**
   If upstream's version of that test line comes back enabled, re-apply the
   `.skip` and keep the comment. That comment is the record of a deliberate
   divergence.
4. **Minimum possible edit.** A resolution is itself a new edit in an
   upstream file, so it can seed the next conflict. Keep upstream's lines in
   upstream's order, keep our block contiguous, don't tidy anything.
5. **Take upstream's version outright when our patch is obsolete** — they
   fixed it properly. Tell the user; it means a `PATCHES.md` entry drops.
6. **Genuine behavioral collision → the user decides.** Explain in plain
   English what each side does and what is lost either way. Recommend one.
7. **Run the unit tests that cover the touched code** after each resolution,
   not just at the end.

## rerere

It's on (`rerere.enabled` and `rerere.autoUpdate`, both true) and it applies
to merges, which is exactly what it's for. It records each conflict you
resolve and replays the resolution automatically if the identical conflict
appears in a later merge — so a resolution done once is usually free
forever.

Two things to know:

- **It lives in `.git/modules/rambla/rr-cache`. It is not checked in and it
  is not shared with CI or any other machine.** It's this machine's memory
  only.
- **It matches on the exact text of both conflict sides, byte for byte,
  whitespace included.** Resolve in a way that matches how the repo is
  formatted, or the memory won't match next time.

Nothing to run. Just resolve, and it remembers.

## How to talk to the user during a merge

- **Concerns first, always.** If something is risky or unresolved, that's
  the first sentence.
- **Never paste raw git output.** Read it and say what it means in one line.
  Merge output is unreadable with a screen reader.
- **Numbered lists for conflicts**, so the user can answer by number.
- **File references are markdown links** — see "File links".

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
needs no prefix at all.

`#L<n>` is the GitHub form and it works in both places, so the line syntax
never changes. Only the prefix does.

A bare `path:line` renders as plain text. The user cannot open it, and this
user reads with a screen reader — an unclickable path costs them a manual
lookup every time.

- Plain words. "Upstream moved this function into a new wrapper component,
  so our two-line fix ended up outside it" — not "hunk collision at
  xdiff-level adjacency."
