// The newsletter list and the contact form (the footer on every page, and /contact).
//  - POST /api/newsletter { email } saves the email in Cloudflare KV (the STOCK namespace, key
//    news:<email>) and sends a welcome email with a one-click unsubscribe link. Signing up twice
//    keeps one entry. `npm run newsletter` lists everyone on it.
//  - /api/unsubscribe?e=<email>&t=<token> takes them off the list (the token, made at signup, is
//    in their emails, so nobody else can unsubscribe them). Mail apps' own "unsubscribe" button
//    POSTs to the same address.
//  - POST /api/contact { name, email, message } emails you the message; reply to reach them.
import { SITE_URL, CONTACT_EMAIL } from '../src/data/store';
import { FROM, GRAY, esc } from './notify';
import { EMAIL, json, resend, page, td, gap } from './waitlist';
import type { Env } from './index';

const PREFIX = 'news:';
type Meta = { at: number; token: string };

const cleanEmail = (v: unknown) => String(v ?? '').trim().toLowerCase();
const unsubscribeUrl = (email: string, token: string) =>
  `${SITE_URL}/api/unsubscribe?e=${encodeURIComponent(email)}&t=${encodeURIComponent(token)}`;

async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json();
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function joinNewsletter(request: Request, env: Env, ctx: ExecutionContext) {
  const body = await readBody(request);
  if (!body) return json({ error: 'something went wrong. try again?' }, 400);
  // "website" is a hidden field only bots fill in: pretend it worked.
  if (body.website) return json({ ok: true });
  const email = cleanEmail(body.email);
  if (email.length > 254 || !EMAIL.test(email)) return json({ error: "that email doesn't look right." }, 400);
  if (!env.STOCK) return json({ error: `this isn't working right now. email ${CONTACT_EMAIL} instead?` }, 503);

  const key = PREFIX + email;
  const old = await env.STOCK.getWithMetadata<Meta>(key);
  if (old.value !== null) return json({ ok: true, already: true }); // one entry per email, no second welcome
  const meta: Meta = { at: Date.now(), token: crypto.randomUUID() };
  await env.STOCK.put(key, '', { metadata: meta });
  ctx.waitUntil(
    resend(env, email, `news-welcome-${email}-${meta.at}`, welcomeEmail(email, meta.token)).catch((err) =>
      console.error('newsletter welcome failed', err),
    ),
  );
  return json({ ok: true });
}

/** The welcome email, with the unsubscribe link (also offered to mail apps' own button). */
export function welcomeEmail(email: string, token: string) {
  const url = unsubscribeUrl(email, token);
  const subject = "you're on the GÜSH list";
  const body = "you'll get updates on the latest styles and projects we're working on.";
  const text = `${subject}\n\n${body}\n\nshop: ${SITE_URL}/shop\n\nunsubscribe: ${url}`;
  const html = page(`
    <div ${td('font-size:22px;')}>${esc(subject)}</div>
    ${gap(14)}
    <div ${td()}>${esc(body)}</div>
    ${gap(24)}
    <div style="text-align:center;"><a href="${SITE_URL}/shop" style="display:inline-block;font-family:'IBM Plex Mono',monospace;font-size:15px;color:#1f1b16;text-decoration:none;border:1.5px solid #1f1b16;padding:10px 18px;">shop</a></div>
    ${gap(28)}
    <div ${td(`color:${GRAY};font-size:12px;`)}>don't want these? <a href="${esc(url)}" style="color:${GRAY};">unsubscribe</a>.</div>`);
  return { subject, text, html, headers: { 'List-Unsubscribe': `<${url}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } };
}

/** GET from the link in an email (then on to a "you're off the list" page), or POST from a mail app. */
export async function unsubscribe(request: Request, env: Env) {
  const u = new URL(request.url);
  const email = cleanEmail(u.searchParams.get('e'));
  const token = u.searchParams.get('t') ?? '';
  if (env.STOCK && email && token) {
    const key = PREFIX + email;
    const { value, metadata } = await env.STOCK.getWithMetadata<Meta>(key);
    if (value !== null && metadata?.token === token) await env.STOCK.delete(key);
  }
  if (request.method === 'POST') return new Response('unsubscribed');
  return Response.redirect(`${u.origin}/unsubscribed`, 303);
}

export async function contact(request: Request, env: Env) {
  const body = await readBody(request);
  if (!body) return json({ error: 'something went wrong. try again?' }, 400);
  if (body.website) return json({ ok: true });
  const name = String(body.name ?? '').trim().slice(0, 120);
  const email = cleanEmail(body.email);
  const message = String(body.message ?? '').trim();
  if (email.length > 254 || !EMAIL.test(email)) return json({ error: "that email doesn't look right." }, 400);
  if (!message) return json({ error: 'write a message first.' }, 400);
  if (message.length > 5000) return json({ error: 'that message is a little long. try shortening it?' }, 400);
  if (!env.ORDER_EMAIL || !env.ORDER_EMAIL_TO) return json({ error: `this isn't working right now. email ${CONTACT_EMAIL} instead?` }, 503);

  const who = name ? `${name} (${email})` : email;
  const subject = `contact: ${name || email}`;
  const text = `${who} wrote:\n\n${message}\n\n(reply to this email to answer them)`;
  const html = page(`
    <div ${td('font-size:22px;')}>${esc(subject)}</div>
    ${gap(10)}
    <div ${td(`color:${GRAY};`)}>${esc(who)}</div>
    ${gap(16)}
    <div ${td('border:1.5px solid #1f1b16;padding:10px 12px;white-space:pre-wrap;')}>${esc(message)}</div>
    ${gap(16)}
    <div ${td(`color:${GRAY};font-size:12px;`)}>reply to this email to answer them.</div>`);
  try {
    await env.ORDER_EMAIL.send({ from: { name: 'GÜSH contact', email: FROM.email }, to: env.ORDER_EMAIL_TO, subject, text, html, replyTo: email });
  } catch (err) {
    console.error('contact email failed', err);
    return json({ error: `that didn't send. email ${CONTACT_EMAIL} instead?` }, 502);
  }
  return json({ ok: true });
}
