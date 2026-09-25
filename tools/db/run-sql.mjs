// node tools/db/run-sql.mjs <file.sql|"inline sql">  — runs against SUPABASE_DB_URL from .env.local
import pg from 'pg'; import fs from 'node:fs'; import path from 'node:path';
const root = path.resolve(import.meta.dirname, '../..');
const env = fs.readFileSync(path.join(root, '.env.local'), 'utf8');
const url = /SUPABASE_DB_URL=(.+)/.exec(env)[1].trim();
const arg = process.argv[2]; const sql = fs.existsSync(arg) ? fs.readFileSync(arg, 'utf8') : arg;
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();
try { const r = await c.query(sql); const rows = Array.isArray(r) ? r.at(-1)?.rows : r.rows; console.log(JSON.stringify(rows ?? 'ok', null, 1).slice(0, 4000)); }
catch (e) { console.error('SQL ERROR:', e.message, e.position ? `at ${e.position}` : '', e.hint ?? ''); process.exit(1); }
finally { await c.end(); }
