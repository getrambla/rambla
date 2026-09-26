#!/usr/bin/env node
// Check a plan file against the mechanical rules in .agents/skills/plan/SKILL.md.
//
// These are the rules an agent reviewer must never spend attention on: section
// shape, plan status, acceptance-criteria presence, link form, digits,
// provenance freshness. Checking them here costs a second and never misses,
// which keeps a review's numbered list to things that would make the work wrong.
//
// Usage: node fork/check-plan.mjs plans/2026-09-22-feat-slug.md
// Exits 1 and prints one line per problem.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename } from "node:path";

const file = process.argv[2];
if (!file) {
  console.error("usage: node fork/check-plan.mjs <plan file>");
  process.exit(2);
}

const text = readFileSync(file, "utf8");
const lines = text.split("\n");
const problems = [];
const at = (i, msg) => problems.push(`${file}:${i + 1}  ${msg}`);

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();

// Filename: YYYY-MM-DD-fix-slug.md or -feat-slug.md.
if (!/^\d{4}-\d{2}-\d{2}-(fix|feat)-[a-z0-9-]+\.md$/.test(basename(file))) {
  problems.push(`${file}  filename must be YYYY-MM-DD-fix-slug.md or YYYY-MM-DD-feat-slug.md`);
}

// Required sections, in order. Cause is required for fix plans only —
// feat plans have no cause.
const headings = lines.filter((l) => l.startsWith("## ")).map((l) => l.slice(3).trim());
const isFix = (lines[0] ?? "").startsWith("# fix: ");
const required = [
  "Provenance",
  "Scope",
  "Acceptance criteria",
  "Goal",
  "Merge conflict mitigation",
  ...(isFix ? ["Cause"] : []),
  "Constraints",
  "Steps",
  "Verification",
  "Risks",
];
let cursor = 0;
for (const want of required) {
  const found = headings.indexOf(want, cursor);
  if (found === -1) {
    problems.push(
      `${file}  missing or out-of-order section "## ${want}" (expected after "${required[required.indexOf(want) - 1] ?? "the title"}")`,
    );
  } else {
    cursor = found + 1;
  }
}

// Title line: "# fix: ..." or "# feat: ...".
if (!/^# (fix|feat): \S/.test(lines[0] ?? "")) {
  at(0, 'title must start with "# fix: " or "# feat: "');
}

// Status line: first non-blank line under the title, before any heading.
// `unapproved` and `approved` are the planning-side values; `coding` and
// `done` are written by the code skill and must also parse.
const bodyAfterTitle = lines.slice(1);
const statusIdx = bodyAfterTitle.findIndex((l) => /^Status: /.test(l.trim()));
const firstHeadingIdx = bodyAfterTitle.findIndex((l) => l.startsWith("## "));
if (statusIdx === -1 || (firstHeadingIdx !== -1 && statusIdx > firstHeadingIdx)) {
  problems.push(`${file}  missing status line — "Status: <value>" must be the first line under the title`);
} else {
  const status = bodyAfterTitle[statusIdx].trim().replace(/^Status: /, "");
  if (!/^(unapproved|approved|coding|done)( |$)/.test(status)) {
    at(statusIdx + 1, `status "${status}" is not one of unapproved | approved | coding | done`);
  }
}

// Acceptance criteria: numbered items, no empty section.
const acIdx = headings.indexOf("Acceptance criteria");
if (acIdx !== -1) {
  const next = headings.findIndex((h, i) => i > acIdx);
  const start = lines.indexOf(`## ${headings[acIdx]}`);
  const end =
    next === -1 ? lines.length : lines.indexOf(`## ${headings[next]}`, start + 1);
  const items = lines
    .slice(start + 1, end)
    .filter((l) => /^\d+\. /.test(l.trim()));
  if (items.length === 0) {
    problems.push(`${file}  Acceptance criteria has no numbered items — plans propose criteria as a numbered list`);
  }
}

// Steps: every numbered step (not the fixed step 0) carries acceptance criteria.
const stepsIdx = headings.indexOf("Steps");
if (stepsIdx !== -1) {
  const start = lines.indexOf("## Steps");
  const end = lines.indexOf("## Verification", start + 1);
  const stepLines = lines.slice(start + 1, end === -1 ? lines.length : end);
  const steps = stepLines.filter((l) => /^\d+\. /.test(l.trim()));
  if (steps.length > 2) {
    // steps[0] is the fixed "read the code skill" step; a multi-step plan
    // (3+ lines) numbers its work steps, and each needs criteria. A 1- or
    // 2-line Steps section is a single-step plan — the plan-level criteria
    // serve as that step's criteria.
    const criteria = stepLines.filter((l) => /\*\*Acceptance criteria\*\*/.test(l));
    if (criteria.length < steps.length - 1) {
      problems.push(
        `${file}  ${steps.length - 1} work steps but ${criteria.length} acceptance-criteria lines — every work step needs its own`,
      );
    }
  }
}

// Links. Inside a plan the target is relative to the plan, so it must not
// start with rambla/ or a slash, and a line reference uses #L.
const linkRe = /\[[^\]]*\]\(([^)]+)\)/g;
lines.forEach((line, i) => {
  for (const m of line.matchAll(linkRe)) {
    const target = m[1];
    if (/^https?:/i.test(target)) {
      at(i, `link target "${target}" leaves the fork repo — plans never link outside it`);
      continue;
    }
    if (target.startsWith("rambla/")) {
      at(i, `link target "${target}" starts with rambla/ — inside a plan use ../ instead`);
    }
    if (target.startsWith("/")) {
      at(i, `link target "${target}" is absolute — use a path relative to the plan`);
    }
    if (/:\d+$/.test(target)) {
      at(i, `link target "${target}" uses :line — use #L${target.split(":").pop()}`);
    }
  }
  // A bare path:line outside a link is unclickable.
  const bare = line.replace(linkRe, "");
  const m = bare.match(/(?<![(\w/])[\w./-]+\.(ts|tsx|js|mjs|json|md|sh):\d+/);
  if (m) at(i, `bare path "${m[0]}" is not a link — wrap it in [name.ts:120](../path#L120)`);
});

// Digits. Only flag a number word directly quantifying something countable;
// "one at a time" and "one of them" are English, not data.
const NUMS = "one|two|three|four|five|six|seven|eight|nine|ten";
const NOUNS =
  "files?|lines?|sites?|items?|commits?|conflicts?|tests?|places?|rounds?|modules?|screens?|components?|imports?|calls?|steps?|changes?|edits?";
const digitRe = new RegExp(`\\b(${NUMS})\\s+(${NOUNS})\\b`, "i");
lines.forEach((line, i) => {
  if (line.startsWith("    ") || line.startsWith("\t")) return; // code block
  const m = line.match(digitRe);
  if (m) at(i, `"${m[0]}" — numbers that are data are digits`);
});

// Provenance: 3 bullets, and main must still be where the plan says it is.
const provStart = lines.findIndex((l) => l.trim() === "## Provenance");
if (provStart !== -1) {
  const body = lines.slice(provStart + 1, provStart + 8).filter((l) => l.startsWith("- "));
  const want = ["main:", "upstream-rebrand:", "upstream/main:"];
  for (const [n, key] of want.entries()) {
    if (!body[n]?.startsWith(`- ${key}`)) {
      problems.push(`${file}  Provenance bullet ${n + 1} must start with "- ${key}"`);
    }
  }
  const claimed = body[0]?.match(/`([0-9a-f]{7,40})`/)?.[1];
  if (claimed) {
    const head = git("rev-parse", "--short", "main");
    if (!head.startsWith(claimed) && !claimed.startsWith(head)) {
      problems.push(
        `${file}  Provenance says main is ${claimed}, but main is now ${head} — line numbers may be stale`,
      );
    }
  }
}

// Leave the plan formatted — oxfmt re-pads markdown table columns, which the
// checker's own edits and agent edits routinely knock out of alignment.
execFileSync("npx", ["--yes", "oxfmt", file], { stdio: "inherit" });

if (problems.length) {
  for (const p of problems) console.error(p);
  console.error(
    `\n${problems.length} problem(s). These are style only — fix them without reporting them.`,
  );
  process.exit(1);
}
console.log(`${file}: ok`);
