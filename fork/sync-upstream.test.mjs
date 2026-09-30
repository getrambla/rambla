import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "sync-upstream.sh");

const TARGET = "fix/sync-target";
const BRANCH = "upstream-rebrand";

// Criterion 10 allows "paseo" only under fork/rebrand.sh's skip paths.
const rebrandSkip =
  /^(PASEO-|fork\/|\.github\/workflows\/merge-upstream\.yml)|\.paseo(\.test)?\.ts$/;

// Listed apart from the script's delete list, so a path dropped from it fails a test.
const logoPaths = [
  "fastlane/metadata/android/en-US/images/icon.png",
  "packages/app/assets/images/android-icon-foreground.png",
  "packages/app/assets/images/favicon-dark-attention.png",
  "packages/app/assets/images/favicon-dark-attention.svg",
  "packages/app/assets/images/favicon-dark-running.png",
  "packages/app/assets/images/favicon-dark-running.svg",
  "packages/app/assets/images/favicon-dark.png",
  "packages/app/assets/images/favicon-dark.svg",
  "packages/app/assets/images/favicon-light-attention.png",
  "packages/app/assets/images/favicon-light-attention.svg",
  "packages/app/assets/images/favicon-light-running.png",
  "packages/app/assets/images/favicon-light-running.svg",
  "packages/app/assets/images/favicon-light.png",
  "packages/app/assets/images/favicon-light.svg",
  "packages/app/assets/images/favicon.png",
  "packages/app/assets/images/icon.png",
  "packages/app/assets/images/notification-icon.png",
  "packages/app/assets/images/splash-icon.png",
  "packages/app/public/apple-touch-icon.png",
  "packages/app/public/pwa-icon-192.png",
  "packages/app/public/pwa-icon-512.png",
  "packages/app/src/components/icons/rambla-logo-mask.ts",
  "packages/app/src/components/icons/rambla-logo.tsx",
  "packages/desktop/assets/icon-dev.png",
  "packages/desktop/assets/icon.icns",
  "packages/desktop/assets/icon.ico",
  "packages/desktop/assets/icon.png",
  "packages/website/public/favicon.ico",
  "packages/website/public/favicon.svg",
  "packages/website/public/logo.svg",
];
const deleteList = [...logoPaths, "nix/npm-deps.hash"];
/** A delete-list path under upstream's name. */
const upstreamName = (file) => file.replace("rambla", "paseo");

const CI_YML = `name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  paseo:
    runs-on: ubuntu-latest
    steps:
      - run: echo paseo
`;

const UPSTREAM_FILES = {
  "README.md": "# Paseo\n",
  "packages/paseo-core/src/paseo.ts": 'export const paseoName  =  "Paseo"\n',
  "packages/app/src/thing.paseo.test.ts": "// paseo stays\n",
  ".github/workflows/ci.yml": CI_YML,
  ...Object.fromEntries(deleteList.map((file) => [upstreamName(file), "upstream copy\n"])),
};

// Tests must never touch the real repo or Tom's git config, and must run the same in CI.
const gitEnv = (() => {
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "Sync Test",
    GIT_AUTHOR_EMAIL: "sync-test@example.invalid",
    GIT_COMMITTER_NAME: "Sync Test",
    GIT_COMMITTER_EMAIL: "sync-test@example.invalid",
    LEFTHOOK: "0",
  };
  for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"]) delete env[key];
  return env;
})();

/** Noon UTC on the given September 2026 day. */
function day(n) {
  return `2026-09-${String(n).padStart(2, "0")}T12:00:00Z`;
}

/** Git author and committer dates for the given day. */
function dated(n) {
  return { GIT_AUTHOR_DATE: day(n), GIT_COMMITTER_DATE: day(n) };
}

/** Runs git in cwd and returns its trimmed stdout. */
function git(cwd, args, env = {}) {
  return execFileSync("git", args, {
    cwd,
    env: { ...gitEnv, ...env },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

/** Writes files into repo (null deletes one), commits them on the given day, and returns the commit. */
function commit(repo, files, n, message) {
  for (const [file, content] of Object.entries(files)) {
    const full = path.join(repo, file);
    if (content === null) {
      rmSync(full);
    } else {
      mkdirSync(path.dirname(full), { recursive: true });
      writeFileSync(full, content);
    }
  }
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-m", message], dated(n));
  return git(repo, ["rev-parse", "HEAD"]);
}

/** Tags a commit: annotated on the given day, or lightweight when no day is given. */
function tag(repo, name, sha, n) {
  if (n === undefined) git(repo, ["tag", name, sha]);
  else git(repo, ["tag", "-a", name, "-m", name, sha], dated(n));
}

/** Records an upstream commit as the old sync did: one merge whose tree differs from its first parent. */
function oldStyleMerge(repo, sha, n) {
  git(repo, ["merge", "-s", "ours", "--no-ff", "--no-commit", sha]);
  writeFileSync(path.join(repo, "stale.txt"), `old sync through ${sha}\n`);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-m", `rebrand upstream through ${sha}`], dated(n));
}

/** Builds a fixture upstream, an origin holding main, the target branch and an old-style upstream-rebrand. */
function makeFixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), "sync-upstream-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const up = path.join(root, "upstream");
  const origin = path.join(root, "origin.git");
  const seed = path.join(root, "seed");
  mkdirSync(up);
  git(up, ["init", "-b", "main"]);

  const c = {};
  c.v090 = commit(up, { ...UPSTREAM_FILES, "version.txt": "0.9.0\n" }, 1, "0.9.0");
  tag(up, "v0.9.0", c.v090, 1);
  c.floor = commit(up, { "version.txt": "0.10.0-beta.1\n" }, 2, "0.10.0-beta.1");
  tag(up, "v0.10.0-beta.1", c.floor, 2);
  c.beta2 = commit(
    up,
    {
      "version.txt": "0.10.0-beta.2\n",
      "packages/paseo-core/src/beta2.ts": "export const beta = 2;\n",
    },
    3,
    "0.10.0-beta.2",
  );
  tag(up, "v0.10.0-beta.2", c.beta2, 3);
  c.untagged = commit(up, { "version.txt": "between\n" }, 4, "untagged");
  c.v0100 = commit(up, { "version.txt": "0.10.0\n" }, 5, "0.10.0");
  tag(up, "v0.10.0", c.v0100, 5);
  c.after = commit(up, { "untagged.txt": "never synced\n" }, 6, "after 0.10.0");
  git(up, ["checkout", "-b", "release/0.10", c.v0100]);
  c.hotfix = commit(up, { "version.txt": "0.10.1\n" }, 7, "0.10.1");
  tag(up, "v0.10.1", c.hotfix, 7);
  git(up, ["checkout", "-b", "beta-side", c.v0100]);
  c.sideBeta = commit(up, { "version.txt": "0.11.0-beta.1\n" }, 8, "0.11.0-beta.1");
  tag(up, "v0.11.0-beta.1", c.sideBeta, 8);
  git(up, ["checkout", "main"]);

  git(root, ["clone", up, seed]);
  git(seed, ["checkout", "-b", BRANCH, c.v090]);
  oldStyleMerge(seed, c.beta2, 3);
  oldStyleMerge(seed, c.untagged, 4);
  git(seed, ["checkout", "-b", "fork-main"]);
  commit(seed, { "fork-only.txt": "ours\n", "nix/npm-deps.hash": "main-hash\n" }, 5, "fork change");
  git(root, ["init", "--bare", "-b", "main", origin]);
  git(seed, ["push", origin, `${BRANCH}:${BRANCH}`, "fork-main:main", `fork-main:${TARGET}`]);

  return { root, up, origin, c };
}

/** Clones the fixture origin on the target branch, with a local upstream-rebrand and upstream pointing at the fixture. */
function checkout(fx, name) {
  const dir = path.join(fx.root, name);
  git(fx.root, ["clone", "-b", TARGET, fx.origin, dir]);
  git(dir, ["remote", "add", "upstream", fx.up]);
  git(dir, ["branch", BRANCH, `origin/${BRANCH}`]);
  return dir;
}

/** Runs the sync script in a checkout and returns its exit status and combined output. */
function sync(dir, env = {}) {
  const result = spawnSync("bash", [script], {
    cwd: dir,
    env: { ...gitEnv, ...env },
    encoding: "utf8",
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

/** Every branch on the fixture origin with its commit, one per line. */
function originBranches(fx) {
  return git(fx.origin, ["for-each-ref", "--format=%(refname) %(objectname)", "refs/heads"]);
}

/** The commit a ref points at in repo. */
function rev(repo, ref) {
  return git(repo, ["rev-parse", ref]);
}

/** The commit an upstream tag points at. */
function tagCommit(fx, name) {
  return rev(fx.up, `${name}^{commit}`);
}

/** The parents of a commit, in order. */
function parents(repo, sha) {
  return git(repo, ["rev-list", "--parents", "-n", "1", sha]).split(" ").slice(1);
}

/** Whether ancestor is reachable from ref in repo. */
function isAncestor(repo, ancestor, ref) {
  return (
    spawnSync("git", ["merge-base", "--is-ancestor", ancestor, ref], { cwd: repo, env: gitEnv })
      .status === 0
  );
}

/** The first-parent commits origin's upstream-rebrand gained after `since`, oldest first. */
function gained(fx, since) {
  return git(fx.origin, ["rev-list", "--first-parent", "--reverse", BRANCH, `^${since}`])
    .split("\n")
    .filter(Boolean);
}

/** Asserts origin's upstream-rebrand gained exactly an ours-merge and a rebrand commit per tag, in order; returns the rebrand commits. */
function assertSynced(fx, since, tagNames) {
  const commits = gained(fx, since);
  assert.equal(commits.length, tagNames.length * 2, `expected 2 commits per tag: ${tagNames}`);
  let previous = since;
  return tagNames.map((name, i) => {
    const [merge, rebrand] = commits.slice(i * 2, i * 2 + 2);
    assert.deepEqual(parents(fx.origin, merge), [previous, tagCommit(fx, name)], name);
    assert.equal(rev(fx.origin, `${merge}^{tree}`), rev(fx.origin, `${previous}^{tree}`), name);
    assert.deepEqual(parents(fx.origin, rebrand), [merge], name);
    previous = rebrand;
    return rebrand;
  });
}

/** The files in a commit's tree. */
function filesOf(repo, sha) {
  return git(repo, ["ls-tree", "-r", "--name-only", sha]).split("\n").filter(Boolean).sort();
}

/** How many worktrees a checkout has, its own included. */
function worktreeCount(dir) {
  return git(dir, ["worktree", "list", "--porcelain"])
    .split("\n")
    .filter((line) => line.startsWith("worktree ")).length;
}

/** Makes origin's upstream-rebrand hold every release tag through v0.10.0, as a first run does. */
function firstRun(fx) {
  const run = sync(checkout(fx, "first"));
  assert.equal(run.status, 0, run.output);
  return rev(fx.origin, BRANCH);
}

/** Asserts a failed run left origin, the checkout's branches and its worktrees as they were. */
function assertNothingChanged(fx, dir, before) {
  assert.equal(originBranches(fx), before.origin);
  assert.equal(rev(dir, BRANCH), before.local);
  assert.equal(rev(dir, TARGET), before.target);
  assert.equal(worktreeCount(dir), 1);
}

/** The origin branches and the checkout's local branches, for assertNothingChanged. */
function snapshot(fx, dir) {
  return { origin: originBranches(fx), local: rev(dir, BRANCH), target: rev(dir, TARGET) };
}

test("criteria 2, 3, 4, 5: the first run syncs every release tag after v0.10.0-beta.1, oldest first, 2 commits each", (t) => {
  const fx = makeFixture(t);
  const dir = checkout(fx, "checkout");
  const oldTip = rev(fx.origin, BRANCH);
  const main = rev(fx.origin, "main");

  const run = sync(dir);

  assert.equal(run.status, 0, run.output);
  // beta.2 counts although the old history merged it: an old one-commit merge is not an ours-merge.
  assertSynced(fx, oldTip, ["v0.10.0-beta.2", "v0.10.0"]);
  assert.ok(!isAncestor(fx.origin, fx.c.after, BRANCH), "an untagged commit is never synced");
  assert.ok(!isAncestor(fx.origin, fx.c.hotfix, BRANCH), "a hotfix tag never lands");
  assert.equal(rev(fx.origin, "main"), main);
  assert.equal(rev(dir, BRANCH), rev(fx.origin, BRANCH));
  assert.equal(worktreeCount(dir), 1);
});

test("criterion 2: a beta tag on a side branch is a hotfix tag and never lands on upstream-rebrand", (t) => {
  const fx = makeFixture(t);
  const dir = checkout(fx, "checkout");

  const run = sync(dir);

  assert.equal(run.status, 0, run.output);
  assert.ok(!isAncestor(fx.origin, fx.c.sideBeta, BRANCH));
  assert.ok(!gained(fx, fx.c.v090).some((c) => parents(fx.origin, c)[1] === fx.c.sideBeta));
});

test("criterion 4: a tag at or below v0.10.0-beta.1 is never synced and never checked", (t) => {
  const fx = makeFixture(t);
  // Dated after beta.2 with a lower version, so checking it against beta.2 would fail the run.
  const alpha = commit(fx.up, { "alpha.txt": "alpha\n" }, 9, "0.10.0-alpha.1");
  tag(fx.up, "v0.10.0-alpha.1", alpha, 9);
  const dir = checkout(fx, "checkout");
  const oldTip = rev(fx.origin, BRANCH);

  const run = sync(dir);

  assert.equal(run.status, 0, run.output);
  assert.doesNotMatch(run.output, /error/);
  assertSynced(fx, oldTip, ["v0.10.0-beta.2", "v0.10.0"]);
  assert.ok(!isAncestor(fx.origin, alpha, BRANCH));
});

test("criteria 5, 9, 10: a rebrand commit is the tag's tree minus the delete list, renamed and formatted, with nothing from main", (t) => {
  const fx = makeFixture(t);
  const oldTip = rev(fx.origin, BRANCH);
  firstRun(fx);
  const [beta2, v0100] = assertSynced(fx, oldTip, ["v0.10.0-beta.2", "v0.10.0"]);

  assert.deepEqual(filesOf(fx.origin, v0100), [
    ".github/workflows/ci.yml",
    "PASEO-README.md",
    "packages/app/src/thing.paseo.test.ts",
    "packages/rambla-core/src/beta2.ts",
    "packages/rambla-core/src/rambla.ts",
    "version.txt",
  ]);
  assert.equal(
    git(fx.origin, ["show", `${v0100}:packages/rambla-core/src/rambla.ts`]),
    'export const ramblaName = "Rambla";',
  );
  assert.equal(git(fx.origin, ["show", `${v0100}:version.txt`]), "0.10.0");

  for (const rebrand of [beta2, v0100]) {
    const files = filesOf(fx.origin, rebrand);
    for (const file of deleteList) {
      assert.ok(!files.includes(file), `${file} is on the delete list`);
      assert.ok(!files.includes(upstreamName(file)), `${upstreamName(file)} is on the delete list`);
    }
    assert.ok(!files.includes("fork-only.txt"), "nothing from main");
    assert.ok(!files.includes("stale.txt"), "nothing from the old upstream-rebrand tree");
    for (const file of files.filter((f) => !rebrandSkip.test(f))) {
      assert.doesNotMatch(file, /paseo/i);
      assert.doesNotMatch(git(fx.origin, ["show", `${rebrand}:${file}`]), /paseo/i, file);
    }
  }
});

test("criterion 21: every rebrand commit's ci.yml runs CI on pushes to main only", (t) => {
  const fx = makeFixture(t);
  const oldTip = rev(fx.origin, BRANCH);
  firstRun(fx);

  for (const rebrand of assertSynced(fx, oldTip, ["v0.10.0-beta.2", "v0.10.0"])) {
    assert.match(
      git(fx.origin, ["show", `${rebrand}:.github/workflows/ci.yml`]),
      /^on:\n {2}push:\n {4}branches: \[main\]\n/m,
    );
  }
});

test("criteria 4, 17: an already-synced tag is skipped and a second run leaves origin unchanged", (t) => {
  const fx = makeFixture(t);
  firstRun(fx);
  const dir = checkout(fx, "second");
  const before = originBranches(fx);

  const run = sync(dir);

  assert.equal(run.status, 0, run.output);
  assert.equal(originBranches(fx), before);
  assert.equal(rev(dir, BRANCH), rev(fx.origin, BRANCH));
  assert.equal(worktreeCount(dir), 1);
});

test("criterion 4: a new release tag syncs on the next run, after the tags already there", (t) => {
  const fx = makeFixture(t);
  const synced = firstRun(fx);
  const v0110 = commit(fx.up, { "version.txt": "0.11.0\n" }, 9, "0.11.0");
  tag(fx.up, "v0.11.0", v0110, 9);

  const run = sync(checkout(fx, "second"));

  assert.equal(run.status, 0, run.output);
  assertSynced(fx, synced, ["v0.11.0"]);
});

test("criterion 4: an old release tag added upstream after a newer one was synced is skipped", (t) => {
  const fx = makeFixture(t);
  firstRun(fx);
  const late = commit(fx.up, { "late.txt": "late\n" }, 9, "late");
  tag(fx.up, "v0.10.0-rc.1", late, 9);
  const before = originBranches(fx);

  const run = sync(checkout(fx, "second"));

  assert.equal(run.status, 0, run.output);
  assert.equal(originBranches(fx), before);
});

test("criteria 4, 13: a higher release version dated before the newest synced tag fails the run, naming both", (t) => {
  const fx = makeFixture(t);
  firstRun(fx);
  // Lightweight, so its date is the date of the day-4 commit it points to.
  tag(fx.up, "v0.11.0", fx.c.untagged);
  const dir = checkout(fx, "second");
  const before = snapshot(fx, dir);

  const run = sync(dir);

  assert.notEqual(run.status, 0, run.output);
  assert.match(run.output, /v0\.11\.0/);
  assert.match(run.output, /v0\.10\.0\b/);
  assert.match(run.output, /2026-09-04/);
  assert.match(run.output, /2026-09-05/);
  assertNothingChanged(fx, dir, before);
});

test("criterion 4: within a major.minor version, a higher version tagged before a lower one fails the run, naming both", (t) => {
  const fx = makeFixture(t);
  firstRun(fx);
  const rc = commit(fx.up, { "rc.txt": "rc\n" }, 9, "rc");
  tag(fx.up, "v0.10.0-rc.1", rc, 9);
  const v0103 = commit(fx.up, { "version.txt": "0.10.3\n" }, 10, "0.10.3");
  tag(fx.up, "v0.10.3", v0103, 8);
  const dir = checkout(fx, "second");
  const before = snapshot(fx, dir);

  const run = sync(dir);

  assert.notEqual(run.status, 0, run.output);
  assert.match(run.output, /v0\.10\.3/);
  assert.match(run.output, /v0\.10\.0-rc\.1/);
  assert.match(run.output, /2026-09-08/);
  assert.match(run.output, /2026-09-09/);
  assertNothingChanged(fx, dir, before);
});

test("criterion 17: a stale local copy run after another copy synced and pushed fast-forwards and adds nothing", (t) => {
  const fx = makeFixture(t);
  const stale = checkout(fx, "stale");
  const staleTip = rev(stale, BRANCH);
  firstRun(fx);
  const before = originBranches(fx);

  const run = sync(stale);

  assert.equal(run.status, 0, run.output);
  assert.equal(originBranches(fx), before);
  assert.equal(rev(stale, BRANCH), rev(fx.origin, BRANCH));
  assert.ok(isAncestor(stale, staleTip, BRANCH), "a fast-forward");
});

test("criterion 17: local-only commits on upstream-rebrand are dropped for origin's copy", (t) => {
  const fx = makeFixture(t);
  const dir = checkout(fx, "checkout");
  const oldTip = rev(fx.origin, BRANCH);
  const localOnly = git(dir, ["commit-tree", "-p", BRANCH, "-m", "local only", `${BRANCH}^{tree}`]);
  git(dir, ["branch", "-f", BRANCH, localOnly]);

  const run = sync(dir);

  assert.equal(run.status, 0, run.output);
  assertSynced(fx, oldTip, ["v0.10.0-beta.2", "v0.10.0"]);
  assert.equal(rev(dir, BRANCH), rev(fx.origin, BRANCH));
  assert.ok(!isAncestor(dir, localOnly, BRANCH));
});

test("criteria 13, 17: origin changing between the run's fetch and its push fails the push and changes nothing", (t) => {
  const fx = makeFixture(t);
  const dir = checkout(fx, "checkout");
  const other = git(dir, ["commit-tree", "-p", BRANCH, "-m", "other writer", `${BRANCH}^{tree}`]);
  git(dir, ["push", "origin", `${other}:refs/heads/other-writer`]);
  // The hook fires after the run fetched and built, just before its push reaches origin.
  const hook = path.join(dir, ".git", "hooks", "pre-push");
  writeFileSync(
    hook,
    `#!/bin/sh\ngit --git-dir="${fx.origin}" update-ref refs/heads/${BRANCH} ${other}\n`,
  );
  chmodSync(hook, 0o755);
  const before = snapshot(fx, dir);

  const run = sync(dir);

  assert.notEqual(run.status, 0, run.output);
  assert.match(run.output, /\[remote rejected\]/);
  assert.equal(
    originBranches(fx),
    before.origin.replace(new RegExp(`(refs/heads/${BRANCH}) \\w+`), `$1 ${other}`),
  );
  assert.equal(rev(dir, BRANCH), before.local);
  assert.equal(worktreeCount(dir), 1);
});

test("criteria 13, 17: a failed fetch fails the run and changes nothing", (t) => {
  const fx = makeFixture(t);
  const dir = checkout(fx, "checkout");
  git(dir, ["remote", "set-url", "origin", path.join(fx.root, "missing.git")]);
  const before = snapshot(fx, dir);

  const run = sync(dir);

  assert.notEqual(run.status, 0, run.output);
  assert.match(run.output, /missing\.git/);
  assertNothingChanged(fx, dir, before);
});

test("criterion 17: uncommitted changes on the target branch stop the run, named, before anything moves", (t) => {
  const fx = makeFixture(t);
  const dir = checkout(fx, "checkout");
  firstRun(fx);
  const pusher = checkout(fx, "pusher");
  commit(pusher, { "later.txt": "later\n" }, 9, "later on target");
  git(pusher, ["push", "origin", TARGET]);
  writeFileSync(path.join(dir, "fork-only.txt"), "edited\n");
  const before = snapshot(fx, dir);

  const run = sync(dir);

  assert.notEqual(run.status, 0, run.output);
  assert.match(run.output, /fork-only\.txt/);
  assertNothingChanged(fx, dir, before);
});

test("criterion 17: commits on the target branch that origin lacks stop the run, named, before anything moves", (t) => {
  const fx = makeFixture(t);
  const dir = checkout(fx, "checkout");
  firstRun(fx);
  commit(dir, { "unpushed.txt": "mine\n" }, 9, "unpushed local work");
  const before = snapshot(fx, dir);

  const run = sync(dir);

  assert.notEqual(run.status, 0, run.output);
  assert.match(run.output, /unpushed local work/);
  assertNothingChanged(fx, dir, before);
});

test("criterion 17: the local target branch fast-forwards to origin's tip", (t) => {
  const fx = makeFixture(t);
  const dir = checkout(fx, "checkout");
  const pusher = checkout(fx, "pusher");
  commit(pusher, { "later.txt": "later\n" }, 9, "later on target");
  git(pusher, ["push", "origin", TARGET]);

  const run = sync(dir);

  assert.equal(run.status, 0, run.output);
  assert.equal(rev(dir, TARGET), rev(fx.origin, TARGET));
  assert.equal(rev(dir, "HEAD"), rev(fx.origin, TARGET));
});

test("criterion 13: an error while building rebrand commits leaves origin, local branches and worktrees as they were", (t) => {
  const fx = makeFixture(t);
  const dir = checkout(fx, "checkout");
  const bin = path.join(fx.root, "bin");
  mkdirSync(bin);
  writeFileSync(path.join(bin, "npm"), "#!/bin/sh\necho 'stand-in npm failing' >&2\nexit 1\n");
  chmodSync(path.join(bin, "npm"), 0o755);
  const before = snapshot(fx, dir);

  const run = sync(dir, { PATH: `${bin}${path.delimiter}${process.env.PATH}` });

  assert.notEqual(run.status, 0, run.output);
  assert.match(run.output, /stand-in npm failing/);
  assertNothingChanged(fx, dir, before);
});
