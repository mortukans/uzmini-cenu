/**
 * Composes final App Store screenshots (1290x2796, iPhone 6.7") from the raw
 * captures in out/raw-*.png: dark gradient background, headline + gold
 * subtitle, and the device screenshot with rounded corners bleeding off the
 * bottom edge. Also writes preview-contact-sheet.png.
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const OUT = path.resolve(import.meta.dirname, 'out');
const W = 1290;
const H = 2796;

const SLIDES = [
  { raw: '01-home', out: '01-home', title: 'Uzmini, cik maksā', sub: 'Reāli sludinājumi no SS.com' },
  { raw: '02-round', out: '02-round', title: 'Dzīvokļi, mājas, auto', sub: 'un dīvaini priekšmeti' },
  { raw: '03-reveal', out: '03-reveal', title: 'Punkti par precizitāti', sub: 'Jo tuvāk, jo vairāk' },
  { raw: '04-daily', out: '04-daily', title: 'Dienas izaicinājums', sub: 'Vieni un tie paši 5 sludinājumi visiem' },
  { raw: '05-cars', out: '05-cars', title: 'Cik maksā šis auto?', sub: 'Uzmini un salīdzini' },
  { raw: '06-friends', out: '06-friends', title: 'Spēlē ar draugiem', sub: 'Dueļi un līderu tabulas' },
];

const BG_TOP = '#0F1115';
const BG_BOTTOM = '#181B22';
const GOLD = '#F5B840';
const BORDER = '#2A2F3A';
const FONT = 'Helvetica, Arial, sans-serif';

const SHOT_W = Math.round(W * 0.84); // ~1084
const SHOT_H = Math.round(SHOT_W * (H / W));
const RADIUS = 60;
const BORDER_PX = 6;
const SHOT_TOP = 430; // below the text block
const BLEED = 90; // pixels of the screenshot pushed past the bottom edge

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Shrink the subtitle a little when it is long so it stays on one line. */
const subSize = (s) => (s.length > 34 ? 34 : 40);

function backgroundSvg() {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${BG_TOP}"/><stop offset="1" stop-color="${BG_BOTTOM}"/>
  </linearGradient></defs>
  <rect width="${W}" height="${H}" fill="url(#g)"/>
</svg>`);
}

function textSvg(title, sub) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${SHOT_TOP}">
  <text x="${W / 2}" y="200" text-anchor="middle" font-family="${FONT}" font-size="72" font-weight="700" fill="#FFFFFF">${esc(title)}</text>
  <text x="${W / 2}" y="290" text-anchor="middle" font-family="${FONT}" font-size="${subSize(sub)}" font-weight="500" fill="${GOLD}">${esc(sub)}</text>
</svg>`);
}

/** Rounded-rect mask and border ring for the device shot. */
const roundedMask = () => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${SHOT_W}" height="${SHOT_H}">
  <rect width="${SHOT_W}" height="${SHOT_H}" rx="${RADIUS}" ry="${RADIUS}" fill="#fff"/></svg>`);
const borderRing = () => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${SHOT_W}" height="${SHOT_H}">
  <rect x="${BORDER_PX / 2}" y="${BORDER_PX / 2}" width="${SHOT_W - BORDER_PX}" height="${SHOT_H - BORDER_PX}" rx="${RADIUS}" ry="${RADIUS}"
        fill="none" stroke="${BORDER}" stroke-width="${BORDER_PX}"/></svg>`);

async function compose(slide) {
  const rawPath = path.join(OUT, `raw-${slide.raw}.png`);
  if (!fs.existsSync(rawPath)) throw new Error(`missing ${rawPath} — run capture.mjs first`);

  const shot = await sharp(rawPath).resize(SHOT_W, SHOT_H, { fit: 'cover' })
    .composite([{ input: roundedMask(), blend: 'dest-in' }, { input: borderRing(), blend: 'over' }])
    .png().toBuffer();

  // Bottom-aligned with a slight bleed: the shot's top sits at SHOT_TOP, the rest is clipped.
  const shotTop = Math.max(SHOT_TOP, H + BLEED - SHOT_H);
  const visibleH = Math.min(SHOT_H, H - shotTop);
  const shotClipped = await sharp(shot).extract({ left: 0, top: 0, width: SHOT_W, height: visibleH }).toBuffer();

  const outPath = path.join(OUT, `${slide.out}.png`);
  await sharp(backgroundSvg())
    .composite([
      { input: textSvg(slide.title, slide.sub), top: 0, left: 0 },
      { input: shotClipped, top: shotTop, left: Math.round((W - SHOT_W) / 2) },
    ])
    .png({ compressionLevel: 9 })
    .toFile(outPath);

  const meta = await sharp(outPath).metadata();
  if (meta.width !== W || meta.height !== H || meta.format !== 'png') {
    throw new Error(`${outPath}: expected ${W}x${H} png, got ${meta.width}x${meta.height} ${meta.format}`);
  }
  console.log(`  ${slide.out}.png  ${meta.width}x${meta.height} ${meta.format}`);
  return outPath;
}

const finals = [];
for (const s of SLIDES) finals.push(await compose(s));

// Contact sheet: all six side by side at 1/5 scale.
const TW = Math.round(W / 5);
const TH = Math.round(H / 5);
const GAP = 24;
const thumbs = await Promise.all(finals.map((f) => sharp(f).resize(TW, TH).png().toBuffer()));
await sharp({ create: { width: TW * finals.length + GAP * (finals.length + 1), height: TH + GAP * 2, channels: 4, background: '#000000' } })
  .composite(thumbs.map((input, i) => ({ input, left: GAP + i * (TW + GAP), top: GAP })))
  .png().toFile(path.join(OUT, 'preview-contact-sheet.png'));
console.log('  preview-contact-sheet.png');
console.log('done');
