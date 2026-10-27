// Emails you each new order: what was bought (item + size), how it ships, the address, the buyer's
// note, and a link to the payment in Stripe. Sent through Cloudflare Email Routing (free for sends to
// your own verified address): ORDER_EMAIL is the send_email binding in wrangler.toml, and
// ORDER_EMAIL_TO is your inbox, set as a Cloudflare secret so it isn't in this public repo.
import { PRODUCTS, formatPrice } from '../src/data/products';
import { SHIPPING_OPTIONS } from '../src/data/store';
import type { Env } from './index';

const FROM = { name: 'GÜSH orders', email: 'orders@gush.supply' };

type Address = { line1?: string | null; line2?: string | null; city?: string | null; state?: string | null; postal_code?: string | null; country?: string | null };

/** The parts of a Checkout Session (as sent in the webhook) the email uses. */
export type PaidSession = {
  id: string;
  livemode?: boolean;
  payment_intent?: string | null;
  amount_total?: number | null;
  total_details?: { amount_discount?: number | null } | null;
  shipping_cost?: { amount_total?: number | null } | null;
  customer_details?: { email?: string | null; name?: string | null } | null;
  // Where the shipping address lives depends on the Stripe API version.
  collected_information?: { shipping_details?: { name?: string | null; address?: Address | null } | null } | null;
  shipping_details?: { name?: string | null; address?: Address | null } | null;
  custom_fields?: { key: string; text?: { value?: string | null } | null }[] | null;
  metadata?: { items?: string } | null;
};

export function orderEmail(s: PaidSession) {
  const items = (s.metadata?.items ?? '')
    .split(',')
    .filter(Boolean)
    .map((entry) => {
      const [slug, size, qty] = entry.split(':');
      const title = PRODUCTS.find((p) => p.slug === slug)?.title ?? slug;
      return { label: `${title} (${size?.toUpperCase()})`, qty: Number(qty) || 1 };
    });
  const ship = s.collected_information?.shipping_details ?? s.shipping_details;
  const a = ship?.address;
  const shippingCents = s.shipping_cost?.amount_total ?? 0;
  const method = SHIPPING_OPTIONS.find((o) => o.cents === shippingCents)?.label ?? 'shipping';
  const note = s.custom_fields?.find((f) => f.key === 'note')?.text?.value?.trim();
  const discount = s.total_details?.amount_discount ?? 0;
  const buyer = s.customer_details;
  const stripeUrl = s.payment_intent
    ? `https://dashboard.stripe.com/${s.livemode ? '' : 'test/'}payments/${s.payment_intent}`
    : null;

  const lines = [
    s.livemode ? 'new GÜSH order' : 'new GÜSH order (sandbox test, not real money)',
    '',
    ...items.map((i) => `${i.qty} × ${i.label}`),
    '',
    `shipping: ${method} (${shippingCents ? formatPrice(shippingCents) : 'free'})`,
    'ship to:',
    ...[
      ship?.name,
      a?.line1,
      a?.line2,
      [a?.city, [a?.state, a?.postal_code].filter(Boolean).join(' ')].filter(Boolean).join(', '),
      a?.country,
    ]
      .filter(Boolean)
      .map((l) => `  ${l}`),
    '',
    note ? `note: ${note}` : 'note: (none)',
    '',
    `buyer: ${[buyer?.name, buyer?.email].filter(Boolean).join(', ') || 'unknown'}`,
    `paid: ${formatPrice(s.amount_total ?? 0)}${discount ? ` (after ${formatPrice(discount)} off)` : ''}`,
    ...(stripeUrl ? ['', `in Stripe: ${stripeUrl}`] : []),
  ];

  const summary = items.map((i) => (i.qty > 1 ? `${i.qty} × ${i.label}` : i.label)).join(', ');
  return {
    subject: `${s.livemode ? '' : '[test] '}new order: ${summary}${ship?.name ? ` for ${ship.name}` : ''}`,
    text: lines.join('\n'),
    replyTo: buyer?.email ?? undefined,
  };
}

/** Sends the order email. Never throws: a failed email mustn't make Stripe retry the order. */
export async function notifyOrder(env: Env, session: PaidSession) {
  if (!env.ORDER_EMAIL || !env.ORDER_EMAIL_TO) return;
  try {
    const { subject, text, replyTo } = orderEmail(session);
    await env.ORDER_EMAIL.send({ from: FROM, to: env.ORDER_EMAIL_TO, subject, text, ...(replyTo ? { replyTo } : {}) });
  } catch (err) {
    console.error('order email failed', session.id, err);
  }
}
