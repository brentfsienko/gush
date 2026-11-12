// Promo codes for one item at a set price, e.g. LOVERS: the blue thermal for $30, usable once.
// Made on the orders page (gush.supply/admin → codes); Stripe does the enforcing. Each code is a
// Stripe promotion code (what buyers type in "Add promotion code" at checkout) on a coupon that only
// applies to that item, with a limit on how many times it can be used.
//
// For Stripe to know which line in a checkout is that item, the item is sold under its own lasting
// Stripe products, one per size (ids like gush-blue-thermal-m, named "blue thermal (M)"), instead of
// a one-off product made fresh for each checkout like everything else. Making a code sets that up;
// worker/checkout.ts then uses those products for the item (fixedProducts below).
import { PRODUCTS, SIZES, formatPrice, type Size } from '../src/data/products';
import { CLOTHING_TAX_CODE, IMAGE_VERSION, SITE_URL } from '../src/data/store';
import type { Env } from './index';

const API = 'https://api.stripe.com/v1';
// Pinned so these calls don't change shape with the Stripe account's default API version.
const VERSION = '2024-06-20';
/** KV: fixed:<slug> → { mode, stamp } once that item's lasting Stripe products exist. */
const FIXED = 'fixed:';

type StripeResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

async function stripe<T>(env: Env, path: string, body?: URLSearchParams, method?: string): Promise<StripeResult<T>> {
  const res = await fetch(API + path, {
    method: method ?? (body ? 'POST' : 'GET'),
    headers: {
      authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'stripe-version': VERSION,
      ...(body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
    },
    body,
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!res.ok) return { ok: false, status: res.status, error: data?.error?.message ?? `Stripe said ${res.status}` };
  return { ok: true, data };
}

/** Live or test Stripe: lasting products exist separately in each. */
const mode = (env: Env) => (/^(sk|rk)_live_/.test(env.STRIPE_SECRET_KEY ?? '') ? 'live' : 'test');

export const productId = (slug: string, size: Size) => `gush-${slug}-${size}`;

const sizesOf = (slug: string) => {
  const p = PRODUCTS.find((x) => x.slug === slug);
  return p ? SIZES.filter((s) => p.stock[s] !== undefined) : [];
};

/** What the lasting products were made from; if it changes (new title or photos), they're updated. */
const stamp = (slug: string) => `${PRODUCTS.find((x) => x.slug === slug)?.title}|${IMAGE_VERSION}`;

/** Make (or bring up to date) the item's lasting Stripe products, one per size. */
export async function ensureProducts(env: Env, slug: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const p = PRODUCTS.find((x) => x.slug === slug);
  if (!p) return { ok: false, error: 'no such item' };
  for (const size of sizesOf(slug)) {
    const id = productId(slug, size);
    const fields = new URLSearchParams();
    fields.set('name', `${p.title} (${size.toUpperCase()})`);
    fields.set('images[0]', `${SITE_URL}/stripe/${slug}.jpg?v=${IMAGE_VERSION}`);
    fields.set('metadata[slug]', slug);
    fields.set('metadata[size]', size);
    fields.set('tax_code', CLOTHING_TAX_CODE);
    const got = await stripe<{ active: boolean }>(env, `/products/${id}`);
    let r: StripeResult<unknown>;
    if (got.ok) {
      if (!got.data.active) fields.set('active', 'true');
      r = await stripe(env, `/products/${id}`, fields);
    } else if (got.status === 404) {
      fields.set('id', id);
      r = await stripe(env, '/products', fields);
    } else r = got;
    if (!r.ok) return { ok: false, error: r.error };
  }
  await env.STOCK?.put(FIXED + slug, JSON.stringify({ mode: mode(env), stamp: stamp(slug) }));
  return { ok: true };
}

/** Checkout asks this per item: sell it under its lasting products? (Only items that have a code.) */
export async function fixedProducts(env: Env, slug: string) {
  const raw = await env.STOCK?.get(FIXED + slug);
  if (!raw) return false;
  try {
    const f = JSON.parse(raw) as { mode?: string; stamp?: string };
    if (f.mode !== mode(env)) return false;
    if (f.stamp !== stamp(slug)) return (await ensureProducts(env, slug)).ok;
    return true;
  } catch {
    return false;
  }
}

/** If Stripe ever loses the lasting products, checkout forgets them and goes back to one-off products. */
export const forgetFixed = (env: Env, slug: string) => env.STOCK?.delete(FIXED + slug);

type Coupon = {
  id: string;
  amount_off: number | null;
  percent_off: number | null;
  applies_to?: { products: string[] } | null;
  metadata?: Record<string, string>;
};
type PromotionCode = { id: string; code: string; active: boolean; times_redeemed: number; max_redemptions: number | null; coupon: Coupon };

export type CodeRow = { id: string; code: string; active: boolean; used: number; max: number | null; what: string };

function describe(c: Coupon) {
  const slug = c.metadata?.gush_slug;
  const p = slug ? PRODUCTS.find((x) => x.slug === slug) : undefined;
  if (p && c.metadata?.gush_price !== undefined) return `${p.title} for ${formatPrice(Number(c.metadata.gush_price))}`;
  const off = c.percent_off ? `${c.percent_off}% off` : c.amount_off ? `${formatPrice(c.amount_off)} off` : 'discount';
  return c.applies_to?.products?.length ? `${off} some items` : `${off} the order`;
}

/** Every promotion code in Stripe, newest first, with how many times each has been used. */
export async function listCodes(env: Env): Promise<{ codes: CodeRow[] } | { error: string }> {
  if (!env.STRIPE_SECRET_KEY) return { error: 'Stripe isn’t set up here.' };
  const r = await stripe<{ data: PromotionCode[] }>(env, '/promotion_codes?limit=50&expand[]=data.coupon.applies_to');
  if (!r.ok) return { error: r.error };
  return {
    codes: r.data.data.map((p) => ({ id: p.id, code: p.code, active: p.active, used: p.times_redeemed, max: p.max_redemptions, what: describe(p.coupon) })),
  };
}

/** Make a code: `code` gets `slug` for `price` cents (instead of its usual price), `uses` times in all. */
export async function makeCode(env: Env, input: { code?: unknown; slug?: unknown; price?: unknown; uses?: unknown }) {
  if (!env.STRIPE_SECRET_KEY) return { error: 'Stripe isn’t set up here.' };
  const code = typeof input.code === 'string' ? input.code.trim().toUpperCase() : '';
  const p = PRODUCTS.find((x) => x.slug === input.slug);
  const price = Number(input.price);
  const uses = Number(input.uses);
  if (!/^[A-Z0-9]{3,24}$/.test(code)) return { error: 'the code should be 3 to 24 letters or numbers.' };
  if (!p) return { error: 'pick an item.' };
  if (!Number.isInteger(price) || price < 0 || price >= p.price) return { error: `the price should be less than ${formatPrice(p.price)}.` };
  if (!Number.isInteger(uses) || uses < 1 || uses > 100) return { error: 'uses should be 1 to 100.' };

  const made = await ensureProducts(env, p.slug);
  if (!made.ok) return { error: made.error };

  const c = new URLSearchParams();
  c.set('name', code);
  c.set('amount_off', String(p.price - price));
  c.set('currency', 'usd');
  c.set('duration', 'once');
  c.set('max_redemptions', String(uses));
  sizesOf(p.slug).forEach((s, i) => c.set(`applies_to[products][${i}]`, productId(p.slug, s)));
  c.set('metadata[gush_slug]', p.slug);
  c.set('metadata[gush_price]', String(price));
  const coupon = await stripe<Coupon>(env, '/coupons', c);
  if (!coupon.ok) return { error: coupon.error };

  const pc = new URLSearchParams();
  pc.set('coupon', coupon.data.id);
  pc.set('code', code);
  pc.set('max_redemptions', String(uses));
  const promo = await stripe<PromotionCode>(env, '/promotion_codes', pc);
  if (!promo.ok) {
    await stripe(env, `/coupons/${coupon.data.id}`, undefined, 'DELETE'); // don't leave a stray coupon behind
    return { error: promo.error };
  }
  return { ok: true as const, code };
}

/** Turn a code off (or back on). Off codes stop working at checkout right away. */
export async function setCodeActive(env: Env, id: unknown, active: boolean) {
  if (typeof id !== 'string' || !/^promo_[A-Za-z0-9]+$/.test(id)) return { error: 'bad request' };
  const f = new URLSearchParams();
  f.set('active', String(active));
  const r = await stripe(env, `/promotion_codes/${id}`, f);
  return r.ok ? { ok: true as const } : { error: r.error };
}
