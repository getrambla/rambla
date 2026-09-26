import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parseChangelogBody } from "../scripts/changelog-utils.mjs";
import { buildChangelog } from "./build-changelog.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const FORK = `# Changelog

## Unreleased

### Added

- Added a fork thing in progress

## 0.8.1 - 2026-09-15

### Added

- Added a fork thing

### Fixed

- Fixed a fork thing
`;

const UPSTREAM = `# Changelog

## 0.9.1 - 2026-09-20

Paseo 0.9.1 adds things and fixes things.

**Before upgrading:** do the thing first.

### Added

- Added a newer upstream thing ([#2](https://github.com/getpaseo/paseo/pull/2))

## 0.8.1 - 2026-09-12

### Fixed

- Fixed an upstream thing ([#1](https://github.com/getpaseo/paseo/pull/1))

### Plugins

- Added an upstream plugin thing

## 0.8.0 - 2026-09-10

### Fixed

- Fixed an older upstream thing
`;

// Output sections between `## heading` and the next `##`. Needed because
// parseChangelogEntries skips `## Unreleased` — it has no date — which is
// correct for the store-text consumers but wrong for these tests.
function sectionBody(text, heading) {
  const start = text.indexOf(heading);
  assert.notEqual(start, -1, `${heading} not found in output`);
  const rest = text.slice(start + heading.length);
  const next = rest.indexOf("\n## ");
  return next === -1 ? rest : rest.slice(0, next);
}

test("only Rambla releases become ## entries, Unreleased first", () => {
  const headings = buildChangelog(FORK, UPSTREAM)
    .split("\n")
    .filter((line) => line.startsWith("## "));

  assert.deepEqual(headings, ["## Unreleased", "## 0.8.1 - 2026-09-15"]);
});
test("Rambla sections come first, labeled; upstream sections follow, labeled", () => {
  const titles = buildChangelog(FORK, UPSTREAM)
    .split("\n")
    .filter((line) => line.startsWith("### "));

  assert.deepEqual(titles, [
    "### Rambla — Added",
    "### From Paseo — Added",
    "### Rambla — Added",
    "### Rambla — Fixed",
  ]);
});

test("a release inherits every upstream entry since the previous Rambla release", () => {
  const text = buildChangelog(FORK, UPSTREAM);
  const unreleased = sectionBody(text, "## Unreleased");

  // Unreleased has no upper bound: it takes 0.9.1, everything upstream cut
  // after Rambla's 0.8.1. Upstream's 0.8.0 predates that and belongs to the
  // fork-point note instead.
  assert.match(unreleased, /newer upstream thing/);
  assert.doesNotMatch(unreleased, /older upstream thing/);
});

test("upstream's action-required notice survives and its summary does not", () => {
  const text = buildChangelog(FORK, UPSTREAM);
  const { notes } = parseChangelogBody(sectionBody(text, "## Unreleased").split("\n"));

  assert.equal(notes.length, 1);
  assert.match(notes[0], /^Before upgrading: do the thing first\.$/);
});

test("the oldest Rambla release points at PASEO-CHANGELOG.md instead of inlining history", () => {
  const text = buildChangelog(FORK, UPSTREAM);
  const oldest = sectionBody(text, "## 0.8.1 - 2026-09-15");

  assert.match(oldest, /PASEO-CHANGELOG\.md/);
  assert.doesNotMatch(oldest, /older upstream thing/);
});

test("prereleases sort below the release they lead to", () => {
  const fork = `# Changelog

## 0.8.2 - 2026-09-14

### Fixed

- Fixed a fork thing

## 0.8.0 - 2026-09-01

### Fixed

- Fixed another fork thing
`;
  const upstream = `# Changelog

## 0.8.1 - 2026-09-12

### Fixed

- Fixed it

## 0.8.1-beta.2 - 2026-09-11

### Fixed

- Nearly fixed it
`;
  const text = buildChangelog(fork, upstream);
  const inherited = sectionBody(text, "## 0.8.2 - 2026-09-14");

  assert.match(inherited, /- Fixed it/);
  assert.match(inherited, /Nearly fixed it/);
});

test("the committed CHANGELOG.md matches its two sources", () => {
  const generated = buildChangelog(
    readFileSync(path.join(rootDir, "RAMBLA-CHANGELOG.md"), "utf8"),
    readFileSync(path.join(rootDir, "PASEO-CHANGELOG.md"), "utf8"),
  );
  assert.equal(
    readFileSync(path.join(rootDir, "CHANGELOG.md"), "utf8"),
    generated,
    "CHANGELOG.md is out of date with its two sources; regenerate it.",
  );
});
