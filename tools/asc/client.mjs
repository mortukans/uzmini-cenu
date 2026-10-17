// Minimal App Store Connect API client (ES256 JWT from the team key in .secrets).
// Usage from other scripts: import { asc } from './client.mjs'; await asc('GET', '/apps/...')
import { readFileSync } from 'node:fs';
import { createSign } from 'node:crypto';

const KEY_ID = process.env.ASC_KEY_ID ?? 'VT9T8N85PX';
const ISSUER = process.env.ASC_ISSUER_ID ?? '5cb73313-0bc9-4f59-ab41-723263fae956';
const KEY_PATH = process.env.ASC_KEY_PATH ?? new URL(`../../.secrets/AuthKey_${KEY_ID}.p8`, import.meta.url);
export const APP_ID = '6816056345';

function jwt() {
  const key = readFileSync(KEY_PATH, 'utf8');
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const h = b64({ alg: 'ES256', kid: KEY_ID, typ: 'JWT' });
  const p = b64({ iss: ISSUER, iat: now, exp: now + 1200, aud: 'appstoreconnect-v1' });
  const sig = createSign('sha256').update(`${h}.${p}`).sign({ key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  return `${h}.${p}.${sig}`;
}

export async function asc(method, path, body) {
  const res = await fetch(`https://api.appstoreconnect.apple.com/v1${path}`, {
    method,
    headers: { Authorization: `Bearer ${jwt()}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(json?.errors ?? json).slice(0, 600)}`);
  return json;
}
