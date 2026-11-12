// The Worker in front of the site. Static pages and images are served straight from dist/
// (see [assets] in wrangler.toml); only /api/*, /item/*, /admin*, /order/* and /family* requests reach this code.
import { checkout } from './checkout';
import { checkCode } from './codes';
import { stripeWebhook } from './webhook';
import { stockMap } from './stock';
import { joinWaitlist, sendRestocks } from './waitlist';
import { itemPage } from './live-stock-page';
import { joinNewsletter, unsubscribe, contact } from './newsletter';
import { admin } from './admin';
import { orderPage, editPage } from './orders';
import { familyPage, familySubmit, familyCheck, familyEdit } from './family';

export interface Env {
  ASSETS: Fetcher;
  STRIPE_SECRET_KEY?: string;
  /** Signing secret of the Stripe webhook endpoint (whsec_...). */
  STRIPE_WEBHOOK_SECRET?: string;
  /** Cloudflare KV namespace holding sold counts (see wrangler.toml). Optional. */
  STOCK?: KVNamespace;
  /** Sends the order emails (send_email binding in wrangler.toml; see worker/notify.ts). Optional. */
  ORDER_EMAIL?: SendEmail;
  /** Your inbox for order emails (a verified Email Routing destination). Optional. */
  ORDER_EMAIL_TO?: string;
  /** Resend API key for the buyer's receipt email (see worker/notify.ts). Optional. */
  RESEND_API_KEY?: string;
}

const allow = (method: string) => new Response('method not allowed', { status: 405, headers: { allow: method } });

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (pathname === '/api/code') {
      // The cart's "have a code?" box (worker/codes.ts).
      if (request.method !== 'POST') return allow('POST');
      const body = (await request.json().catch(() => ({}))) as { code?: unknown; items?: unknown };
      const r = await checkCode(env, body.code, body.items);
      const { promoId: _, ...pub } = 'error' in r ? { ...r, promoId: undefined } : r;
      return new Response(JSON.stringify(pub), { status: 'error' in r ? 400 : 200, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
    }
    if (pathname === '/api/checkout') {
      return request.method === 'POST' ? checkout(request, env) : allow('POST');
    }
    if (pathname === '/api/stripe-webhook') {
      return request.method === 'POST' ? stripeWebhook(request, env) : allow('POST');
    }
    if (pathname === '/api/stock') {
      if (request.method !== 'GET') return allow('GET');
      return new Response(JSON.stringify(await stockMap(env)), {
        headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
      });
    }
    if (pathname === '/api/waitlist') {
      return request.method === 'POST' ? joinWaitlist(request, env, ctx) : allow('POST');
    }
    // Editing a family gift from its tracking page (only until it's on the machine).
    const editing = pathname.match(/^\/api\/order\/([A-Za-z0-9_-]+)\/edit$/);
    if (editing) return request.method === 'POST' ? familyEdit(request, env, ctx, editing[1]) : allow('POST');
    if (pathname === '/api/family/check') {
      return request.method === 'POST' ? familyCheck(request, env) : allow('POST');
    }
    if (pathname === '/api/family') {
      return request.method === 'POST' ? familySubmit(request, env, ctx) : allow('POST');
    }
    if (pathname === '/api/newsletter') {
      return request.method === 'POST' ? joinNewsletter(request, env, ctx) : allow('POST');
    }
    if (pathname === '/api/unsubscribe') {
      return request.method === 'GET' || request.method === 'POST' ? unsubscribe(request, env) : allow('GET, POST');
    }
    if (pathname === '/api/contact') {
      return request.method === 'POST' ? contact(request, env) : allow('POST');
    }
    // The private orders page (only you can sign in; see worker/admin.ts).
    if (pathname === '/admin' || pathname.startsWith('/admin/') || pathname.startsWith('/admin.')) return admin(request, env);
    // The family gift list: only /family/<secret key> opens it (worker/family.ts).
    if (pathname === '/family' || pathname.startsWith('/family/') || pathname.startsWith('/family.')) {
      return familyPage(request, env, pathname.match(/^\/family\/([A-Za-z0-9_-]+)$/)?.[1]);
    }
    // A buyer's order tracking page: /order/<private code>.
    // A family gift's edit page: /order/<private code>/edit.
    const editGift = pathname.match(/^\/order\/([A-Za-z0-9_-]+)\/edit$/);
    if (editGift && (request.method === 'GET' || request.method === 'HEAD')) return editPage(request, env, editGift[1]);
    const tracked = pathname.match(/^\/order\/([A-Za-z0-9_-]+)$/);
    if (tracked && (request.method === 'GET' || request.method === 'HEAD')) return orderPage(request, env, tracked[1]);
    // Item pages: filled in with live stock so sold-out sizes don't flash as available.
    const item = pathname.match(/^\/item\/([a-z0-9-]+)$/);
    if (item && (request.method === 'GET' || request.method === 'HEAD')) return itemPage(request, env, item[1]);
    if (pathname.startsWith('/api/')) return new Response('not found', { status: 404 });
    return env.ASSETS.fetch(request);
  },
  // Hourly (crons in wrangler.toml): email waitlisted people whose size is back in stock.
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(sendRestocks(env));
  },
} satisfies ExportedHandler<Env>;
