import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "check-plan.mjs");
const repoRoot = path.resolve(path.dirname(script), "..");
const RULE = "plans never link private repos or research files";

/** A feat plan that passes every check, with the given lines under Constraints. */
function plan(lines) {
  return `# feat: test plan

Status: unapproved

## Provenance

- main: test
- upstream-rebrand: test
- upstream/main: test

## Scope

Test.

## Acceptance criteria

1. Test.

## Goal

Test.

## Merge conflict mitigation

Test.

## Constraints

${lines.join("\n")}

## Steps

Test.

## Verification

Test.

## Risks

Test.
`;
}

/** Runs the checker on a plan in a throwaway git repo; returns the repo root and the checker's output. */
function check(t, ...lines) {
  const root = mkdtempSync(path.join(tmpdir(), "check-plan-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q", root]);
  mkdirSync(path.join(root, "plans"));
  const file = path.join(root, "plans", "2026-10-01-feat-test.md");
  writeFileSync(file, plan(lines.map((line) => line.replaceAll("<root>", root))));
  const result = spawnSync("node", [script, file], { cwd: repoRoot, encoding: "utf8" });
  return { root, output: `${result.stdout}${result.stderr}` };
}

/** Asserts the output flags the link target under the plan-link rule. */
function assertFlagged(output, target) {
  assert.ok(
    output
      .split("\n")
      .some((line) => line.includes(`link target "${target}"`) && line.includes(RULE)),
    `${target} is flagged:\n${output}`,
  );
}

test("public http and https links pass", (t) => {
  const { output } = check(
    t,
    "- [a](https://example.com/page)",
    "- [b](http://example.com/page)",
    "- [c](https://github.com/getrambla/rambla/blob/main/README.md)",
  );

  assert.match(output, /: ok$/m, output);
});

test("links into a research/ folder fail, relative or absolute, inside or outside the repo", (t) => {
  const { root, output } = check(
    t,
    "- [a](../research/notes.md)",
    "- [b](../../research/notes.md)",
    "- [c](<root>/research/notes.md)",
    "- [d](/home/tom/getrambla/research/notes.md#L3)",
  );

  assertFlagged(output, "../research/notes.md");
  assertFlagged(output, "../../research/notes.md");
  assertFlagged(output, `${root}/research/notes.md`);
  assertFlagged(output, "/home/tom/getrambla/research/notes.md#L3");
});

test("filesystem links that leave the repo fail", (t) => {
  const { output } = check(t, "- [a](../../outside.md)", "- [b](/home/tom/elsewhere.md)");

  assertFlagged(output, "../../outside.md");
  assertFlagged(output, "/home/tom/elsewhere.md");
});

test("web links to the private getrambla repo fail", (t) => {
  const { output } = check(
    t,
    "- [a](https://github.com/getrambla/getrambla/blob/main/CLAUDE.md)",
    "- [b](https://github.com/getrambla/getrambla)",
  );

  assertFlagged(output, "https://github.com/getrambla/getrambla/blob/main/CLAUDE.md");
  assertFlagged(output, "https://github.com/getrambla/getrambla");
});

test("links inside the repo keep their old checks and never trip the plan-link rule", (t) => {
  const { root, output } = check(
    t,
    "- [a](../packages/a.ts#L3)",
    "- [b](rambla/packages/b.ts)",
    "- [c](<root>/packages/c.ts)",
    "- [d](../packages/d.ts:12)",
  );

  assert.doesNotMatch(output, new RegExp(RULE));
  assert.doesNotMatch(output, /packages\/a\.ts/);
  assert.match(output, /"rambla\/packages\/b\.ts" starts with rambla\//);
  assert.ok(output.includes(`"${root}/packages/c.ts" is absolute`), output);
  assert.match(output, /"\.\.\/packages\/d\.ts:12" uses :line/);
});
