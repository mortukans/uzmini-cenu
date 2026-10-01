// Audit active listings: HEAD the first photo; i.ss.com returns a 49-byte GIF (HTTP 200) when photos are gone.
import pg from 'pg'; import fs from 'node:fs'; import path from 'node:path';
const root = path.resolve(import.meta.dirname, '../..');
const url = process.env.SUPABASE_DB_URL || /SUPABASE_DB_URL=(.+)/.exec(fs.readFileSync(path.join(root, '.env.local'), 'utf8'))[1].trim();
const fix = process.argv.includes('--fix');
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } }); await c.connect();
const { rows } = await c.query(`select id, photo_urls[1] p from listings where status='active' and array_length(photo_urls,1) > 0 order by id`);
const dead = [];
let i = 0;
for (const r of rows) {
  i++;
  try {
    const res = await fetch(r.p, { method: 'HEAD', headers: { 'User-Agent': 'UzminiCenuBot/1.0 (+mailto:mortukans@gmail.com)' }, signal: AbortSignal.timeout(10000) });
    const len = Number(res.headers.get('content-length') ?? 0); const ct = res.headers.get('content-type') ?? '';
    if (res.status !== 200 || len < 2000 || !ct.startsWith('image/jpeg')) dead.push({ id: r.id, status: res.status, len, ct });
  } catch (e) { dead.push({ id: r.id, status: 0, len: 0, ct: String(e.message).slice(0, 40) }); }
  if (i % 100 === 0) console.log(`${i}/${rows.length} checked, ${dead.length} dead`);
  await new Promise((s) => setTimeout(s, 150));
}
console.log(`checked ${rows.length}, dead ${dead.length}`);
if (fix && dead.length) {
  await c.query(`update listings set status='expired', checked_at=now(), attributes = attributes || '{"reject_reason":"photo_dead"}' where id = any($1::bigint[])`, [dead.map((d) => d.id)]);
  console.log('expired', dead.length);
}
await c.end();
