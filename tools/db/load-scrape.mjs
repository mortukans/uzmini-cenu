// Load scraper --dry-run JSONL into listings via pg (no service key needed).
import pg from 'pg'; import fs from 'node:fs'; import path from 'node:path';
const root = path.resolve(import.meta.dirname, '../..');
const url = /SUPABASE_DB_URL=(.+)/.exec(fs.readFileSync(path.join(root, '.env.local'), 'utf8'))[1].trim();
const lines = fs.readFileSync(process.argv[2] ?? path.join(root, 'tools/db/scrape-dry.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const ok = lines.filter((l) => l.verdict?.ok && l.price_eur && l.photo_urls?.length);
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } }); await c.connect();
let n = 0;
for (const l of ok) {
  const photoHash = l.photo_urls[0]?.match(/(\d+)\.800\.jpg$/)?.[1] ? `ssid:${l.photo_urls[0].match(/(\d+)\.800\.jpg$/)[1]}` : null;
  await c.query(`insert into listings (source, source_url, category, price_eur, region, location, attributes, title_hint, photo_urls, photo_hash, status, first_seen_at, checked_at)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'active',coalesce($11::timestamptz, now()),now())
    on conflict (source_url) do update set price_eur=excluded.price_eur, attributes=excluded.attributes, photo_urls=excluded.photo_urls, status='active', checked_at=now()`,
    [l.source, l.source_url, l.category, l.price_eur, l.region, l.location, l.attributes ?? {}, l.title_hint, l.photo_urls.slice(0, 8), photoHash, l.posted_at ?? null]);
  n++;
}
const { rows } = await c.query(`select category, count(*)::int n from listings where status='active' and source='ss' group by 1 order by 1`);
console.log('inserted/updated', n, 'of', lines.length, '→ active SS listings by category:', JSON.stringify(rows));
await c.end();
