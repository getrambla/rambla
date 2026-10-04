import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildReadme, EXEMPT, FORKED_FROM } from "./build-readme.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const upstream = readFileSync(path.join(rootDir, "PASEO-README.md"), "utf8");
const readme = buildReadme(upstream);
const isExempt = (line) => EXEMPT.some((rule) => rule.test(line));
const rebranded = readme.split("\n").filter((line) => !isExempt(line) && line !== FORKED_FROM);

test("Related projects ends with the forked-from line", () => {
  const section = readme.split("## Related projects")[1].split("\n## ")[0];
  const items = section.split("\n").filter((line) => line.startsWith("- "));
  assert.equal(items.at(-1), FORKED_FROM);
  assert.equal(items.filter((line) => line === FORKED_FROM).length, 1);
});

test("only exempt lines mention Paseo", () => {
  for (const line of rebranded) {
    assert.doesNotMatch(line, /paseo/i);
  }
});

test("nothing points at upstream's author, socials, sponsors or translations", () => {
  for (const line of rebranded) {
    assert.doesNotMatch(line, /boudra|sponsor|x\.com|discord|reddit|README\.[\w-]+\.md/i);
  }
});

test("links point at Rambla's repos", () => {
  assert.match(readme, /github\.com\/getrambla\/rambla\/releases/);
  assert.match(readme, /github\.com\/getrambla\/rambla-relay/);
});

test("exempt lines keep upstream's wording", () => {
  const lines = readme.split("\n");
  for (const line of upstream.split("\n").filter(isExempt)) {
    assert.ok(lines.includes(line), `${line} was changed`);
  }
});

test("every relative link and image exists in the repo", () => {
  const targets = [...readme.matchAll(/(?:src|href)="([^"]+)"|\]\(([^)]+)\)/g)]
    .map((match) => match[1] ?? match[2])
    .filter((target) => !/^[a-z]+:/i.test(target) && !target.startsWith("#"));
  assert.ok(targets.length > 0);
  for (const target of targets) {
    assert.ok(existsSync(path.join(rootDir, target)), `${target} is missing`);
  }
});

test("the committed README.md matches PASEO-README.md", () => {
  assert.equal(
    readFileSync(path.join(rootDir, "README.md"), "utf8"),
    readme,
    "README.md is out of date with PASEO-README.md; run node fork/build-readme.mjs.",
  );
});
