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
