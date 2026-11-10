// The private orders page, gush.supply/admin: only you can open it.
//
// Signing in: the sign-in page (/admin/login) has one button, "email me a sign-in link". The link is
// sent through Cloudflare Email Routing to ORDER_EMAIL_TO, your own verified inbox, and that's the
// only address it can ever go to, so only you can sign in. The link works once, for 15 minutes, and
// signs that browser in for 30 days (an HttpOnly cookie; the session lives in KV, admin:session:<id>).
// "sign out" ends it. At most one link a minute is sent, so the button can't be used to flood you.
//
// Everything under /admin goes through here (run_worker_first in wrangler.toml). Signed out, the
// page redirects to the sign-in page and the API answers 401.
import { FROM, esc, INK, GRAY, FONT } from './notify';
import { page, td, gap } from './waitlist';
import { listOrders, setStatus, setArchived, importFromStripe, isStatus } from './orders';
import { ORDER_UPDATE_EMAILS } from '../src/data/store';
import type { Env } from './index';

const COOKIE = 'gush_admin';
const SESSION_DAYS = 30;
const SESSION = 'admin:session:';
const LOGIN = 'admin:login:';
const LINK_SENT = 'admin:linksent';

const json = (body: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-robots-tag': 'noindex', ...headers },
  });

const randomId = () => [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('');

function cookie(request: Request, name: string) {
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return undefined;
}

async function signedIn(request: Request, env: Env) {
  const id = cookie(request, COOKIE);
  if (!env.STOCK || !id || !/^[0-9a-f]{64}$/.test(id)) return false;
  return (await env.STOCK.get(SESSION + id)) !== null;
}

/** Same-site check for anything that changes data (on top of the SameSite cookie). */
const sameOrigin = (request: Request, url: URL) => request.headers.get('origin') === url.origin;

async function servePage(request: Request, env: Env, path: string) {
  const res = await env.ASSETS.fetch(new Request(new URL(path, request.url), request));
  const headers = new Headers(res.headers);
  headers.set('cache-control', 'no-store');
  headers.set('x-robots-tag', 'noindex');
  headers.set('referrer-policy', 'no-referrer');
  return new Response(res.body, { status: res.status, headers });
}

const redirect = (to: string, headers: HeadersInit = {}) =>
  new Response(null, { status: 303, headers: { location: to, 'cache-control': 'no-store', ...headers } });

export async function admin(request: Request, env: Env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\.html$/, '').replace(/\/$/, '') || '/admin';
  const method = request.method;

  // ---- signed-out routes ----
  if (path === '/admin/login') return servePage(request, env, '/admin/login');

  if (path === '/admin/api/login') {
    if (method !== 'POST') return json({ error: 'method not allowed' }, 405);
    if (!sameOrigin(request, url)) return json({ error: 'forbidden' }, 403);
    return sendLoginLink(env, url.origin);
  }

  if (path === '/admin/auth') {
    const token = url.searchParams.get('t') ?? '';
    if (!env.STOCK || !/^[0-9a-f]{64}$/.test(token) || (await env.STOCK.get(LOGIN + token)) === null) {
      return redirect('/admin/login?link=expired');
    }
    await env.STOCK.delete(LOGIN + token);
    const id = randomId();
    await env.STOCK.put(SESSION + id, String(Date.now()), { expirationTtl: SESSION_DAYS * 86400 });
    return redirect('/admin', {
      'set-cookie': `${COOKIE}=${id}; Path=/; Max-Age=${SESSION_DAYS * 86400}; HttpOnly; Secure; SameSite=Lax`,
    });
  }

  if (path === '/admin/logout') {
    if (method !== 'POST') return json({ error: 'method not allowed' }, 405);
    if (!sameOrigin(request, url)) return json({ error: 'forbidden' }, 403);
    const id = cookie(request, COOKIE);
    if (env.STOCK && id) await env.STOCK.delete(SESSION + id);
    return redirect('/admin/login', { 'set-cookie': `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax` });
  }

  // ---- everything else needs you signed in ----
  if (!(await signedIn(request, env))) {
    return path.startsWith('/admin/api/') ? json({ error: 'signed out' }, 401) : redirect('/admin/login');
  }

  if (path === '/admin') return servePage(request, env, '/admin');

  if (path === '/admin/api/orders' && method === 'GET') {
    const orders = await listOrders(env);
    return json({ orders: orders.map((o) => ({ ...o, trackUrl: `/order/${o.token}` })), emailsOn: ORDER_UPDATE_EMAILS });
  }

  if (method === 'POST' && !sameOrigin(request, url)) return json({ error: 'forbidden' }, 403);
  let body: Record<string, unknown> = {};
  if (method === 'POST') body = ((await request.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;

  if (path === '/admin/api/status' && method === 'POST') {
    if (typeof body.id !== 'string' || !isStatus(body.status)) return json({ error: 'bad request' }, 400);
    const r = await setStatus(env, body.id, body.status, {
      tracking: typeof body.tracking === 'string' ? body.tracking : undefined,
      email: body.email === true,
    });
    if ('error' in r) return json(r, 404);
    return json({ order: { ...r.order, trackUrl: `/order/${r.order.token}` }, emailed: r.emailed });
  }

  if (path === '/admin/api/archive' && method === 'POST') {
    if (typeof body.id !== 'string') return json({ error: 'bad request' }, 400);
    const o = await setArchived(env, body.id, body.archived === true);
    return o ? json({ order: { ...o, trackUrl: `/order/${o.token}` } }) : json({ error: 'order not found' }, 404);
  }

  if (path === '/admin/api/import' && method === 'POST') {
    const r = await importFromStripe(env);
    if ('error' in r) return json(r, 502);
    return json({ ...r, orders: r.orders.map((o) => ({ ...o, trackUrl: `/order/${o.token}` })) });
  }

  return json({ error: 'not found' }, 404);
}

async function sendLoginLink(env: Env, origin: string) {
  if (!env.STOCK || !env.ORDER_EMAIL || !env.ORDER_EMAIL_TO) return json({ error: 'sign-in isn’t set up here.' }, 503);
  if (await env.STOCK.get(LINK_SENT)) return json({ ok: true, wait: true }); // one link a minute
  await env.STOCK.put(LINK_SENT, '1', { expirationTtl: 60 });
  const token = randomId();
  await env.STOCK.put(LOGIN + token, '1', { expirationTtl: 15 * 60 });
  const link = `${origin}/admin/auth?t=${token}`;
  const subject = 'sign in to GÜSH orders';
  const text = `${subject}\n\n${link}\n\nthis link works once, for 15 minutes. didn't ask for it? ignore this email; nobody else can use it.`;
  const html = page(`
    <div ${td('font-size:22px;')}>${esc(subject)}</div>
    ${gap(20)}
    <div style="text-align:center;"><a href="${esc(link)}" style="display:inline-block;font-family:${FONT};font-size:15px;color:${INK};text-decoration:none;border:1.5px solid ${INK};padding:10px 18px;">sign in</a></div>
    ${gap(20)}
    <div ${td(`color:${GRAY};font-size:12px;`)}>this link works once, for 15 minutes. didn’t ask for it? ignore this email; nobody else can use it.</div>`);
  try {
    await env.ORDER_EMAIL.send({ from: { name: 'GÜSH orders', email: FROM.email }, to: env.ORDER_EMAIL_TO, subject, text, html });
  } catch (err) {
    console.error('sign-in email failed', err);
    return json({ error: 'the email didn’t send. try again in a minute.' }, 502);
  }
  return json({ ok: true });
}

