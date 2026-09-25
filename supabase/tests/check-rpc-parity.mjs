#!/usr/bin/env node
/**
 * Contract check: every `call<...>('name', { p_x: ... })` in src/api/rpc.ts must
 * exist as `create or replace function public.name(...)` in supabase/migrations
 * with matching p_* argument names, and must be granted to `authenticated`.
 *
 *   node supabase/tests/check-rpc-parity.mjs        # exit 1 on any mismatch
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const rpcSrc = readFileSync(join(root, 'src', 'api', 'rpc.ts'), 'utf8');
const migDir = join(root, 'supabase', 'migrations');
const sql = readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort()
  .map((f) => readFileSync(join(migDir, f), 'utf8')).join('\n')
  .replace(/--[^\n]*/g, '');   // strip line comments so `-- global | friends` can not break the param regex

// ── rpc.ts side ──────────────────────────────────────────────────────────────
const calls = new Map(); // name -> Set(args)
const callRe = /call<.*?>\(\s*'(\w+)'\s*(?:,\s*\{([\s\S]*?)\})?\s*\)/g;
for (const m of rpcSrc.matchAll(callRe)) {
  const [, name, argBlock] = m;
  const args = new Set([...(argBlock ?? '').matchAll(/(p_\w+)\s*:/g)].map((a) => a[1]));
  const prev = calls.get(name) ?? new Set();
  for (const a of args) prev.add(a);
  calls.set(name, prev);
}
if (calls.size === 0) { console.error('no call<...>() sites found in rpc.ts'); process.exit(1); }

// ── migrations side ──────────────────────────────────────────────────────────
const fns = new Map(); // name -> { params: [{name, hasDefault}], granted }
const fnRe = /create\s+or\s+replace\s+function\s+public\.(\w+)\s*\(([\s\S]*?)\)\s*returns/gi;
for (const m of sql.matchAll(fnRe)) {
  const [, name, paramBlock] = m;
  const params = paramBlock
    .replace(/--[^\n]*/g, '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => ({ name: s.split(/\s+/)[0], hasDefault: /\bdefault\b/i.test(s) }));
  fns.set(name, { params, granted: false });
}
const grantRe = /grant\s+execute\s+on\s+function\s+public\.(\w+)\s*\([^)]*\)\s+to\s+([^;]+);/gi;
for (const m of sql.matchAll(grantRe)) {
  const f = fns.get(m[1]);
  if (f && /\bauthenticated\b/.test(m[2])) f.granted = true;
}

// ── compare ──────────────────────────────────────────────────────────────────
let failures = 0;
const ok = (msg) => console.log(`  ok    ${msg}`);
const bad = (msg) => { failures++; console.log(`  FAIL  ${msg}`); };

console.log(`rpc.ts calls: ${calls.size}, migration functions: ${fns.size}\n`);
for (const [name, args] of [...calls.entries()].sort()) {
  const fn = fns.get(name);
  if (!fn) { bad(`${name}: missing in migrations`); continue; }
  const paramNames = new Set(fn.params.map((p) => p.name));
  const missing = [...args].filter((a) => !paramNames.has(a));
  const unpassedRequired = fn.params.filter((p) => !p.hasDefault && !args.has(p.name)).map((p) => p.name);
  if (missing.length) bad(`${name}: rpc.ts passes ${missing.join(', ')} but function has (${[...paramNames].join(', ')})`);
  else if (unpassedRequired.length) bad(`${name}: function requires ${unpassedRequired.join(', ')} which rpc.ts never passes`);
  else if (!fn.granted) bad(`${name}: no "grant execute ... to authenticated"`);
  else ok(`${name}(${[...args].join(', ')})`);
}

console.log(failures ? `\n${failures} mismatch(es)` : '\nall RPCs in parity');
process.exit(failures ? 1 : 0);
