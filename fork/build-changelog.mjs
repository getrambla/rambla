// Builds CHANGELOG.md from the fork's own entries and upstream's.
//
// The fork keeps two sources. RAMBLA-CHANGELOG.md is hand-written and lists only
// what this fork changed. PASEO-CHANGELOG.md is upstream's file, byte-identical
// to theirs so it can never conflict on a merge. Neither is a shipped surface:
// CHANGELOG.md is, and it has to carry both, because a Rambla user gets upstream's
// work too.
//
// Fork sections come first under plain headings, followed by upstream's sections
// under plain headings of their own. scripts/changelog-utils.mjs recognizes
// `###` headings, `-` bullets and `>` quotes and nothing else; a `####` sub-heading
// or a `**Rambla**` divider would be swallowed as a note and hoisted above every
// bullet in the 500-character F-Droid text.
//
// Lives in fork/ because upstream owns scripts/: a file of ours on a path upstream
// could one day occupy is an add/add conflict waiting to happen. rebrand.sh skips
// fork/ for the same reason.
//
// Usage: node fork/build-changelog.mjs [--check]

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseChangelogEntries } from "../scripts/changelog-utils.mjs";
import { isMainModule } from "../scripts/is-main-module.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const FORK_FILE = "RAMBLA-CHANGELOG.md";
const UPSTREAM_FILE = "PASEO-CHANGELOG.md";
const OUTPUT_FILE = "CHANGELOG.md";

const SECTION_HEADING = /^###\s+(.+?)\s*$/;

// Splits an entry body into the lines before the first `### ` and the sections
// after it, keeping every line verbatim. changelog-utils strips markup for the
// store text; here the links and attributions have to survive.
function splitSections(bodyLines) {
  const preamble = [];
  const sections = [];
  let current = null;

  for (const line of bodyLines) {
    const heading = line.match(SECTION_HEADING);
    if (heading) {
      current = { title: heading[1], lines: [] };
      sections.push(current);
      continue;
    }
    (current ? current.lines : preamble).push(line);
  }

  return { preamble, sections };
}

function trimBlankEdges(lines) {
  const out = lines.slice();
  while (out.length > 0 && out[0].trim() === "") {
    out.shift();
  }
  while (out.length > 0 && out[out.length - 1].trim() === "") {
    out.pop();
  }
  return out;
}

// Upstream opens an entry with a summary paragraph and sometimes an action-required
// notice. The summary is marketing in upstream's voice and names the wrong product,
// so it goes. The notice tells a Rambla user something they have to act on before
// upgrading, so it stays. Upstream writes notices as a bold lead-in or a blockquote
// and summaries as plain prose, which is the whole test.
function keepUpstreamNotices(preamble) {
  const kept = [];
  let inNotice = false;

  for (const line of preamble) {
    if (line.trim() === "") {
      inNotice = false;
      if (kept.length > 0 && kept[kept.length - 1] !== "") {
        kept.push("");
      }
      continue;
    }
    if (line.startsWith(">") || line.trimStart().startsWith("**")) {
      inNotice = true;
    }
    if (inNotice) {
      kept.push(line);
    }
  }

  return trimBlankEdges(kept);
}

function compareVersionsDescending(a, b) {
  const partsOf = (version) =>
    version.split(/[.-]/).map((part) => (/^\d+$/.test(part) ? Number(part) : part));
  const left = partsOf(a);
  const right = partsOf(b);

  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const l = left[index];
    const r = right[index];
    if (l === r) {
      continue;
    }
    // A missing part means the shorter version is the release and the longer is
    // its prerelease, so 0.8.1 sorts above 0.8.1-beta.1.
    if (l === undefined) {
      return -1;
    }
    if (r === undefined) {
      return 1;
    }
    if (typeof l === "number" && typeof r === "number") {
      return r - l;
    }
    return String(r).localeCompare(String(l));
  }

  return 0;
}

function indexByVersion(entries) {
  const byVersion = new Map();
  for (const entry of entries) {
    if (!byVersion.has(entry.version)) {
      byVersion.set(entry.version, entry);
    }
  }
  return byVersion;
}

export function buildChangelog(forkText, upstreamText) {
  const fork = indexByVersion(parseChangelogEntries(forkText));
  const upstream = indexByVersion(parseChangelogEntries(upstreamText));

  const versions = [...new Set([...fork.keys(), ...upstream.keys()])].sort(
    compareVersionsDescending,
  );

  const out = ["# Changelog", ""];

  for (const version of versions) {
    const forkEntry = fork.get(version);
    const upstreamEntry = upstream.get(version);

    // The fork releases after absorbing upstream's tag, so its own date is the
    // one a user saw. Fall back to upstream's for a release the fork never cut.
    out.push(`## ${version} - ${forkEntry?.date ?? upstreamEntry.date}`, "");

    if (upstreamEntry) {
      const notices = keepUpstreamNotices(splitSections(upstreamEntry.bodyLines).preamble);
      if (notices.length > 0) {
        out.push(...notices, "");
      }
    }

    if (forkEntry) {
      for (const section of splitSections(forkEntry.bodyLines).sections) {
        out.push(`### ${section.title}`, "", ...trimBlankEdges(section.lines), "");
      }
    }

    if (upstreamEntry) {
      for (const section of splitSections(upstreamEntry.bodyLines).sections) {
        out.push(`### ${section.title}`, "", ...trimBlankEdges(section.lines), "");
      }
    }
  }

  return `${out.join("\n").trimEnd()}\n`;
}

export function syncChangelog(argv = process.argv.slice(2), deps = {}) {
  const cwd = deps.cwd ?? rootDir;
  const check = argv.includes("--check");

  const forkText = readFileSync(path.join(cwd, FORK_FILE), "utf8");
  const upstreamText = readFileSync(path.join(cwd, UPSTREAM_FILE), "utf8");
  const generated = buildChangelog(forkText, upstreamText);

  const outputPath = path.join(cwd, OUTPUT_FILE);
  let existing = null;
  try {
    existing = readFileSync(outputPath, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }

  if (check) {
    if (existing !== generated) {
      throw new Error(
        `${OUTPUT_FILE} is out of date with ${FORK_FILE} and ${UPSTREAM_FILE}; regenerate it.`,
      );
    }
    console.log(`${OUTPUT_FILE} is up to date.`);
    return { generated, written: false };
  }

  if (existing === generated) {
    console.log(`${OUTPUT_FILE} is already up to date.`);
    return { generated, written: false };
  }

  writeFileSync(outputPath, generated);
  console.log(`Wrote ${OUTPUT_FILE}.`);
  return { generated, written: true };
}

if (isMainModule(import.meta.url)) {
  try {
    syncChangelog();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
