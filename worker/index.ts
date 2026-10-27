// The Worker in front of the site. Static pages and images are served straight from dist/
// (see [assets] in wrangler.toml); only /api/* requests reach this code.
import { checkout } from './checkout';
import { stripeWebhook } from './webhook';
import { stockMap } from './stock';

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
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
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
    if (pathname.startsWith('/api/')) return new Response('not found', { status: 404 });
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
