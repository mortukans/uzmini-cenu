// End-to-end RPC smoke test as an anonymous user through the public API.
import { createClient } from '@supabase/supabase-js';
const url = 'https://szlqqshbuswezepvnzsb.supabase.co', key = 'sb_publishable_y712wSYSHQbGuVNEEf136Q_h4YWsYZf';
const sb = createClient(url, key, { auth: { persistSession: false } });
const rpc = async (fn, args) => { const { data, error } = await sb.rpc(fn, args); if (error) throw new Error(`${fn}: ${error.message}`); return data; };
const { data: auth, error: aerr } = await sb.auth.signInAnonymously(); if (aerr) throw aerr;
console.log('anon user', auth.user.id);
const rounds = await rpc('get_rounds', { p_category: 'flats', p_region: null, p_n: 3 });
console.log('rounds', rounds.length, 'keys', Object.keys(rounds[0]).join(','), 'price leaked?', 'price_eur' in rounds[0]);
const g = await rpc('submit_guess', { p_token: rounds[0].token, p_guess: 80000, p_time_ms: 1200 });
console.log('guess result', g);
try { await rpc('submit_guess', { p_token: rounds[0].token, p_guess: 80000 }); console.log('REPLAY ALLOWED (bad)'); } catch (e) { console.log('replay blocked:', e.message); }
// ── listing filters (migration 25) ──────────────────────────────────────────
const assert = (cond, msg) => { if (!cond) throw new Error(`ASSERT: ${msg}`); };
const fr = await rpc('get_rounds_filtered', { p_category: 'cars', p_region: null, p_n: 5, p_period: '30d', p_make: null, p_model: null, p_sort: 'newest', p_exclude: [] });
assert(Array.isArray(fr) && fr.length > 0, 'get_rounds_filtered returns a non-empty array');
for (const r of fr) {
  assert(typeof r.token === 'string' && r.token.length > 0, 'filtered round has token');
  assert(typeof r.published_at === 'string', 'filtered round has published_at');
  assert(!('price_eur' in r), 'filtered round leaks price_eur');
  assert(r.category === 'cars', 'filtered round is a car');
}
for (let i = 1; i < fr.length; i++) assert(Date.parse(fr[i - 1].published_at) >= Date.parse(fr[i].published_at), `published_at non-increasing at ${i}`);
console.log('filtered rounds', fr.length, 'newest', fr[0].published_at, 'oldest', fr.at(-1).published_at);
const fr2 = await rpc('get_rounds_filtered', { p_category: 'cars', p_region: null, p_n: 3, p_period: '30d', p_make: null, p_model: null, p_sort: 'newest', p_exclude: fr.map((r) => r.id) });
assert(fr2.every((r) => !fr.some((x) => x.id === r.id)), 'p_exclude ids never returned');
console.log('filtered refill (excluding first page)', fr2.length);
const cFlats = await rpc('count_listings', { p_category: 'flats', p_region: null, p_period: 'all', p_make: null, p_model: null });
const cAll = await rpc('count_listings', { p_category: 'all', p_region: null, p_period: 'all', p_make: null, p_model: null });
assert(Number.isInteger(cFlats) && cFlats > 0 && Number.isInteger(cAll) && cAll >= cFlats, 'count_listings integers');
console.log('count flats', cFlats, 'all', cAll);
const makes = await rpc('list_car_makes', { p_region: null, p_period: 'all' });
assert(Array.isArray(makes) && makes.length > 0 && typeof makes[0].make === 'string' && Number.isInteger(makes[0].n), 'list_car_makes shape');
console.log('car makes', makes.length, 'top', JSON.stringify(makes.slice(0, 3)));
const models = await rpc('list_car_models', { p_make: makes[0].make, p_region: null, p_period: 'all' });
assert(Array.isArray(models) && models.length > 0 && typeof models[0].model === 'string' && Number.isInteger(models[0].n), 'list_car_models shape');
console.log('models of', makes[0].make, models.length, 'top', JSON.stringify(models.slice(0, 3)));
const byMake = await rpc('count_listings', { p_category: 'cars', p_region: null, p_period: 'all', p_make: makes[0].make, p_model: models[0].model });
assert(byMake === models[0].n, `count_listings(make, model)=${byMake} equals list_car_models n=${models[0].n}`);
const asc = await rpc('get_rounds_filtered', { p_category: 'cars', p_region: null, p_n: 3, p_period: 'all', p_make: makes[0].make, p_model: null, p_sort: 'price_asc', p_exclude: [] });
assert(asc.every((r) => r.attributes.make.toLowerCase() === makes[0].make.toLowerCase()), 'make filter applied');
const st = await rpc('get_listing_status', { p_ids: [...fr.map((r) => r.id), 0] });
assert(st.length === fr.length + 1, 'get_listing_status one row per id');
assert(fr.every((r, i) => st[i].id === r.id && st[i].status === 'active' && st[i].source_url && st[i].checked_at), 'statuses active');
assert(st.at(-1).status === 'unknown' && st.at(-1).source_url === '' && st.at(-1).checked_at === null, 'unknown id');
assert(st.every((s) => !('price_eur' in s)), 'status leaks price');
console.log('listing status', st.map((s) => s.status).join(','));
try { await rpc('get_rounds_filtered', { p_category: 'cars', p_region: null, p_n: 3, p_period: 'all', p_make: null, p_model: null, p_sort: 'cheapest', p_exclude: [] }); throw new Error('bad_sort ACCEPTED (bad)'); }
catch (e) { assert(/bad_sort/.test(e.message), `bad_sort rejected: ${e.message}`); console.log('bad_sort rejected:', e.message); }
try { await rpc('count_listings', { p_category: 'cars', p_region: null, p_period: 'yesterday', p_make: null, p_model: null }); throw new Error('bad_period ACCEPTED (bad)'); }
catch (e) { assert(/bad_period/.test(e.message), `bad_period rejected: ${e.message}`); console.log('bad_period rejected:', e.message); }

const daily = await rpc('get_daily'); console.log('daily #', daily.number, 'rounds', daily.rounds.length, 'played', daily.already_played);
try { await rpc('invite_duel', { p_opponent: auth.user.id, p_category: 'all' }); } catch (e) { console.log('invite w/o username:', e.message); }
const uname = 'test_' + Math.random().toString(36).slice(2, 8);
await rpc('set_username', { p_username: uname }); console.log('username set', uname);
const lb = await rpc('leaderboard', { p_scope: 'global', p_period: 'day' }); console.log('leaderboard rows', lb.length);
const room = await rpc('create_room', { p_category: 'cars', p_rounds: 5 }); console.log('room', room);
const rt = await rpc('room_tokens', { p_code: room.code }); console.log('room tokens', rt.length);
await rpc('start_room', { p_code: room.code });
const rg = await rpc('submit_guess', { p_token: rt[0].token, p_guess: 5000 }); console.log('room guess', rg.score);
const { data: rrow } = await sb.from('rooms').select('status,current_round,results').eq('code', room.code).single(); console.log('room row', JSON.stringify(rrow));
const friends = await rpc('list_friends'); console.log('friends', friends.length);
await rpc('delete_me'); console.log('delete_me ok');
