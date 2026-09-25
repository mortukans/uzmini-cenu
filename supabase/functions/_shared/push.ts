// Expo Push API helpers shared by send-push (and a future push-receipts).
// https://docs.expo.dev/push-notifications/sending-notifications/

export const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
export const EXPO_RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';
const CHUNK = 100;

export type Lang = 'lv' | 'ru' | 'en';

export interface ExpoMessage {
  to: string;
  title: string;
  body?: string;
  data?: Record<string, unknown>;
  sound?: 'default' | null;
  priority?: 'default' | 'normal' | 'high';
  channelId?: string;
  categoryId?: string;
  expiration?: number; // unix seconds
  ttl?: number;
}

export interface ExpoTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

export function isExpoToken(t: string): boolean {
  return /^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/.test(t);
}

/** Sends in chunks of 100; returns tickets aligned with `messages` order. */
export async function sendExpo(messages: ExpoMessage[]): Promise<ExpoTicket[]> {
  const tickets: ExpoTicket[] = [];
  const accessToken = Deno.env.get('EXPO_ACCESS_TOKEN');
  for (let i = 0; i < messages.length; i += CHUNK) {
    const chunk = messages.slice(i, i + CHUNK);
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify(chunk),
    });
    if (!res.ok) {
      const text = await res.text();
      console.error('expo push failed', res.status, text);
      for (const _ of chunk) tickets.push({ status: 'error', message: `http_${res.status}` });
      continue;
    }
    const parsed = (await res.json()) as { data?: ExpoTicket[]; errors?: unknown };
    if (parsed.errors) console.error('expo push errors', parsed.errors);
    const data = parsed.data ?? [];
    for (let j = 0; j < chunk.length; j++) tickets.push(data[j] ?? { status: 'error', message: 'no_ticket' });
  }
  return tickets;
}

export function pickLang(l: string | null | undefined): Lang {
  return l === 'ru' || l === 'en' ? l : 'lv';
}

export function fmtPts(n: number): string {
  // 4210 -> "4 210" (Latvian thousands separator)
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}
