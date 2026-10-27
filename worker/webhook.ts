// POST /api/stripe-webhook: Stripe calls this after a checkout is paid. It checks the request
// really came from Stripe (signature with STRIPE_WEBHOOK_SECRET) and counts the sold items off
// the stock (worker/stock.ts), then emails you the order (worker/notify.ts). Each order is only
// counted and emailed once, even if Stripe retries.
import { recordSale } from './stock';
import { notifyOrder, type PaidSession } from './notify';
import type { Env } from './index';

const TOLERANCE_SECONDS = 5 * 60;

async function hmacHex(secret: string, message: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time string comparison. */
function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** https://docs.stripe.com/webhooks#verify-manually */
export async function verifySignature(payload: string, header: string | null, secret: string, now = Date.now() / 1000) {
  if (!header) return false;
  const parts = header.split(',').map((p) => p.split('=') as [string, string]);
  const t = Number(parts.find(([k]) => k === 't')?.[1]);
  const v1s = parts.filter(([k]) => k === 'v1').map(([, v]) => v);
  if (!t || v1s.length === 0 || Math.abs(now - t) > TOLERANCE_SECONDS) return false;
  const expected = await hmacHex(secret, `${t}.${payload}`);
  return v1s.some((v) => safeEqual(v, expected));
}

type Session = PaidSession & { payment_status?: string };

export async function stripeWebhook(request: Request, env: Env) {
  if (!env.STRIPE_WEBHOOK_SECRET) return new Response('webhook not set up', { status: 503 });
  const payload = await request.text();
  if (!(await verifySignature(payload, request.headers.get('stripe-signature'), env.STRIPE_WEBHOOK_SECRET))) {
    return new Response('bad signature', { status: 400 });
  }

  const event = JSON.parse(payload) as { type: string; data: { object: Session } };
  const session = event.data.object;
  const paid =
    (event.type === 'checkout.session.completed' && session.payment_status === 'paid') ||
    event.type === 'checkout.session.async_payment_succeeded';
  if (!paid) return new Response('ignored', { status: 200 });

  if (!env.STOCK) {
    console.warn('order paid but stock tracking (STOCK) is not set up', session.id);
    await notifyOrder(env, session);
    return new Response('ok (no stock tracking)', { status: 200 });
  }
  const doneKey = `order:${session.id}`;
  if (await env.STOCK.get(doneKey)) return new Response('already counted', { status: 200 });

  for (const entry of (session.metadata?.items ?? '').split(',').filter(Boolean)) {
    const [slug, size, qty] = entry.split(':');
    const n = Number(qty);
    if (slug && size && Number.isInteger(n) && n > 0) await recordSale(env, slug, size, n);
  }
  await env.STOCK.put(doneKey, new Date().toISOString());
  await notifyOrder(env, session);
  return new Response('ok', { status: 200 });
}
