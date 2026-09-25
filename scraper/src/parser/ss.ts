/**
 * SS.com HTML → raw strings. No interpretation happens here (docs/03: the
 * parser returns strings exactly as found; the normaliser types them).
 *
 * Selectors confirmed by the Phase 0 probe (docs/notes/ss-probe.md):
 *   list   : tr#tr_N > td.msga2 (thumb) | td.msg2 > div.d1 > a.am#dm_N | td.msga2-o.pp6 / td.msga2-r.pp6
 *            header row tr#head_line > td.msg_column_td; hidden tr#tr_bnr_* banner rows
 *   detail : td.ads_opt_name / td.ads_opt, td.ads_price (cars nest span.ads_price),
 *            h2.headtitle breadcrumb, #msg_div_msg description, div.ads_photo_label
 *            gallery with a[href$=".800.jpg"], td.ads_contacts_name "Vieta:",
 *            td.msg_footer "Datums: dd.mm.yyyy HH:MM", features via img[src*=kv.gif]
 */
import * as cheerio from 'cheerio';
import type { Cheerio, CheerioAPI } from 'cheerio';
import type { AnyNode } from 'domhandler';
import { BASE } from '../config.ts';
import type { SsRawDetail, SsRawListRow } from '../types.ts';

const ws = (s: string) => s.replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
const MSG_LINK = 'a[href*="/msg/lv/"]';

export const NOT_FOUND_RE = /sludinājums (nav atrasts|ir dzēsts|dzēsts|nav aktīvs)|объявление (не найдено|удалено)|nav atrasts/i;

export function parseList(html: string, baseUrl = BASE): SsRawListRow[] {
  const $ = cheerio.load(html);
  const rows: SsRawListRow[] = [];
  const seen = new Set<AnyNode>();

  $(MSG_LINK).each((_, aEl) => {
    const $tr = $(aEl).closest('tr');
    if (!$tr.length || seen.has($tr[0]!)) return;
    seen.add($tr[0]!);
    const id = $tr.attr('id');
    if (id && !/^tr_\d+$/.test(id)) return; // tr_bnr_* banner rows
    if (($tr.attr('style') ?? '').includes('display:none')) return;

    const titleLink = pickTitleLink($, $tr);
    const href = titleLink.attr('href');
    if (!href) return;

    const tds = $tr.children('td');
    const titleTd = titleLink.closest('td');
    const titleIdx = tds.toArray().indexOf(titleTd[0] as (typeof tds)[0]);
    const cells = tds
      .toArray()
      .slice(titleIdx + 1)
      .map((td) => cellText($, $(td)));

    const regionHint = ws(titleTd.find('.ads_region').text()) || undefined;
    rows.push({
      sourceUrl: new URL(href, baseUrl).toString(),
      rowId: id,
      titleSnippet: ws(titleLink.text()),
      cells,
      thumbUrl: $tr.find('img[src*="i.ss.com/gallery"]').first().attr('src') ?? undefined,
      promoted: /\b(pp7|msga2-top|top_msg|vip)\b/.test($tr.attr('class') ?? '') || $tr.find('img[src*="top"]').length > 0,
      regionHint,
    });
  });
  return rows;
}

/** The title link is the one with text; thumbnail links only wrap an <img>. */
function pickTitleLink($: CheerioAPI, $tr: Cheerio<AnyNode>) {
  const links = $tr.find(MSG_LINK);
  const am = links.filter('.am').first();
  if (am.length) return am;
  const withText = links.filter((_, x) => ws($(x).text()).length > 0).first();
  return withText.length ? withText : links.first();
}

/** `<td>Garkalnes nov.<br>Bukulti</td>` → "Garkalnes nov. Bukulti" (keep a space at <br>). */
function cellText($: CheerioAPI, $td: Cheerio<AnyNode>): string {
  const clone = $td.clone();
  clone.find('br').replaceWith(' ');
  return ws(clone.text());
}

/** Header texts of a list page (`tr#head_line`), for column mapping / drift tests. */
export function parseListHeaders(html: string): string[] {
  const $ = cheerio.load(html);
  const head = $('tr#head_line');
  if (!head.length) return [];
  return head
    .children('td')
    .map((_, td) => ws($(td).text()))
    .get();
}

/** Pagination links of the same list (lv only). */
export function parseListPages(html: string, listUrl: string): string[] {
  const $ = cheerio.load(html);
  const base = new URL(listUrl).pathname;
  const out = new Set<string>();
  $('a[href]').each((_, a) => {
    const h = $(a).attr('href')!;
    if (h.startsWith(base) && /page\d+\.html$/.test(h)) out.add(new URL(h, listUrl).toString());
  });
  return [...out].sort();
}

export function parseDetail(html: string, sourceUrl: string): SsRawDetail {
  const $ = cheerio.load(html);
  const attrs: Record<string, string> = {};

  $('td.ads_opt_name').each((_, el) => {
    const $label = $(el);
    const $value = $label.next('td');
    if (!$value.length) return;
    const label = ws($label.text()).replace(/:$/, '');
    let value = ws($value.text());
    value = value.replace(/\s*\[\s*Karte\s*\]\s*$/, '').replace(/\s*Aprēķināt apdrošināšanu.*$/, '');
    if (label && value) attrs[label] = value;
  });

  // Price: prefer the innermost .ads_price (cars nest a span inside the td); strip the insurance link text.
  let priceText = '';
  const priceEls = $('.ads_price');
  if (priceEls.length) {
    const inner = priceEls.filter((_, e) => $(e).find('.ads_price').length === 0).first();
    priceText = ws(inner.text()).replace(/\s*Aprēķināt apdrošināšanu.*$/, '');
  }
  if (!priceText && attrs['Cena']) priceText = attrs['Cena'];
  delete attrs['Cena'];

  // Breadcrumb: h2.headtitle "Dzīvokļi / Rīga / Purvciems / Pārdod"
  const crumbText = ws($('h2.headtitle').first().text());
  const breadcrumb = crumbText ? crumbText.split(/\s+\/\s+/).map(ws).filter(Boolean) : [];

  // Photos: gallery .800.jpg links in page order, deduped; fall back to thumbs converted to .800
  const photos: string[] = [];
  const seenPhoto = new Set<string>();
  const addPhoto = (u: string | undefined) => {
    if (!u) return;
    const m = u.match(/^(https?:\/\/i\.ss\.com\/gallery\/\d+\/\d+\/\d+\/[^/]+?)\.(th2|t|800)\.jpg/);
    if (!m) return;
    const full = `${m[1]}.800.jpg`;
    if (!seenPhoto.has(full)) {
      seenPhoto.add(full);
      photos.push(full);
    }
  };
  $('.ads_photo_label a[href*="i.ss.com/gallery"], .pic_dv_thumbnail a[href*="i.ss.com/gallery"]').each((_, a) => addPhoto($(a).attr('href')));
  if (!photos.length) $('img[src*="i.ss.com/gallery"], a[href*="i.ss.com/gallery"]').each((_, el) => addPhoto($(el).attr('href') ?? $(el).attr('src')));

  // Contacts block: Vieta (+ Uzņēmums for dealer flag). Phones/e-mail are never read.
  let locationText: string | undefined;
  $('td.ads_contacts_name').each((_, el) => {
    const label = ws($(el).text()).replace(/:$/, '');
    const value = ws($(el).next('td').text());
    if (label === 'Vieta' && value) locationText = value;
    if (label === 'Uzņēmums' && value) attrs['Uzņēmums'] = value;
  });

  // Footer date
  const footer = ws($('td.msg_footer').text());
  const postedAtText = footer.match(/Datums:\s*(\d{2}\.\d{2}\.\d{4}\s+\d{2}:\d{2})/)?.[1] ?? ws($('body').text()).match(/Datums:\s*(\d{2}\.\d{2}\.\d{4}\s+\d{2}:\d{2})/)?.[1];

  // Car features: div.auto_c_column > div.auto_c_head (section) + b.auto_c items (present items carry kv.gif). Stats only.
  const features: Record<string, string[]> = {};
  $('.auto_c_column').each((_, col) => {
    let section = 'Aprīkojums';
    $(col)
      .children()
      .each((_, child) => {
        const $c = $(child);
        if ($c.hasClass('auto_c_head')) section = ws($c.text()) || section;
        else if ($c.is('b.auto_c')) {
          const item = ws($c.text());
          if (item) (features[section] ??= []).push(item);
        }
      });
  });

  const descriptionLength = ws($('#msg_div_msg').text()).length;
  const bodyText = ws($('body').text());
  const notFound = Object.keys(attrs).length === 0 && !priceText && NOT_FOUND_RE.test(bodyText);

  return {
    sourceUrl,
    breadcrumb,
    attrs,
    priceText,
    photoUrls: photos,
    postedAtText,
    locationText,
    features: Object.keys(features).length ? features : undefined,
    descriptionLength,
    notFound,
  };
}

/** True when a fetched detail page says the ad is gone (used by the rechecker). */
export function detailIsGone(status: number, html: string): boolean {
  if (status === 404) return true;
  if (!html) return false;
  const $ = cheerio.load(html);
  if ($('.ads_price').length || $('td.ads_opt_name').length) return false;
  return NOT_FOUND_RE.test(ws($('body').text()));
}
