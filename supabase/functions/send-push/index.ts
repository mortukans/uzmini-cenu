/**
 * send-push — receives { event, payload } from private.notify() (pg_net) and
 * pushes Expo notifications to the target user(s). Titles/bodies are localised
 * by the recipient's profiles.lang (lv default). Tickets go to push_tickets.
 *
 * Deploy:   supabase functions deploy send-push --no-verify-jwt
 * Secrets:  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   (auto-injected)
 *           EXPO_ACCESS_TOKEN (optional, raises Expo rate limit)
 *           INTERNAL_SECRET   (optional alternative Bearer for pg_net)
 * Local:    supabase functions serve send-push --env-file supabase/.env
 *           curl -X POST localhost:54321/functions/v1/send-push \
 *             -H "Authorization: Bearer $SERVICE_ROLE_KEY" -H 'content-type: application/json' \
 *             -d '{"event":"duel_invite","payload":{"duel_id":"<uuid>","from":"<uuid>","to":"<uuid>"}}'
 *
 * Events (docs/06 payload table) and the `data` the app routes on (src/api/types.ts PushData):
 *   duel_invite    {duel_id, from, to}       -> {type:'duel_invite',   duelId, from, url}
 *   duel_accepted  {duel_id, from, to}       -> {type:'duel_accepted', duelId, url}
 *   duel_declined  {duel_id, from, to}       -> {type:'duel_declined', duelId}
 *   duel_async     {duel_id, to}             -> {type:'duel_invite',   duelId, from, url}   (same route)
 *   duel_expired   {duel_id, to}             -> {type:'duel_expired',  duelId}
 *   duel_finished  {duel_id}                 -> {type:'duel_finished', duelId, url}  (both players)
 *   friend_request {from, to}                -> {type:'friend_request', from}
 *   daily_ready    {day}                     -> {type:'daily_ready', day}          (every user with a token)
 *   room_invite    {code, from, to: uuid[]}  -> {type:'room_invite', code, url}
 */
import { serviceClient, assertInternalCaller } from '../_shared/client.ts';
import { json, preflight } from '../_shared/cors.ts';
import { sendExpo, isExpoToken, pickLang, fmtPts, type ExpoMessage, type Lang } from '../_shared/push.ts';

type Payload = Record<string, unknown>;
interface Profile { id: string; username: string | null; lang: string | null }
interface Copy { title: string; body?: string }

const SCHEME = 'uzminicenu://';

function name(p: Profile | undefined, lang: Lang): string {
  if (p?.username) return p.username;
  return { lv: 'Spēlētājs', ru: 'Игрок', en: 'A player' }[lang];
}

function copyFor(event: string, lang: Lang, ctx: { from?: Profile; you?: string; mine?: number; theirs?: number; day?: string; code?: string }): Copy {
  const who = name(ctx.from, lang);
  const t: Record<string, Record<Lang, Copy>> = {
    duel_invite: {
      lv: { title: `${who} izaicina tevi!`, body: 'Uzmini 5 cenas ātrāk un precīzāk. Spēlēsim?' },
      ru: { title: `${who} вызывает тебя на дуэль!`, body: 'Угадай 5 цен быстрее и точнее. Сыграем?' },
      en: { title: `${who} challenges you!`, body: 'Guess 5 prices faster and closer. Game on?' },
    },
    duel_accepted: {
      lv: { title: `${who} pieņēma izaicinājumu`, body: '1. raunds sākas tagad' },
      ru: { title: `${who} принял вызов`, body: 'Раунд 1 начинается' },
      en: { title: `${who} accepted your challenge`, body: 'Round 1 starts now' },
    },
    duel_declined: {
      lv: { title: `${who} šobrīd nevar`, body: 'Izaicini kādu citu vai spēlē solo' },
      ru: { title: `${who} сейчас не может`, body: 'Вызови кого-нибудь другого или играй соло' },
      en: { title: `${who} can't right now`, body: 'Challenge someone else or play solo' },
    },
    duel_async: {
      lv: { title: `${who} vēl nav atbildējis`, body: `Izspēlē savus 5 raundus tagad, rezultāts atnāks, kad ${who} pabeigs` },
      ru: { title: `${who} пока не ответил`, body: `Сыграй свои 5 раундов сейчас, результат придёт, когда ${who} закончит` },
      en: { title: `${who} hasn't answered yet`, body: `Play your 5 rounds now; the result arrives when ${who} finishes` },
    },
    duel_expired: {
      lv: { title: `Duelis ar ${who} beidzās bez atbildes` },
      ru: { title: `Дуэль с ${who} закончилась без ответа` },
      en: { title: `Duel with ${who} ended without an answer` },
    },
    friend_request: {
      lv: { title: `${who} vēlas būt tavs draugs` },
      ru: { title: `${who} хочет добавить тебя в друзья` },
      en: { title: `${who} wants to be your friend` },
    },
    daily_ready: {
      lv: { title: 'Šodienas 5 cenas gaida', body: `Uzmini Cenu #${dailyNumber(ctx.day)}` },
      ru: { title: 'Сегодняшние 5 цен ждут', body: `Uzmini Cenu #${dailyNumber(ctx.day)}` },
      en: { title: "Today's 5 prices are waiting", body: `Uzmini Cenu #${dailyNumber(ctx.day)}` },
    },
    room_invite: {
      lv: { title: `${who} atvēra istabu ${ctx.code}`, body: 'Pievienojies, spēle sāksies drīz' },
      ru: { title: `${who} открыл комнату ${ctx.code}`, body: 'Присоединяйся, игра скоро начнётся' },
      en: { title: `${who} opened room ${ctx.code}`, body: 'Join now, the game starts soon' },
    },
  };
  if (event === 'duel_finished') {
    const mine = ctx.mine ?? 0, theirs = ctx.theirs ?? 0;
    const score = `${fmtPts(mine)} : ${fmtPts(theirs)}`;
    const won = mine > theirs, draw = mine === theirs;
    const title = {
      lv: draw ? `Neizšķirts! ${score}` : won ? `Tu uzvarēji! ${score}` : `${who} uzvarēja ${fmtPts(theirs)} : ${fmtPts(mine)}`,
      ru: draw ? `Ничья! ${score}` : won ? `Ты победил! ${score}` : `${who} победил ${fmtPts(theirs)} : ${fmtPts(mine)}`,
      en: draw ? `Draw! ${score}` : won ? `You won! ${score}` : `${who} won ${fmtPts(theirs)} : ${fmtPts(mine)}`,
    }[lang];
    return { title, body: { lv: 'Revanšs?', ru: 'Реванш?', en: 'Rematch?' }[lang] };
  }
  return t[event]?.[lang] ?? { title: 'Uzmini Cenu' };
}

function dailyNumber(day?: string): number {
  if (!day) return 0;
  const d = new Date(day + 'T00:00:00Z').getTime();
  const start = Date.UTC(2026, 0, 1);
  return Math.floor((d - start) / 86_400_000) + 1;
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const denied = assertInternalCaller(req);
  if (denied) return denied;
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  let event: string; let payload: Payload;
  try {
    const body = await req.json();
    event = String(body.event ?? '');
    payload = (body.payload ?? {}) as Payload;
  } catch {
    return json({ error: 'bad_json' }, 400);
  }
  if (!event) return json({ error: 'missing_event' }, 400);

  const db = serviceClient();
  const duelId = payload.duel_id ? String(payload.duel_id) : undefined;
  const fromId = payload.from ? String(payload.from) : undefined;

  // ── recipients ──────────────────────────────────────────────────────────
  let recipients: string[] = [];
  let duel: { challenger: string | null; opponent: string | null; scores: Record<string, number> } | null = null;

  if (event === 'duel_finished' || (event === 'duel_async' && !fromId)) {
    if (!duelId) return json({ error: 'missing_duel_id' }, 400);
    const { data } = await db.from('duels').select('challenger, opponent, scores').eq('id', duelId).maybeSingle();
    duel = data as typeof duel;
    if (!duel) return json({ ok: true, sent: 0, note: 'duel_gone' });
    recipients = event === 'duel_finished'
      ? [duel.challenger, duel.opponent].filter((x): x is string => !!x)
      : [String(payload.to)];
  } else if (event === 'daily_ready') {
    const { data } = await db.from('push_tokens').select('user_id').limit(20000);
    recipients = [...new Set((data ?? []).map((r: { user_id: string }) => r.user_id))];
  } else if (Array.isArray(payload.to)) {
    recipients = (payload.to as unknown[]).map(String);
  } else if (payload.to) {
    recipients = [String(payload.to)];
  }
  recipients = recipients.filter((r) => r && r !== fromId);
  if (recipients.length === 0) return json({ ok: true, sent: 0 });

  // ── profiles (names + langs) and tokens ─────────────────────────────────
  const profileIds = [...new Set([...recipients, ...(fromId ? [fromId] : []), ...(duel ? [duel.challenger, duel.opponent] : [])])]
    .filter((x): x is string => !!x);
  const [{ data: profiles }, { data: tokens }] = await Promise.all([
    db.from('profiles').select('id, username, lang').in('id', profileIds),
    db.from('push_tokens').select('user_id, token, platform').in('user_id', recipients),
  ]);
  const byId = new Map<string, Profile>((profiles ?? []).map((p: Profile) => [p.id, p]));

  // ── build messages ──────────────────────────────────────────────────────
  const nowSec = Math.floor(Date.now() / 1000);
  const messages: ExpoMessage[] = [];
  const meta: { token: string }[] = [];

  for (const t of (tokens ?? []) as { user_id: string; token: string; platform: string }[]) {
    if (!isExpoToken(t.token)) continue;
    const me = byId.get(t.user_id);
    const lang = pickLang(me?.lang);

    let from: Profile | undefined = fromId ? byId.get(fromId) : undefined;
    let mine: number | undefined, theirs: number | undefined;
    if (event === 'duel_finished' && duel) {
      const otherId = duel.challenger === t.user_id ? duel.opponent : duel.challenger;
      from = otherId ? byId.get(otherId) : undefined;
      mine = Number(duel.scores?.[t.user_id] ?? 0);
      theirs = otherId ? Number(duel.scores?.[otherId] ?? 0) : 0;
    }
    if (event === 'duel_async' && duel) {
      const otherId = duel.challenger === t.user_id ? duel.opponent : duel.challenger;
      from = otherId ? byId.get(otherId) : undefined;
    }

    const copy = copyFor(event, lang, { from, mine, theirs, day: payload.day as string | undefined, code: payload.code as string | undefined });
    const data = dataFor(event, { duelId, fromId: from?.id ?? fromId, day: payload.day as string | undefined, code: payload.code as string | undefined });
    const invite = event === 'duel_invite' || event === 'duel_async' || event === 'room_invite' || event === 'friend_request';

    messages.push({
      to: t.token,
      title: copy.title,
      body: copy.body,
      data,
      sound: invite || event === 'duel_accepted' ? 'default' : null,
      priority: event === 'duel_invite' || event === 'duel_accepted' ? 'high' : 'default',
      channelId: event.startsWith('duel') ? 'duels' : 'default',
      ...(event === 'duel_invite' ? { categoryId: 'duel_invite', expiration: nowSec + 24 * 3600 } : {}),
    });
    meta.push({ token: t.token });
  }
  if (messages.length === 0) return json({ ok: true, sent: 0, note: 'no_tokens' });

  // ── send + store tickets ────────────────────────────────────────────────
  const tickets = await sendExpo(messages);
  const rows = tickets
    .map((tk, i) => ({ tk, token: meta[i].token }))
    .filter(({ tk }) => tk.status === 'ok' && tk.id)
    .map(({ tk, token }) => ({ ticket_id: tk.id!, token, event }));
  if (rows.length) {
    const { error } = await db.from('push_tickets').upsert(rows, { onConflict: 'ticket_id' });
    if (error) console.error('push_tickets upsert', error);
  }
  // immediate DeviceNotRegistered -> drop the token now
  const dead = tickets.map((tk, i) => (tk.details?.error === 'DeviceNotRegistered' ? meta[i].token : null)).filter((x): x is string => !!x);
  if (dead.length) await db.from('push_tokens').delete().in('token', dead);

  return json({ ok: true, event, recipients: recipients.length, sent: rows.length, dead: dead.length });
});

function dataFor(event: string, c: { duelId?: string; fromId?: string; day?: string; code?: string }): Record<string, unknown> {
  switch (event) {
    case 'duel_invite':
    case 'duel_async':
      return { type: 'duel_invite', duelId: c.duelId, from: c.fromId, url: `${SCHEME}duel/${c.duelId}` };
    case 'duel_accepted':
      return { type: 'duel_accepted', duelId: c.duelId, url: `${SCHEME}duel/${c.duelId}` };
    case 'duel_finished':
      return { type: 'duel_finished', duelId: c.duelId, url: `${SCHEME}duel/${c.duelId}` };
    case 'duel_declined':
      return { type: 'duel_declined', duelId: c.duelId };
    case 'duel_expired':
      return { type: 'duel_expired', duelId: c.duelId };
    case 'friend_request':
      return { type: 'friend_request', from: c.fromId };
    case 'daily_ready':
      return { type: 'daily_ready', day: c.day, url: `${SCHEME}daily` };
    case 'room_invite':
      return { type: 'room_invite', code: c.code, url: `${SCHEME}room/${c.code}` };
    default:
      return { type: event };
  }
}
