// Item pages are built ahead of time with the stock numbers in products.ts, but sales live in KV,
// so a size that has since sold out would show as available for a moment, then gray out once the
// page asks /api/stock. To avoid that flash, item pages pass through here: the live stock is read
// first, and the page's size buttons, "add to cart" and message are set to match as the HTML streams
// out, so the very first paint is already right. (The page still checks /api/stock too, as a backup.)
import { PRODUCTS, SIZES } from '../src/data/products';
import { available } from './stock';
import type { Env } from './index';

const SOLD_OUT_MSG = 'sold out. pick your size to get an email when it’s back.';

export async function itemPage(request: Request, env: Env, slug: string) {
  const page = await env.ASSETS.fetch(request);
  const p = PRODUCTS.find((x) => x.slug === slug);
  if (!p || !page.ok || !env.STOCK || !page.headers.get('content-type')?.includes('text/html')) return page;

  const live: Record<string, number> = {};
  for (const s of SIZES) {
    const a = await available(env, slug, s);
    if (a !== undefined) live[s] = a;
  }
  const sizes = Object.keys(live);
  const allGone = sizes.length > 0 && sizes.every((s) => live[s] <= 0);

  const out = new HTMLRewriter()
    .on('button[data-size]', {
      element(el) {
        const s = el.getAttribute('data-size')!;
        if (live[s] === undefined) return;
        el.setAttribute('data-stock', String(live[s]));
        if (live[s] <= 0) {
          el.setAttribute('data-sold', '');
          el.setAttribute('aria-label', `${s}, sold out`);
        } else {
          el.removeAttribute('data-sold');
          el.setAttribute('aria-label', s);
        }
      },
    })
    .on('[data-add]', {
      element(el) {
        if (allGone) el.setAttribute('disabled', '');
        else el.removeAttribute('disabled');
      },
    })
    .on('[data-msg]', {
      element(el) {
        el.setInnerContent(allGone ? SOLD_OUT_MSG : '');
      },
    })
    .transform(page);
  // Stock changes, so this page mustn't be cached as-is.
  const res = new Response(out.body, out);
  res.headers.set('cache-control', 'no-store');
  return res;
}
