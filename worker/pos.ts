// The market register: gush.supply/admin/pos, for selling in person (pop-ups, markets).
//  - You pick what they're buying; "charge" makes a Stripe checkout for it (POST /admin/api/pos/charge)
//    and the page shows its QR code. The buyer scans it and pays on their own phone. The page asks
//    /admin/api/pos/status until it's paid.
//  - Sales tax is worked out for where you're selling (the market's address, set on the page): the
//    checkout's customer carries that address, so Stripe Tax charges that location's rate and it shows
//    in Stripe's tax reports like website orders.
//  - Paid checkouts go through the usual webhook (worker/webhook.ts): stock counted down, order saved
//    (tagged "in person", already handed over), receipt emailed. The buyer can skip giving a name.
//  - The printed booth sign's QR code opens gush.supply/pay: the checkout you're charging right now
//    (pos:current in KV), or the shop when there isn't one.
//  - "cash" records a cash sale (POST /admin/api/pos/cash): stock counted down, an order saved with the
//    tax worked out the same way. No money moves through Stripe, so cash sales aren't in Stripe's tax
//    report; they're on the orders page.
import { PRODUCTS, SIZES, type Size } from '../src/data/products';
import { CLOTHING_TAX_CODE, TAX_ENABLED, MAX_QTY } from '../src/data/store';
import { available, recordSale } from './stock';
import { brand, imageOrigin, createSession, taxProblem } from './checkout';
import { addOrder, nextNumber, randomCode, setStatus, type Order } from './orders';
import { json } from './waitlist';
import type { Env } from './index';

const CURRENT = 'pos:current';
const CUSTOMER = 'pos:customer:'; // pos:customer:<place> -> Stripe customer id
const STRIPE = 'https://api.stripe.com/v1';

export type Place = { name: string; line1: string; city: string; state: string; zip: string };
type Line = { slug: string; size: Size; qty: number; title: string; cents: number };

const clean = (v: unknown, max: number) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max);

function readPlace(v: unknown): Place | string {
  const p = (v ?? {}) as Record<string, unknown>;
  const place = { name: clean(p.name, 60), line1: clean(p.line1, 120), city: clean(p.city, 60), state: clean(p.state, 30), zip: clean(p.zip, 12) };
  if (!place.name || !place.line1 || !place.city || !place.state || !place.zip) return 'set where you’re selling first (name and address).';
  return place;
}

/** What's being bought, checked against the catalog and stock. */
async function readLines(env: Env, v: unknown): Promise<Line[] | string> {
  if (!Array.isArray(v) || !v.length || v.length > 20) return 'add something first.';
  const wanted = new Map<string, number>();
  for (const raw of v as { slug?: unknown; size?: unknown; qty?: unknown }[]) {
    const qty = Number(raw?.qty);
    if (typeof raw?.slug !== 'string' || typeof raw?.size !== 'string' || !Number.isInteger(qty) || qty < 1) return 'something looks off. try again.';
    const k = `${raw.slug}:${raw.size}`;
    wanted.set(k, (wanted.get(k) ?? 0) + qty);
  }
  const lines: Line[] = [];
  for (const [k, qty] of wanted) {
    const [slug, size] = k.split(':') as [string, Size];
    const p = PRODUCTS.find((x) => x.slug === slug);
    if (!p || !SIZES.includes(size) || p.stock[size] === undefined) return 'something isn’t in the catalog anymore.';
    const left = (await available(env, slug, size)) ?? 0;
    if (qty > Math.min(left, MAX_QTY)) return left ? `only ${left} ${p.title} (${size.toUpperCase()}) left.` : `${p.title} (${size.toUpperCase()}) is sold out on the site. add stock first.`;
    lines.push({ slug, size, qty, title: p.title, cents: p.price });
  }
  return lines;
}

async function stripe(env: Env, path: string, body?: URLSearchParams) {
  const res = await fetch(`${STRIPE}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, ...(body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
    body,
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: { message?: string } };
  return { ok: res.ok, data, message: data.error?.message ?? '' };
}

const setAddress = (q: URLSearchParams, prefix: string, p: Place) => {
  q.set(`${prefix}[line1]`, p.line1);
  q.set(`${prefix}[city]`, p.city);
  q.set(`${prefix}[state]`, p.state);
  q.set(`${prefix}[postal_code]`, p.zip);
  q.set(`${prefix}[country]`, 'US');
};

/** A Stripe customer standing for the market (its address sets the tax), made once per place. */
async function placeCustomer(env: Env, p: Place) {
  const k = CUSTOMER + `${p.line1}|${p.zip}`.toLowerCase().replace(/[^a-z0-9|]+/g, '-');
  const known = await env.STOCK!.get(k);
  if (known) return known;
  const q = new URLSearchParams();
  q.set('name', `GÜSH booth: ${p.name}`);
  q.set('shipping[name]', p.name);
  setAddress(q, 'shipping[address]', p);
  setAddress(q, 'address', p);
  q.set('metadata[gush_pos]', 'place');
  const r = await stripe(env, '/customers', q);
  const id = typeof r.data.id === 'string' ? r.data.id : undefined;
  if (!id) throw new Error(`couldn’t set up the market in Stripe: ${r.message}`);
  await env.STOCK!.put(k, id);
  return id;
}

function chargeParams(lines: Line[], p: Place, origin: string, customer: string | undefined, tax: boolean) {
  const q = new URLSearchParams();
  q.set('mode', 'payment');
  lines.forEach((l, i) => {
    q.set(`line_items[${i}][quantity]`, String(l.qty));
    q.set(`line_items[${i}][price_data][currency]`, 'usd');
    q.set(`line_items[${i}][price_data][unit_amount]`, String(l.cents));
    q.set(`line_items[${i}][price_data][product_data][name]`, `${l.title} (${l.size.toUpperCase()})`);
    q.set(`line_items[${i}][price_data][product_data][images][0]`, `${imageOrigin(origin)}/stripe/${l.slug}.jpg`);
    if (tax) {
      q.set(`line_items[${i}][price_data][product_data][tax_code]`, CLOTHING_TAX_CODE);
      q.set(`line_items[${i}][price_data][tax_behavior]`, 'exclusive');
    }
  });
  if (customer) q.set('customer', customer);
  if (tax) q.set('automatic_tax[enabled]', 'true');
  q.set('allow_promotion_codes', 'true');
  q.set('metadata[items]', lines.map((l) => `${l.slug}:${l.size}:${l.qty}`).join(','));
  q.set('metadata[gush_pos]', p.name);
  q.set('payment_intent_data[description]', `GÜSH in person · ${p.name}`);
  q.set('success_url', `${origin}/success?session_id={CHECKOUT_SESSION_ID}&inperson=1`);
  q.set('cancel_url', `${origin}/shop`);
  q.set('custom_text[submit][message]', 'thank you for supporting handmade ♥');
  q.set('expires_at', String(Math.floor(Date.now() / 1000) + 30 * 60));
  brand(q, imageOrigin(origin));
  return q;
}

/** POST /admin/api/pos/charge { items, place }: a checkout for the booth, and its link (for the QR). */
export async function posCharge(env: Env, origin: string, body: Record<string, unknown>) {
  if (!env.STRIPE_SECRET_KEY || !env.STOCK) return json({ error: 'payments aren’t set up.' }, 503);
  const place = readPlace(body.place);
  if (typeof place === 'string') return json({ error: place }, 400);
  const lines = await readLines(env, body.items);
  if (typeof lines === 'string') return json({ error: lines }, 409);
  let customer: string | undefined;
  try {
    if (TAX_ENABLED) customer = await placeCustomer(env, place);
  } catch (err) {
    console.error('pos customer failed', err);
  }
  let res = await createSession(chargeParams(lines, place, origin, customer, TAX_ENABLED && !!customer), env);
  if (!res.ok && TAX_ENABLED && taxProblem(res.message)) {
    console.error('pos: Stripe Tax isn’t set up, charging without tax:', res.message);
    res = await createSession(chargeParams(lines, place, origin, customer, false), env);
  }
  if (!res.ok) {
    console.error('pos charge failed', res.status, res.message);
    return json({ error: 'couldn’t start the payment. try again?' }, 502);
  }
  const id = res.url.match(/cs_(test|live)_[A-Za-z0-9]+/)?.[0] ?? '';
  await env.STOCK.put(CURRENT, JSON.stringify({ id, url: res.url, at: Date.now() }), { expirationTtl: 30 * 60 });
  return json({ id, url: res.url, pay: `${origin}/pay` });
}

/** GET /admin/api/pos/status?id=cs_...: paid yet? */
export async function posStatus(env: Env, id: string | null) {
  if (!id || !/^cs_(test|live)_[A-Za-z0-9]+$/.test(id)) return json({ error: 'bad request' }, 400);
  const r = await stripe(env, `/checkout/sessions/${id}`);
  if (!r.ok) return json({ error: 'couldn’t check with Stripe.' }, 502);
  const paid = r.data.status === 'complete';
  const expired = r.data.status === 'expired';
  if (paid || expired) await clearCurrent(env, id);
  const details = r.data.total_details as { amount_tax?: number } | undefined;
  return json({ paid, expired, total: r.data.amount_total, tax: details?.amount_tax ?? 0 });
}

/** POST /admin/api/pos/cancel { id }: stops a checkout (so it can't be paid later). */
export async function posCancel(env: Env, id: unknown) {
  if (typeof id !== 'string' || !/^cs_(test|live)_[A-Za-z0-9]+$/.test(id)) return json({ error: 'bad request' }, 400);
  await clearCurrent(env, id);
  const r = await stripe(env, `/checkout/sessions/${id}/expire`, new URLSearchParams());
  // Already paid between the tap and now: say so instead of pretending it was cancelled.
  if (!r.ok && /complete/i.test(r.message)) return json({ paid: true });
  return json({ ok: true });
}

async function clearCurrent(env: Env, id: string) {
  const cur = await env.STOCK!.get<{ id: string }>(CURRENT, 'json');
  if (cur?.id === id) await env.STOCK!.delete(CURRENT);
}

/** GET /pay (the booth sign's QR code): the checkout being charged right now, or the shop. */
export async function payNow(request: Request, env: Env) {
  const cur = env.STOCK ? await env.STOCK.get<{ url: string; at: number }>(CURRENT, 'json') : null;
  const to = cur && Date.now() - cur.at < 30 * 60 * 1000 ? cur.url : new URL('/shop', request.url).toString();
  return new Response(null, { status: 303, headers: { location: to, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
}

/** Sales tax for a cash sale at the place, from Stripe Tax (0 if it can't be worked out). */
async function cashTax(env: Env, lines: Line[], p: Place) {
  if (!TAX_ENABLED || !env.STRIPE_SECRET_KEY) return 0;
  const q = new URLSearchParams();
  q.set('currency', 'usd');
  lines.forEach((l, i) => {
    q.set(`line_items[${i}][amount]`, String(l.cents * l.qty));
    q.set(`line_items[${i}][quantity]`, String(l.qty));
    q.set(`line_items[${i}][reference]`, `${l.slug}-${l.size}`);
    q.set(`line_items[${i}][tax_code]`, CLOTHING_TAX_CODE);
  });
  setAddress(q, 'customer_details[address]', p);
  q.set('customer_details[address_source]', 'shipping');
  const r = await stripe(env, '/tax/calculations', q);
  if (!r.ok) console.error('pos cash tax failed', r.message);
  return r.ok ? Number(r.data.tax_amount_exclusive) || 0 : 0;
}

/** POST /admin/api/pos/cash { items, place, confirm }: without confirm, the total to collect (with
 *  tax); with confirm, records the sale. */
export async function posCash(env: Env, body: Record<string, unknown>) {
  if (!env.STOCK) return json({ error: 'not set up.' }, 503);
  const place = readPlace(body.place);
  if (typeof place === 'string') return json({ error: place }, 400);
  const lines = await readLines(env, body.items);
  if (typeof lines === 'string') return json({ error: lines }, 409);
  const subtotal = lines.reduce((s, l) => s + l.cents * l.qty, 0);
  const tax = await cashTax(env, lines, place);
  if (body.confirm !== true) return json({ subtotal, tax, total: subtotal + tax });
  for (const l of lines) await recordSale(env, l.slug, l.size, l.qty);
  const now = Date.now();
  const o: Order = {
    id: `cash_${randomCode().slice(0, 20)}`,
    number: await nextNumber(env),
    token: randomCode(),
    created: now,
    live: true,
    items: lines.map((l) => ({ slug: l.slug, title: l.title, size: l.size.toUpperCase(), qty: l.qty, cents: l.cents * l.qty })),
    buyerName: 'cash sale',
    address: [],
    shippingMethod: `in person · cash · ${place.name}`,
    shippingCents: 0,
    subtotal,
    discount: 0,
    tax: tax || undefined,
    total: subtotal + tax,
    status: 'received',
    dates: { received: now },
    inPerson: place.name,
  };
  await addOrder(env, o);
  await setStatus(env, o.id, 'delivered');
  return json({ ok: true, number: o.number, total: o.total, tax });
}
