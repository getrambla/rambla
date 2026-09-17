#!/usr/bin/env node
// Render every Rambla brand asset from one source SVG.
//
// fork/brand/rambla-logo.svg is the source of truth. Everything this writes
// lives at a path upstream also owns, so a sync would otherwise drag Paseo's
// artwork back in. fork/merge-upstream.sh re-runs this inside the
// upstream-rebrand worktree, which puts our artwork on both sides of the merge
// and leaves git nothing to conflict over.
//
// Usage: node fork/brand/generate.mjs [source.svg] [--out <repo-root>]
//
// Needs rsvg-convert (librsvg) and magick (ImageMagick 7) on PATH.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadArtwork, markSvg, sh, tileSvg } from "./artwork.mjs";
import { componentSource } from "./component.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const STORED = join(HERE, "rambla-logo.svg");

const argv = process.argv.slice(2);
let sourceArg = "";
let outRoot = resolve(HERE, "../..");
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--out") outRoot = resolve(argv[++i]);
  else if (!sourceArg) sourceArg = argv[i];
  else throw new Error(`unexpected argument: ${argv[i]}`);
}

for (const tool of ["rsvg-convert", "magick"]) {
  try {
    execFileSync("sh", ["-c", `command -v ${tool} >/dev/null`]);
  } catch {
    throw new Error(`${tool} is required. Install librsvg and imagemagick.`);
  }
}

const source = sourceArg ? resolve(sourceArg) : STORED;
if (!existsSync(source)) throw new Error(`no such source SVG: ${source}`);
// Adopting a new design means the stored copy becomes the new source of truth.
if (source !== STORED) writeFileSync(STORED, readFileSync(source));

const art = loadArtwork(source);
const TMP = mkdtempSync(join(tmpdir(), "rambla-brand-"));
const written = [];

function out(relative) {
  const target = join(outRoot, relative);
  mkdirSync(dirname(target), { recursive: true });
  written.push(relative);
  return target;
}

function pngBuffer(size, svg) {
  const scratch = join(TMP, `f${size}.svg`);
  const png = join(TMP, `f${size}.png`);
  writeFileSync(scratch, svg);
  sh("rsvg-convert", ["-w", String(size), "-h", String(size), scratch, "-o", png]);
  return readFileSync(png);
}

const writeSvg = (relative, svg) => writeFileSync(out(relative), `${svg.trim()}\n`);
const writePng = (relative, size, svg) => writeFileSync(out(relative), pngBuffer(size, svg));

function writeIco(relative, sizes, svg) {
  const frames = sizes.map((size) => {
    const png = join(TMP, `ico-${size}.png`);
    writeFileSync(png, pngBuffer(size, svg));
    return png;
  });
  sh("magick", [...frames, out(relative)]);
}

// ImageMagick on Linux has no ICNS delegate, and the container is trivial:
// "icns", a total length, then typed chunks that modern macOS reads as PNG.
function writeIcns(relative, svg) {
  const chunks = [
    ["icp4", 16],
    ["icp5", 32],
    ["icp6", 64],
    ["ic07", 128],
    ["ic08", 256],
    ["ic09", 512],
    ["ic10", 1024],
  ].map(([type, size]) => {
    const png = pngBuffer(size, svg);
    const header = Buffer.alloc(8);
    header.write(type, 0, "ascii");
    header.writeUInt32BE(png.length + 8, 4);
    return Buffer.concat([header, png]);
  });
  const body = Buffer.concat(chunks);
  const header = Buffer.alloc(8);
  header.write("icns", 0, "ascii");
  header.writeUInt32BE(body.length + 8, 4);
  writeFileSync(out(relative), Buffer.concat([header, body]));
}

const tile = (dot) => tileSvg(art, 1024, dot);

// Square tiles: store listings, home screens, docks, taskbars.
for (const [relative, size] of [
  ["packages/app/assets/images/icon.png", 1024],
  ["packages/app/assets/images/favicon.png", 48],
  ["packages/app/public/apple-touch-icon.png", 180],
  ["packages/app/public/pwa-icon-192.png", 192],
  ["packages/app/public/pwa-icon-512.png", 512],
  ["packages/desktop/assets/icon.png", 512],
  ["packages/desktop/assets/icon-dev.png", 1254],
  ["fastlane/metadata/android/en-US/images/icon.png", 512],
]) {
  writePng(relative, size, tile());
}

writeIco("packages/desktop/assets/icon.ico", [256, 128, 64, 48, 32, 16], tile());
writeIco("packages/website/public/favicon.ico", [48, 32, 16], tile());
writeIcns("packages/desktop/assets/icon.icns", tile());

// Browser tab states. Light and dark are the same artwork upstream and stay
// that way; the dot is the whole difference between the six.
for (const scheme of ["light", "dark"]) {
  for (const [suffix, dot] of [
    ["", null],
    ["-running", "#3b82f6"],
    ["-attention", "#22c55e"],
  ]) {
    const stem = `packages/app/assets/images/favicon-${scheme}${suffix}`;
    writeSvg(`${stem}.svg`, tileSvg(art, 48, dot));
    writePng(`${stem}.png`, 48, tile(dot));
  }
}

writeSvg("packages/website/public/favicon.svg", tileSvg(art, 48));
writeSvg("packages/website/public/logo.svg", markSvg(art, 32, "#ffffff", 1));

// Bare marks. The Android foreground is cropped to the inner two thirds of the
// canvas, the notification icon is re-tinted white by the system anyway, and
// the splash sits on a background that flips with the theme.
writePng(
  "packages/app/assets/images/android-icon-foreground.png",
  1024,
  markSvg(art, 1024, "#ffffff", 0.52),
);
writePng("packages/app/assets/images/notification-icon.png", 96, markSvg(art, 96, "#ffffff", 0.82));
writePng("packages/app/assets/images/splash-icon.png", 200, markSvg(art, 200, art.brand, 0.92));

writeFileSync(out("packages/app/src/components/icons/rambla-logo.tsx"), componentSource(art));

rmSync(TMP, { recursive: true, force: true });

console.log(`brand ${art.brand}, gradient ${art.rampLight} to ${art.rampDark}`);
console.log(`wrote ${written.length} files into ${outRoot}`);
