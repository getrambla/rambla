---
name: sync-upstream
description: Sync latest upstream (getpaseo/paseo) release tag into the Rambla fork with `just sync-upstream`, and resolve conflicts, a failing check, a failing CI job — walking each conflict past the user in plain English. Use when the user says "sync", "sync upstream", "merge upstream", or "/sync-upstream".
---

# Syncing upstream into the fork

**The repo being merged is `getrambla/rambla`** — a permanent, terminal fork of
upstream `getpaseo/paseo`, rebranded by script in the `origin/upstream-rebrand` branch. Every command in this skill
runs from a checkout of `getrambla/rambla`, on the branch the sync lands in — normally main.

You are the supervisor for this run. Never hand the whole merge to one
subagent — you own the decisions, and the user owns the calls you can't make.
When spawning subagents, do not set the provider/model fields —
omitting `provider` runs the new agent on your own provider and current
model. Pass a provider/model only when the user asked for a different one.

## Hard nos

- **Never edit, delete, or skip an upstream test to make a merge pass.**
  Forbidden during a merge, with no exceptions and no judgment call. A
  failing upstream test means the merge broke behavior — bring it to the
  user.
- **Never rebase against upstream. Never force-push or rewrite main's history unless you made an error that the user is telling you to reset and correct.** This
  fork only ever merges from our own `upstream-rebrand` branch. We never contribute upstream.
- **Never run end-to-end, integration, browser, Playwright, or Maestro
  suites.** They will freeze the machine. Unit suites only.
- **Never merge upstream/main directly.** Only a tag's rebrand commit from
  `upstream-rebrand` is ever merged — it carries the rebrand, so the merge
  base stays rebranded. This is the whole reason the branch exists.
- **Never resolve a conflict by deleting our side** because upstream's looks
  cleaner. Every `RAMBLA-FORK:` tag marks something we chose on purpose.
- **Never set or change git config.** Never `git config user.email`,
  `user.name`, or any other key — not in this repo, not in a temp clone or
  worktree, not "just to make a commit work". Git is already configured
  globally; a fresh clone inherits it. If a commit fails for missing
  identity, stop and tell the user — do not pick an email for them.

## The run

### 1. Run it

```
just sync-upstream
```

It takes no arguments, and does the whole run:

1. Syncs every new upstream release tag onto `upstream-rebrand`, oldest
   first, and pushes it. Every tag gets its own rebrand commit there, kept
   for future reference. A release tag is a `v*` tag on upstream main, betas
   included. Tags on upstream side branches, like hotfix `v0.10.1` on `release/v0.10.1`, are
   ignored.
2. Merges only the newest tag the branch lacks; its rebrand commit carries
   every older one, so the tags in between are never merged on their own.
   Cuts `merge-<tag>` from the branch, merges that tag's rebrand commit,
   keeps the branch's copies of the delete list, rebuilds `CHANGELOG.md`
   and `README.md`, and runs the local checks:
   `npm ci`, `npm run build:server`, `npm run build:app-deps`,
   `npm run typecheck` and each package's unit tests.
3. Pushes `merge-<tag>`, waits for `ci.yml` on it, fast-forwards the branch
   on origin to it, and deletes it. The local branch catches up with
   `git pull --ff-only`, or at the next run.

`just sync-upstream` turns the local checks on with `LOCAL_SYNC=1`. The daily
`sync-upstream.rambla.yml` workflow runs the same script with them off, since
`ci.yml` runs the same checks.

Exit 0 → report which tag landed, from its `landed <tag>` line, and stop.

### 2. When it stops

The last lines of the output say why:

| It stopped on                                         | Left behind                                                | Next                                                     |
| ----------------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------- |
| uncommitted changes or unpushed commits on the branch | nothing                                                    | bring it to the user                                     |
| a conflict, listing the paths                         | `merge-<tag>` unpushed in `~/worktrees/rambla/merge-<tag>` | finish the merge there (step 3)                          |
| a failing local check, naming it                      | `merge-<tag>` on origin                                    | check it out and fix it (step 5)                         |
| a failing `ci.yml` job, naming it                     | `merge-<tag>` on origin                                    | check it out and fix it (step 5)                         |
| the branch moving, naming both tips                   | `merge-<tag>` on origin                                    | merge the branch into `merge-<tag>`, resolving conflicts |
| another `merge-` branch on origin                     | that branch                                                | land it or delete it first                               |
| a tag out of order, naming both tags                  | nothing                                                    | bring it to the user                                     |

Every hand fix ends the same way: ask the user, push `merge-<tag>`, and run
`just sync-upstream` again. It uses the branch on origin instead of making a
new one, waits for `ci.yml`, and lands it.

### 3. Finishing a conflicted merge

The run leaves the merge in progress on local branch `merge-<tag>`, in its own
worktree, with main's copy of every **delete list** path (the block at the top
of `fork/sync-upstream.sh`) already put back:

```bash
cd ~/worktrees/rambla/merge-<tag>
git status
```

Resolve every conflict (step 4), then:

```bash
node fork/build-changelog.mjs
node fork/build-readme.mjs
git add CHANGELOG.md README.md
git commit -m "merge upstream <tag>"
```

### 4. Conflicts

**Enumerate the conflicts for the user, numbered, in plain English, before
touching anything.** One entry each:

```
3. [composer.tsx](rambla/packages/app/src/components/composer.tsx)
   Ours: RAMBLA-FORK: fix: dictation tail-trim on submit.
   Upstream: "add chat search", 3 weeks ago — wrapped the component in a search
     provider, reindenting the body.
   Collides? No — mechanical, their reindent moved our lines.
   Plan: re-apply our block inside their new wrapper, unchanged.
```

For each one say: what our side is (name the `RAMBLA-FORK:` tag; if there
isn't one, say the divergence is untagged), what upstream changed, whether
the two actually collide in behavior or only in text, and your proposed
resolution.

**Trace upstream's change. Every conflict, no exceptions.** Never describe
their intent from the shape of the diff:

```
git log MERGE_HEAD^^2 -1 --format='%s — %cr' -L <start>,<end>:"$(echo <path> | sed 's/RAMBLA/PASEO/g; s/Rambla/Paseo/g; s/rambla/paseo/g')" | head -1
```

`MERGE_HEAD^^2` is upstream's own tag commit: the rebrand commit's parent is
the ours-merge, whose second parent is the tag. Tracing `upstream-rebrand`
instead always answers with our `rebrand upstream <tag>` commit. The `sed`
undoes the rebrand's path renames; `<start>,<end>` are upstream's side of the
conflict. `head -1` drops the diff `-L` prints. Verified in this repo — it
returns one line like `Make Paseo tool calls readable (#4066) — 6 weeks ago`.

Report the commit's **subject line and how long ago**, never the hash. "Their
'add chat search' commit from 3 weeks ago wrapped this component" is what you
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

### 5. A failing check or job

The run names the failing local check or `ci.yml` job:

- A failing test → **show the failure before naming a
  cause.** In this order: the test's name, what it expected and what it got,
  and the `file.ts:120` the assertion failed on. Then the cause, with its own
  citation. A cause offered without the failure shown first is a guess, and
  you can't tell the difference afterwards. Do not touch a test.

  Quote only the expected/actual values and the one failing line — never
  paste the raw test output. It's unreadable with a screen reader, and
  summarizing it is your job.

- Typecheck failing → the classic silent break: upstream changed a
  prop or signature in a way git merged cleanly but TypeScript rejects. Fix
  the call site, minimally.

Fix it on `merge-<tag>`, never on main.

### 6. Update the tags, then push

Before pushing the merge branch:

- **Untagged divergences you hit.** If a conflict landed on fork code with
  no `RAMBLA-FORK:` tag, add the tag while you're in there. Untagged
  divergence is divergence we lose.
- **Divergences that drop.** Where upstream fixed it properly and we took
  theirs, delete our tag along with our code.

**Then ask before pushing.** Summarize: what came in, what conflicted, what
you resolved, anything still uncertain. Wait for a yes.

```
git push origin merge-<tag>
just sync-upstream
```

### 7. Propose what should become a rule

Last step, every time: was there anything here that would have been cheaper
if a rule had existed? A placement that caused a conflict, an upstream habit
worth knowing, a resolution that took three tries.

**Propose it in one or two sentences. Do not write it into any file.** The
user decides whether it becomes a line in a skill, or
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
   fixed it properly. Tell the user; it means a `RAMBLA-FORK:` tag drops.
6. **Genuine behavioral collision → the user decides.** Explain in plain
   English what each side does and what is lost either way. Recommend one.
7. **Run the unit tests that cover the touched code** after each resolution,
   not just at the end.

## How to talk to the user during a merge

- **Concerns first, always.** If something is risky or unresolved, that's
  the first sentence.
- Plain words. "Upstream moved this function into a new wrapper component,
  so our two-line fix ended up outside it" — not "hunk collision at
  xdiff-level adjacency."
- **Never paste raw git output.** Read it and say what it means in one line.
  Merge output is unreadable with a screen reader.
- **Numbered lists for conflicts**, so the user can answer by number.
- **File references are markdown links** — see "File links".

## Numbers are digits when they are data

A number that is **data** — a count, a measurement, a limit, a version, a
date — is a digit. `5 conflicts`, `3 files`, `6 of 7 items`. Never `five
conflicts`. This holds at 1 as well: `1 conflict`, not `one conflict`.

The test: **would the user want to spot it at a glance?** They read with a
screen reader; a digit is findable, a spelled-out number has to be read
through.

A number that is part of an English phrase rather than a quantity stays a
word: "one at a time", "one another", "no one", "one of them".

Applies in chat, in commit messages and in files in the repo.

## File links

**Never write a bare path.** Every file reference, everywhere, is a markdown
link with the line as `#L<n>`. Link text is always `name.ts:120`.

| Where the text is read  | Target starts with           |
| ----------------------- | ---------------------------- |
| Chat with the user      | `rambla/`                    |
| A file inside `rambla/` | a path relative to that file |

```markdown
chat: [en.ts:2207](rambla/packages/app/src/i18n/resources/en.ts#L2207)
RAMBLA-CHANGELOG.md: [en.ts:2207](packages/app/src/i18n/resources/en.ts#L2207)
```

Why they differ: the user runs this project from a workspace folder that
holds the fork in a subfolder named `rambla/`, so paths in chat resolve from
that workspace root. A file committed in the repo has no `rambla/` above it —
on GitHub and in a clone, the repo root _is_ the fork — so links written into
a file are relative to that file. `RAMBLA-CHANGELOG.md` sits at the fork root, so it
needs no prefix at all.

`#L<n>` is the GitHub form and it works in both places, so the line syntax
never changes. Only the prefix does.

A bare `path:line` renders as plain text. The user cannot open it, and this
user reads with a screen reader — an unclickable path costs them a manual
lookup every time.
