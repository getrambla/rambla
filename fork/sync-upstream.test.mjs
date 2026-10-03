import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildChangelog } from "./build-changelog.mjs";

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "sync-upstream.sh");
const repoRoot = path.resolve(path.dirname(script), "..");
// The stand-in npm hands the rebrand's formatting to the real npm.
const realNpm = execFileSync("sh", ["-c", "command -v npm"], { encoding: "utf8" }).trim();

const TARGET = "fix/sync-target";
const BRANCH = "upstream-rebrand";

// Criterion 7 allows "paseo" only under fork/rebrand.sh's skip paths.
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
// RAMBLA-FORK: fix: 2026-09-30-fix-eradicate-generated-blobs.md: lists the generated webview blobs the fork no longer tracks.
const blobPaths = [
  "packages/app/src/components/markdown/fence/mermaid/runtime/html.gen.ts",
  "packages/app/src/terminal/webview/terminal-emulator-webview-html.ts",
];
const deleteList = [...logoPaths, "nix/npm-deps.hash", ...blobPaths];
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
  // RAMBLA-FORK: fix: 2026-09-30-fix-eradicate-generated-blobs.md: real blobs are valid TypeScript, so the rebrand's formatter accepts them.
  ...Object.fromEntries(blobPaths.map((file) => [file, 'export const html = "upstream copy";\n'])),
};

const RAMBLA_CHANGELOG = `# Changelog

## Unreleased

### Added

- Added a fork thing

## 0.9.0 - 2026-09-01

### Added

- Added the fork
`;

/** Upstream's CHANGELOG.md with one Added entry per [version, day], newest first. */
function upstreamChangelog(...entries) {
  const lines = entries.flatMap(([version, n]) => [
    `## ${version} - ${day(n).slice(0, 10)}`,
    "",
    "### Added",
    "",
    `- Added the ${version} thing`,
    "",
  ]);
  return ["# Changelog", "", ...lines].join("\n");
}

// Criterion 18's list, written out apart from the script so a changed command fails a test.
const UNIT_ARGS = [
  "--",
  "--exclude",
  "**/*e2e*",
  "--exclude",
  "**/*integration*",
  "--exclude",
  "**/generic-acp-agent.commands.test.ts",
];
const LOCAL_CHECKS = [
  ["ci"],
  ["run", "build:server"],
  ["run", "build:app-deps"],
  ["run", "typecheck"],
  ["run", "test:unit", "--workspace=packages/server", ...UNIT_ARGS],
  ["run", "test:unit", "--workspace=packages/cli", ...UNIT_ARGS],
  ...["desktop", "client", "highlight", "plugin", "protocol", "relay"].map((pkg) =>
    ["run", "test", `--workspace=packages/${pkg}`].concat(UNIT_ARGS),
  ),
  ["run", "test", "--workspace=packages/app", ...UNIT_ARGS, "--project", "unit"],
];

/** The ci.yml jobs the stand-in gh reports, each with its conclusion; CI_JOBS overrides them. */
const CI_JOBS = {
  changes: "success",
  typecheck: "success",
  "server-tests-ubuntu": "success",
  "server-tests-windows": "skipped",
  "playwright (shard 1/4)": "success",
  "playwright (shard 2/4)": "success",
  "playwright (shard 3/4)": "success",
  "playwright (shard 4/4)": "success",
  "cli-tests (shard 1/3)": "success",
};

// Records each call, with where it ran; hands formatting to the real npm and fails the call named by NPM_FAIL.
const NPM_STANDIN = `#!/usr/bin/env node
const { appendFileSync } = require("node:fs");
const { execFileSync, spawnSync } = require("node:child_process");
const args = process.argv.slice(2);
const git = (a) => execFileSync("git", a, { encoding: "utf8" }).trim();
const call = { tool: "npm", args, cwd: process.cwd(), gitDir: git(["rev-parse", "--absolute-git-dir"]), head: git(["rev-parse", "HEAD"]) };
appendFileSync(process.env.CALL_LOG, JSON.stringify(call) + "\\n");
if (args[0] === "--prefix") process.exit(spawnSync(process.env.REAL_NPM, args, { stdio: "inherit" }).status ?? 1);
if (args.join(" ") === process.env.NPM_FAIL) {
  console.error("stand-in npm: " + args.join(" ") + " failed");
  process.exit(1);
}
console.log("stand-in npm: " + args.join(" "));
`;

// Records each call and answers run list, watch and view through the caller's own --jq filter; GH_ON_WATCH runs during the watch.
const GH_STANDIN = `#!/usr/bin/env node
const { appendFileSync } = require("node:fs");
const { execSync, spawnSync } = require("node:child_process");
const args = process.argv.slice(2);
appendFileSync(process.env.CALL_LOG, JSON.stringify({ tool: "gh", args }) + "\\n");
function jq(data) {
  const filter = args[args.indexOf("--jq") + 1];
  const result = spawnSync("jq", ["-r", filter], { input: JSON.stringify(data), stdio: ["pipe", "inherit", "inherit"] });
  process.exit(result.status ?? 1);
}
const command = args.slice(0, 2).join(" ");
if (command === "run list") {
  jq([{ databaseId: 4242 }]);
} else if (command === "run watch") {
  if (process.env.GH_ON_WATCH) execSync(process.env.GH_ON_WATCH, { stdio: "inherit" });
  console.log("stand-in gh: run 4242 completed");
} else if (command === "run view") {
  const conclusions = { ...${JSON.stringify(CI_JOBS)}, ...JSON.parse(process.env.CI_JOBS || "{}") };
  jq({ jobs: Object.entries(conclusions).map(([name, conclusion]) => ({ name, conclusion })) });
} else {
  console.error("stand-in gh: unexpected call: " + args.join(" "));
  process.exit(1);
}
`;

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

/** Builds a fixture upstream, an origin holding main, the target branch and an old-style upstream-rebrand, plus the stand-in npm and gh; asserts main never moves (criteria 1, 13). */
function makeFixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), "sync-upstream-test-"));
  let main;
  t.after(() => {
    try {
      if (main) assert.equal(rev(origin, "main"), main, "main never moves");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  const standins = path.join(root, "standins");
  mkdirSync(standins);
  for (const [name, source] of [
    ["npm", NPM_STANDIN],
    ["gh", GH_STANDIN],
  ]) {
    writeFileSync(path.join(standins, name), source);
    chmodSync(path.join(standins, name), 0o755);
  }
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
      "CHANGELOG.md": upstreamChangelog(["0.10.0-beta.2", 3]),
    },
    3,
    "0.10.0-beta.2",
  );
  tag(up, "v0.10.0-beta.2", c.beta2, 3);
  c.untagged = commit(up, { "version.txt": "between\n" }, 4, "untagged");
  c.v0100 = commit(
    up,
    {
      "version.txt": "0.10.0\n",
      "CHANGELOG.md": upstreamChangelog(["0.10.0", 5], ["0.10.0-beta.2", 3]),
    },
    5,
    "0.10.0",
  );
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
  // The changelog builder and its inputs, as main carries them; main's copy of the nix hash differs from upstream's.
  const forkFiles = {
    "fork-only.txt": "ours\n",
    "nix/npm-deps.hash": "main-hash\n",
    "RAMBLA-CHANGELOG.md": RAMBLA_CHANGELOG,
    "CHANGELOG.md": "# Changelog\n",
    ...Object.fromEntries(
      ["fork/build-changelog.mjs", "scripts/changelog-utils.mjs", "scripts/is-main-module.mjs"].map(
        (file) => [file, readFileSync(path.join(repoRoot, file), "utf8")],
      ),
    ),
  };
  commit(seed, forkFiles, 5, "fork change");
  git(root, ["init", "--bare", "-b", "main", origin]);
  git(seed, ["push", origin, `${BRANCH}:${BRANCH}`, "fork-main:main", `fork-main:${TARGET}`]);
  main = rev(origin, "main");

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

let runs = 0;

/** Runs the sync script in a checkout with the stand-in npm and gh first on PATH; returns its exit status, combined output, and every stand-in call in order. */
function sync(dir, env = {}) {
  const root = path.dirname(dir);
  runs += 1;
  const log = path.join(root, `calls-${runs}.jsonl`);
  writeFileSync(log, "");
  const result = spawnSync("bash", [script], {
    cwd: dir,
    env: {
      ...gitEnv,
      PATH: `${path.join(root, "standins")}${path.delimiter}${process.env.PATH}`,
      REAL_NPM: realNpm,
      CALL_LOG: log,
      ...env,
    },
    encoding: "utf8",
  });
  const calls = readFileSync(log, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  return {
    status: result.status,
    output: `${result.stdout}${result.stderr}`,
    calls,
    npm: calls.filter((call) => call.tool === "npm"),
    gh: calls.filter((call) => call.tool === "gh"),
  };
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

/** Commits files on an upstream side branch cut at `from`, tags the commit on tagDay (default: the commit's day), and returns the commit. */
function sideTag(fx, branch, from, name, files, n, tagDay = n) {
  git(fx.up, ["checkout", "-B", branch, from]);
  const sha = commit(fx.up, files, n, name);
  tag(fx.up, name, sha, tagDay);
  git(fx.up, ["checkout", "main"]);
  return sha;
}

/** Adds side-branch tag v0.10.2 on release/0.10, built on side-branch tag v0.10.1 and changing a paseo-named file, tagged on tagDay. */
function addV0102(fx, tagDay = 9) {
  const files = {
    "version.txt": "0.10.2\n",
    "packages/paseo-core/src/paseo.ts": 'export const paseoName  =  "Paseo 0.10.2"\n',
  };
  return sideTag(fx, "release/0.10", fx.c.hotfix, "v0.10.2", files, 9, tagDay);
}

/** Every branch name in repo, sorted. */
function branchNames(repo) {
  return git(repo, ["for-each-ref", "--format=%(refname:strip=2)", "refs/heads"]).split("\n");
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
  assert.ok(!isAncestor(fx.origin, fx.c.hotfix, BRANCH), "a side-branch tag never lands");
  assert.equal(rev(fx.origin, "main"), main);
  assert.equal(rev(dir, BRANCH), rev(fx.origin, BRANCH));
  assert.equal(worktreeCount(dir), 1);
});

test("criterion 2: a beta tag on a side branch is a side-branch tag and never lands on upstream-rebrand", (t) => {
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

test("criteria 5, 6, 7: a rebrand commit is the tag's tree minus the delete list, renamed and formatted, with nothing from main", (t) => {
  const fx = makeFixture(t);
  const oldTip = rev(fx.origin, BRANCH);
  firstRun(fx);
  const [beta2, v0100] = assertSynced(fx, oldTip, ["v0.10.0-beta.2", "v0.10.0"]);

  assert.deepEqual(filesOf(fx.origin, v0100), [
    ".github/workflows/ci.yml",
    "PASEO-CHANGELOG.md",
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

test("criterion 17: every rebrand commit's ci.yml runs CI on pushes to main only", (t) => {
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

test("criteria 4, 14: an already-synced tag is skipped and a second run leaves origin unchanged", (t) => {
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

test("criteria 4, 10: a higher release version dated before the newest synced tag fails the run, naming both", (t) => {
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

test("criterion 4: a release tag at or below the newest synced tag is never checked against the tags a run syncs", (t) => {
  const fx = makeFixture(t);
  const synced = firstRun(fx);
  // Tagged after v0.10.3, a higher version of the same major.minor, so checking it would fail the run.
  const rc = commit(fx.up, { "rc.txt": "rc\n" }, 9, "rc");
  tag(fx.up, "v0.10.0-rc.1", rc, 9);
  const v0103 = commit(fx.up, { "version.txt": "0.10.3\n" }, 10, "0.10.3");
  tag(fx.up, "v0.10.3", v0103, 8);

  const run = sync(checkout(fx, "second"));

  assert.equal(run.status, 0, run.output);
  assert.doesNotMatch(run.output, /error/);
  assertSynced(fx, synced, ["v0.10.3"]);
});

test("criterion 14: a stale local copy run after another copy synced and pushed fast-forwards and adds nothing", (t) => {
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

test("criterion 14: local-only commits on upstream-rebrand are dropped for origin's copy", (t) => {
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

test("criteria 10, 14: origin changing between the run's fetch and its push fails the push and changes nothing", (t) => {
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

test("criteria 10, 14: a failed fetch fails the run and changes nothing", (t) => {
  const fx = makeFixture(t);
  const dir = checkout(fx, "checkout");
  git(dir, ["remote", "set-url", "origin", path.join(fx.root, "missing.git")]);
  const before = snapshot(fx, dir);

  const run = sync(dir);

  assert.notEqual(run.status, 0, run.output);
  assert.match(run.output, /missing\.git/);
  assertNothingChanged(fx, dir, before);
});

test("criterion 14: uncommitted changes on the target branch stop the run, named, before anything moves", (t) => {
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

test("criterion 14: commits on the target branch that origin lacks stop the run, named, before anything moves", (t) => {
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

test("criterion 14: the local target branch fast-forwards to origin's tip", (t) => {
  const fx = makeFixture(t);
  const dir = checkout(fx, "checkout");
  const pusher = checkout(fx, "pusher");
  commit(pusher, { "later.txt": "later\n" }, 9, "later on target");
  git(pusher, ["push", "origin", TARGET]);
  const pushed = rev(fx.origin, TARGET);

  const run = sync(dir);

  assert.equal(run.status, 0, run.output);
  assert.equal(rev(dir, TARGET), pushed);
  assert.equal(rev(dir, "HEAD"), pushed);
});

test("criterion 10: an error while building rebrand commits leaves origin, local branches and worktrees as they were", (t) => {
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

test("criteria 2, 3: tags on upstream side branches, like v0.10.1 and v0.10.2, get no branch, no rebrand commit and no error", (t) => {
  const fx = makeFixture(t);
  const v0102 = addV0102(fx);
  const dir = checkout(fx, "checkout");
  const oldTip = rev(fx.origin, BRANCH);

  const run = sync(dir);

  assert.equal(run.status, 0, run.output);
  assert.doesNotMatch(run.output, /error/);
  assertSynced(fx, oldTip, ["v0.10.0-beta.2", "v0.10.0"]);
  for (const side of [fx.c.hotfix, v0102, fx.c.sideBeta]) {
    assert.ok(!isAncestor(fx.origin, side, BRANCH));
  }
  assert.deepEqual(branchNames(fx.origin), [TARGET, "main", BRANCH]);
  assert.deepEqual(branchNames(dir), [TARGET, BRANCH]);
});

test("criteria 2, 4: a side-branch tag dated out of order with a release tag of the same major.minor causes no error", (t) => {
  const fx = makeFixture(t);
  // Tagged before v0.10.0 and v0.10.1, both lower versions.
  addV0102(fx, 4);
  const oldTip = rev(fx.origin, BRANCH);

  const first = sync(checkout(fx, "first"));

  assert.equal(first.status, 0, first.output);
  assert.doesNotMatch(first.output, /error/);
  const [, v0100] = assertSynced(fx, oldTip, ["v0.10.0-beta.2", "v0.10.0"]);

  const v0103 = commit(fx.up, { "version.txt": "0.10.3\n" }, 10, "0.10.3");
  tag(fx.up, "v0.10.3", v0103, 10);
  const dir = checkout(fx, "second");

  const second = sync(dir);

  assert.equal(second.status, 0, second.output);
  assert.doesNotMatch(second.output, /error/);
  assertSynced(fx, v0100, ["v0.10.3"]);
  assert.deepEqual(branchNames(fx.origin), [TARGET, "main", BRANCH]);
  assert.deepEqual(branchNames(dir), [TARGET, BRANCH]);
});

test("criteria 4, 10: among the release tags one run syncs, a higher version tagged before a lower one fails the run, naming both", (t) => {
  const fx = makeFixture(t);
  // Different major.minor versions, so only the rule across one run's tags can catch it.
  const v0110 = commit(fx.up, { "version.txt": "0.11.0\n" }, 9, "0.11.0");
  tag(fx.up, "v0.11.0", v0110, 10);
  const v0120 = commit(fx.up, { "version.txt": "0.12.0\n" }, 11, "0.12.0");
  tag(fx.up, "v0.12.0", v0120, 9);
  const dir = checkout(fx, "checkout");
  const before = snapshot(fx, dir);

  const run = sync(dir);

  assert.notEqual(run.status, 0, run.output);
  assert.match(run.output, /v0\.12\.0 \(version 0\.12\.0, tagged 2026-09-09/);
  assert.match(run.output, /v0\.11\.0 \(version 0\.11\.0, tagged 2026-09-10/);
  assertNothingChanged(fx, dir, before);
});

/** A file's exact content at a commit. */
function show(repo, sha, file) {
  return execFileSync("git", ["show", `${sha}:${file}`], {
    cwd: repo,
    env: gitEnv,
    encoding: "utf8",
  });
}

/** Commits files on the target branch in a fresh checkout and pushes them; returns the checkout, level with origin. */
function pushToTarget(fx, name, files, n) {
  const dir = checkout(fx, name);
  commit(dir, files, n, `${name} on ${TARGET}`);
  git(dir, ["push", "origin", TARGET]);
  return dir;
}

/** Commits files on upstream main and tags the commit as a release on the given day. */
function release(fx, name, files, n) {
  const sha = commit(fx.up, files, n, name);
  tag(fx.up, name, sha, n);
  return sha;
}

/** The ci.yml runs a sync looked up, in order, as { workflow, branch, commit }. */
function ciLookups(run) {
  const opt = (args, name) => args[args.indexOf(name) + 1];
  return run.gh
    .filter(({ args }) => args[0] === "run" && args[1] === "list")
    .map(({ args }) => ({
      workflow: opt(args, "--workflow"),
      branch: opt(args, "--branch"),
      commit: opt(args, "--commit"),
    }));
}

/** Every npm call but the rebrand's formatting: the local checks. */
function checkCalls(run) {
  return run.npm.filter(({ args }) => args[0] !== "--prefix");
}

/** The merge branches in a repo. */
function mergeBranches(repo) {
  return branchNames(repo).filter((name) => name.startsWith("merge-"));
}

/** Makes the target branch rewrite rambla.ts and tags an upstream release rewriting it too, so merging that release conflicts; returns the checkout. */
function conflictingRelease(fx, name, n) {
  const ours = pushToTarget(
    fx,
    "ours",
    { "packages/rambla-core/src/rambla.ts": 'export const ramblaName = "Ours";\n' },
    n,
  );
  release(
    fx,
    name,
    { "packages/paseo-core/src/paseo.ts": 'export const paseoName = "Theirs";\n' },
    n + 1,
  );
  return ours;
}

test("criteria 8, 11: each release tag the target branch lacks lands through its own merge branch, oldest first, as a fast-forward once ci.yml passes", (t) => {
  const fx = makeFixture(t);
  const dir = checkout(fx, "checkout");
  const oldTip = rev(fx.origin, BRANCH);
  const before = rev(fx.origin, TARGET);

  const run = sync(dir);

  assert.equal(run.status, 0, run.output);
  const [beta2, v0100] = assertSynced(fx, oldTip, ["v0.10.0-beta.2", "v0.10.0"]);
  const second = rev(fx.origin, TARGET);
  const first = parents(fx.origin, second)[0];
  // Each merge takes only its own tag's rebrand commit, on the target branch's tip once the tag before it landed.
  assert.deepEqual(parents(fx.origin, first), [before, beta2]);
  assert.deepEqual(parents(fx.origin, second), [first, v0100]);
  // The target branch's new tips are the very commits ci.yml ran on: fast-forwards, no merge commit of its own.
  assert.deepEqual(ciLookups(run), [
    { workflow: "ci.yml", branch: "merge-v0.10.0-beta.2", commit: first },
    { workflow: "ci.yml", branch: "merge-v0.10.0", commit: second },
  ]);
  assert.match(run.output, /stand-in gh: run 4242 completed/);
  assert.deepEqual(mergeBranches(fx.origin), []);
  assert.deepEqual(mergeBranches(dir), []);
  assert.equal(rev(dir, TARGET), before, "the local target branch is not touched");
  assert.equal(rev(dir, BRANCH), rev(fx.origin, BRANCH));
  assert.equal(worktreeCount(dir), 1);
});

test("criterion 8: the merge keeps the target branch's delete-list files, whether main changed them or they match upstream-rebrand", (t) => {
  const fx = makeFixture(t);
  firstRun(fx);
  const landed = rev(fx.origin, TARGET);

  // The logos on main match the old upstream-rebrand's; main changed the nix hash.
  for (const file of logoPaths) {
    assert.equal(show(fx.origin, landed, upstreamName(file)), "upstream copy\n", file);
  }
  assert.equal(show(fx.origin, landed, "nix/npm-deps.hash"), "main-hash\n");

  const ours = pushToTarget(fx, "ours", { "nix/npm-deps.hash": "main-hash-2\n" }, 9);
  release(
    fx,
    "v0.11.0",
    { "nix/npm-deps.hash": "upstream-hash-2\n", "version.txt": "0.11.0\n" },
    10,
  );

  const run = sync(ours);

  assert.equal(run.status, 0, run.output);
  const tip = rev(fx.origin, TARGET);
  assert.equal(show(fx.origin, tip, "version.txt"), "0.11.0\n");
  assert.equal(show(fx.origin, tip, "nix/npm-deps.hash"), "main-hash-2\n");
});

// RAMBLA-FORK: fix: 2026-09-30-fix-eradicate-generated-blobs.md: an upstream tag modifying the removed blobs lands clean.
test("a release tag modifying the generated webview blobs main removed lands with no conflict, and neither blob is tracked afterward", (t) => {
  const fx = makeFixture(t);
  firstRun(fx);
  const ours = pushToTarget(
    fx,
    "ours",
    Object.fromEntries(blobPaths.map((file) => [file, null])),
    9,
  );
  release(
    fx,
    "v0.11.0",
    {
      ...Object.fromEntries(
        blobPaths.map((file) => [file, 'export const html = "upstream copy 2";\n']),
      ),
      "version.txt": "0.11.0\n",
    },
    10,
  );

  const run = sync(ours);

  assert.equal(run.status, 0, run.output);
  assert.doesNotMatch(run.output, /CONFLICT/);
  const tip = rev(fx.origin, TARGET);
  assert.equal(show(fx.origin, tip, "version.txt"), "0.11.0\n");
  const files = filesOf(fx.origin, tip);
  for (const file of blobPaths) assert.ok(!files.includes(file), `${file} is not tracked`);
});

test("criterion 8: each merge regenerates CHANGELOG.md with fork/build-changelog.mjs", (t) => {
  const fx = makeFixture(t);
  firstRun(fx);
  const second = rev(fx.origin, TARGET);
  const first = parents(fx.origin, second)[0];

  for (const sha of [first, second]) {
    assert.equal(
      show(fx.origin, sha, "CHANGELOG.md"),
      buildChangelog(
        show(fx.origin, sha, "RAMBLA-CHANGELOG.md"),
        show(fx.origin, sha, "PASEO-CHANGELOG.md"),
      ),
    );
  }
  assert.match(show(fx.origin, first, "CHANGELOG.md"), /Added the 0\.10\.0-beta\.2 thing/);
  assert.doesNotMatch(show(fx.origin, first, "CHANGELOG.md"), /Added the 0\.10\.0 thing/);
  assert.match(show(fx.origin, second, "CHANGELOG.md"), /Added the 0\.10\.0 thing/);
});

test("criterion 9: with every release tag synced and landed, a run changes nothing, makes no merge branch and exits 0", (t) => {
  const fx = makeFixture(t);
  firstRun(fx);
  const dir = checkout(fx, "second");
  const before = originBranches(fx);

  const run = sync(dir);

  assert.equal(run.status, 0, run.output);
  assert.equal(originBranches(fx), before);
  assert.deepEqual(run.gh, []);
  assert.deepEqual(run.npm, []);
  assert.deepEqual(mergeBranches(dir), []);
  assert.equal(rev(dir, TARGET), rev(fx.origin, TARGET));
  assert.equal(rev(dir, BRANCH), rev(fx.origin, BRANCH));
  assert.equal(worktreeCount(dir), 1);
});

test("criteria 10, 16: a conflict stops the run listing its paths; upstream-rebrand is pushed, the merge branch is deleted unpushed, the target branch is unchanged", (t) => {
  const fx = makeFixture(t);
  const synced = firstRun(fx);
  const ours = conflictingRelease(fx, "v0.11.0", 9);
  const target = rev(fx.origin, TARGET);

  const run = sync(ours);

  assert.notEqual(run.status, 0, run.output);
  assert.match(run.output, /CONFLICT \(content\)/, "git's own output is shown");
  assert.match(run.output, /merge-v0\.11\.0/);
  assert.match(run.output, /^packages\/rambla-core\/src\/rambla\.ts$/m);
  assertSynced(fx, synced, ["v0.11.0"]);
  assert.equal(rev(ours, BRANCH), rev(fx.origin, BRANCH));
  assert.equal(rev(fx.origin, TARGET), target);
  assert.equal(rev(ours, TARGET), target);
  assert.deepEqual(mergeBranches(fx.origin), []);
  assert.deepEqual(mergeBranches(ours), []);
  assert.deepEqual(run.gh, []);
  assert.deepEqual(checkCalls(run), []);
  assert.equal(worktreeCount(ours), 1);
});

test("criterion 10: upstream deleting a file main changed is a conflict, listed", (t) => {
  const fx = makeFixture(t);
  firstRun(fx);
  const ours = pushToTarget(
    fx,
    "ours",
    { "packages/rambla-core/src/beta2.ts": "export const beta = 3;\n" },
    9,
  );
  release(
    fx,
    "v0.11.0",
    { "packages/paseo-core/src/beta2.ts": null, "version.txt": "0.11.0\n" },
    10,
  );
  const target = rev(fx.origin, TARGET);

  const run = sync(ours);

  assert.notEqual(run.status, 0, run.output);
  assert.match(run.output, /CONFLICT \(modify\/delete\)/);
  assert.match(run.output, /^packages\/rambla-core\/src\/beta2\.ts$/m);
  assert.equal(rev(fx.origin, TARGET), target);
  assert.deepEqual(mergeBranches(fx.origin), []);
  assert.equal(worktreeCount(ours), 1);
});

test("criteria 8, 10: of two new release tags, the first lands and the second conflicts; the first stays landed and each got its own merge branch", (t) => {
  const fx = makeFixture(t);
  const synced = firstRun(fx);
  const ours = pushToTarget(
    fx,
    "ours",
    { "packages/rambla-core/src/rambla.ts": 'export const ramblaName = "Ours";\n' },
    9,
  );
  release(fx, "v0.11.0", { "version.txt": "0.11.0\n" }, 10);
  release(
    fx,
    "v0.12.0",
    { "packages/paseo-core/src/paseo.ts": 'export const paseoName = "Theirs";\n' },
    11,
  );
  const before = rev(fx.origin, TARGET);

  const run = sync(ours);

  assert.notEqual(run.status, 0, run.output);
  const [v0110] = assertSynced(fx, synced, ["v0.11.0", "v0.12.0"]);
  const landed = rev(fx.origin, TARGET);
  assert.deepEqual(parents(fx.origin, landed), [before, v0110]);
  assert.deepEqual(ciLookups(run), [
    { workflow: "ci.yml", branch: "merge-v0.11.0", commit: landed },
  ]);
  assert.match(run.output, /merge-v0\.12\.0/);
  assert.match(run.output, /^packages\/rambla-core\/src\/rambla\.ts$/m);
  assert.deepEqual(
    checkCalls(run).map(({ head }) => head),
    LOCAL_CHECKS.map(() => landed),
  );
  assert.deepEqual(mergeBranches(fx.origin), []);
  assert.deepEqual(mergeBranches(ours), []);
  assert.equal(worktreeCount(ours), 1);
});

test("criteria 10, 16, 18: a failing local check stops the run naming it; the merge branch is pushed and left on origin, upstream-rebrand is pushed, the target branch is unchanged", (t) => {
  const fx = makeFixture(t);
  const dir = checkout(fx, "checkout");
  const oldTip = rev(fx.origin, BRANCH);
  const target = rev(fx.origin, TARGET);

  const run = sync(dir, { NPM_FAIL: "run typecheck" });

  assert.notEqual(run.status, 0, run.output);
  assert.match(run.output, /stand-in npm: run typecheck failed/, "the check's own output is shown");
  assert.match(run.output, /^error: .*npm run typecheck.*merge-v0\.10\.0-beta\.2 .*on origin/m);
  const checks = checkCalls(run);
  assert.deepEqual(
    checks.map(({ args }) => args),
    LOCAL_CHECKS.slice(0, 4),
  );
  const [beta2] = assertSynced(fx, oldTip, ["v0.10.0-beta.2", "v0.10.0"]);
  // The branch left on origin is the very merge the checks ran on.
  assert.deepEqual(mergeBranches(fx.origin), ["merge-v0.10.0-beta.2"]);
  const left = rev(fx.origin, "merge-v0.10.0-beta.2");
  assert.deepEqual(parents(fx.origin, left), [target, beta2]);
  for (const call of checks) assert.equal(call.head, left);
  assert.equal(rev(fx.origin, TARGET), target);
  assert.equal(rev(dir, TARGET), target);
  assert.deepEqual(mergeBranches(dir), []);
  assert.deepEqual(run.gh, []);
  assert.equal(worktreeCount(dir), 1);
});

test("criteria 10, 11: a re-run after the merge branch a failing local check left is fixed on origin uses that branch and lands it", (t) => {
  const fx = makeFixture(t);
  const dir = checkout(fx, "checkout");
  const stopped = sync(dir, { NPM_FAIL: "run typecheck" });
  assert.notEqual(stopped.status, 0, stopped.output);
  const hand = checkout(fx, "hand");
  git(hand, ["checkout", "-b", "merge-v0.10.0-beta.2", "origin/merge-v0.10.0-beta.2"]);
  const fixed = commit(hand, { "fix.txt": "fixed by hand\n" }, 9, "fix the typecheck");
  git(hand, ["push", "origin", "merge-v0.10.0-beta.2"]);

  const run = sync(dir);

  assert.equal(run.status, 0, run.output);
  const tip = rev(fx.origin, TARGET);
  assert.deepEqual(ciLookups(run), [
    { workflow: "ci.yml", branch: "merge-v0.10.0-beta.2", commit: fixed },
    { workflow: "ci.yml", branch: "merge-v0.10.0", commit: tip },
  ]);
  assert.equal(parents(fx.origin, tip)[0], fixed);
  // Only v0.10.0's fresh merge runs the local checks; the fixed branch goes straight to ci.yml.
  assert.deepEqual(
    checkCalls(run).map(({ args, head }) => [args, head]),
    LOCAL_CHECKS.map((args) => [args, tip]),
  );
  assert.deepEqual(mergeBranches(fx.origin), []);
  assert.equal(worktreeCount(dir), 1);
});

test("criterion 18: the local checks run in the temporary worktree, in order, after each clean merge and before ci.yml is looked up", (t) => {
  const fx = makeFixture(t);
  const dir = checkout(fx, "checkout");

  const run = sync(dir);

  assert.equal(run.status, 0, run.output);
  const second = rev(fx.origin, TARGET);
  const first = parents(fx.origin, second)[0];
  const [format1, format2, ...checks] = run.npm;
  for (const call of [format1, format2]) {
    assert.deepEqual([call.args[0], ...call.args.slice(2, 4)], ["--prefix", "run", "format:files"]);
  }
  assert.deepEqual(
    checks.map(({ args }) => args),
    [...LOCAL_CHECKS, ...LOCAL_CHECKS],
  );
  const worktrees = `${path.join(realpathSync(dir), ".git", "worktrees")}${path.sep}`;
  checks.forEach((call, i) => {
    assert.ok(call.gitDir.startsWith(worktrees), call.gitDir);
    assert.ok(!existsSync(call.cwd), `${call.cwd} is removed after the run`);
    assert.equal(call.head, i < LOCAL_CHECKS.length ? first : second);
  });
  // Each merge's checks all come before its ci.yml lookup, which follows its push.
  const order = run.calls.map((call) => (call.tool === "npm" ? call.head : call.args[1]));
  assert.ok(order.lastIndexOf(first) < order.indexOf("list"));
  assert.ok(order.lastIndexOf(second) < order.lastIndexOf("list"));
});

test("criterion 18: no test file named e2e or integration runs or is passed to a test run, and no end-to-end, integration, browser or Playwright script runs", (t) => {
  const fx = makeFixture(t);

  const run = sync(checkout(fx, "checkout"));

  assert.equal(run.status, 0, run.output);
  const testRuns = checkCalls(run).filter(
    ({ args }) => args[0] === "run" && args[1].startsWith("test"),
  );
  assert.equal(testRuns.length, 2 * 9);
  for (const { args } of checkCalls(run)) {
    assert.ok(
      ["ci", "build:server", "build:app-deps", "typecheck", "test", "test:unit"].includes(
        args[1] ?? args[0],
      ),
      args.join(" "),
    );
    assert.doesNotMatch(args.join(" "), /playwright|browser|test:e2e|test:integration/);
    args.forEach((arg, i) => {
      if (/e2e|integration/.test(arg)) assert.equal(args[i - 1], "--exclude", arg);
    });
  }
  for (const { args } of testRuns) {
    const excluded = args.filter((_, i) => args[i - 1] === "--exclude");
    const willRun = (file) => !excluded.some((glob) => path.matchesGlob(file, glob));
    for (const file of [
      "src/server/daemon.e2e.test.ts",
      "src/db.integration.test.ts",
      "tests/e2e.test.ts",
      "src/terminal-integration.test.ts",
    ]) {
      assert.ok(!willRun(file), `${file} must not run: ${args.join(" ")}`);
    }
    assert.ok(willRun("src/server/session.test.ts"), args.join(" "));
  }
});

test("criterion 18: RUN_LOCAL_CHECKS set to 0 or false skips the local checks", (t) => {
  for (const value of ["0", "false"]) {
    const fx = makeFixture(t);

    const run = sync(checkout(fx, "checkout"), { RUN_LOCAL_CHECKS: value });

    assert.equal(run.status, 0, run.output);
    assert.deepEqual(checkCalls(run), [], value);
    assert.equal(ciLookups(run).length, 2, value);
    assert.deepEqual(mergeBranches(fx.origin), [], value);
  }
});

test("criterion 11: a merge branch already on origin, fixed by hand after a stop, is used instead of a new one", (t) => {
  const fx = makeFixture(t);
  const synced = firstRun(fx);
  const ours = conflictingRelease(fx, "v0.11.0", 9);
  const stopped = sync(ours);
  assert.notEqual(stopped.status, 0, stopped.output);
  const [v0110] = assertSynced(fx, synced, ["v0.11.0"]);
  const hand = checkout(fx, "hand");
  git(hand, ["checkout", "-b", "merge-v0.11.0"]);
  git(hand, ["merge", "-X", "ours", "--no-edit", v0110]);
  git(hand, ["push", "origin", "merge-v0.11.0"]);
  const fixed = rev(hand, "merge-v0.11.0");

  const run = sync(ours);

  assert.equal(run.status, 0, run.output);
  assert.deepEqual(checkCalls(run), []);
  assert.deepEqual(ciLookups(run), [
    { workflow: "ci.yml", branch: "merge-v0.11.0", commit: fixed },
  ]);
  assert.equal(rev(fx.origin, TARGET), fixed);
  assert.deepEqual(mergeBranches(fx.origin), []);
  assert.equal(worktreeCount(ours), 1);
});

test("criterion 11: a merge- branch for an older tag on origin stops the merge step with an error naming it, while upstream-rebrand still syncs", (t) => {
  const fx = makeFixture(t);
  const synced = firstRun(fx);
  const dir = checkout(fx, "checkout");
  git(dir, ["push", "origin", `${TARGET}:refs/heads/merge-v0.10.0`]);
  const stray = rev(fx.origin, "merge-v0.10.0");
  release(fx, "v0.11.0", { "version.txt": "0.11.0\n" }, 10);
  const target = rev(fx.origin, TARGET);

  const run = sync(dir);

  assert.notEqual(run.status, 0, run.output);
  assert.match(
    run.output,
    /^error: merge-v0\.10\.0 .*must land in fix\/sync-target or be deleted first/m,
  );
  assertSynced(fx, synced, ["v0.11.0"]);
  assert.equal(rev(fx.origin, TARGET), target);
  assert.deepEqual(mergeBranches(fx.origin), ["merge-v0.10.0"]);
  assert.equal(rev(fx.origin, "merge-v0.10.0"), stray);
  assert.deepEqual(run.gh, []);
  assert.deepEqual(checkCalls(run), []);
  assert.equal(worktreeCount(dir), 1);
});

test("criteria 11, 16: a failing ci.yml job stops the run naming it and leaves the merge branch and the target branch", (t) => {
  const fx = makeFixture(t);
  const dir = checkout(fx, "checkout");
  const target = rev(fx.origin, TARGET);

  const run = sync(dir, { CI_JOBS: JSON.stringify({ "server-tests-ubuntu": "failure" }) });

  assert.notEqual(run.status, 0, run.output);
  assert.match(run.output, /stand-in gh: run 4242 completed/, "gh's own output is shown");
  assert.match(run.output, /^server-tests-ubuntu$/m);
  const lookups = ciLookups(run);
  assert.equal(lookups.length, 1);
  assert.deepEqual(mergeBranches(fx.origin), ["merge-v0.10.0-beta.2"]);
  assert.equal(rev(fx.origin, "merge-v0.10.0-beta.2"), lookups[0].commit);
  assert.equal(rev(fx.origin, TARGET), target);
  assert.equal(worktreeCount(dir), 1);
});

test("criterion 11: the target branch moving during the ci.yml wait stops the run naming both tips, with no fast-forward and the merge branch left", (t) => {
  const fx = makeFixture(t);
  const dir = checkout(fx, "checkout");
  const pusher = checkout(fx, "pusher");
  const moved = commit(pusher, { "later.txt": "later\n" }, 9, "later on target");

  const run = sync(dir, { GH_ON_WATCH: `git -C '${pusher}' push origin ${TARGET}` });

  assert.notEqual(run.status, 0, run.output);
  const [lookup] = ciLookups(run);
  assert.match(run.output, new RegExp(`^error: .*${moved}.*${lookup.commit}`, "m"));
  assert.equal(rev(fx.origin, TARGET), moved);
  assert.deepEqual(mergeBranches(fx.origin), ["merge-v0.10.0-beta.2"]);
  assert.equal(rev(fx.origin, "merge-v0.10.0-beta.2"), lookup.commit);
  assert.equal(worktreeCount(dir), 1);
});

test("criterion 11: a Playwright-only failure lands while IGNORE_PLAYWRIGHT_TESTS is on, its default, and stops the run when it is false or 0", (t) => {
  const jobs = JSON.stringify({ "playwright (shard 2/4)": "failure" });
  for (const env of [{}, { IGNORE_PLAYWRIGHT_TESTS: "1" }]) {
    const fx = makeFixture(t);

    const run = sync(checkout(fx, "checkout"), { CI_JOBS: jobs, ...env });

    assert.equal(run.status, 0, run.output);
    assert.equal(ciLookups(run).length, 2);
    assert.deepEqual(mergeBranches(fx.origin), []);
  }
  for (const value of ["false", "0"]) {
    const fx = makeFixture(t);
    const target = rev(fx.origin, TARGET);

    const run = sync(checkout(fx, "checkout"), { CI_JOBS: jobs, IGNORE_PLAYWRIGHT_TESTS: value });

    assert.notEqual(run.status, 0, run.output);
    assert.match(run.output, /^playwright \(shard 2\/4\)$/m, value);
    assert.deepEqual(mergeBranches(fx.origin), ["merge-v0.10.0-beta.2"], value);
    assert.equal(rev(fx.origin, TARGET), target, value);
  }
});

test("criteria 11, 16: the script never hides or swallows output, never turns on git tracing, never force-pushes, and needs no ImageMagick or librsvg", () => {
  const source = readFileSync(script, "utf8");

  assert.doesNotMatch(source, /\/dev\/null/);
  assert.doesNotMatch(source, /(^|\s)(-q|--quiet|--silent)(\s|$)/m);
  assert.doesNotMatch(source, /\|\|\s*true|2>&1|&>|>&-/);
  assert.doesNotMatch(source, /GIT_TRACE|GIT_CURL_VERBOSE|set -x/);
  assert.doesNotMatch(source, /git push[^\n]*(--force|\s-f\b|\s\+)/);
  assert.doesNotMatch(source, /magick|rsvg|node [^\n]*generate\.mjs/i);
});

// Criterion 16's ways to hide, swallow or trace output, for the recipes and the workflow.
const HIDDEN_OUTPUT =
  /\/dev\/null|\|\|\s*true|2>&1|&>|>&-|(^|\s)(-q|--quiet|--silent)(\s|$)|GIT_TRACE|set -x/m;

/** Runs just on this repo's justfile in cwd and returns its trimmed stdout. */
function just(args, cwd = repoRoot) {
  return execFileSync(
    "just",
    ["--justfile", path.join(repoRoot, "justfile"), "--working-directory", cwd, ...args],
    { env: gitEnv, encoding: "utf8" },
  ).trim();
}

/** A file in this repo, as text. */
function repoFile(file) {
  return readFileSync(path.join(repoRoot, file), "utf8");
}

/** Whether a path exists in this repo, without following a symlink. */
function lexists(file) {
  try {
    lstatSync(path.join(repoRoot, file));
    return true;
  } catch {
    return false;
  }
}

/** Every symlink under dir, recursively, without following one. */
function symlinksUnder(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) return [full];
    return entry.isDirectory() ? symlinksUnder(full) : [];
  });
}

/** The text of a markdown section, from its heading to the next heading of the same level. */
function section(text, heading) {
  const start = text.indexOf(`\n${heading}\n`);
  assert.notEqual(start, -1, heading);
  const level = heading.match(/^#+ /)[0];
  const end = text.indexOf(`\n${level}`, start + heading.length + 2);
  return text.slice(start, end === -1 ? undefined : end);
}

/** A markdown file's sentences, with line breaks and code fences flattened. */
function sentences(text) {
  return text.replace(/\s+/g, " ").split(/(?<=[.!?])\s+/);
}

const SYNC_SKILL = ".agents/skills/sync-upstream/SKILL.md";
// The old names criterion 11 retires; sync-upstream.rambla.yml is renamed in step 7, so it is stripped before matching.
const OLD_NAMES = "sync-upstream-rebrand|merge-upstream|trial-merge|MERGE-SKILL|skills/merge";
const WORKFLOW_NAME = /merge-upstream\\?\.yml/g;

test("criteria 11, 16, 18: just sync-upstream runs the script, with its local checks left on, hiding no output", () => {
  const recipe = just(["--show", "sync-upstream"]);

  assert.match(recipe, /^\s+bash fork\/sync-upstream\.sh\s*$/m);
  // The script turns the local checks on unless told otherwise, so the recipe never mentions them.
  assert.doesNotMatch(recipe, /RUN_LOCAL_CHECKS/);
  assert.doesNotMatch(recipe, HIDDEN_OUTPUT);
});

test("criteria 11, 13, 16, 18: sync-upstream.rambla.yml runs the script daily and by hand, on the dispatched ref, with the local checks off, naming no main", () => {
  const workflow = repoFile(".github/workflows/sync-upstream.rambla.yml");

  assert.match(workflow, /^ {2}schedule:\n( +#.*\n)* +- cron: "\d+ \d+ \* \* \*"$/m);
  assert.match(workflow, /^ {2}workflow_dispatch:$/m);
  assert.match(workflow, /^ +fork\/sync-upstream\.sh$/m);
  assert.match(workflow, /^ +RUN_LOCAL_CHECKS: "?(0|false)"?$/m);
  assert.match(workflow, /^ +ref: \$\{\{ github\.ref \}\}$/m);
  assert.doesNotMatch(workflow.replaceAll("main-writer", ""), /\bmain\b/);
  // The script does every push; the workflow names no branch to push to or trigger on.
  assert.doesNotMatch(workflow, /^ +git push|^ +push:|branches:/m);
  assert.doesNotMatch(workflow, /sync-upstream-rebrand|merge-upstream\.sh/);
  assert.doesNotMatch(workflow, HIDDEN_OUTPUT);
});

test("criterion 15: just provenance and the plan skill's Provenance commands name the rebrand commit main last merged and its tag, from git links alone", (t) => {
  const fx = makeFixture(t);
  firstRun(fx);
  const dir = checkout(fx, "provenance");
  // A local main that merged v0.10.0-beta.2's rebrand commit while upstream-rebrand also holds v0.10.0's.
  const merged = parents(fx.origin, rev(fx.origin, TARGET))[0];
  git(dir, ["branch", "main", merged]);
  const rebrand = parents(fx.origin, merged)[1];
  const short = (sha) => git(dir, ["rev-parse", "--short", sha]);
  const tagSha = short(tagCommit(fx, "v0.10.0-beta.2"));

  const skill = section(repoFile(".agents/skills/plan/SKILL.md"), "## Provenance");
  const commands = skill.match(/```bash\n([\s\S]*?)```/)[1];
  const fromSkill = execFileSync("bash", ["-eo", "pipefail", "-c", commands], {
    cwd: dir,
    env: gitEnv,
    encoding: "utf8",
  });
  const fromJust = just(["provenance"], dir);

  assert.match(fromSkill, new RegExp(`^${short(rebrand)} — `, "m"));
  assert.match(fromSkill, new RegExp(`^${tagSha} — `, "m"));
  assert.match(fromSkill, /^v0\.10\.0-beta\.2$/m);
  assert.match(fromJust, /^- main: /m);
  assert.match(fromJust, new RegExp(`^- upstream-rebrand: ${short(rebrand)} — `, "m"));
  assert.match(
    fromJust,
    new RegExp(`^- upstream/main: ${tagSha} \\(v0\\.10\\.0-beta\\.2\\) — `, "m"),
  );
  // Commit messages are never read.
  for (const source of [commands, just(["--show", "provenance"])]) {
    assert.doesNotMatch(source, /%s|%B|--grep/);
  }
  // Every sync lands on a tag, so the plan template's upstream/main bullet always names one.
  const planSkill = repoFile(".agents/skills/plan/SKILL.md");
  assert.doesNotMatch(planSkill, /untagged/);
  assert.match(planSkill, /^- upstream\/main: `[0-9a-f]{7,40}` \(v\d+\.\d+\.\d+[^)]*\) — /m);
});

test("criterion 11: no old script, recipe or skill name remains in a tracked file outside plans/, the workflow's own name aside", () => {
  for (const gone of [
    "fork/sync-upstream-rebrand.sh",
    "fork/merge-upstream.sh",
    ".agents/skills/merge",
    ".agents/skills/MERGE-SKILL.md",
    ".claude/skills/merge",
  ]) {
    assert.ok(!lexists(gone), `${gone} is gone`);
  }
  const grep = spawnSync(
    "git",
    [
      "grep",
      "-n",
      "-I",
      "-E",
      "-e",
      OLD_NAMES,
      "--",
      ".",
      ":!plans/",
      ":!fork/sync-upstream.test.mjs",
    ],
    { cwd: repoRoot, env: gitEnv, encoding: "utf8" },
  );
  const hits = grep.stdout
    .split("\n")
    .filter((line) => new RegExp(OLD_NAMES).test(line.replace(WORKFLOW_NAME, "")));
  assert.deepEqual(hits, []);

  const recipes = just(["--summary"]).split(/\s+/);
  assert.ok(recipes.includes("sync-upstream"));
  for (const old of ["merge-upstream", "sync-upstream-rebrand", "trial-merge"]) {
    assert.ok(!recipes.includes(old), old);
  }
  assert.ok(!repoFile(".gitignore").split("\n").includes(".trial-merge/"));
});

test("criterion 11: the skill is sync-upstream, reachable from .claude/ and .agents/, and no symlink under either is broken", () => {
  const links = [".claude", ".agents"].flatMap((dir) => symlinksUnder(path.join(repoRoot, dir)));
  for (const link of links) {
    assert.ok(existsSync(link), `${path.relative(repoRoot, link)} is not broken`);
  }
  const skill = realpathSync(path.join(repoRoot, SYNC_SKILL));
  assert.equal(realpathSync(path.join(repoRoot, ".claude/skills/sync-upstream/SKILL.md")), skill);
  assert.equal(realpathSync(path.join(repoRoot, ".agents/skills/SYNC-UPSTREAM-SKILL.md")), skill);

  const text = repoFile(SYNC_SKILL);
  assert.match(text, /^---\nname: sync-upstream\n/);
  assert.match(text, /just sync-upstream/);
  assert.match(text, /delete list/);
  assert.doesNotMatch(text.replace(WORKFLOW_NAME, ""), new RegExp(OLD_NAMES));
});

test("criterion 10: the skill's stop table says a failing local check leaves merge-<tag> on origin to fix on that branch, and a conflict deletes it", () => {
  const table = section(repoFile(SYNC_SKILL), "### 2. When it stops");
  const row = (start) => {
    const line = table.split("\n").find((l) => l.startsWith(`| ${start}`));
    assert.ok(line, start);
    return line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
  };

  const [, checkLeft, checkNext] = row("a failing local check");
  assert.equal(checkLeft, "`merge-<tag>` on origin");
  assert.match(checkNext, /fix it/);
  assert.doesNotMatch(checkNext, /by hand/);
  const [, conflictLeft] = row("a conflict");
  assert.match(conflictLeft, /`merge-<tag>` deleted/);
});

test("criterion 11: the skill and docs/brand.md never say a sync runs the logo generator, and generate.mjs's comment never mentions a sync", () => {
  assert.doesNotMatch(repoFile(SYNC_SKILL), /generat|rsvg|magick/i);

  const brand = repoFile("docs/brand.md");
  for (const sentence of sentences(brand)) {
    const syncRunsGenerator =
      /\b(sync|merge)/i.test(sentence) &&
      /\bgenerat/i.test(sentence) &&
      /\b(re-?)?run(s|ning)?\b/i.test(sentence);
    assert.ok(!syncRunsGenerator, sentence);
  }
  assert.match(brand, /fork\/sync-upstream\.sh/);
  assert.match(brand, /delete list/);

  const comment = repoFile("fork/brand/generate.mjs").split("\nimport ")[0];
  assert.doesNotMatch(comment, /sync|merge/i);
  assert.match(comment, /^\/\/ fork\/brand\/rambla-logo\.svg is the source of truth\.$/m);
});

test("criterion 12: the last job in ci.yml runs these tests and carries the fork tag", () => {
  const lines = repoFile(".github/workflows/ci.yml").trimEnd().split("\n");
  const start = lines.findLastIndex((line) => /^ {2}[\w-]+:$/.test(line));
  const job = lines.slice(start).join("\n");

  assert.match(
    lines[start - 1],
    /^ {2}# RAMBLA-FORK: fix: 2026-09-29-fix-upstream-sync\.md: [^\n]+\.$/,
  );
  assert.match(job, /^ +run: node --test fork\/sync-upstream\.test\.mjs$/m);
  // The provenance test runs just, and the rebrand formats with oxfmt from node_modules.
  assert.match(job, /setup-just/);
  assert.match(job, /npm-retry\.mjs ci|npm ci/);
});
