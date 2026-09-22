import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parseChangelogBody, parseChangelogEntries } from "../scripts/changelog-utils.mjs";
import { buildChangelog } from "./build-changelog.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const FORK = `# Changelog

## 0.8.1 - 2026-09-15

### Added

- Added a fork thing

### Fixed

- Fixed a fork thing
`;

const UPSTREAM = `# Changelog

## 0.8.1 - 2026-09-12

Paseo 0.8.1 adds things and fixes things.

**Before upgrading:** do the thing first.

### Added

- Added an upstream thing ([#1](https://github.com/getpaseo/paseo/pull/1))

### Plugins

- Added an upstream plugin thing

## 0.8.0 - 2026-09-10

### Fixed

- Fixed an older upstream thing
`;

test("fork sections come first and upstream sections follow under plain headings", () => {
  const titles = buildChangelog(FORK, UPSTREAM)
    .split("\n")
    .filter((line) => line.startsWith("### "));

  assert.deepEqual(titles, ["### Added", "### Fixed", "### Added", "### Plugins", "### Fixed"]);
});

test("the fork's release date wins over upstream's", () => {
  const entries = parseChangelogEntries(buildChangelog(FORK, UPSTREAM));
  assert.equal(entries[0].version, "0.8.1");
  assert.equal(entries[0].date, "2026-09-15");
  assert.equal(entries[1].date, "2026-09-10");
});

test("upstream's action-required notice survives and its summary does not", () => {
  const { notes } = parseChangelogBody(
    parseChangelogEntries(buildChangelog(FORK, UPSTREAM))[0].bodyLines,
  );
  assert.equal(notes.length, 1);
  assert.match(notes[0], /^Before upgrading: do the thing first\.$/);
});

test("a version in only one source still gets an entry", () => {
  const forkOnly = buildChangelog(
    FORK,
    "# Changelog\n\n## 0.8.0 - 2026-09-10\n\n### Fixed\n\n- Fixed it\n",
  );
  const versions = parseChangelogEntries(forkOnly).map((entry) => entry.version);
  assert.deepEqual(versions, ["0.8.1", "0.8.0"]);
});

test("prereleases sort below the release they lead to", () => {
  const upstream = `# Changelog

## 0.8.1 - 2026-09-12

### Fixed

- Fixed it

## 0.8.1-beta.2 - 2026-09-11

### Fixed

- Nearly fixed it

## 0.8.0 - 2026-09-10

### Fixed

- Fixed something older
`;
  const versions = parseChangelogEntries(buildChangelog(FORK, upstream)).map(
    (entry) => entry.version,
  );
  assert.deepEqual(versions, ["0.8.1", "0.8.1-beta.2", "0.8.0"]);
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
