// Orders and their status: what the orders page (gush.supply/admin, worker/admin.ts) shows and
// changes, and what each buyer's tracking page (gush.supply/order/<code>) shows.
//
//  - Every paid order is saved in Cloudflare KV (the STOCK namespace) as ord:<stripe session id>,
//    with a long random code (ordtok:<code> points back to it) that makes the buyer's private
//    tracking link. The webhook saves new orders; past ones are imported from Stripe.
//  - Status goes order received → on the machine → headed your way → delivered, each step with its date.
//  - Status emails to buyers only go out while ORDER_UPDATE_EMAILS (src/data/store.ts) is true.
//
// (The webhook's older order:<session id> keys are just "already counted" markers; separate.)
import { SITE_URL, ORDER_UPDATE_EMAILS, CONTACT_EMAIL, IMAGE_VERSION } from '../src/data/store';
import { readOrder, esc, GRAY, INK, FONT, type PaidSession } from './notify';
import { resend, page, td, gap } from './waitlist';
import type { Env } from './index';

export const STATUSES = [
  { key: 'received', label: 'order received' },
  { key: 'sewing', label: 'on the machine' },
  { key: 'shipped', label: 'headed your way' },
  { key: 'delivered', label: 'delivered' },
] as const;
export type Status = (typeof STATUSES)[number]['key'];
export const isStatus = (s: unknown): s is Status => STATUSES.some((x) => x.key === s);
const stepOf = (s: Status) => STATUSES.findIndex((x) => x.key === s);

export type Order = {
  id: string; // Stripe checkout session id
  number: number; // #1001, #1002, ...
  token: string; // the private code in the buyer's tracking link
  created: number; // ms
  live: boolean; // false for Stripe test-mode orders
  paymentIntent?: string;
  items: { slug: string; title: string; size: string; qty: number; cents: number }[];
  buyerName?: string;
  buyerEmail?: string;
  shipName?: string;
  address: string[];
  shippingMethod: string;
  shippingCents: number;
  subtotal: number;
  discount: number;
  total: number;
  note?: string;
  status: Status;
  dates: Partial<Record<Status, number>>; // when each step happened
  tracking?: string; // tracking number (or link), set when shipped
  archived?: boolean; // hidden from the orders list (e.g. a test order)
};

const ORDER = 'ord:';
const TOKEN = 'ordtok:';
const COUNTER = 'ordcount';

const randomCode = () => {
  const b = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

export const trackUrl = (o: Order) => `${SITE_URL}/order/${o.token}`;

export async function getOrder(env: Env, id: string) {
  return env.STOCK ? env.STOCK.get<Order>(ORDER + id, 'json') : null;
}

export async function getOrderByToken(env: Env, token: string) {
  if (!env.STOCK || !/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const id = await env.STOCK.get(TOKEN + token);
  return id ? getOrder(env, id) : null;
}

async function putOrder(env: Env, o: Order) {
  await env.STOCK!.put(ORDER + o.id, JSON.stringify(o));
}

/** All saved orders, newest first. */
export async function listOrders(env: Env) {
  if (!env.STOCK) return [];
  const ids: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.STOCK.list({ prefix: ORDER, cursor });
    ids.push(...page.keys.map((k) => k.name.slice(ORDER.length)));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  const orders = (await Promise.all(ids.map((id) => getOrder(env, id)))).filter(Boolean) as Order[];
  return orders.sort((a, b) => b.created - a.created);
}

/** Saves a paid Stripe checkout session as an order (once; returns the saved one if it exists). */
export async function saveOrder(env: Env, s: PaidSession & { created?: number }, created = Date.now(), lastNumber?: number) {
  const existing = await getOrder(env, s.id);
  if (existing) return existing;
  const r = readOrder(s);
  const number = (lastNumber ?? (Number(await env.STOCK!.get(COUNTER)) || 1000)) + 1;
  await env.STOCK!.put(COUNTER, String(number));
  const o: Order = {
    id: s.id,
    number,
    token: randomCode(),
    created,
    live: !!s.livemode,
    paymentIntent: s.payment_intent ?? undefined,
    items: r.items.map((i) => ({ slug: i.slug, title: i.title, size: i.size, qty: i.qty, cents: i.cents })),
    buyerName: r.buyerName,
    buyerEmail: r.buyerEmail,
    shipName: r.shipName,
    address: r.address,
    shippingMethod: r.shippingMethod,
    shippingCents: r.shippingCents,
    subtotal: r.subtotal,
    discount: r.discount,
    total: r.total,
    note: r.note,
    status: 'received',
    dates: { received: created },
  };
  await env.STOCK!.put(TOKEN + o.token, o.id);
  await putOrder(env, o);
  return o;
}

/** Moves an order to a status (forward or back). Later steps' dates are cleared when moving back.
 *  Emails the buyer only if the status changed, you asked to, and ORDER_UPDATE_EMAILS is on. */
export async function setStatus(env: Env, id: string, status: Status, opts: { tracking?: string; email?: boolean } = {}) {
  const o = await getOrder(env, id);
  if (!o) return { error: 'order not found' };
  const step = stepOf(status);
  const changed = o.status !== status;
  const now = Date.now();
  const dates: Order['dates'] = {};
  for (const s of STATUSES) {
    const i = stepOf(s.key);
    if (i < step) dates[s.key] = o.dates[s.key] ?? now;
    if (i === step) dates[s.key] = o.status === status ? (o.dates[s.key] ?? now) : now;
  }
  o.status = status;
  o.dates = dates;
  if (opts.tracking !== undefined) o.tracking = opts.tracking.trim().slice(0, 300) || undefined;
  if (step < stepOf('shipped')) o.tracking = undefined;
  await putOrder(env, o);

  let emailed = false;
  // One email per step: only when the status actually changes (re-saving to fix a tracking number
  // doesn't email again).
  if (changed && opts.email && ORDER_UPDATE_EMAILS && o.buyerEmail && o.live && status !== 'received') {
    emailed = await resend(env, o.buyerEmail, `order-${o.id}-${status}-${o.dates[status]}`, statusEmail(o, status)).catch((err) => {
      console.error('order update email failed', o.id, status, err);
      return false;
    });
  }
  return { order: o, emailed };
}

export async function setArchived(env: Env, id: string, archived: boolean) {
  const o = await getOrder(env, id);
  if (!o) return null;
  o.archived = archived || undefined;
  await putOrder(env, o);
  return o;
}

/** Imports past paid orders from Stripe (only ones made through this site's checkout). Nobody is
 *  emailed. Returns how many were new. */
export async function importFromStripe(env: Env) {
  if (!env.STRIPE_SECRET_KEY) return { error: 'the Stripe key isn’t set up here.' };
  const sessions: (PaidSession & { created: number; payment_status?: string })[] = [];
  let after: string | undefined;
  for (let pages = 0; pages < 10; pages++) {
    const q = new URLSearchParams({ limit: '100', status: 'complete' });
    if (after) q.set('starting_after', after);
    const res = await fetch(`https://api.stripe.com/v1/checkout/sessions?${q}`, {
      headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
    });
    const data = (await res.json()) as { data?: (PaidSession & { created: number; payment_status?: string })[]; has_more?: boolean; error?: { message?: string } };
    if (!res.ok || !data.data) return { error: `Stripe said: ${data.error?.message ?? res.status}` };
    sessions.push(...data.data);
    if (!data.has_more || !data.data.length) break;
    after = data.data[data.data.length - 1].id;
  }
  // Oldest first, so order numbers follow the order they came in.
  const paid = sessions.filter((s) => s.payment_status === 'paid' && s.metadata?.items).sort((a, b) => a.created - b.created);
  // Saved orders are handed back too: KV can take up to a minute to list new keys.
  const saved: Order[] = [];
  let last = Number(await env.STOCK!.get(COUNTER)) || 1000;
  for (const s of paid) {
    if (await getOrder(env, s.id)) continue;
    const o = await saveOrder(env, s, s.created * 1000, last);
    last = o.number;
    saved.push(o);
  }
  return { found: paid.length, added: saved.length, orders: saved };
}

// ---------- dates and tracking links ----------

export const shortDate = (ms: number) =>
  new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Los_Angeles' }).toLowerCase();

/** A tracking number becomes a USPS tracking link; a pasted link is used as is. */
export function trackingLink(tracking: string) {
  if (/^https?:\/\//i.test(tracking)) return tracking;
  return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encodeURIComponent(tracking.replace(/\s+/g, ''))}`;
}

const itemsText = (o: Order) =>
  o.items.map((i) => `${i.qty > 1 ? `${i.qty} × ` : ''}${i.title} (${i.size})`).join(', ');

// ---------- status emails (only sent while ORDER_UPDATE_EMAILS is on) ----------

export function statusEmail(o: Order, status: Status) {
  const first = o.buyerName?.trim().split(/\s+/)[0]?.toLowerCase();
  const hi = first ? `${first}, ` : '';
  const url = trackUrl(o);
  const what = itemsText(o);
  let subject = '';
  let lines: string[] = [];
  let extra = '';
  if (status === 'sewing') {
    subject = 'your GÜSH order is on the machine';
    lines = [`${hi}we’ve started sewing your ${what}.`, 'every piece is sewn by hand, so it usually ships within 1–2 weeks. we’ll email you when it’s headed your way.'];
  } else if (status === 'shipped') {
    subject = 'your GÜSH order is headed your way';
    lines = [`${hi}your ${what} is headed your way.`];
    if (o.tracking) {
      lines.push(`tracking: ${o.tracking}`);
      extra = `<div ${td()}><a href="${esc(trackingLink(o.tracking))}" style="color:${INK};">follow the package →</a></div>`;
    } else {
      lines.push('we’ll drop it off soon.');
    }
  } else if (status === 'delivered') {
    subject = 'your GÜSH order arrived';
    lines = [`${hi}your ${what} should be with you now. we hope it fits just right.`, 'if it doesn’t, returns and exchanges are open for 14 days after delivery. just reply to this email.'];
  }
  const photos = o.items
    .map(
      (i) =>
        `<img src="${SITE_URL}/stripe/${encodeURIComponent(i.slug)}.jpg?v=${IMAGE_VERSION}" width="160" height="160" alt="${esc(i.title)}" style="display:inline-block;border:0;width:160px;height:160px;margin:0 4px;">`,
    )
    .join('');
  const text = [subject, '', ...lines, '', `see your order: ${url}`, '', `questions? just reply, or email ${CONTACT_EMAIL}.`].join('\n');
  const html = page(`
    <div ${td('font-size:22px;')}>${esc(subject)}</div>
    ${gap(16)}
    <div style="text-align:center;">${photos}</div>
    ${gap(16)}
    ${lines.map((l) => `<div ${td('margin:0 0 10px;')}>${esc(l)}</div>`).join('')}
    ${extra}
    ${gap(20)}
    <div style="text-align:center;"><a href="${esc(url)}" style="display:inline-block;font-family:${FONT};font-size:15px;color:${INK};text-decoration:none;border:1.5px solid ${INK};padding:10px 18px;">see your order</a></div>
    ${gap(24)}
    <div ${td(`color:${GRAY};font-size:12px;`)}>order #${o.number} · questions? just reply to this email.</div>`);
  return { subject, text, html };
}

// ---------- the buyer's tracking page (filled into src/pages/order.astro) ----------

/** The timeline's HTML: the buyer's first name, the items and the status. No full name, email or
 *  address, since links get forwarded. */
export function timelineHtml(o: Order) {
  const first = (o.buyerName ?? o.shipName)?.trim().split(/\s+/)[0]?.toLowerCase();
  const step = stepOf(o.status);
  const items = o.items
    .map(
      (i) => `<li class="ot-item">
        <img src="/stripe/${encodeURIComponent(i.slug)}.jpg?v=${IMAGE_VERSION}" alt="" width="72" height="72" />
        <span><span class="ot-item-name">${esc(i.title)}</span><br /><span class="ot-dim">size ${esc(i.size)}${i.qty > 1 ? ` · ${i.qty} pieces` : ''}</span></span>
      </li>`,
    )
    .join('');
  const steps = STATUSES.map((s, i) => {
    const state = i < step ? 'done' : i === step ? 'now' : 'todo';
    const date = o.dates[s.key];
    let detail = '';
    if (s.key === 'shipped' && i <= step) {
      detail = o.tracking
        ? `<a class="ot-detail" href="${esc(trackingLink(o.tracking))}" target="_blank" rel="noopener">tracking: ${esc(o.tracking.replace(/^https?:\/\//, ''))} →</a>`
        : `<span class="ot-detail ot-dim">we’ll drop it off soon</span>`;
    } else if (s.key === 'shipped' && state === 'todo') {
      detail = `<span class="ot-detail ot-dim">usually ships within 1–2 weeks</span>`;
    }
    return `<li class="ot-step ${state}">
      <span class="ot-dot" aria-hidden="true"></span>
      <span class="ot-step-body">
        <span class="ot-step-name">${esc(s.label)}</span>${date && i <= step ? `<span class="ot-date">${esc(shortDate(date))}</span>` : ''}
        ${detail}
      </span>
    </li>`;
  }).join('');
  return `<p class="ot-label">order #${o.number}</p>
    <h1 class="heading ot-title">${first ? `${esc(first)}’s order` : 'your order'}</h1>
    <ul class="ot-items">${items}</ul>
    <ol class="ot-steps" aria-label="order status: ${esc(STATUSES[step].label)}">${steps}</ol>
    <p class="ot-help ot-dim">questions? email <a href="mailto:${esc(CONTACT_EMAIL)}">${esc(CONTACT_EMAIL)}</a> and mention order #${o.number}.</p>`;
}

/** /order/<code>: the order page with its timeline filled in (or "not found"). */
export async function orderPage(request: Request, env: Env, token: string) {
  const shell = await env.ASSETS.fetch(new Request(new URL('/order', request.url), request));
  const o = await getOrderByToken(env, token);
  const headers = new Headers(shell.headers);
  headers.set('cache-control', 'no-store');
  headers.set('x-robots-tag', 'noindex');
  headers.set('referrer-policy', 'no-referrer');
  if (!o) return new Response(shell.body, { status: 404, headers });
  const out = new HTMLRewriter()
    .on('[data-order]', {
      element(el) {
        el.setInnerContent(timelineHtml(o), { html: true });
      },
    })
    .transform(new Response(shell.body, { status: 200, headers }));
  return out;
}

