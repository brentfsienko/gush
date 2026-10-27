// Order emails, styled like the site (logo, item photos, mono type, thin rules), each with a
// plain-text copy for mail apps that don't show HTML:
//  - to you: what was bought, how it ships, the address, the buyer's note, a link to Stripe. Sent
//    through Cloudflare Email Routing (free for sends to your own verified address): ORDER_EMAIL is
//    the send_email binding in wrangler.toml, ORDER_EMAIL_TO your inbox (a Cloudflare secret, so it
//    isn't in this public repo).
//  - to the buyer: a thank-you receipt (wording in src/data/store.ts, RECEIPT). Sent through Resend
//    (free up to 3,000/month) with the RESEND_API_KEY secret. Real orders only, not sandbox tests.
import { PRODUCTS, formatPrice } from '../src/data/products';
import { SHIPPING_OPTIONS, SITE_URL, CONTACT_EMAIL, RECEIPT } from '../src/data/store';
import type { Env } from './index';

const FROM = { name: 'GÜSH', email: 'orders@gush.supply' };

type Address = { line1?: string | null; line2?: string | null; city?: string | null; state?: string | null; postal_code?: string | null; country?: string | null };

/** The parts of a Checkout Session (as sent in the webhook) the emails use. */
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

type Order = ReturnType<typeof readOrder>;

/** Everything the emails show, pulled out of the session. */
function readOrder(s: PaidSession) {
  const items = (s.metadata?.items ?? '')
    .split(',')
    .filter(Boolean)
    .map((entry) => {
      const [slug = '', size = '', qty] = entry.split(':');
      const p = PRODUCTS.find((x) => x.slug === slug);
      const n = Number(qty) || 1;
      const title = p?.title ?? slug;
      return { slug, title, size: size.toUpperCase(), qty: n, cents: (p?.price ?? 0) * n, label: `${title} (${size.toUpperCase()})` };
    });
  const ship = s.collected_information?.shipping_details ?? s.shipping_details;
  const a = ship?.address;
  const shippingCents = s.shipping_cost?.amount_total ?? 0;
  return {
    test: !s.livemode,
    items,
    subtotal: s.amount_subtotal ?? items.reduce((t, i) => t + i.cents, 0),
    shippingMethod: SHIPPING_OPTIONS.find((o) => o.cents === shippingCents)?.label ?? 'shipping',
    shippingCents,
    discount: s.total_details?.amount_discount ?? 0,
    total: s.amount_total ?? 0,
    address: [
      ship?.name,
      a?.line1,
      a?.line2,
      [a?.city, [a?.state, a?.postal_code].filter(Boolean).join(' ')].filter(Boolean).join(', '),
      a?.country,
    ].filter(Boolean) as string[],
    shipName: ship?.name ?? undefined,
    note: s.custom_fields?.find((f) => f.key === 'note')?.text?.value?.trim() || undefined,
    buyerName: s.customer_details?.name ?? ship?.name ?? undefined,
    buyerEmail: s.customer_details?.email ?? undefined,
    stripeUrl: s.payment_intent ? `https://dashboard.stripe.com/${s.livemode ? '' : 'test/'}payments/${s.payment_intent}` : undefined,
  };
}

const money = (cents: number) => (cents ? formatPrice(cents) : 'free');

/** The email to you. */
export function ownerEmail(s: PaidSession) {
  const o = readOrder(s);
  const summary = o.items.map((i) => (i.qty > 1 ? `${i.qty} × ${i.label}` : i.label)).join(', ');
  const buyer = [o.buyerName, o.buyerEmail].filter(Boolean).join(' · ') || 'unknown';
  const text = [
    o.test ? 'new GÜSH order (sandbox test, not real money)' : 'new GÜSH order',
    '',
    ...o.items.map((i) => `${i.qty} × ${i.label}`),
    '',
    `shipping: ${o.shippingMethod} (${money(o.shippingCents)})`,
    'ship to:',
    ...o.address.map((l) => `  ${l}`),
    '',
    `note: ${o.note ?? '(none)'}`,
    '',
    `buyer: ${buyer}`,
    `paid: ${formatPrice(o.total)}${o.discount ? ` (after ${formatPrice(o.discount)} off)` : ''}`,
    ...(o.stripeUrl ? ['', `in Stripe: ${o.stripeUrl}`] : []),
  ].join('\n');
  return {
    subject: `${o.test ? '[test] ' : ''}new order: ${summary}${o.shipName ? ` for ${o.shipName}` : ''}`,
    text,
    html: renderHtml(o, {
      title: 'new order',
      titleNote: o.test ? '(sandbox test, not real money)' : undefined,
      noteHeading: 'note',
      extra: [
        { heading: 'buyer', lines: [buyer], small: 'reply to this email to write to them.' },
      ],
      button: o.stripeUrl ? { label: 'view in stripe →', href: o.stripeUrl } : undefined,
    }),
    replyTo: o.buyerEmail,
  };
}

/** The receipt to the buyer. */
export function customerEmail(s: PaidSession) {
  const o = readOrder(s);
  const first = o.buyerName?.trim().split(/\s+/)[0]?.toLowerCase();
  const hello = first ? `thank you, ${first}!` : 'thank you!';
  const text = [
    hello,
    '',
    RECEIPT.intro,
    '',
    ...o.items.map((i) => `${i.qty} × ${i.label}  ${formatPrice(i.cents)}`),
    `shipping (${o.shippingMethod})  ${money(o.shippingCents)}`,
    ...(o.discount ? [`promo code  −${formatPrice(o.discount)}`] : []),
    `paid  ${formatPrice(o.total)}`,
    '',
    'shipping to:',
    ...o.address.map((l) => `  ${l}`),
    ...(o.note ? ['', `your note: ${o.note}`] : []),
    '',
    RECEIPT.outro,
    '',
    SITE_URL.replace(/^https?:\/\//, ''),
  ].join('\n');
  return {
    subject: RECEIPT.subject,
    text,
    html: renderHtml(o, {
      title: hello,
      intro: RECEIPT.intro,
      noteHeading: 'your note',
      hideEmptyNote: true,
      outro: RECEIPT.outro,
      button: { label: 'visit GÜSH →', href: SITE_URL },
    }),
  };
}

// --- HTML. Email apps only reliably support tables and inline styles, so it's built that way;
// colors and spacing follow src/styles/global.css. ---

const INK = '#1f1b16';
const GRAY = '#7a7a7a';
const FONT = "'IBM Plex Mono', 'SF Mono', Menlo, Consolas, 'Courier New', monospace";

const esc = (v: string) =>
  v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function renderHtml(
  o: Order,
  v: {
    title: string;
    titleNote?: string;
    intro?: string;
    noteHeading: string;
    hideEmptyNote?: boolean;
    extra?: { heading: string; lines: string[]; small?: string }[];
    outro?: string;
    button?: { label: string; href: string };
  },
) {
  const td = (style = '') => `style="font-family:${FONT};color:${INK};font-size:14px;line-height:1.5;${style}"`;
  const heading = (t: string) => `<div ${td('font-size:19px;margin:0 0 6px;')}>${esc(t)}</div>`;
  const rule = `<tr><td style="border-top:1px solid ${INK};font-size:0;line-height:0;height:1px;">&nbsp;</td></tr>`;
  const gap = (h: number) => `<tr><td style="height:${h}px;font-size:0;line-height:0;">&nbsp;</td></tr>`;
  const section = (inner: string) => `<tr><td>${inner}</td></tr>${gap(20)}`;
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
    row(`shipping (${o.shippingMethod})`, money(o.shippingCents)),
    o.discount ? row('promo code', `−${formatPrice(o.discount)}`) : '',
    row('paid', formatPrice(o.total), true),
  ].join('');

  const note = o.note
    ? section(`${heading(v.noteHeading)}<div ${td(`border:1.5px solid ${INK};padding:10px 12px;white-space:pre-wrap;`)}>${esc(o.note)}</div>`)
    : v.hideEmptyNote
      ? ''
      : section(`${heading(v.noteHeading)}<div ${td(`color:${GRAY};`)}>(no note)</div>`);

  const extra = (v.extra ?? [])
    .map((e) =>
      section(
        `${heading(e.heading)}<div ${td()}>${e.lines.map(esc).join('<br>')}</div>${e.small ? `<div ${td(`color:${GRAY};font-size:12px;`)}>${esc(e.small)}</div>` : ''}`,
      ),
    )
    .join('');

  const button = v.button
    ? `${gap(8)}<tr><td align="center"><a href="${esc(v.button.href)}" style="display:inline-block;font-family:${FONT};font-size:15px;color:${INK};text-decoration:none;border:1.5px solid ${INK};padding:10px 18px;">${esc(v.button.label)}</a></td></tr>`
    : '';

  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"></head>
<body style="margin:0;padding:0;background:#ffffff;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;"><tr><td align="center" style="padding:24px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;">
  <tr><td align="center" style="padding:0 0 18px;"><a href="${SITE_URL}"><img src="${SITE_URL}/stripe/logo.png" width="160" alt="GÜSH" style="display:block;border:0;width:160px;height:auto;"></a></td></tr>
  ${rule}
  ${gap(20)}
  <tr><td ${td('font-size:22px;')}>${esc(v.title)}${v.titleNote ? ` <span style="color:${GRAY};font-size:14px;">${esc(v.titleNote)}</span>` : ''}</td></tr>
  ${v.intro ? `${gap(10)}<tr><td ${td()}>${esc(v.intro)}</td></tr>` : ''}
  ${gap(18)}
  <tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${items}</table></td></tr>
  <tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${totals}</table></td></tr>
  ${gap(22)}
  ${rule}
  ${gap(20)}
  ${section(`${heading('ship to')}<div ${td()}>${o.address.map(esc).join('<br>') || '(no address)'}</div>`)}
  ${note}
  ${extra}
  ${v.outro ? section(`<div ${td()}>${esc(v.outro)}</div>`) : ''}
  ${button}
  ${gap(32)}
  <tr><td align="center" ${td(`color:${GRAY};font-size:12px;`)}><a href="${SITE_URL}" style="color:${GRAY};">${esc(SITE_URL.replace(/^https?:\/\//, ''))}</a></td></tr>
</table>
</td></tr></table>
</body></html>`;
}

/** Sends both emails. Never throws: a failed email mustn't make Stripe retry the order. */
export async function notifyOrder(env: Env, session: PaidSession) {
  await Promise.all([emailOwner(env, session), emailCustomer(env, session)]);
}

async function emailOwner(env: Env, session: PaidSession) {
  if (!env.ORDER_EMAIL || !env.ORDER_EMAIL_TO) return;
  try {
    const { subject, text, html, replyTo } = ownerEmail(session);
    await env.ORDER_EMAIL.send({ from: { name: 'GÜSH orders', email: FROM.email }, to: env.ORDER_EMAIL_TO, subject, text, html, ...(replyTo ? { replyTo } : {}) });
  } catch (err) {
    console.error('owner order email failed', session.id, err);
  }
}

async function emailCustomer(env: Env, session: PaidSession) {
  const to = session.customer_details?.email;
  if (!env.RESEND_API_KEY || !to || !session.livemode) return;
  try {
    const { subject, text, html } = customerEmail(session);
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY}`,
        'content-type': 'application/json',
        // Resend sends at most one email per key, so a retried webhook can't email the buyer twice.
        'idempotency-key': `receipt-${session.id}`,
      },
      body: JSON.stringify({ from: `${FROM.name} <${FROM.email}>`, to: [to], reply_to: CONTACT_EMAIL, subject, text, html }),
    });
    if (!res.ok) console.error('customer receipt failed', session.id, res.status, await res.text());
  } catch (err) {
    console.error('customer receipt failed', session.id, err);
  }
}
