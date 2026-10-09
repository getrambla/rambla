import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { buildChangelog } from "./build-changelog.mjs";

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "sync-upstream.sh");
const repoRoot = path.resolve(path.dirname(script), "..");

const TARGET = "fix/sync-target";
const BRANCH = "upstream-rebrand";

const UPSTREAM_FILES = {
  "README.md": "# Paseo\n",
  "packages/paseo-core/src/paseo.ts": 'export const paseoName = "Paseo";\n',
  "nix/npm-deps.hash": "upstream-hash\n",
};

const RAMBLA_CHANGELOG = `# Changelog

## Unreleased

### Added

- Added a fork thing
`;

const LOCAL_CHECKS_BEFORE_TYPECHECK = [
  ["ci"],
  ["run", "build:server"],
  ["run", "build:app-deps"],
  ["run", "typecheck"],
];

const NPM_STANDIN = `#!/usr/bin/env node
const { appendFileSync } = require("node:fs");
const { execFileSync } = require("node:child_process");
const args = process.argv.slice(2);
const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
appendFileSync(process.env.CALL_LOG, JSON.stringify({ tool: "npm", args, head }) + "\\n");
if (args.join(" ") === process.env.NPM_FAIL) {
  console.error("stand-in npm: " + args.join(" ") + " failed");
  process.exit(1);
}
`;

const GH_STANDIN = `#!/usr/bin/env node
const { appendFileSync } = require("node:fs");
const { spawnSync } = require("node:child_process");
const args = process.argv.slice(2);
appendFileSync(process.env.CALL_LOG, JSON.stringify({ tool: "gh", args }) + "\\n");
function jq(data) {
  const filter = args[args.indexOf("--jq") + 1];
  process.exit(spawnSync("jq", ["-r", filter], { input: JSON.stringify(data), stdio: ["pipe", "inherit", "inherit"] }).status ?? 1);
}
const command = args.slice(0, 2).join(" ");
if (command === "run list") jq([{ databaseId: 4242 }]);
else if (command === "run watch") console.log("stand-in gh: run 4242 completed");
else if (command === "run view") {
  const conclusions = { typecheck: "success", ...JSON.parse(process.env.CI_JOBS || "{}") };
  jq({ jobs: Object.entries(conclusions).map(([name, conclusion]) => ({ name, conclusion })) });
} else {
  console.error("stand-in gh: unexpected call: " + args.join(" "));
  process.exit(1);
}
`;

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

function day(n) {
  return `2026-09-${String(n).padStart(2, "0")}T12:00:00Z`;
}

function git(cwd, args, env = {}) {
  return execFileSync("git", args, {
    cwd,
    env: { ...gitEnv, ...env },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function commit(repo, files, n, message) {
  for (const [file, content] of Object.entries(files)) {
    const full = path.join(repo, file);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-m", message], { GIT_AUTHOR_DATE: day(n), GIT_COMMITTER_DATE: day(n) });
  return git(repo, ["rev-parse", "HEAD"]);
}

function tag(repo, name, sha, n) {
  git(repo, ["tag", "-a", name, "-m", name, sha], { GIT_COMMITTER_DATE: day(n) });
}

function changelog(...versions) {
  return [
    "# Changelog",
    "",
    ...versions.flatMap(([version, n]) => [
      `## ${version} - ${day(n).slice(0, 10)}`,
      "",
      "### Added",
      "",
      `- Added the ${version} thing`,
      "",
    ]),
  ].join("\n");
}

/** Upstream with 2 releases past the floor and a side-branch tag; origin with main, the target branch and an upstream-rebrand the old sync left. */
function buildTemplate() {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "sync-upstream-template-")));
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

  const v090 = commit(up, { ...UPSTREAM_FILES, "version.txt": "0.9.0\n" }, 1, "0.9.0");
  const floor = commit(up, { "version.txt": "0.10.0-beta.1\n" }, 2, "0.10.0-beta.1");
  tag(up, "v0.10.0-beta.1", floor, 2);
  const beta2 = commit(
    up,
    { "version.txt": "0.10.0-beta.2\n", "CHANGELOG.md": changelog(["0.10.0-beta.2", 3]) },
    3,
    "0.10.0-beta.2",
  );
  tag(up, "v0.10.0-beta.2", beta2, 3);
  const v0100 = commit(
    up,
    {
      "version.txt": "0.10.0\n",
      "CHANGELOG.md": changelog(["0.10.0", 5], ["0.10.0-beta.2", 3]),
    },
    5,
    "0.10.0",
  );
  tag(up, "v0.10.0", v0100, 5);
  git(up, ["checkout", "-b", "release/0.10", v0100]);
  tag(up, "v0.10.1", commit(up, { "version.txt": "0.10.1\n" }, 6, "0.10.1"), 6);
  git(up, ["checkout", "main"]);

  git(root, ["clone", up, seed]);
  git(seed, ["checkout", "-b", BRANCH, v090]);
  git(seed, ["merge", "-s", "ours", "--no-ff", "--no-commit", floor]);
  writeFileSync(path.join(seed, "stale.txt"), "old sync\n");
  git(seed, ["add", "-A"]);
  git(seed, ["commit", "-m", "old sync"], { GIT_AUTHOR_DATE: day(2), GIT_COMMITTER_DATE: day(2) });
  git(seed, ["checkout", "-b", "fork-main"]);
  commit(
    seed,
    {
      "fork-only.txt": "ours\n",
      "nix/npm-deps.hash": "main-hash\n",
      "RAMBLA-CHANGELOG.md": RAMBLA_CHANGELOG,
      "CHANGELOG.md": "# Changelog\n",
      "PASEO-README.md": "# Paseo\n",
      ...Object.fromEntries(
        [
          "fork/build-changelog.mjs",
          "fork/build-readme.mjs",
          "scripts/changelog-utils.mjs",
          "scripts/is-main-module.mjs",
        ].map((file) => [file, readFileSync(path.join(repoRoot, file), "utf8")]),
      ),
    },
    4,
    "fork change",
  );
  git(root, ["init", "--bare", "-b", "main", origin]);
  git(seed, ["push", origin, `${BRANCH}:${BRANCH}`, "fork-main:main", `fork-main:${TARGET}`]);
  rmSync(seed, { recursive: true, force: true });
  return root;
}

let template;
before(() => {
  template = buildTemplate();
});
after(() => {
  rmSync(template, { recursive: true, force: true });
});

/** A fresh copy of the template; asserts main never moves. */
function fixture(t) {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "sync-upstream-test-")));
  cpSync(template, root, { recursive: true });
  const fx = { root, up: path.join(root, "upstream"), origin: path.join(root, "origin.git") };
  const main = rev(fx.origin, "main");
  t.after(() => {
    try {
      assert.equal(rev(fx.origin, "main"), main, "main never moves");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  return fx;
}

function checkout(fx, name) {
  const dir = path.join(fx.root, name);
  git(fx.root, ["clone", "-b", TARGET, fx.origin, dir]);
  git(dir, ["remote", "add", "upstream", fx.up]);
  return dir;
}

let runs = 0;

function sync(dir, env = {}) {
  const root = path.dirname(dir);
  runs += 1;
  const log = path.join(root, `calls-${runs}.jsonl`);
  writeFileSync(log, "");
  const result = spawnSync("bash", [script], {
    cwd: dir,
    env: {
      ...gitEnv,
      HOME: path.join(root, "home"),
      PATH: `${path.join(root, "standins")}${path.delimiter}${process.env.PATH}`,
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
    gh: calls.filter((call) => call.tool === "gh"),
    checks: calls.filter((call) => call.tool === "npm" && call.args[0] !== "--prefix"),
  };
}

function rev(repo, ref) {
  return git(repo, ["rev-parse", ref]);
}

function parents(repo, sha) {
  return git(repo, ["rev-list", "--parents", "-n", "1", sha]).split(" ").slice(1);
}

function show(repo, sha, file) {
  return git(repo, ["show", `${sha}:${file}`]) + "\n";
}

function originBranches(fx) {
  return git(fx.origin, ["for-each-ref", "--format=%(refname) %(objectname)", "refs/heads"]);
}

function mergeBranches(repo) {
  return git(repo, ["for-each-ref", "--format=%(refname:strip=2)", "refs/heads/merge-*"])
    .split("\n")
    .filter(Boolean);
}

function worktreeCount(dir) {
  return git(dir, ["worktree", "list", "--porcelain"])
    .split("\n")
    .filter((line) => line.startsWith("worktree ")).length;
}

function ciLookups(run) {
  const opt = (args, name) => args[args.indexOf(name) + 1];
  return run.gh
    .filter(({ args }) => args[0] === "run" && args[1] === "list")
    .map(({ args }) => ({ branch: opt(args, "--branch"), commit: opt(args, "--commit") }));
}

/** Asserts upstream-rebrand gained an ours-merge and a rebrand commit per tag, in order; returns the rebrand commits. */
function assertSynced(fx, since, tagNames) {
  const commits = git(fx.origin, ["rev-list", "--first-parent", "--reverse", BRANCH, `^${since}`])
    .split("\n")
    .filter(Boolean);
  assert.equal(commits.length, tagNames.length * 2, `2 commits per tag: ${tagNames}`);
  let previous = since;
  return tagNames.map((name, i) => {
    const [merge, rebrand] = commits.slice(i * 2, i * 2 + 2);
    assert.deepEqual(parents(fx.origin, merge), [previous, rev(fx.up, `${name}^{commit}`)], name);
    assert.deepEqual(parents(fx.origin, rebrand), [merge], name);
    previous = rebrand;
    return rebrand;
  });
}

/** Runs a clean first sync; returns upstream-rebrand's tip after it. */
function firstRun(fx) {
  const run = sync(checkout(fx, "first"));
  assert.equal(run.status, 0, run.output);
  return rev(fx.origin, BRANCH);
}

function release(fx, name, files, n) {
  tag(fx.up, name, commit(fx.up, files, n, name), n);
}

test("a run syncs every new release onto upstream-rebrand, lands only the newest in the target branch, and a second run changes nothing", (t) => {
  const fx = fixture(t);
  const dir = checkout(fx, "checkout");
  const oldTip = rev(fx.origin, BRANCH);
  const oldTarget = rev(fx.origin, TARGET);

  const run = sync(dir);

  assert.equal(run.status, 0, run.output);
  const [, newest] = assertSynced(fx, oldTip, ["v0.10.0-beta.2", "v0.10.0"]);
  assert.match(show(fx.origin, newest, "packages/rambla-core/src/rambla.ts"), /rambla/i);
  const landed = rev(fx.origin, TARGET);
  assert.deepEqual(parents(fx.origin, landed), [oldTarget, newest]);
  assert.deepEqual(ciLookups(run), [{ branch: "merge-v0.10.0", commit: landed }]);
  assert.deepEqual(run.checks, [], "local checks are off by default");
  assert.equal(show(fx.origin, landed, "nix/npm-deps.hash"), "main-hash\n");
  assert.equal(show(fx.origin, landed, "fork-only.txt"), "ours\n");
  assert.equal(
    show(fx.origin, landed, "CHANGELOG.md"),
    buildChangelog(
      show(fx.origin, landed, "RAMBLA-CHANGELOG.md"),
      show(fx.origin, landed, "PASEO-CHANGELOG.md"),
    ),
  );
  assert.deepEqual(mergeBranches(fx.origin), []);
  assert.equal(worktreeCount(dir), 1);

  const branches = originBranches(fx);
  const again = sync(checkout(fx, "again"));
  assert.equal(again.status, 0, again.output);
  assert.equal(originBranches(fx), branches);
  assert.deepEqual(again.gh, []);
});

test("a conflict stops the run listing its paths; the merge branch is left in its worktree and the target branch is unchanged", (t) => {
  const fx = fixture(t);
  const synced = firstRun(fx);
  const ours = checkout(fx, "ours");
  commit(
    ours,
    { "packages/rambla-core/src/rambla.ts": 'export const ramblaName = "Ours";\n' },
    9,
    "ours",
  );
  git(ours, ["push", "origin", TARGET]);
  release(
    fx,
    "v0.11.0",
    { "packages/paseo-core/src/paseo.ts": 'export const paseoName = "Theirs";\n' },
    10,
  );
  const target = rev(fx.origin, TARGET);

  const run = sync(ours);

  assert.notEqual(run.status, 0, run.output);
  assert.match(run.output, /merge-v0\.11\.0/);
  assert.match(run.output, /^packages\/rambla-core\/src\/rambla\.ts$/m);
  assertSynced(fx, synced, ["v0.11.0"]);
  assert.equal(rev(fx.origin, TARGET), target);
  assert.deepEqual(mergeBranches(fx.origin), []);
  assert.deepEqual(mergeBranches(ours), ["merge-v0.11.0"]);
  assert.deepEqual(run.gh, []);
});

test("with LOCAL_SYNC on, a failing local check leaves the merge branch on origin; once fixed by hand, a re-run lands it", (t) => {
  const fx = fixture(t);
  const dir = checkout(fx, "checkout");
  const target = rev(fx.origin, TARGET);

  const stopped = sync(dir, { LOCAL_SYNC: "1", NPM_FAIL: "run typecheck" });

  assert.notEqual(stopped.status, 0, stopped.output);
  assert.match(stopped.output, /^error: .*npm run typecheck.*merge-v0\.10\.0 /m);
  assert.deepEqual(
    stopped.checks.map(({ args }) => args),
    LOCAL_CHECKS_BEFORE_TYPECHECK,
  );
  assert.deepEqual(mergeBranches(fx.origin), ["merge-v0.10.0"]);
  assert.equal(rev(fx.origin, TARGET), target);

  const hand = checkout(fx, "hand");
  git(hand, ["checkout", "-b", "merge-v0.10.0", "origin/merge-v0.10.0"]);
  const fixed = commit(hand, { "fix.txt": "fixed\n" }, 9, "fix");
  git(hand, ["push", "origin", "merge-v0.10.0"]);

  const run = sync(dir, { LOCAL_SYNC: "1" });

  assert.equal(run.status, 0, run.output);
  assert.deepEqual(run.checks, []);
  assert.deepEqual(ciLookups(run), [{ branch: "merge-v0.10.0", commit: fixed }]);
  assert.equal(rev(fx.origin, TARGET), fixed);
  assert.deepEqual(mergeBranches(fx.origin), []);
});

test("a failing ci.yml job stops the run naming it and leaves the merge branch; a Playwright-only failure lands by default", (t) => {
  const failing = fixture(t);
  const target = rev(failing.origin, TARGET);
  const run = sync(checkout(failing, "checkout"), {
    CI_JOBS: JSON.stringify({ "server-tests-ubuntu": "failure" }),
  });
  assert.notEqual(run.status, 0, run.output);
  assert.match(run.output, /^server-tests-ubuntu$/m);
  assert.deepEqual(mergeBranches(failing.origin), ["merge-v0.10.0"]);
  assert.equal(rev(failing.origin, TARGET), target);

  const playwright = fixture(t);
  const landed = sync(checkout(playwright, "checkout"), {
    CI_JOBS: JSON.stringify({ "playwright (shard 2/4)": "failure" }),
  });
  assert.equal(landed.status, 0, landed.output);
  assert.deepEqual(mergeBranches(playwright.origin), []);
});

test("uncommitted changes on the target branch stop the run before anything moves", (t) => {
  const fx = fixture(t);
  const dir = checkout(fx, "checkout");
  writeFileSync(path.join(dir, "fork-only.txt"), "dirty\n");
  const branches = originBranches(fx);

  const run = sync(dir);

  assert.notEqual(run.status, 0, run.output);
  assert.match(run.output, /uncommitted changes/);
  assert.equal(originBranches(fx), branches);
});
