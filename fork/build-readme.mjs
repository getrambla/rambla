// Builds README.md from upstream's README, which rebrand.sh keeps as
// PASEO-README.md. Renames Paseo to Rambla the way rebrand.sh does and drops
// what has no Rambla counterpart: upstream's translations, socials and sponsors.
//
// Usage: node fork/build-readme.mjs

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isMainModule } from "../scripts/is-main-module.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const UPSTREAM_FILE = "PASEO-README.md";
const OUTPUT_FILE = "README.md";

// Lines matching any of these keep upstream's wording.
export const EXEMPT = [/paseo-vscode/];

const REMOVE = [
  /^<p align="center">\n\s*<a href="README\.md">[\s\S]*?<\/p>\n\n/m,
  /^ *<a href="https:\/\/(?:x\.com|discord\.gg|www\.reddit\.com)\/[^"]*">\n.*\n *<\/a>\n/gm,
  /^## Sponsors\n[\s\S]*?(?=^## )/m,
];

// Upstream serves its screenshots from its site; the same files are in the repo.
const SCREENSHOT = /https:\/\/paseo\.sh\/([\w-]+\.png)/g;

function rebrand(line) {
  if (EXEMPT.some((rule) => rule.test(line))) {
    return line;
  }
  return line
    .replace(SCREENSHOT, "packages/website/public/$1")
    .replaceAll("PASEO", "RAMBLA")
    .replaceAll("Paseo", "Rambla")
    .replaceAll("paseo", "rambla");
}

export const FORKED_FROM = "- Forked from [getpaseo/paseo](https://github.com/getpaseo/paseo)";

function addForkedFrom(lines) {
  const start = lines.indexOf("## Related projects");
  if (start === -1) {
    return lines;
  }
  let last = start;
  for (let index = start + 1; index < lines.length && !lines[index].startsWith("## "); index += 1) {
    if (lines[index].startsWith("- ")) {
      last = index;
    }
  }
  return [...lines.slice(0, last + 1), FORKED_FROM, ...lines.slice(last + 1)];
}

export function buildReadme(upstreamText) {
  const kept = REMOVE.reduce((text, rule) => text.replace(rule, ""), upstreamText);
  return addForkedFrom(kept.split("\n").map(rebrand)).join("\n");
}

if (isMainModule(import.meta.url)) {
  const upstreamText = readFileSync(path.join(rootDir, UPSTREAM_FILE), "utf8");
  writeFileSync(path.join(rootDir, OUTPUT_FILE), buildReadme(upstreamText));
  console.log(`Wrote ${OUTPUT_FILE}.`);
}
