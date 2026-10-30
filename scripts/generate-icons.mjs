// One SVG source for the website, Windows icon and macOS icon.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import pngToIco from 'png-to-ico';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const icons = path.join(root, 'assets', 'icons');
const publicDir = path.join(root, 'public');
const svg = await fs.readFile(path.join(icons, 'icon.svg'));
const png = (size) => sharp(svg).resize(size, size).png().toBuffer();

await fs.mkdir(publicDir, { recursive: true });
await fs.writeFile(path.join(publicDir, 'favicon.svg'), svg);
await fs.writeFile(path.join(publicDir, 'favicon.png'), await png(64));
await fs.writeFile(path.join(icons, 'icon.png'), await png(512));
await fs.writeFile(path.join(icons, 'icon.ico'), await pngToIco(await Promise.all([16, 32, 48, 256].map(png))));

// ICNS supports PNG payloads. Generate a real container, not a renamed PNG.
const chunks = await Promise.all([
  ['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128],
  ['ic08', 256], ['ic09', 512], ['ic10', 1024],
].map(async ([type, size]) => {
  const payload = await png(size);
  const header = Buffer.alloc(8);
  header.write(type, 0, 4, 'ascii');
  header.writeUInt32BE(payload.length + 8, 4);
  return Buffer.concat([header, payload]);
}));
const header = Buffer.alloc(8);
header.write('icns', 0, 4, 'ascii');
header.writeUInt32BE(8 + chunks.reduce((sum, chunk) => sum + chunk.length, 0), 4);
await fs.writeFile(path.join(icons, 'icon.icns'), Buffer.concat([header, ...chunks]));
console.log('Generated MultiStudio favicon, PNG, ICO and ICNS from assets/icons/icon.svg.');
