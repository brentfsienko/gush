// @ts-check
import { defineConfig } from 'astro/config';

export default defineConfig({
  // Fully static site; the only server code is the Stripe checkout endpoint in /functions (Cloudflare Pages Functions).
  output: 'static',
});
