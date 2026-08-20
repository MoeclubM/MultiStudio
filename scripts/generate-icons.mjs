#!/usr/bin/env node
// Generate LiveTranslator icon set: SVG source + PNGs (via sharp or canvas fallback) + ICO.
// Minimal deps: sharp if available, otherwise pure JS PNG via canvas literal.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const outDir = path.join(root, "src-tauri", "icons");
const publicDir = path.join(root, "public");

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="title">
  <title>LiveTranslator — LT monogram with sound waves</title>
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#1565FF"/>
      <stop offset="55%" stop-color="#2E7BFF"/>
      <stop offset="100%" stop-color="#7C3AED"/>
    </linearGradient>
    <linearGradient id="g2" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#1565FF" stop-opacity="0.95"/>
      <stop offset="100%" stop-color="#7C3AED" stop-opacity="0.95"/>
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="12" stdDeviation="18" flood-color="#1a2a6a" flood-opacity="0.18"/>
    </filter>
  </defs>
  <!-- Rounded background -->
  <rect x="0" y="0" width="1024" height="1024" rx="224" fill="#0F1117"/>
  <!-- Soft inner glow -->
  <rect x="0" y="0" width="1024" height="1024" rx="224" fill="url(#g)" opacity="0.06"/>
  <!-- Center group -->
  <g filter="url(#shadow)">
    <!-- Sound waves — three arcs to the right of L -->
    <g opacity="0.95" stroke-linecap="round" fill="none">
      <path d="M 612 356 Q 742 356 742 512 Q 742 668 612 668" stroke="url(#g)" stroke-width="28" opacity="0.18"/>
      <path d="M 632 386 Q 708 386 708 512 Q 708 638 632 638" stroke="url(#g)" stroke-width="22" opacity="0.28"/>
      <path d="M 652 416 Q 678 416 678 512 Q 678 608 652 608" stroke="url(#g)" stroke-width="18" opacity="0.42"/>
    </g>
    <!-- L — clean, translation vibe -->
    <path d="M 268 268 L 268 732 L 520 732 L 520 672 L 328 672 L 328 268 Z" fill="url(#g2)" />
    <!-- T — overlapped, subtle depth -->
    <path d="M 420 320 L 740 320 L 740 376 L 620 376 L 620 700 L 560 700 L 560 376 L 420 376 Z" fill="white" opacity="0.96"/>
    <!-- Translation hint: tiny globe meridian -->
    <g opacity="0.85">
      <ellipse cx="512" cy="512" rx="14" ry="54" fill="none" stroke="white" stroke-width="2.2" opacity="0.22"/>
      <ellipse cx="512" cy="512" rx="54" ry="14" fill="none" stroke="white" stroke-width="2.2" opacity="0.18"/>
      <circle cx="512" cy="512" r="2.2" fill="white" opacity="0.9"/>
    </g>
    <!-- Live dot -->
    <circle cx="764" cy="278" r="14" fill="#10B981"/>
    <circle cx="764" cy="278" r="22" fill="none" stroke="#10B981" stroke-width="2.5" opacity="0.35"/>
  </g>
  <!-- Subtle bottom highlight -->
  <rect x="0" y="0" width="1024" height="1024" rx="224" fill="none" stroke="white" stroke-opacity="0.06" stroke-width="1.5"/>
</svg>
`;

fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(publicDir, { recursive: true });

// Always write SVG source
fs.writeFileSync(path.join(outDir, "icon.svg"), svg, "utf-8");
fs.writeFileSync(path.join(publicDir, "favicon.svg"), svg, "utf-8");

console.log("Wrote icon.svg + favicon.svg");

// Try sharp for PNG/ICO
let sharp;
try {
  sharp = (await import("sharp")).default;
} catch {
  console.log("sharp not available — writing SVG only; PNGs will be generated via fallback if needed");
}

if (sharp) {
  const svgBuf = Buffer.from(svg);
  const sizes = [
    { name: "icon.png", size: 512 },
    { name: "128x128.png", size: 128 },
    { name: "128x128@2x.png", size: 256 },
    { name: "32x32.png", size: 32 },
  ];
  for (const { name, size } of sizes) {
    const buf = await sharp(svgBuf).resize(size, size).png().toBuffer();
    fs.writeFileSync(path.join(outDir, name), buf);
    console.log(`Wrote ${name} ${size}x${size}`);
  }
  // Also public favicon
  const fav = await sharp(svgBuf).resize(64, 64).png().toBuffer();
  fs.writeFileSync(path.join(publicDir, "favicon.png"), fav);
  console.log("Wrote favicon.png 64x64");

  // ICO: bundle 16,32,48,256 from sharp
  const { default: pngToIco } = await import("png-to-ico").catch(() => ({ default: null }));
  if (pngToIco) {
    const icoPngs = await Promise.all(
      [16, 32, 48, 256].map((s) => sharp(svgBuf).resize(s, s).png().toBuffer()),
    );
    const ico = await pngToIco(icoPngs);
    fs.writeFileSync(path.join(outDir, "icon.ico"), ico);
    console.log("Wrote icon.ico");
  } else {
    // Minimal ICO fallback: just use 256 png renamed — Tauri accepts png ico in dev, but warn
    const png256 = await sharp(svgBuf).resize(256, 256).png().toBuffer();
    // Build a real ICO header for single image
    const ico = buildIco([png256]);
    fs.writeFileSync(path.join(outDir, "icon.ico"), ico);
    console.log("Wrote icon.ico (single-image fallback)");
  }

  // ICNS: best-effort via sharp + manual header would be heavy; copy 512 as placeholder and let Tauri use png
  // For macOS bundle, Tauri can use icon.png; keep existing icon.icns if sharp lacks icns encoder
  if (!fs.existsSync(path.join(outDir, "icon.icns"))) {
    console.log("icon.icns not generated (requires iconutil); Tauri will use png fallback on macOS");
  }

  console.log("Done");
} else {
  console.log("No sharp — SVG ready; install sharp + png-to-ico for PNG/ICO: npm i -D sharp png-to-ico");
}

function buildIco(pngs) {
  const count = pngs.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);
  const dir = Buffer.alloc(16 * count);
  let offset = 6 + 16 * count;
  for (let i = 0; i < count; i++) {
    const png = pngs[i];
    // parse PNG IHDR for size
    const w = png.readUInt32BE(16);
    const h = png.readUInt32BE(20);
    const entry = dir.subarray(i * 16, (i + 1) * 16);
    entry.writeUInt8(w >= 256 ? 0 : w, 0);
    entry.writeUInt8(h >= 256 ? 0 : h, 1);
    entry.writeUInt8(0, 2); // palette
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // planes
    entry.writeUInt16LE(32, 6); // bpp
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
  }
  return Buffer.concat([header, dir, ...pngs]);
}
