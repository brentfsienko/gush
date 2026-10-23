// Live stock. products.ts says how many of each size you've had in total; Cloudflare KV (the STOCK
// binding) keeps a running "sold" count per size, added to by the Stripe webhook after each paid
// order. Available = total - sold. Without the STOCK binding this falls back to products.ts alone.
import { PRODUCTS, SIZES, type Size } from '../src/data/products';
import type { Env } from './index';

const soldKey = (slug: string, size: string) => `sold:${slug}:${size}`;

export async function sold(env: Env, slug: string, size: string) {
  if (!env.STOCK) return 0;
  return Number(await env.STOCK.get(soldKey(slug, size))) || 0;
}

export async function available(env: Env, slug: string, size: Size) {
  const p = PRODUCTS.find((x) => x.slug === slug);
  const total = p?.stock[size];
  if (total === undefined) return undefined;
  return Math.max(0, total - (await sold(env, slug, size)));
}

export async function recordSale(env: Env, slug: string, size: string, qty: number) {
  if (!env.STOCK) return;
  await env.STOCK.put(soldKey(slug, size), String((await sold(env, slug, size)) + qty));
}

/** { slug: { size: available } } for every product, for the item page's sold-out marks. */
export async function stockMap(env: Env) {
  const out: Record<string, Record<string, number>> = {};
  for (const p of PRODUCTS) {
    out[p.slug] = {};
    for (const s of SIZES) {
      const a = await available(env, p.slug, s);
      if (a !== undefined) out[p.slug][s] = a;
    }
  }
  return out;
}
