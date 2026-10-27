// Emails you each new order: what was bought (item + size, with photos), how it ships, the address,
// the buyer's note, and a link to the payment in Stripe. Styled like the site (logo, mono type, thin
// rules); a plain-text copy goes along for mail apps that don't show HTML. Sent through Cloudflare Email Routing (free for sends to
// your own verified address): ORDER_EMAIL is the send_email binding in wrangler.toml, and
// ORDER_EMAIL_TO is your inbox, set as a Cloudflare secret so it isn't in this public repo.
import { PRODUCTS, formatPrice } from '../src/data/products';
import { SHIPPING_OPTIONS, SITE_URL } from '../src/data/store';
import type { Env } from './index';

const FROM = { name: 'GÜSH orders', email: 'orders@gush.supply' };

type Address = { line1?: string | null; line2?: string | null; city?: string | null; state?: string | null; postal_code?: string | null; country?: string | null };

/** The parts of a Checkout Session (as sent in the webhook) the email uses. */
export type PaidSession = {
  id: string;
  livemode?: boolean;
  payment_intent?: string | null;
  amount_total?: number | null;
  amount_subtotal?: number | null;
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
      const p = PRODUCTS.find((x) => x.slug === slug);
      const title = p?.title ?? slug;
      const n = Number(qty) || 1;
      return { slug, title, size: size?.toUpperCase() ?? '', label: `${title} (${size?.toUpperCase()})`, qty: n, cents: (p?.price ?? 0) * n };
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

  const addressLines = [
    ship?.name,
    a?.line1,
    a?.line2,
    [a?.city, [a?.state, a?.postal_code].filter(Boolean).join(' ')].filter(Boolean).join(', '),
    a?.country,
  ].filter(Boolean) as string[];

  const summary = items.map((i) => (i.qty > 1 ? `${i.qty} × ${i.label}` : i.label)).join(', ');
  return {
    subject: `${s.livemode ? '' : '[test] '}new order: ${summary}${ship?.name ? ` for ${ship.name}` : ''}`,
    text: lines.join('\n'),
    html: orderHtml({
      test: !s.livemode,
      items,
      subtotal: s.amount_subtotal ?? items.reduce((t, i) => t + i.cents, 0),
      shipping: `${method}`,
      shippingCents,
      discount,
      total: s.amount_total ?? 0,
      addressLines,
      note,
      buyer: [buyer?.name, buyer?.email].filter(Boolean).join(' · ') || 'unknown',
      stripeUrl,
    }),
    replyTo: buyer?.email ?? undefined,
  };
}

// --- The HTML version. Email apps only reliably support tables and inline styles, so it's built
// that way; colors and spacing follow src/styles/global.css. ---

const INK = '#1f1b16';
const GRAY = '#7a7a7a';
const FONT = "'IBM Plex Mono', 'SF Mono', Menlo, Consolas, 'Courier New', monospace";

const esc = (v: string) =>
  v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function orderHtml(o: {
  test: boolean;
  items: { slug: string; title: string; size: string; qty: number; cents: number }[];
  subtotal: number;
  shipping: string;
  shippingCents: number;
  discount: number;
  total: number;
  addressLines: string[];
  note?: string;
  buyer: string;
  stripeUrl: string | null;
}) {
  const td = (style = '') => `style="font-family:${FONT};color:${INK};font-size:14px;line-height:1.5;${style}"`;
  const heading = (t: string) => `<div ${td('font-size:19px;margin:0 0 6px;')}>${esc(t)}</div>`;
  const rule = `<tr><td style="border-top:1px solid ${INK};font-size:0;line-height:0;height:1px;">&nbsp;</td></tr>`;
  const gap = (h: number) => `<tr><td style="height:${h}px;font-size:0;line-height:0;">&nbsp;</td></tr>`;
  const row = (label: string, value: string, strong = false) =>
    `<tr><td ${td(strong ? 'font-size:16px;' : '')}>${esc(label)}</td><td align="right" ${td(strong ? 'font-size:16px;' : `color:${GRAY};`)}>${esc(value)}</td></tr>`;

  const items = o.items
    .map(
      (i) => `<tr>
        <td width="84" valign="top" style="padding:0 14px 14px 0;"><img src="${SITE_URL}/stripe/${encodeURIComponent(i.slug)}.jpg" width="84" height="84" alt="${esc(i.title)}" style="display:block;border:0;width:84px;height:84px;"></td>
        <td valign="top" ${td('padding:0 0 14px;')}>${esc(i.title)}<br><span style="color:${GRAY};">size ${esc(i.size)}${i.qty > 1 ? ` · ${i.qty} pieces` : ''}</span></td>
        <td valign="top" align="right" ${td(`padding:0 0 14px;color:${GRAY};white-space:nowrap;`)}>${esc(formatPrice(i.cents))}</td>
      </tr>`,
    )
    .join('');

  const totals = [
    row('subtotal', formatPrice(o.subtotal)),
    row(`shipping (${o.shipping})`, o.shippingCents ? formatPrice(o.shippingCents) : 'free'),
    o.discount ? row('promo code', `−${formatPrice(o.discount)}`) : '',
    row('paid', formatPrice(o.total), true),
  ].join('');

  const note = o.note
    ? `<div ${td(`border:1.5px solid ${INK};padding:10px 12px;white-space:pre-wrap;`)}>${esc(o.note)}</div>`
    : `<div ${td(`color:${GRAY};`)}>(no note)</div>`;

  const button = o.stripeUrl
    ? `${gap(28)}<tr><td align="center"><a href="${esc(o.stripeUrl)}" style="display:inline-block;font-family:${FONT};font-size:15px;color:${INK};text-decoration:none;border:1.5px solid ${INK};padding:10px 18px;">view in stripe →</a></td></tr>`
    : '';

  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"></head>
<body style="margin:0;padding:0;background:#ffffff;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;"><tr><td align="center" style="padding:24px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;">
  <tr><td align="center" style="padding:0 0 18px;"><a href="${SITE_URL}"><img src="${SITE_URL}/stripe/logo.png" width="160" alt="GÜSH" style="display:block;border:0;width:160px;height:auto;"></a></td></tr>
  ${rule}
  ${gap(20)}
  <tr><td ${td('font-size:22px;')}>new order${o.test ? ` <span style="color:${GRAY};font-size:14px;">(sandbox test, not real money)</span>` : ''}</td></tr>
  ${gap(16)}
  <tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${items}</table></td></tr>
  <tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${totals}</table></td></tr>
  ${gap(22)}
  ${rule}
  ${gap(20)}
  <tr><td>${heading('ship to')}<div ${td()}>${o.addressLines.map(esc).join('<br>') || '(no address)'}</div></td></tr>
  ${gap(20)}
  <tr><td>${heading('note')}${note}</td></tr>
  ${gap(20)}
  <tr><td>${heading('buyer')}<div ${td()}>${esc(o.buyer)}</div><div ${td(`color:${GRAY};font-size:12px;`)}>reply to this email to write to them.</div></td></tr>
  ${button}
  ${gap(32)}
  <tr><td align="center" ${td(`color:${GRAY};font-size:12px;`)}><a href="${SITE_URL}" style="color:${GRAY};">gush.supply</a></td></tr>
</table>
</td></tr></table>
</body></html>`;
}

/** Sends the order email. Never throws: a failed email mustn't make Stripe retry the order. */
export async function notifyOrder(env: Env, session: PaidSession) {
  if (!env.ORDER_EMAIL || !env.ORDER_EMAIL_TO) return;
  try {
    const { subject, text, html, replyTo } = orderEmail(session);
    await env.ORDER_EMAIL.send({ from: FROM, to: env.ORDER_EMAIL_TO, subject, text, html, ...(replyTo ? { replyTo } : {}) });
  } catch (err) {
    console.error('order email failed', session.id, err);
  }
}
