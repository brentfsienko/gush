// @ts-check
import { defineConfig } from 'astro/config';

export default defineConfig({
  // Fully static site; the only server code is the Stripe checkout in /worker.
  output: 'static',
  // Build /shop as shop.html (not shop/index.html) so Cloudflare serves /shop without a redirect.
  build: { format: 'file' },
  trailingSlash: 'never',
});
