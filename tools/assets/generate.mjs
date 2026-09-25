// Renders app icon / splash / adaptive-icon / favicon PNGs from a single vector glyph.
// Usage: cd tools/assets && npm install && npm run generate
import sharp from 'sharp';
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const assetsDir = path.resolve(here, '../../assets');

const BG = '#0F1115';
const GOLD = '#F5B840';
const GOLD_DEEP = '#D99A1E';

/**
 * Price-tag glyph in a 1024x1024 box: a rounded tag rotated -20deg, punched
 * hole at the top and a bold "?" cut out of it. The "?" and hole are cut with
 * a mask so the glyph is a single silhouette (works for monochrome icons).
 * The "?" is drawn as stroked paths, so no font is needed at render time.
 */
function glyph({ fill, scale = 1, gradient = true }) {
  const id = Math.random().toString(36).slice(2, 8);
  const fillRef = gradient ? `url(#g${id})` : fill;
  return `
  <defs>
    <linearGradient id="g${id}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${GOLD}"/>
      <stop offset="1" stop-color="${GOLD_DEEP}"/>
    </linearGradient>
    <mask id="m${id}">
      <rect x="252" y="132" width="520" height="760" rx="72" fill="#fff"/>
      <circle cx="512" cy="232" r="42" fill="#000"/>
      <path d="M402 472 A110 110 0 1 1 512 582 L512 648" fill="none" stroke="#000" stroke-width="72" stroke-linecap="round"/>
      <circle cx="512" cy="756" r="44" fill="#000"/>
    </mask>
  </defs>
  <g transform="translate(512 512) scale(${scale}) rotate(-20) translate(-512 -512)">
    <rect x="252" y="132" width="520" height="760" rx="72" fill="${fillRef}" mask="url(#m${id})"/>
  </g>`;
}

const svg = (size, inner, bg = null) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024">${
    bg ? `<rect width="1024" height="1024" fill="${bg}"/>` : ''
  }${inner}</svg>`;

const iconSvg = svg(1024, glyph({ fill: GOLD, scale: 0.86 }), BG);
const glyphOnlySvg = svg(1024, glyph({ fill: GOLD, scale: 1 }));
const foregroundSvg = svg(1024, glyph({ fill: GOLD, scale: 0.6 })); // fits 66% adaptive safe zone
const monoSvg = svg(1024, glyph({ fill: '#FFFFFF', scale: 0.6, gradient: false }));

const render = (s, size, out) => sharp(Buffer.from(s), { density: 72 }).resize(size, size).png().toFile(out);

async function main() {
  await mkdir(assetsDir, { recursive: true });
  await writeFile(path.join(here, 'icon.svg'), iconSvg);

  const outputs = [
    [iconSvg, 1024, 'icon.png'],
    [glyphOnlySvg, 512, 'splash-icon.png'],
    [foregroundSvg, 1024, 'android-icon-foreground.png'],
    [svg(1024, '', BG), 1024, 'android-icon-background.png'],
    [monoSvg, 1024, 'android-icon-monochrome.png'],
    [iconSvg, 48, 'favicon.png'],
  ];
  for (const [s, size, name] of outputs) {
    const out = path.join(assetsDir, name);
    if (name === 'icon.png' || name === 'favicon.png' || name === 'android-icon-background.png') {
      await sharp(Buffer.from(s)).resize(size, size).flatten({ background: BG }).png().toFile(out);
    } else {
      await render(s, size, out);
    }
  }

  // Legibility preview: icon at 180px and 60px on dark and light backgrounds.
  const icon180 = await sharp(Buffer.from(iconSvg)).resize(180, 180).png().toBuffer();
  const icon60 = await sharp(Buffer.from(iconSvg)).resize(60, 60).png().toBuffer();
  const rounded = async (buf, size, r) => {
    const m = Buffer.from(`<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${r}" fill="#fff"/></svg>`);
    return sharp(buf).composite([{ input: m, blend: 'dest-in' }]).png().toBuffer();
  };
  const i180 = await rounded(icon180, 180, 40);
  const i60 = await rounded(icon60, 60, 13);
  const W = 640, H = 300;
  const preview = sharp({ create: { width: W, height: H, channels: 4, background: '#0F1115' } })
    .composite([
      { input: Buffer.from(`<svg width="${W / 2}" height="${H}"><rect width="${W / 2}" height="${H}" fill="#F2F2F5"/></svg>`), left: W / 2, top: 0 },
      { input: i180, left: 40, top: 60 },
      { input: i60, left: 240, top: 120 },
      { input: i180, left: 360, top: 60 },
      { input: i60, left: 560, top: 120 },
    ]);
  await preview.png().toFile(path.join(here, 'app-store-icon-preview.png'));

  for (const name of ['icon.png', 'splash-icon.png', 'android-icon-foreground.png', 'android-icon-background.png', 'android-icon-monochrome.png', 'favicon.png']) {
    const m = await sharp(path.join(assetsDir, name)).metadata();
    console.log(`${name}: ${m.width}x${m.height} ch=${m.channels} alpha=${m.hasAlpha}`);
  }
  const p = await sharp(path.join(here, 'app-store-icon-preview.png')).metadata();
  console.log(`app-store-icon-preview.png: ${p.width}x${p.height}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
