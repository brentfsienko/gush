// The Worker in front of the site. Static pages and images are served straight from dist/
// (see [assets] in wrangler.toml); only /api/* requests reach this code.
import { checkout } from './checkout';

export interface Env {
  ASSETS: Fetcher;
  STRIPE_SECRET_KEY?: string;
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/api/checkout') {
      if (request.method !== 'POST') return new Response('method not allowed', { status: 405, headers: { allow: 'POST' } });
      return checkout(request, env);
    }
    if (pathname.startsWith('/api/')) return new Response('not found', { status: 404 });
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
