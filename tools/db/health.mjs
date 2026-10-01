// Health check used by CI after the nightly scrape: fails loudly instead of silently shipping an empty daily.
import pg from 'pg';
const url = process.env.SUPABASE_DB_URL; if (!url) { console.error('SUPABASE_DB_URL missing'); process.exit(2); }
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } }); await c.connect();
const q = async (sql) => (await c.query(sql)).rows[0];
const run = await q(`select finished_at, new_rows, updated_rows, notes from scrape_runs order by id desc limit 1`);
const fresh = await q(`select count(*)::int n from listings where status='active' and checked_at > now() - interval '36 hours'`);
const daily = await q(`select count(*)::int n from daily_sets where day >= (now() at time zone 'Europe/Riga')::date`);
await c.end();
const problems = [];
if (!run?.finished_at) problems.push('last scrape run did not finish');
if (run && /crash|BLOCKED/i.test(run.notes ?? '')) problems.push(`last scrape run: ${run.notes}`);
if ((run?.new_rows ?? 0) + (run?.updated_rows ?? 0) === 0) problems.push('last scrape run wrote 0 rows');
if (fresh.n < 200) problems.push(`only ${fresh.n} active listings checked in the last 36 h`);
if (daily.n < 1) problems.push('no daily set for today');
console.log(JSON.stringify({ run, freshActive: fresh.n, dailySetsFromToday: daily.n, problems }, null, 1));
if (problems.length) process.exit(1);
