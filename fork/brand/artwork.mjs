// Reads the source mark and derives everything the generator draws with: the
// brand colour, the gradient that straddles it, and where the ink actually sits
// inside the viewBox. Nothing here writes to the repo.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const TILE_RADIUS = 0.2246; // iOS-style corner, as a fraction of the tile
export const TILE_INK = 0.72; // how much of the tile the mark fills

export const sh = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8" });

// --- colour ------------------------------------------------------------------

function toHsl(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) {
    h = (g - b) / d + (g < b ? 6 : 0);
  } else if (max === g) {
    h = (b - r) / d + 2;
  } else {
    h = (r - g) / d + 4;
  }
  return [h / 6, s, l];
}

function toHex([h, rawS, rawL]) {
  const clamp = (v) => Math.min(1, Math.max(0, v));
  const s = clamp(rawS);
  const l = clamp(rawL);
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h * 6) % 2) - 1));
  const m = l - c / 2;
  const wheel = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ];
  const channels = wheel[Math.floor(h * 6) % 6];
  const byte = (v) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${channels.map(byte).join("")}`;
}

// --- the source mark ---------------------------------------------------------

export function loadArtwork(sourcePath) {
  const svg = readFileSync(sourcePath, "utf8");

  const viewBox = /viewBox="([\d.\-\s]+)"/.exec(svg);
  if (!viewBox) throw new Error("source SVG has no viewBox");
  const [vbX, vbY, vbW, vbH] = viewBox[1].trim().split(/\s+/).map(Number);

  // The brand colour is whichever hex the artwork uses most, ignoring the pure
  // black and white that masks and cut-outs are made of.
  const counts = new Map();
  for (const [, hex] of svg.matchAll(/#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b/g)) {
    const full = (hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex).toLowerCase();
    if (full === "ffffff" || full === "000000") continue;
    counts.set(full, (counts.get(full) ?? 0) + 1);
  }
  const [best] = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (!best) throw new Error("source SVG has no brand colour to key the gradient off");
  const brand = `#${best[0]}`;

  // Artwork minus the XML preamble and the bits that only make sense on a
  // standalone file; what is left can be dropped inside any <g>.
  const inner = svg
    .replace(/<\?xml[^>]*\?>/g, "")
    .replace(/<!DOCTYPE[^>]*>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<title>[\s\S]*?<\/title>/gi, "")
    .replace(/<desc>[\s\S]*?<\/desc>/gi, "")
    .replace(/^[\s\S]*?<svg[^>]*>/i, "")
    .replace(/<\/svg>\s*$/i, "")
    .trim();

  const recolor = (fill) => inner.replaceAll(new RegExp(brand, "gi"), fill);

  // A shallow ramp that straddles the brand colour, so the tile reads as one
  // purple at thumbnail size rather than as two.
  const [h, s, l] = toHsl(brand);
  const rampLight = toHex([h, s + 0.05, l + 0.11]);
  const rampDark = toHex([h, s + 0.1, l - 0.1]);

  const ink = measureInk({ vbX, vbY, vbW, vbH, brand, recolor });

  return { svg, brand, inner, recolor, rampLight, rampDark, ink, vbX, vbY, vbW, vbH };
}

// The mark is rarely centred in its own viewBox, so measure the ink rather than
// trust the box. Every placement downstream is relative to this.
function measureInk({ vbX, vbY, vbW, vbH, brand, recolor }) {
  const tmp = mkdtempSync(join(tmpdir(), "rambla-ink-"));
  const probeSvg = join(tmp, "probe.svg");
  const probePng = join(tmp, "probe.png");
  writeFileSync(
    probeSvg,
    `<svg width="1024" height="1024" viewBox="${vbX} ${vbY} ${vbW} ${vbH}" fill="none" xmlns="http://www.w3.org/2000/svg">${recolor(brand)}</svg>`,
  );
  sh("rsvg-convert", ["-w", "1024", "-h", "1024", probeSvg, "-o", probePng]);
  // %@ reports the ink bounding box of the image as it stands. Trimming first
  // would crop the image and then report the whole of it at +0+0.
  const trimmed = /^(\d+)x(\d+)\+(\d+)\+(\d+)/.exec(
    sh("magick", [probePng, "-format", "%@", "info:"]),
  );
  if (!trimmed) throw new Error("could not measure the mark; is the source SVG empty?");
  const [, w, h, x, y] = trimmed;
  const unit = Math.max(vbW, vbH) / 1024;
  return {
    x: vbX + Number(x) * unit,
    y: vbY + Number(y) * unit,
    w: Number(w) * unit,
    h: Number(h) * unit,
  };
}

// --- drawing -----------------------------------------------------------------

// Place the mark centred in a square canvas, its longest side at `fraction`.
export function placed(art, size, fraction, fill) {
  const scale = (size * fraction) / Math.max(art.ink.w, art.ink.h);
  const tx = size / 2 - scale * (art.ink.x + art.ink.w / 2);
  const ty = size / 2 - scale * (art.ink.y + art.ink.h / 2);
  return `<g transform="translate(${tx.toFixed(3)},${ty.toFixed(3)}) scale(${scale.toFixed(5)})">${art.recolor(fill)}</g>`;
}

export function tileSvg(art, size, dot) {
  const badge = dot
    ? `<circle cx="${size * 0.8143}" cy="${size * 0.8143}" r="${size * 0.1857}" fill="${dot}"/>`
    : "";
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" fill="none" xmlns="http://www.w3.org/2000/svg">
<defs><linearGradient id="rambla-tile" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${art.rampLight}"/><stop offset="1" stop-color="${art.rampDark}"/></linearGradient></defs>
<rect width="${size}" height="${size}" rx="${(size * TILE_RADIUS).toFixed(2)}" fill="url(#rambla-tile)"/>
${placed(art, size, TILE_INK, "#ffffff")}${badge}
</svg>`;
}

export function markSvg(art, size, fill, fraction) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" fill="none" xmlns="http://www.w3.org/2000/svg">
${placed(art, size, fraction, fill)}
</svg>`;
}
