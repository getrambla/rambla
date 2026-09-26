// Builds CHANGELOG.md from the fork's own releases plus upstream's.
//
// The changelog is organized around Rambla releases, not upstream's. Only
// Rambla releases appear as `##` entries — upstream never gets a heading of
// its own, because upstream shipping 0.9.1 and 0.9.2 between Rambla releases
// would otherwise push Rambla's own work down the page (and out of it: the
// old version-match merge dropped any Rambla entry that had no upstream
// counterpart, which is how the hand-written Unreleased section used to
// disappear entirely).
//
// Each Rambla release carries two labeled halves: `### Rambla — <Section>`
// for the fork's own work, then `### From Paseo — <Section>` for every
// upstream entry released since the previous Rambla release, up to this one.
// The labels come from which file each bullet was parsed from, which is the
// provenance — no git archaeology needed.
//
// The oldest Rambla release inlines nothing from upstream: the fork began as
// a copy of Paseo, and everything before that is upstream's own history, so
// the entry points at PASEO-CHANGELOG.md instead.
//
// Sources: RAMBLA-CHANGELOG.md is hand-written and lists only what this fork
// changed, including an `## Unreleased` section for work not yet shipped.
// PASEO-CHANGELOG.md is upstream's file, byte-identical to theirs so it can
// never conflict on a merge. Neither is a shipped surface: CHANGELOG.md is,
// and it has to carry both, because a Rambla user gets upstream's work too.
//
// scripts/changelog-utils.mjs recognizes `###` headings, `-` bullets and `>`
// quotes and nothing else; the `### Rambla — …` / `### From Paseo — …`
// headings below are chosen to survive it into the F-Droid store text.
//
// Lives in fork/ because upstream owns scripts/: a file of ours on a path
// upstream could one day occupy is an add/add conflict waiting to happen.
// rebrand.sh skips fork/ for the same reason.
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

const UNRELEASED = "Unreleased";

const FORK_HEADING = /^##\s+(.+?)\s*$/;
const SECTION_HEADING = /^###\s+(.+?)\s*$/;

const INTRO =
  "Rambla is a fork of Paseo. Each release lists Rambla's own changes first, " +
  "followed by the Paseo changes included in that release.";

// Splits the hand-written fork changelog into entries. Unlike
// parseChangelogEntries this accepts `## Unreleased`, which has no date,
// because carrying that section through is the point.
function parseForkEntries(changelogText) {
  const lines = changelogText.split(/\r?\n/);
  const headings = [];

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(FORK_HEADING);
    if (!match) {
      continue;
    }
    // `## Unreleased` carries no date; releases are `## 0.8.1 - 2026-09-15`.
    const dateMatch = match[1].match(/^(.*?)\s*-\s*(\d{4}-\d{2}-\d{2})$/);
    headings.push({
      version: dateMatch ? dateMatch[1] : match[1],
      date: dateMatch ? dateMatch[2] : null,
      headingLineIndex: index,
    });
  }

  if (headings.length === 0) {
    throw new Error(
      `No release headings found in ${FORK_FILE}. Expected headings like \`## 0.8.1 - 2026-09-15\`.`,
    );
  }

  return headings.map((heading, index) => {
    const nextHeading = headings[index + 1];
    const bodyLines = lines.slice(
      heading.headingLineIndex + 1,
      nextHeading ? nextHeading.headingLineIndex : lines.length,
    );
    return Object.assign({}, heading, { bodyLines });
  });
}

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

// Upstream opens an entry with a summary paragraph and sometimes an
// action-required notice. The summary is marketing in upstream's voice and
// names the wrong product, so it goes. The notice tells a Rambla user
// something they have to act on before upgrading, so it stays. Upstream
// writes notices as a bold lead-in or a blockquote and summaries as plain
// prose, which is the whole test.
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
    // A missing part means the shorter version is the release and the longer
    // is its prerelease, so 0.8.1 sorts above 0.8.1-beta.1.
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

const isNewerThan = (a, b) => compareVersionsDescending(b, a) > 0;
const isOlderOrEqual = (a, b) => compareVersionsDescending(a, b) >= 0;

// The fork file's entries are newest-first, so the next entry is the release
// before this one.
function previousForkRelease(forkEntries, index) {
  return forkEntries[index + 1] ?? null;
}

// Upstream entries a Rambla release inherits: everything upstream released
// after the previous Rambla release and no later than this one. Unreleased
// has no upper bound yet — it takes everything since the last real release.
function inheritedUpstream(previousRelease, release, upstreamByVersion) {
  if (!previousRelease) {
    return [];
  }
  return upstreamByVersion.filter(
    (entry) =>
      isNewerThan(entry.version, previousRelease.version) &&
      (release.version === UNRELEASED || isOlderOrEqual(entry.version, release.version)),
  );
}

export function buildChangelog(forkText, upstreamText) {
  const forkEntries = parseForkEntries(forkText);
  const upstreamEntries = parseChangelogEntries(upstreamText);

  const out = ["# Changelog", "", INTRO, ""];

  forkEntries.forEach((forkEntry, index) => {
    const previousRelease = previousForkRelease(forkEntries, index);
    const inherited = inheritedUpstream(previousRelease, forkEntry, upstreamEntries);

    // The fork releases after absorbing upstream's tag, so its own date is
    // the one a user saw.
    if (forkEntry.version === UNRELEASED) {
      out.push(`## ${UNRELEASED}`, "");
    } else if (forkEntry.date) {
      out.push(`## ${forkEntry.version} - ${forkEntry.date}`, "");
    } else {
      out.push(`## ${forkEntry.version}`, "");
    }

    const forkSections = splitSections(forkEntry.bodyLines).sections;
    for (const section of forkSections) {
      out.push(`### Rambla — ${section.title}`, "", ...trimBlankEdges(section.lines), "");
    }

    if (inherited.length > 0) {
      const notices = inherited.flatMap((upstreamEntry) =>
        keepUpstreamNotices(splitSections(upstreamEntry.bodyLines).preamble),
      );
      if (notices.length > 0) {
        out.push(...trimBlankEdges(notices), "");
      }

      // Merge sections by title across the inherited entries so several
      // upstream releases do not produce several `### From Paseo — Added`
      // blocks. First-seen order wins, newest release first.
      const merged = new Map();
      for (const upstreamEntry of inherited) {
        for (const section of splitSections(upstreamEntry.bodyLines).sections) {
          if (!merged.has(section.title)) {
            merged.set(section.title, []);
          }
          merged.get(section.title).push(...trimBlankEdges(section.lines), "");
        }
      }
      for (const [title, lines] of merged) {
        out.push(`### From Paseo — ${title}`, "", ...trimBlankEdges(lines), "");
      }
    } else if (!previousRelease) {
      out.push(
        "> Rambla began as a fork of Paseo. For Paseo's own history before this",
        "> release, see [PASEO-CHANGELOG.md](PASEO-CHANGELOG.md).",
        "",
      );
    }
  });

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
