#!/usr/bin/env -S npx tsx
/**
 * CLI
 *   scrape run [--category flats,cars] [--dry-run] [--limit N] [--no-recheck]
 *   scrape recheck [--limit N] [--dry-run]
 *   scrape stats
 *   scrape parse <file.html> [--category cars] [--url https://www.ss.com/msg/lv/...]   (offline, for fixtures)
 *
 * --dry-run never touches the DB and prints parsed listings as JSON lines.
 */
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { env, politeness } from './config.ts';
import { Fetcher } from './fetcher.ts';
import { normalise, rawFromDetail } from './normaliser.ts';
import { parseDetail, parseList } from './parser/ss.ts';
import { checkQuality } from './quality.ts';
import { recheck, recheckDefaults } from './rechecker.ts';
import { runNight } from './scheduler.ts';
import type { SsCategory } from './types.ts';
import { createMemoryWriter, createWriter } from './writer.ts';

const Category = z.enum(['flats', 'houses', 'cars', 'land', 'random']);

const [, , command = 'help', ...rest] = process.argv;
const flags: Record<string, string | boolean> = {};
const positional: string[] = [];
for (let i = 0; i < rest.length; i++) {
  const a = rest[i]!;
  if (a.startsWith('--')) {
    const next = rest[i + 1];
    if (next && !next.startsWith('--')) {
      flags[a.slice(2)] = next;
      i++;
    } else flags[a.slice(2)] = true;
  } else positional.push(a);
}
const dryRun = flags['dry-run'] === true;
const limit = typeof flags['limit'] === 'string' ? Number(flags['limit']) : process.env.SCRAPER_LIMIT ? Number(process.env.SCRAPER_LIMIT) : undefined;
const categories = typeof flags['category'] === 'string' ? z.array(Category).parse(flags['category'].split(',')) : undefined;
const log = (s: string) => console.error(`[${new Date().toISOString().slice(11, 19)}] ${s}`);

function requireMailto() {
  if (!env.mailto) {
    console.error('SCRAPER_MAILTO is not set. The User-Agent must carry a real contact address (docs/09).');
    process.exit(1);
  }
}

async function cmdRun() {
  requireMailto();
  const fetcher = new Fetcher({ log });
  const writer = dryRun ? createMemoryWriter() : createWriter();
  const report = await runNight(fetcher, writer, {
    categories,
    limit,
    dryRun,
    skipRechecks: flags['no-recheck'] === true,
    log,
    onListing: dryRun ? (l, v) => console.log(JSON.stringify({ verdict: v, ...l, attributes: { ...l.attributes, _raw: undefined } })) : undefined,
  });
  log(`run finished: ${JSON.stringify({ ...report, zeroRowPages: report.zeroRowPages.length })}`);
  if (report.zeroRowPages.length) log(`zero-row list pages (unknown slugs or index pages):\n  ${report.zeroRowPages.join('\n  ')}`);
  if (report.blocked) process.exit(2);
}

async function cmdRecheck() {
  requireMailto();
  const fetcher = new Fetcher({ log, budget: Math.min(politeness.nightlyBudget, (limit ?? recheckDefaults.limit) + 5) });
  const writer = createWriter();
  const targets = await writer.dueForRecheck(limit ?? recheckDefaults.limit, recheckDefaults.olderThanDays);
  log(`${targets.length} listings due for recheck`);
  const runId = dryRun ? 0 : await writer.startRun('ss', 'recheck');
  const stats = await recheck(fetcher, writer, targets, { log, dryRun });
  if (!dryRun) await writer.finishRun(runId, { requests: fetcher.stats.requests, expired_rows: stats.expired, updated_rows: stats.alive, errors: stats.errors });
  console.log(JSON.stringify(stats, null, 2));
}

async function cmdStats() {
  const writer = createWriter();
  const [runs, pool] = await Promise.all([writer.runStats(10), writer.poolStats()]);
  console.log('Active pool per category (target: flats 1500, houses 400, cars 1500, random 600):');
  console.table(pool);
  console.log('Last runs:');
  console.table(runs.map((r) => ({ id: r.id, started: r.started_at?.slice(0, 16), finished: r.finished_at?.slice(11, 16), req: r.requests, new: r.new_rows, upd: r.updated_rows, exp: r.expired_rows, err: r.errors, blocked: r.blocked_until ?? '', rejected: JSON.stringify(r.rejected) })));
}

function cmdParse() {
  const file = positional[0];
  if (!file) throw new Error('usage: scrape parse <file.html> [--category cars] [--url URL] [--list]');
  const html = readFileSync(file, 'utf8');
  if (flags['list']) {
    console.log(JSON.stringify(parseList(html), null, 2));
    return;
  }
  const url = typeof flags['url'] === 'string' ? flags['url'] : 'https://www.ss.com/msg/lv/unknown/x/aaaaa.html';
  const category = Category.parse(flags['category'] ?? 'flats');
  const detail = parseDetail(html, url);
  const listing = normalise(rawFromDetail(category, url.replace(/\/[a-z]+\.html$/, '/sell/').replace('/msg/', '/'), detail));
  console.log(JSON.stringify({ detail: { ...detail, photoUrls: detail.photoUrls.length }, listing, quality: checkQuality(listing) }, null, 2));
}

const commands: Record<string, () => Promise<void> | void> = { run: cmdRun, recheck: cmdRecheck, stats: cmdStats, parse: cmdParse };
if (!commands[command]) {
  console.log(readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0]!.replace(/^#!.*$|^\/\*\*?|^\s\*\s?/gm, ''));
  process.exit(command === 'help' ? 0 : 1);
}
await commands[command]!();
