/**
 * Captures raw App Store screenshots from the web build (npx expo start --web --port 8095).
 * Output: tools/screenshots/out/raw-0N-*.png at 1290x2796 (430x932 @3x).
 *
 * Prices are never sent to the client, so to make reveals look good we read the
 * round's listing (price-free, with source_url) from the get_rounds/get_daily
 * responses and look the price up directly in Postgres (.env.local SUPABASE_DB_URL).
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';

const ROOT = path.resolve(import.meta.dirname, '../..');
const OUT = path.resolve(import.meta.dirname, 'out');
const BASE = process.env.APP_URL ?? 'http://localhost:8095';
fs.mkdirSync(OUT, { recursive: true });

const readEnv = (file) => Object.fromEntries(
  fs.readFileSync(path.join(ROOT, file), 'utf8').split(/\r?\n/).filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const env = { ...readEnv('.env'), ...readEnv('.env.local') };

// ─── price lookup ────────────────────────────────────────────────────────────
const db = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
const priceCache = new Map();
async function priceFor(sourceUrl) {
  if (priceCache.has(sourceUrl)) return priceCache.get(sourceUrl);
  const r = await db.query('select price_eur from public.listings where source_url = $1', [sourceUrl]);
  const p = r.rows[0]?.price_eur ?? null;
  priceCache.set(sourceUrl, p);
  return p;
}

// ─── browser ─────────────────────────────────────────────────────────────────
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 430, height: 932 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  locale: 'lv-LV',
  timezoneId: 'Europe/Riga',
  colorScheme: 'dark',
});
const page = await context.newPage();

/** Rounds seen in RPC responses, keyed by first photo url and by listing id. */
const roundsByPhoto = new Map();
const roundsById = new Map();
let lastRounds = [];
const remember = (rounds) => {
  lastRounds = rounds;
  for (const r of rounds) {
    roundsById.set(r.id, r);
    for (const u of r.photo_urls ?? []) roundsByPhoto.set(u, r);
  }
};
page.on('response', async (res) => {
  const url = res.url();
  if (!/\/rest\/v1\/rpc\/(get_rounds|get_daily)/.test(url) || res.request().method() !== 'POST') return;
  try {
    const body = await res.json();
    const rounds = Array.isArray(body) ? body : body?.rounds;
    if (Array.isArray(rounds)) remember(rounds);
  } catch { /* ignore */ }
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const btn = (name) => page.getByRole('button', { name, exact: true });

async function settle() {
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  await sleep(400);
}

/** Wait until at least one listing photo is decoded. */
async function waitPhotos(timeout = 15_000) {
  await settle();
  await page.waitForFunction(
    () => Array.from(document.images).some((i) => i.naturalWidth > 0 && /ss\.(com|lv)/.test(i.src) && i.getBoundingClientRect().width > 100),
    null, { timeout },
  ).catch(() => console.warn('  ! photo did not load in time, capturing anyway'));
  await sleep(600); // let expo-image fade-in finish
}

async function capture(name) {
  const file = path.join(OUT, `raw-${name}.png`);
  await page.screenshot({ path: file, fullPage: false, animations: 'disabled' });
  console.log('  captured', path.basename(file));
}

/** Identify the listing currently on screen from its visible photo. */
async function currentRound() {
  const srcs = await page.evaluate(() => Array.from(document.images)
    .filter((i) => i.getBoundingClientRect().width > 100 && i.getBoundingClientRect().height > 50)
    .map((i) => i.currentSrc || i.src));
  for (const s of srcs) {
    for (const [u, r] of roundsByPhoto) if (s === u || s.includes(u) || u.includes(s)) return r;
  }
  return null;
}

/** Type digits by clicking the custom keypad. */
async function typeGuess(value) {
  await btn('Dzēst').click({ delay: 900 }).catch(() => {}); // long press clears (harmless if already empty)
  for (const d of String(Math.round(value))) {
    await btn(d).click();
    await sleep(60);
  }
}

const nice = (n) => (n >= 100_000 ? Math.round(n / 1000) * 1000 : n >= 10_000 ? Math.round(n / 500) * 500 : n >= 1000 ? Math.round(n / 100) * 100 : Math.round(n / 10) * 10);

/** Guess `factor` × real price (falls back to an index-based guess if the price is unknown). */
async function guessFor(fallbackIndex, factor) {
  let round = await currentRound();
  if (!round && lastRounds[fallbackIndex]) round = lastRounds[fallbackIndex];
  const price = round ? await priceFor(round.source_url) : null;
  const guess = price ? nice(price * factor) : 25_000;
  console.log(`  round ${round?.id ?? '?'} ${round?.category ?? ''} price=${price} guess=${guess}`);
  return guess;
}

async function waitReveal() {
  await Promise.race([
    btn('Nākamais').waitFor({ state: 'visible', timeout: 30_000 }),
    btn('Rezultāts').waitFor({ state: 'visible', timeout: 30_000 }),
  ]);
  await sleep(500);
}

// ─── flow ─────────────────────────────────────────────────────────────────────
try {
  console.log('1. home');
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await btn('Izlaist').waitFor({ timeout: 90_000 });
  await btn('Izlaist').click();
  await btn('Spēlēt šodien').waitFor({ timeout: 30_000 });
  await settle();
  await capture('01-home');

  console.log('2. flats round');
  await btn('Dzīvokļi').click();
  await btn('Rīga').click();
  await page.getByRole('button', { name: /Brīvā spēle/ }).click();
  await btn('Uzmini!').waitFor({ timeout: 30_000 });
  await waitPhotos();
  await typeGuess(await guessFor(0, 0.96));
  await sleep(300);
  await capture('02-round');

  console.log('3. reveal');
  await btn('Uzmini!').click();
  await waitReveal();
  await capture('03-reveal');

  console.log('4. daily');
  await page.goto(`${BASE}/daily`, { waitUntil: 'domcontentloaded' });
  await btn('Spēlēt').waitFor({ timeout: 60_000 });
  await settle();
  await btn('Spēlēt').click();
  const factors = [0.97, 1.04, 0.85, 1.03, 0.95]; // 🟩🟩🟨🟩🟩
  for (let i = 0; i < 5; i++) {
    await btn('Uzmini!').waitFor({ timeout: 30_000 });
    await waitPhotos(10_000);
    await typeGuess(await guessFor(i, factors[i]));
    await btn('Uzmini!').click();
    await waitReveal();
    if (await btn('Rezultāts').isVisible()) await btn('Rezultāts').click();
    else await btn('Nākamais').click();
  }
  await btn('Dalīties').waitFor({ timeout: 30_000 });
  await settle();
  await capture('04-daily');

  console.log('5. cars round');
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await btn('Spēlēt šodien').or(btn('Šodien jau izspēlēts')).first().waitFor({ timeout: 60_000 });
  await btn('Auto').click();
  await btn('Latvija').click();
  await page.getByRole('button', { name: /Brīvā spēle/ }).click();
  await btn('Uzmini!').waitFor({ timeout: 30_000 });
  await waitPhotos();
  await typeGuess(await guessFor(0, 1.03));
  await sleep(300);
  await capture('05-cars');

  console.log('6. profile with username');
  const username = `screenshot_demo_${Math.random().toString(36).slice(2, 5)}`.slice(0, 16);
  await page.goto(`${BASE}/profile`, { waitUntil: 'domcontentloaded' });
  await btn('Izvēlēties lietotājvārdu').waitFor({ timeout: 60_000 });
  await btn('Izvēlēties lietotājvārdu').click();
  const input = page.getByLabel('Izvēlies lietotājvārdu').or(page.getByPlaceholder('piem. martins_r')).first();
  await input.waitFor({ timeout: 15_000 });
  await input.fill(username);
  await sleep(300);
  await btn('Saglabāt').click();
  await page.getByText(username).first().waitFor({ timeout: 30_000 });
  await settle();
  await capture('06-friends');

  // Clean up the demo account (delete_me RPC as the browser's anonymous user).
  const token = await page.evaluate(() => {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith('sb-') && k.endsWith('-auth-token')) {
        try { return JSON.parse(localStorage.getItem(k)).access_token; } catch { return null; }
      }
    }
    return null;
  });
  if (token) {
    const sb = createClient(env.EXPO_PUBLIC_SUPABASE_URL, env.EXPO_PUBLIC_SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false },
    });
    const { error } = await sb.rpc('delete_me');
    console.log(error ? `  delete_me failed: ${error.message}` : `  deleted demo account ${username}`);
  }
} finally {
  await browser.close();
  await db.end();
}
console.log('done');
