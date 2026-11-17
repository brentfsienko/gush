// Custom gifts: family (and friends of family) order a custom piece for someone else and pay for it.
//  - /gift/<key> is the page (src/pages/gift.astro). Like the family list, the key is the secret part
//    of the link, kept in Cloudflare KV (gift:key), not in this public code. Any other /gift address
//    is "not found". The link can be shared with anyone you want to be able to order.
//  - POST /api/gift saves the request as an order on the orders page (tagged "gift"): who it's from,
//    who it's for, a card message, the piece (same choices as the family list), and whether to mail it
//    to them or hand it to the giver. No price yet. You get an email; so do they.
//  - You set a price on the orders page (setQuote). That emails the giver a link to their gift's page,
//    where a "pay" button (POST /order/<code>/pay) opens Stripe checkout for that amount.
//  - The Stripe webhook (worker/webhook.ts) hands paid gift checkouts to giftPaid: the order is marked
//    paid, and you and the giver get an email.
import { CONTACT_EMAIL, SITE_URL } from '../src/data/store';
import { addOrder, nextNumber, randomCode, trackUrl, itemLabel, itemPicture, getOrder, getOrderByToken, putOrder, type Order } from './orders';
import { readPick } from './family';
import { resend, page, td, gap, json, EMAIL } from './waitlist';
import { FROM, esc, INK, GRAY, FONT, type PaidSession } from './notify';
import { brand, imageOrigin, createSession } from './checkout';
import type { Env } from './index';

const KEY = 'gift:key';
const MAX_PRICE = 2000_00; // $2,000: a typo guard on the orders page

const money = (c: number) => `$${(c / 100).toFixed(2).replace(/\.00$/, '')}`;
const firstName = (n?: string) => n?.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
const clean = (v: unknown, max: number) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max);

function sameKey(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function keyOk(env: Env, key: unknown) {
  if (!env.STOCK || typeof key !== 'string' || key.length < 16 || key.length > 64) return false;
  const real = await env.STOCK.get(KEY);
  return !!real && sameKey(real, key);
}

const noStore = (headers: Headers) => {
  headers.set('cache-control', 'no-store');
  headers.set('x-robots-tag', 'noindex');
  headers.set('referrer-policy', 'no-referrer');
  return headers;
};

/** /gift/<key>: the page, or the site's 404 page for a wrong key (or plain /gift). */
export async function giftPage(request: Request, env: Env, key: string | undefined) {
  const ok = await keyOk(env, key);
  const shell = await env.ASSETS.fetch(new Request(new URL(ok ? '/gift' : '/404', request.url), request));
  return new Response(shell.body, { status: ok ? 200 : 404, headers: noStore(new Headers(shell.headers)) });
}

/** POST /api/gift: saves a gift request (no price yet). */
export async function giftSubmit(request: Request, env: Env, ctx: ExecutionContext) {
  let b: Record<string, unknown>;
  try {
    b = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'something went wrong. try again?' }, 400);
  }
  if (!(await keyOk(env, b.key))) return json({ error: 'this link doesn’t work.' }, 404);

  const name = clean(b.name, 80);
  if (!name) return json({ error: 'tell us your name.' }, 400);
  const email = String(b.email ?? '').trim().toLowerCase();
  if (email.length > 254 || !EMAIL.test(email)) return json({ error: 'that email doesn’t look right.' }, 400);
  const to = clean(b.to, 80);
  if (!to) return json({ error: 'who’s it for?' }, 400);
  const message = String(b.message ?? '').trim().slice(0, 400) || undefined;
  const pick = readPick(b);
  if (typeof pick === 'string') return json({ error: pick }, 400);
  const fit = String(b.fit ?? '').trim().slice(0, 600) || undefined;

  const deliver = b.deliver === 'mail' ? 'mail' : b.deliver === 'hand' ? 'hand' : null;
  if (!deliver) return json({ error: 'how should it get to them?' }, 400);
  let address: string[] = [];
  if (deliver === 'mail') {
    const line1 = clean(b.line1, 120);
    const line2 = clean(b.line2, 120);
    const city = clean(b.city, 80);
    const state = clean(b.state, 40);
    const zip = clean(b.zip, 20);
    if (!line1 || !city || !state || !zip) return json({ error: 'fill in their address (street, city, state, zip).' }, 400);
    address = [to, line1, line2, `${city}, ${state} ${zip}`].filter(Boolean);
  }

  const now = Date.now();
  const o: Order = {
    id: `gift_${randomCode().slice(0, 20)}`,
    number: await nextNumber(env),
    token: randomCode(),
    created: now,
    live: true,
    items: [{ slug: pick.slug, title: pick.title, size: pick.size, qty: 1, cents: 0, swatch: pick.swatch }],
    buyerName: name,
    buyerEmail: email,
    shipName: deliver === 'mail' ? to : undefined,
    address,
    shippingMethod: deliver === 'mail' ? `mail it to ${to}` : `hand it to ${name} to give`,
    shippingCents: 0,
    subtotal: 0,
    discount: 0,
    total: 0,
    note: fit,
    status: 'received',
    dates: { received: now },
    pick: pick.choices,
    gift: { to, message, deliver },
  };
  await addOrder(env, o);
  ctx.waitUntil(Promise.all([tellOwner(env, o), sendRequestReceipt(env, o)]));
  return json({ ok: true, label: o.items.map(itemLabel).join(', '), trackUrl: `/order/${o.token}` });
}

const button = (href: string, label: string) =>
  `<div style="text-align:center;"><a href="${esc(href)}" style="display:inline-block;font-family:${FONT};font-size:15px;color:${INK};text-decoration:none;border:1.5px solid ${INK};padding:10px 18px;">${esc(label)}</a></div>`;

function email(subject: string, o: Order, lines: string[], cta?: { href: string; label: string }, foot?: string) {
  const text = [subject, '', ...lines, ...(cta ? ['', `${cta.label}: ${cta.href}`] : []), ...(foot ? ['', foot] : [])].join('\n');
  const html = page(`
    <div ${td('font-size:22px;')}>${esc(subject)}</div>
    ${gap(16)}
    <div style="text-align:center;">${o.items.map((i) => itemPicture(i, 140, true)).join('')}</div>
    ${gap(16)}
    ${lines.map((l) => `<div ${td('margin:0 0 10px;')}>${esc(l)}</div>`).join('')}
    ${cta ? `${gap(18)}${button(cta.href, cta.label)}` : ''}
    ${foot ? `${gap(24)}<div ${td(`color:${GRAY};font-size:12px;`)}>${esc(foot)}</div>` : ''}`);
  return { subject, text, html };
}

/** Everything about the gift, for your emails. */
const details = (o: Order) => [
  `from: ${o.buyerName} (${o.buyerEmail})`,
  `for: ${o.gift?.to}`,
  `piece: ${o.items.map(itemLabel).join(', ')}`,
  `note: ${o.note ?? '(none)'}`,
  `card message: ${o.gift?.message ?? '(none)'}`,
  `delivery: ${o.shippingMethod}`,
  ...(o.address.length ? [`address: ${o.address.join(', ')}`] : []),
];

async function toOwner(env: Env, o: Order, subject: string, lines: string[]) {
  if (!env.ORDER_EMAIL || !env.ORDER_EMAIL_TO) return;
  const mail = email(subject, o, lines, { href: `${SITE_URL}/admin`, label: 'open the orders page' });
  try {
    await env.ORDER_EMAIL.send({ from: { name: 'GÜSH gifts', email: FROM.email }, to: env.ORDER_EMAIL_TO, subject, text: mail.text, html: mail.html, replyTo: o.buyerEmail });
  } catch (err) {
    console.error('gift owner email failed', o.id, err);
  }
}

const tellOwner = (env: Env, o: Order) =>
  toOwner(env, o, `gift request: ${o.buyerName} → ${o.gift?.to}`, [...details(o), `it's #${o.number} on your orders page. set a price there and they'll get a link to pay.`]);

/** To the giver: we got it, a price is coming. */
async function sendRequestReceipt(env: Env, o: Order) {
  const hi = firstName(o.buyerName);
  const mail = email(
    'we got your GÜSH gift request ♥',
    o,
    [
      `${hi ? `${hi}, ` : ''}thank you! we got your request for a ${o.items.map(itemLabel).join(', ')} for ${o.gift?.to}.`,
      'brent will look it over and email you a price. once it’s paid, it goes on the machine, sewn by hand.',
    ],
    { href: trackUrl(o), label: 'see your gift' },
    `questions or changes? just reply to this email.`,
  );
  try {
    await resend(env, o.buyerEmail!, `gift-${o.id}`, mail);
  } catch (err) {
    console.error('gift receipt failed', o.id, err);
  }
}

/** The orders page: sets (or changes) a gift's price and emails the giver the link to pay. */
export async function setQuote(env: Env, id: string, dollars: unknown, sendEmail = true) {
  const o = await getOrder(env, id);
  if (!o || !o.gift) return { error: 'gift not found' };
  if (o.paid) return { error: 'it’s already paid.' };
  const cents = Math.round(Number(dollars) * 100);
  if (!Number.isFinite(cents) || cents < 100 || cents > MAX_PRICE) return { error: 'enter a price between $1 and $2,000.' };
  o.quote = { cents, at: Date.now() };
  await putOrder(env, o);
  let emailed = false;
  if (sendEmail && o.buyerEmail) {
    const hi = firstName(o.buyerName);
    const mail = email(
      `your GÜSH gift for ${o.gift.to}: ${money(cents)}`,
      o,
      [
        `${hi ? `${hi}, ` : ''}brent priced out your gift for ${o.gift.to}: ${o.items.map(itemLabel).join(', ')}.`,
        `${money(cents)}${o.gift.deliver === 'mail' ? ', shipping included' : ''}. once it’s paid, it goes on the machine.`,
      ],
      { href: trackUrl(o), label: `pay ${money(cents)}` },
      'questions about the price? just reply to this email.',
    );
    emailed = await resend(env, o.buyerEmail, `gift-quote-${o.id}-${o.quote.at}`, mail).catch((err) => {
      console.error('gift quote email failed', o.id, err);
      return false;
    });
  }
  return { order: o, emailed };
}

/** POST /order/<code>/pay: opens Stripe checkout for the gift's price. */
export async function giftPay(request: Request, env: Env, token: string) {
  const o = await getOrderByToken(env, token);
  const back = (q = '') => Response.redirect(new URL(`/order/${token}${q}`, request.url).toString(), 303);
  if (!o || !o.gift || !o.quote) return back();
  if (o.paid) return back();
  if (!env.STRIPE_SECRET_KEY) return new Response('payments aren’t set up yet.', { status: 503 });
  const origin = new URL(request.url).origin;
  const p = new URLSearchParams();
  p.set('mode', 'payment');
  p.set('line_items[0][quantity]', '1');
  p.set('line_items[0][price_data][currency]', 'usd');
  p.set('line_items[0][price_data][unit_amount]', String(o.quote.cents));
  p.set('line_items[0][price_data][product_data][name]', `custom GÜSH gift for ${o.gift.to}`);
  p.set('line_items[0][price_data][product_data][description]', `${o.items.map(itemLabel).join(', ')} · sewn by hand in Seattle`);
  if (o.buyerEmail) p.set('customer_email', o.buyerEmail);
  p.set('metadata[gush_gift]', o.id);
  p.set('payment_intent_data[metadata][gush_gift]', o.id);
  p.set('payment_intent_data[description]', `GÜSH gift #${o.number} for ${o.gift.to}`);
  p.set('success_url', `${origin}/order/${token}?paid=1`);
  p.set('cancel_url', `${origin}/order/${token}`);
  p.set('custom_text[submit][message]', 'thank you for supporting handmade ♥');
  brand(p, imageOrigin(origin));
  const res = await createSession(p, env);
  if (!res.ok) {
    console.error('gift checkout failed', o.id, res.status, res.message);
    return back('?payerror=1');
  }
  return Response.redirect(res.url, 303);
}

/** The webhook: a gift's checkout was paid. Marks it paid (once) and emails you and the giver. */
export async function giftPaid(env: Env, s: PaidSession) {
  const o = s.metadata?.gush_gift ? await getOrder(env, s.metadata.gush_gift) : null;
  if (!o || !o.gift) {
    console.error('paid gift not found', s.id, s.metadata?.gush_gift);
    return;
  }
  if (o.paid) return;
  const total = s.amount_total ?? o.quote?.cents ?? 0;
  o.paid = Date.now();
  o.live = !!s.livemode;
  o.paymentIntent = s.payment_intent ?? undefined;
  o.items = o.items.map((i) => ({ ...i, cents: total }));
  o.subtotal = total;
  o.total = total;
  await putOrder(env, o);
  const hi = firstName(o.buyerName);
  await Promise.all([
    toOwner(env, o, `gift paid: ${o.buyerName} paid ${money(total)} for ${o.gift.to}’s gift`, [...details(o), `paid: ${money(total)}`, `it's #${o.number}. time to sew!`]),
    o.buyerEmail
      ? resend(
          env,
          o.buyerEmail,
          `gift-paid-${o.id}`,
          email(
            'your GÜSH gift is paid ♥',
            o,
            [
              `${hi ? `${hi}, ` : ''}thank you! we got your ${money(total)} for ${o.gift.to}’s ${o.items.map(itemLabel).join(', ')}.`,
              o.gift.deliver === 'mail'
                ? `it goes on the machine next, sewn by hand, then we’ll mail it to ${o.gift.to}. we’ll email you along the way.`
                : `it goes on the machine next, sewn by hand, then we’ll get it to you to give. we’ll email you along the way.`,
            ],
            { href: trackUrl(o), label: 'see your gift' },
            `order #${o.number} · questions? just reply, or email ${CONTACT_EMAIL}.`,
          ),
        ).catch((err) => console.error('gift paid email failed', o.id, err))
      : null,
  ]);
}
