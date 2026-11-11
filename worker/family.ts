// The family Christmas gift list (settings in src/data/family.ts).
//  - /family/<key> is the page. The key is the secret part of the link: it's kept in Cloudflare KV
//    (family:key), not in this public code, so only someone with the link can open the page. Any
//    other /family address is "not found".
//  - POST /api/family saves one pick per email as an order on the orders page (tagged "family", with
//    the code), emails you, and emails them a receipt with their tracking link. No Stripe, no price.
//    The code only works here, with the key, until the deadline.
import { FAMILY_CODE, FAMILY_DEADLINE, FAMILY_DEADLINE_LABEL, FAMILY_STYLES, FAMILY_COLORS, FAMILY_SIZES } from '../src/data/family';
import { ORDER_UPDATE_EMAILS } from '../src/data/store';
import { addOrder, nextNumber, randomCode, trackUrl, itemLabel, itemPicture, getOrder, getOrderByToken, putOrder, type Order } from './orders';
import { resend, page, td, gap, json, EMAIL } from './waitlist';
import { FROM, esc, INK, GRAY, FONT } from './notify';
import type { Env } from './index';

const KEY = 'family:key';
const CLAIM = 'famclaim:'; // famclaim:<email> -> order id
const CLAIM_NAME = 'famname:'; // famname:<name, lowercased> -> order id

/** "Mom  Sienko" and "mom sienko" are the same person. */
const nameKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** The gift already picked under this email or name, if any. */
async function existingPick(env: Env, email: string, name: string) {
  for (const k of [email ? CLAIM + email : '', nameKey(name) ? CLAIM_NAME + nameKey(name) : '']) {
    if (!k) continue;
    const id = await env.STOCK!.get(k);
    const o = id ? await getOrder(env, id) : null;
    if (o) return o;
  }
  return null;
}

const pickReply = (o: Order) => ({
  already: true,
  label: o.items.map(itemLabel).join(', '),
  trackUrl: `/order/${o.token}`,
  editable: o.status === 'received', // can still change it (until it's on the machine)
});

/** POST /api/family/check { key, name, email }: step 1 asks this before moving on, so someone who
 *  already picked (by email or name) is stopped right there. */
export async function familyCheck(request: Request, env: Env) {
  const b = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  if (!(await keyOk(env, b.key))) return json({ error: 'this link doesn’t work.' }, 404);
  const email = String(b.email ?? '').trim().toLowerCase();
  const name = String(b.name ?? '').trim();
  const o = await existingPick(env, email, name);
  return json(o ? { ok: true, ...pickReply(o) } : { ok: true, already: false });
}

/** Constant-time comparison, so the key can't be guessed a letter at a time. */
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

/** Open through the end of the deadline day, Seattle time. */
export const familyOpen = (now = Date.now()) => now <= Date.parse(`${FAMILY_DEADLINE}T23:59:59-08:00`);

const noStore = (headers: Headers) => {
  headers.set('cache-control', 'no-store');
  headers.set('x-robots-tag', 'noindex');
  headers.set('referrer-policy', 'no-referrer');
  return headers;
};

/** /family/<key>: the page, or the site's 404 page for a wrong key (or plain /family). */
export async function familyPage(request: Request, env: Env, key: string | undefined) {
  if (!(await keyOk(env, key))) {
    const notFound = await env.ASSETS.fetch(new Request(new URL('/404', request.url), request));
    return new Response(notFound.body, { status: 404, headers: noStore(new Headers(notFound.headers)) });
  }
  const shell = await env.ASSETS.fetch(new Request(new URL('/family', request.url), request));
  const res = new Response(shell.body, { status: 200, headers: noStore(new Headers(shell.headers)) });
  if (familyOpen()) return res;
  // After the deadline the form is replaced with a note.
  return new HTMLRewriter()
    .on('[data-fam-body]', {
      element(el) {
        el.setInnerContent(
          `<p>the gift list closed on ${esc(FAMILY_DEADLINE_LABEL)}. already picked? check the link in your email. otherwise, text brent ♥</p>`,
          { html: true },
        );
      },
    })
    .transform(res);
}

type Pick = { title: string; size: string; swatch?: string; slug: string; choices: NonNullable<Order['pick']> };

/** Checks the form and turns it into the gift. Returns an error message for anything off. */
function readPick(b: Record<string, unknown>): Pick | string {
  const style = FAMILY_STYLES.find((s) => s.key === b.style);
  if (!style) return 'pick a gift first.';
  const mystery = style.key === 'mystery';
  const bag = style.key === 'bag';
  const surprise = mystery && (b.color === 'surprise' || !b.color);
  const color = FAMILY_COLORS.find((c) => c.key === b.color);
  if (!color && !surprise) return 'pick a color.';
  let size = '';
  if (!bag) {
    const s = FAMILY_SIZES.find((x) => x === b.size);
    if (!s) return 'pick a size.';
    size = s.toUpperCase();
  }
  const bagKind = String(b.bag ?? '').trim().replace(/\s+/g, ' ').slice(0, 60).toLowerCase();
  if (bag && !bagKind) return 'tell us what kind of bag.';
  const colorName = color?.key ?? '';
  const title = mystery
    ? surprise
      ? 'mystery gift'
      : `mystery gift (${colorName})`
    : bag
      ? `${colorName} bag · ${bagKind}`
      : `${colorName} ${style.label}`;
  return {
    title,
    size,
    swatch: color?.hex,
    slug: `family-${style.key}`,
    choices: { style: style.key, color: color?.key ?? (surprise ? 'surprise' : ''), size: size.toLowerCase(), bag: bagKind },
  };
}

export async function familySubmit(request: Request, env: Env, ctx: ExecutionContext) {
  let b: Record<string, unknown>;
  try {
    b = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'something went wrong. try again?' }, 400);
  }
  if (!(await keyOk(env, b.key))) return json({ error: 'this link doesn’t work.' }, 404);
  if (!familyOpen()) return json({ error: `the gift list closed on ${FAMILY_DEADLINE_LABEL}.` }, 410);

  const name = String(b.name ?? '').trim().replace(/\s+/g, ' ').slice(0, 80);
  if (!name) return json({ error: 'tell us your name.' }, 400);
  const email = String(b.email ?? '').trim().toLowerCase();
  if (email.length > 254 || !EMAIL.test(email)) return json({ error: 'that email doesn’t look right.' }, 400);
  const pick = readPick(b);
  if (typeof pick === 'string') return json({ error: pick }, 400);
  if (String(b.code ?? '').trim().toUpperCase() !== FAMILY_CODE) return json({ error: 'use your secret code first.' }, 400);
  const fit = String(b.fit ?? '').trim().slice(0, 600);

  // One gift per person (by email or name).
  const existing = await existingPick(env, email, name);
  if (existing) return json({ ok: true, ...pickReply(existing) });

  const now = Date.now();
  const o: Order = {
    id: `fam_${randomCode().slice(0, 20)}`,
    number: await nextNumber(env),
    token: randomCode(),
    created: now,
    live: true,
    items: [{ slug: pick.slug, title: pick.title, size: pick.size, qty: 1, cents: 0, swatch: pick.swatch }],
    buyerName: name,
    buyerEmail: email,
    address: [],
    shippingMethod: 'in person at christmas',
    shippingCents: 0,
    subtotal: 0,
    discount: 0,
    total: 0,
    note: fit || undefined,
    status: 'received',
    dates: { received: now },
    family: true,
    pick: pick.choices,
    code: FAMILY_CODE,
  };
  await addOrder(env, o);
  await env.STOCK!.put(CLAIM + email, o.id);
  if (nameKey(name)) await env.STOCK!.put(CLAIM_NAME + nameKey(name), o.id);
  ctx.waitUntil(Promise.all([tellOwner(env, o), sendReceipt(env, o)]));
  return json({ ok: true, label: o.items.map(itemLabel).join(', '), trackUrl: `/order/${o.token}` });
}

/** To you: who picked what. */
async function tellOwner(env: Env, o: Order) {
  if (!env.ORDER_EMAIL || !env.ORDER_EMAIL_TO) return;
  const gift = o.items.map(itemLabel).join(', ');
  const subject = `family gift: ${o.buyerName} picked ${gift}`;
  const lines = [
    `${o.buyerName} (${o.buyerEmail}) picked:`,
    gift,
    `fit note: ${o.note ?? '(none)'}`,
    `code used: ${o.code}`,
    `delivery: ${o.shippingMethod}`,
    `it's #${o.number} on your orders page.`,
  ];
  const html = page(`
    <div ${td('font-size:22px;')}>${esc(subject)}</div>
    ${gap(16)}
    <div style="text-align:center;">${o.items.map((i) => itemPicture(i, 120, true)).join('')}</div>
    ${gap(16)}
    ${lines.map((l) => `<div ${td('margin:0 0 8px;')}>${esc(l)}</div>`).join('')}`);
  try {
    await env.ORDER_EMAIL.send({ from: { name: 'GÜSH family', email: FROM.email }, to: env.ORDER_EMAIL_TO, subject, text: lines.join('\n'), html, replyTo: o.buyerEmail });
  } catch (err) {
    console.error('family owner email failed', o.id, err);
  }
}

/** To them: their pick and the tracking link (when order emails are on). */
async function sendReceipt(env: Env, o: Order) {
  if (!ORDER_UPDATE_EMAILS || !o.buyerEmail) return;
  try {
    await resend(env, o.buyerEmail, `family-${o.id}`, familyReceipt(o));
  } catch (err) {
    console.error('family receipt failed', o.id, err);
  }
}

export function familyReceipt(o: Order) {
  const first = o.buyerName?.trim().split(/\s+/)[0]?.toLowerCase();
  const gift = o.items.map(itemLabel).join(', ');
  const url = trackUrl(o);
  const subject = 'your GÜSH gift is on the list ♥';
  const lines = [
    `${first ? `${first}, ` : ''}we got your pick: ${gift}.`,
    'it’ll be sewn by hand and given to you at christmas. you can check on it anytime, and change your pick there until it’s on the machine.',
  ];
  const text = [subject, '', ...lines, ...(o.note ? ['', `your fit note: ${o.note}`] : []), '', `see your gift: ${url}`].join('\n');
  const html = page(`
    <div ${td('font-size:22px;')}>${esc(subject)}</div>
    ${gap(16)}
    <div style="text-align:center;">${o.items.map((i) => itemPicture(i, 140, true)).join('')}</div>
    ${gap(16)}
    ${lines.map((l) => `<div ${td('margin:0 0 10px;')}>${esc(l)}</div>`).join('')}
    ${o.note ? `<div ${td(`color:${GRAY};margin:0 0 10px;`)}>your fit note: ${esc(o.note)}</div>` : ''}
    ${gap(18)}
    <div style="text-align:center;"><a href="${esc(url)}" style="display:inline-block;font-family:${FONT};font-size:15px;color:${INK};text-decoration:none;border:1.5px solid ${INK};padding:10px 18px;">see your gift</a></div>`);
  return { subject, text, html };
}

/** POST /api/order/<code>/edit { style, color, size, bag, fit }: changes a family gift, but only
 *  while it's still "order received". Once it's on the machine, it's locked. Emails you the change. */
export async function familyEdit(request: Request, env: Env, ctx: ExecutionContext, token: string) {
  const o = await getOrderByToken(env, token);
  if (!o || !o.family) return json({ error: 'this gift can’t be changed here.' }, 404);
  if (o.status !== 'received') return json({ error: 'it’s already on the machine, so it can’t be changed. text brent ♥' }, 409);
  const b = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const pick = readPick(b);
  if (typeof pick === 'string') return json({ error: pick }, 400);
  const before = o.items.map(itemLabel).join(', ');
  const beforeNote = o.note;
  o.items = [{ slug: pick.slug, title: pick.title, size: pick.size, qty: 1, cents: 0, swatch: pick.swatch }];
  o.pick = pick.choices;
  o.note = String(b.fit ?? '').trim().slice(0, 600) || undefined;
  await putOrder(env, o);
  const after = o.items.map(itemLabel).join(', ');
  if (after !== before || o.note !== beforeNote) ctx.waitUntil(tellOwnerChange(env, o, before));
  return json({ ok: true, label: after });
}

/** To you: someone changed their pick. */
async function tellOwnerChange(env: Env, o: Order, before: string) {
  if (!env.ORDER_EMAIL || !env.ORDER_EMAIL_TO) return;
  const after = o.items.map(itemLabel).join(', ');
  const subject = `family gift changed: ${o.buyerName} now wants ${after}`;
  const lines = [`${o.buyerName} changed their pick (#${o.number}).`, `was: ${before}`, `now: ${after}`, `note: ${o.note ?? '(none)'}`];
  const html = page(`
    <div ${td('font-size:22px;')}>${esc(subject)}</div>
    ${gap(16)}
    <div style="text-align:center;">${o.items.map((i) => itemPicture(i, 120, true)).join('')}</div>
    ${gap(16)}
    ${lines.map((l) => `<div ${td('margin:0 0 8px;')}>${esc(l)}</div>`).join('')}`);
  try {
    await env.ORDER_EMAIL.send({ from: { name: 'GÜSH family', email: FROM.email }, to: env.ORDER_EMAIL_TO, subject, text: lines.join('\n'), html, replyTo: o.buyerEmail });
  } catch (err) {
    console.error('family change email failed', o.id, err);
  }
}
