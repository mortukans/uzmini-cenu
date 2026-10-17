#!/usr/bin/env node
/**
 * App Store release steps through the ASC API (no browser login needed).
 *   node tools/asc/release.mjs create 0.2.0          # new version (release after approval)
 *   node tools/asc/release.mjs notes 0.2.0 <file.md> # What's New from docs/notes/release-x.md (## English + ## Latvian [+ ## Russian])
 *   node tools/asc/release.mjs build 0.2.0 28        # attach build number 28 (must be VALID)
 *   node tools/asc/release.mjs submit 0.2.0          # create review submission + submit
 *   node tools/asc/release.mjs status
 */
import { readFileSync } from 'node:fs';
import { asc, APP_ID } from './client.mjs';

const [cmd, ver, arg] = process.argv.slice(2);

async function version(v) {
  const r = await asc('GET', `/apps/${APP_ID}/appStoreVersions?filter[versionString]=${v}&filter[platform]=IOS&limit=1`);
  return r.data[0] ?? null;
}

/** "## English" / "## Latvian" / "## Russian" blocks → { English, Latvian, Russian }. */
const sections = (md) => {
  const out = {};
  let cur = null;
  for (const line of md.split(/\r?\n/)) {
    const h = line.match(/^## (\w+)/);
    if (h) { cur = h[1]; out[cur] = []; } else if (cur) out[cur].push(line);
  }
  for (const k in out) out[k] = out[k].join('\n').trim();
  return out;
};

if (cmd === 'status') {
  const r = await asc('GET', `/apps/${APP_ID}/appStoreVersions?filter[platform]=IOS&limit=3&include=build`);
  for (const x of r.data) console.log(x.attributes.versionString, x.attributes.appVersionState, x.attributes.releaseType);
  for (const b of r.included ?? []) console.log('  build', b.attributes.version, b.attributes.processingState);
  const s = await asc('GET', `/reviewSubmissions?filter[app]=${APP_ID}&limit=3`);
  for (const x of s.data) console.log('  submission', x.attributes.state, x.attributes.submittedDate ?? '');
} else if (cmd === 'create') {
  if (await version(ver)) { console.log(`version ${ver} already exists`); process.exit(0); }
  const r = await asc('POST', '/appStoreVersions', {
    data: { type: 'appStoreVersions', attributes: { platform: 'IOS', versionString: ver, releaseType: 'AFTER_APPROVAL' },
      relationships: { app: { data: { type: 'apps', id: APP_ID } } } },
  });
  console.log('created', r.data.id, r.data.attributes.versionString, r.data.attributes.appVersionState);
} else if (cmd === 'notes') {
  const v = await version(ver); if (!v) throw new Error(`no version ${ver}`);
  const { English: en = '', Latvian: lv = '', Russian: ru = '' } = sections(readFileSync(arg, 'utf8'));
  if (!en || !lv) throw new Error('release notes need ## English and ## Latvian sections');
  const locs = await asc('GET', `/appStoreVersions/${v.id}/appStoreVersionLocalizations`);
  for (const l of locs.data) {
    const loc = l.attributes.locale;
    // Only an en-US localization exists on the listing: English first, Latvian below it.
    const text = loc.startsWith('lv') ? lv : loc.startsWith('ru') ? ru : [en, '', '— — —', '', lv].join('\n');
    await asc('PATCH', `/appStoreVersionLocalizations/${l.id}`, { data: { type: 'appStoreVersionLocalizations', id: l.id, attributes: { whatsNew: text } } });
    console.log('whatsNew set for', loc, `(${text.length} chars)`);
  }
} else if (cmd === 'build') {
  const v = await version(ver); if (!v) throw new Error(`no version ${ver}`);
  const b = await asc('GET', `/builds?filter[app]=${APP_ID}&filter[version]=${arg}&limit=1`);
  const build = b.data[0]; if (!build) throw new Error(`build ${arg} not found`);
  if (build.attributes.processingState !== 'VALID') throw new Error(`build ${arg} is ${build.attributes.processingState}`);
  await asc('PATCH', `/appStoreVersions/${v.id}/relationships/build`, { data: { type: 'builds', id: build.id } });
  console.log(`attached build ${arg} (${build.id}) to ${ver}`);
} else if (cmd === 'submit') {
  const v = await version(ver); if (!v) throw new Error(`no version ${ver}`);
  const sub = await asc('POST', '/reviewSubmissions', {
    data: { type: 'reviewSubmissions', attributes: { platform: 'IOS' }, relationships: { app: { data: { type: 'apps', id: APP_ID } } } },
  });
  await asc('POST', '/reviewSubmissionItems', {
    data: { type: 'reviewSubmissionItems', relationships: {
      reviewSubmission: { data: { type: 'reviewSubmissions', id: sub.data.id } },
      appStoreVersion: { data: { type: 'appStoreVersions', id: v.id } } } },
  });
  const done = await asc('PATCH', `/reviewSubmissions/${sub.data.id}`, { data: { type: 'reviewSubmissions', id: sub.data.id, attributes: { submitted: true } } });
  console.log('submitted:', done.data.attributes.state, done.data.id);
} else {
  console.log('usage: create <ver> | notes <ver> <md> | build <ver> <buildNo> | submit <ver> | status');
}
