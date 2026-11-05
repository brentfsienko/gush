// "Email me when it's back": the waitlist for sold-out sizes.
//  - POST /api/waitlist { slug, size, email } (from the item page) saves the email in Cloudflare KV
//    (the STOCK namespace, key want:<slug>:<size>:<email>), emails you that someone's waiting, and
//    emails them a confirmation (through Resend).
//  - Every hour (the cron in wrangler.toml), anyone waiting on a size that's in stock again is
//    emailed once through Resend, and marked as sent. So to restock: raise the size's number in
//    src/data/products.ts and deploy; the emails go out within the hour, and you get a summary.
//  - `npm run waitlist` lists who's waiting for what.
// The signup time and whether they've been emailed are kept in the key's metadata, so the whole
// list comes back in one KV list call (no read per person).
import { PRODUCTS, formatPrice, type Product, type Size } from '../src/data/products';
import { SITE_URL, CONTACT_EMAIL, IMAGE_VERSION } from '../src/data/store';
import { available } from './stock';
import { FROM, INK, GRAY, FONT, esc } from './notify';
import type { Env } from './index';

const PREFIX = 'want:';
type Meta = { at: number; sent?: number };
type Want = { key: string; slug: string; size: string; email: string; meta: Meta };

const key = (slug: string, size: string, email: string) => `${PREFIX}${slug}:${size}:${email}`;
const EMAIL = /^[^\s@<>()[\],;:"]+@[^\s@<>()[\],;:"]+\.[a-z]{2,}$/i;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

async function list(env: Env, prefix = PREFIX): Promise<Want[]> {
  const out: Want[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.STOCK!.list<Meta>({ prefix, cursor });
    for (const k of page.keys) {
      const [slug = '', size = '', ...rest] = k.name.slice(PREFIX.length).split(':');
      out.push({ key: k.name, slug, size, email: rest.join(':'), meta: k.metadata ?? { at: 0 } });
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return out;
}

export async function joinWaitlist(request: Request, env: Env, ctx: ExecutionContext) {
  let body: { slug?: unknown; size?: unknown; email?: unknown; website?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'something went wrong. try again?' }, 400);
  }
  // "website" is a hidden field only bots fill in: pretend it worked.
  if (body.website) return json({ ok: true });
  const p = PRODUCTS.find((x) => x.slug === body.slug);
  const size = String(body.size ?? '');
  if (!p || p.stock[size as Size] === undefined) return json({ error: 'something went wrong. try again?' }, 400);
  const email = String(body.email ?? '').trim().toLowerCase();
  if (email.length > 254 || !EMAIL.test(email)) return json({ error: "that email doesn't look right." }, 400);
  if (!env.STOCK) return json({ error: "this isn't working right now. email " + CONTACT_EMAIL + ' instead?' }, 503);
  if (((await available(env, p.slug, size as Size)) ?? 0) > 0)
    return json({ error: `${size.toUpperCase()} is in stock. you can add it to your cart.` }, 409);

  const k = key(p.slug, size, email);
  const old = await env.STOCK.getWithMetadata<Meta>(k);
  // Already waiting (and not yet emailed): nothing to do, and no second email to you.
  if (old.value !== null && !old.metadata?.sent) return json({ ok: true });
  await env.STOCK.put(k, '', { metadata: { at: Date.now() } satisfies Meta });
  ctx.waitUntil(Promise.all([tellOwner(env, p, size, email), confirm(env, p, size, email)]));
  return json({ ok: true });
}

/** The email to you when someone joins. */
async function tellOwner(env: Env, p: Product, size: string, email: string) {
  if (!env.ORDER_EMAIL || !env.ORDER_EMAIL_TO) return;
  try {
    const waiting = (await list(env, `${PREFIX}${p.slug}:${size}:`)).filter((w) => !w.meta.sent).length;
    const S = size.toUpperCase();
    const subject = `waitlist: ${p.title} (${S})`;
    const lines = [
      `${email} wants ${p.title} in ${S}.`,
      `${waiting} ${waiting === 1 ? 'person is' : 'people are'} waiting for ${S}.`,
    ];
    const html = page(`<div ${td('font-size:22px;')}>${esc(subject)}</div>${gap(14)}${lines.map((l) => `<div ${td('margin:0 0 10px;')}>${esc(l)}</div>`).join('')}`);
    await env.ORDER_EMAIL.send({ from: { name: 'GÜSH waitlist', email: FROM.email }, to: env.ORDER_EMAIL_TO, subject, text: lines.join('\n\n'), html, replyTo: email });
  } catch (err) {
    console.error('waitlist owner email failed', p.slug, size, err);
  }
}

/** Sends one email through Resend (the same sender as the order receipts). True if it went. */
async function resend(env: Env, to: string, idempotencyKey: string, mail: { subject: string; text: string; html: string }) {
  if (!env.RESEND_API_KEY) return false;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      'content-type': 'application/json',
      // Resend sends at most one email per key, so a retry can't send the same email twice.
      'idempotency-key': idempotencyKey.slice(0, 256),
    },
    body: JSON.stringify({ from: `${FROM.name} <${FROM.email}>`, to: [to], reply_to: CONTACT_EMAIL, ...mail }),
  });
  if (!res.ok) console.error('resend failed', res.status, await res.text());
  return res.ok;
}

/** The email to the person who just joined: you're on the list. */
async function confirm(env: Env, p: Product, size: string, email: string) {
  try {
    await resend(env, email, `waitlist-${p.slug}-${size}-${email}-${Date.now()}`, confirmEmail(p, size));
  } catch (err) {
    console.error('waitlist confirmation failed', p.slug, size, err);
  }
}

export function confirmEmail(p: Product, size: string) {
  const S = size.toUpperCase();
  const subject = `you're on the list: ${p.title} in ${S}`;
  const body = `${p.title} in ${S} is sold out right now. we'll email you as soon as it's back, once, and that's it.`;
  const outro = `didn't sign up for this? you can ignore this email.`;
  const text = `${subject}\n\n${body}\n\n${outro}`;
  const html = page(`
    <div ${td('font-size:22px;')}>${esc(subject)}</div>
    ${gap(18)}
    <img src="${SITE_URL}/stripe/${encodeURIComponent(p.slug)}.jpg?v=${IMAGE_VERSION}" width="240" height="240" alt="${esc(p.title)}" style="display:block;border:0;width:240px;height:240px;margin:0 auto;">
    ${gap(18)}
    <div ${td()}>${esc(body)}</div>
    ${gap(24)}
    <div ${td(`color:${GRAY};font-size:12px;`)}>${esc(outro)}</div>`);
  return { subject, text, html };
}

/** Hourly: email everyone waiting on a size that's back in stock. */
export async function sendRestocks(env: Env) {
  if (!env.STOCK) return;
  const due: Want[] = [];
  const inStock = new Map<string, boolean>();
  for (const w of await list(env)) {
    if (w.meta.sent) continue;
    const id = `${w.slug}:${w.size}`;
    if (!inStock.has(id)) inStock.set(id, ((await available(env, w.slug, w.size as Size)) ?? 0) > 0);
    if (inStock.get(id)) due.push(w);
  }
  if (!due.length) return;
  if (!env.RESEND_API_KEY) {
    console.error(`waitlist: ${due.length} people to email, but RESEND_API_KEY isn't set`);
    return;
  }
  const sent: Want[] = [];
  for (const w of due) {
    const p = PRODUCTS.find((x) => x.slug === w.slug)!;
    try {
      // One email per signup, even if this runs again before it's marked as sent.
      if (!(await resend(env, w.email, `restock-${w.slug}-${w.size}-${w.meta.at}-${w.email}`, restockEmail(p, w.size)))) continue;
      await env.STOCK.put(w.key, '', { metadata: { ...w.meta, sent: Date.now() } satisfies Meta });
      sent.push(w);
    } catch (err) {
      console.error('restock email failed', w.slug, w.size, err);
    }
  }
  // A summary to you.
  if (sent.length && env.ORDER_EMAIL && env.ORDER_EMAIL_TO) {
    const lines = sent.map((w) => `${PRODUCTS.find((x) => x.slug === w.slug)!.title} (${w.size.toUpperCase()}): ${w.email}`);
    const subject = `waitlist: emailed ${sent.length} ${sent.length === 1 ? 'person' : 'people'} that it's back`;
    try {
      await env.ORDER_EMAIL.send({
        from: { name: 'GÜSH waitlist', email: FROM.email },
        to: env.ORDER_EMAIL_TO,
        subject,
        text: lines.join('\n'),
        html: page(`<div ${td('font-size:22px;')}>${esc(subject)}</div>${gap(14)}<div ${td()}>${lines.map(esc).join('<br>')}</div>`),
      });
    } catch (err) {
      console.error('waitlist summary email failed', err);
    }
  }
}

/** The email to someone waiting: it's back. */
export function restockEmail(p: Product, size: string) {
  const S = size.toUpperCase();
  const url = `${SITE_URL}/item/${p.slug}?size=${size}`;
  const subject = `${p.title} in ${S} is back`;
  const outro = `you asked us to email you when this was back. this is the only email you'll get about it.`;
  const text = `${subject}.\n\n${formatPrice(p.price)}. there aren't many, so don't wait too long.\n\n${url}\n\n${outro}`;
  const html = page(`
    <div ${td('font-size:22px;')}>${esc(subject)}</div>
    ${gap(18)}
    <a href="${esc(url)}"><img src="${SITE_URL}/stripe/${encodeURIComponent(p.slug)}.jpg?v=${IMAGE_VERSION}" width="240" height="240" alt="${esc(p.title)}" style="display:block;border:0;width:240px;height:240px;margin:0 auto;"></a>
    ${gap(14)}
    <div ${td('text-align:center;')}>${esc(p.title)}<br><span style="color:${GRAY};">size ${esc(S)} · ${esc(formatPrice(p.price))}</span></div>
    ${gap(18)}
    <div ${td()}>there aren't many, so don't wait too long.</div>
    ${gap(20)}
    <div style="text-align:center;"><a href="${esc(url)}" style="display:inline-block;font-family:${FONT};font-size:15px;color:${INK};text-decoration:none;border:1.5px solid ${INK};padding:10px 18px;">shop it</a></div>
    ${gap(24)}
    <div ${td(`color:${GRAY};font-size:12px;`)}>${esc(outro)}</div>`);
  return { subject, text, html };
}

const td = (style = '') => `style="font-family:${FONT};color:${INK};font-size:14px;line-height:1.5;${style}"`;
const gap = (h: number) => `<div style="height:${h}px;font-size:0;line-height:0;">&nbsp;</div>`;

/** Same frame as the order emails: logo, a thin rule, then the content. */
const page = (inner: string) => `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"></head>
<body style="margin:0;padding:0;background:#ffffff;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;"><tr><td align="center" style="padding:24px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;">
  <tr><td align="center" style="padding:0 0 18px;"><a href="${SITE_URL}"><img src="${SITE_URL}/stripe/logo.png?v=${IMAGE_VERSION}" width="160" alt="GÜSH" style="display:block;border:0;width:160px;height:auto;"></a></td></tr>
  <tr><td style="border-top:1px solid ${INK};font-size:0;line-height:0;height:1px;">&nbsp;</td></tr>
  <tr><td style="padding:20px 0 0;">${inner}</td></tr>
  <tr><td align="center" style="padding:32px 0 0;font-family:${FONT};color:${GRAY};font-size:12px;"><a href="${SITE_URL}" style="color:${GRAY};">${esc(SITE_URL.replace(/^https?:\/\//, ''))}</a></td></tr>
</table>
</td></tr></table>
</body></html>`;
