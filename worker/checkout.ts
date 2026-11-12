// POST /api/checkout  { items: [{ slug, size, qty }] }  ->  { url }
// Creates a Stripe Checkout session and returns the URL to send the shopper to.
// Prices come from src/data/products.ts and stock from worker/stock.ts, never from the browser.
import { PRODUCTS, SIZES, type Size } from '../src/data/products';
import {
  SHIPPING_OPTIONS,
  SHIP_TO_COUNTRIES,
  MAX_QTY,
  TAX_ENABLED,
  CLOTHING_TAX_CODE,
  SHIPPING_TAX_CODE,
  CHECKOUT_LOOK,
  CHECKOUT_TEXT,
  ORDER_NOTE_LABEL,
  SITE_URL,
  IMAGE_VERSION,
} from '../src/data/store';
import { available } from './stock';
import { fixedProducts, forgetFixed, productId, checkCode } from './codes';
import type { Env } from './index';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export async function checkout(request: Request, env: Env) {
  if (!env.STRIPE_SECRET_KEY) return json({ error: 'checkout isn’t set up yet.' }, 503);

  let items: unknown;
  let code: unknown;
  try {
    ({ items, code } = (await request.json()) as { items?: unknown; code?: unknown });
  } catch {
    return json({ error: 'bad request' }, 400);
  }
  if (!Array.isArray(items) || items.length === 0 || items.length > 20) return json({ error: 'your cart is empty.' }, 400);

  // Combine duplicate lines, then check each against the catalog and stock.
  const wanted = new Map<string, number>();
  for (const raw of items as { slug?: unknown; size?: unknown; qty?: unknown }[]) {
    const qty = Number(raw?.qty);
    if (typeof raw?.slug !== 'string' || typeof raw?.size !== 'string' || !Number.isInteger(qty) || qty < 1) {
      return json({ error: 'something in your cart looks off. try removing it and adding it again.' }, 400);
    }
    const key = `${raw.slug}:${raw.size}`;
    wanted.set(key, (wanted.get(key) ?? 0) + qty);
  }

  const origin = new URL(request.url).origin;
  // Where Stripe loads the logo and product photos from (see src/pages/stripe/[file].ts).
  const images = /^https?:\/\/(localhost|127\.0\.0\.1)(:|$)/.test(origin) ? SITE_URL : origin;

  // Check everything first, then build the Stripe request (twice at most: see the retry below).
  const lines: { slug: string; size: Size; qty: number; p: (typeof PRODUCTS)[number] }[] = [];
  for (const [key, qty] of wanted) {
    const [slug, size] = key.split(':') as [string, Size];
    const p = PRODUCTS.find((x) => x.slug === slug);
    if (!p || !SIZES.includes(size) || p.stock[size] === undefined) {
      return json({ error: 'something in your cart isn’t available anymore. try removing it.' }, 400);
    }
    const left = (await available(env, slug, size)) ?? 0;
    if (left <= 0) return json({ error: `${p.title} (${size.toUpperCase()}) is sold out.` }, 409);
    if (qty > Math.min(left, MAX_QTY)) return json({ error: `only ${Math.min(left, MAX_QTY)} ${p.title} (${size.toUpperCase()}) available.` }, 409);
    lines.push({ slug, size, qty, p });
  }

  // Items with an item-only promo code (worker/codes.ts) are sold under their lasting Stripe
  // products, so Stripe can tell which line the code applies to. Everything else gets a one-off
  // product made for this checkout.
  const fixed = new Set<string>();
  for (const slug of new Set(lines.map((l) => l.slug))) if (await fixedProducts(env, slug)) fixed.add(slug);

  // A code typed in the cart's code box: checked again here, then already applied at Stripe.
  let promoId: string | undefined;
  if (typeof code === 'string' && code.trim()) {
    const c = await checkCode(env, code, lines);
    if ('error' in c) return json({ error: c.error, code: 'bad' }, 400);
    promoId = c.promoId;
  }

  let res = await createSession(buildParams(lines, fixed, origin, images, wanted, promoId), env);
  if (!res.ok && fixed.size && /no such product/i.test(res.message)) {
    // The lasting products are gone from Stripe: forget them and check out the usual way.
    for (const slug of fixed) await forgetFixed(env, slug);
    res = await createSession(buildParams(lines, new Set(), origin, images, wanted, promoId), env);
  }
  if (!res.ok) {
    console.error('stripe error', res.status, res.message);
    return json({ error: 'couldn’t start checkout. try again in a bit.' }, 502);
  }
  return json({ url: res.url });
}

async function createSession(params: URLSearchParams, env: Env) {
  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: params,
  });
  const data = (await res.json().catch(() => ({}))) as { url?: string; error?: { message?: string } };
  return res.ok && data.url ? { ok: true as const, url: data.url } : { ok: false as const, status: res.status, message: data.error?.message ?? '' };
}

function buildParams(
  lines: { slug: string; size: Size; qty: number; p: (typeof PRODUCTS)[number] }[],
  fixed: Set<string>,
  origin: string,
  images: string,
  wanted: Map<string, number>,
  promoId?: string,
) {
  const params = new URLSearchParams();
  lines.forEach(({ slug, size, qty, p }, i) => {
    params.set(`line_items[${i}][quantity]`, String(qty));
    params.set(`line_items[${i}][price_data][currency]`, 'usd');
    params.set(`line_items[${i}][price_data][unit_amount]`, String(p.price));
    if (fixed.has(slug)) {
      params.set(`line_items[${i}][price_data][product]`, productId(slug, size));
    } else {
      params.set(`line_items[${i}][price_data][product_data][name]`, `${p.title} (${size.toUpperCase()})`);
      params.set(`line_items[${i}][price_data][product_data][metadata][slug]`, p.slug);
      params.set(`line_items[${i}][price_data][product_data][metadata][size]`, size);
      params.set(`line_items[${i}][price_data][product_data][images][0]`, `${images}/stripe/${p.slug}.jpg?v=${IMAGE_VERSION}`);
      if (TAX_ENABLED) params.set(`line_items[${i}][price_data][product_data][tax_code]`, CLOTHING_TAX_CODE);
    }
    if (TAX_ENABLED) params.set(`line_items[${i}][price_data][tax_behavior]`, 'exclusive');
  });

  params.set('mode', 'payment');
  // A code from the cart's code box comes already applied; otherwise Stripe shows its own "Add
  // promotion code" field. Codes are made in the Stripe dashboard (Product catalog → Coupons) or on
  // the orders page (worker/codes.ts), so no code changes are needed to add or retire one.
  if (promoId) params.set('discounts[0][promotion_code]', promoId);
  else params.set('allow_promotion_codes', 'true');
  params.set('success_url', `${origin}/success?session_id={CHECKOUT_SESSION_ID}`);
  params.set('cancel_url', `${origin}/cart`);
  SHIP_TO_COUNTRIES.forEach((c, n) => params.set(`shipping_address_collection[allowed_countries][${n}]`, c));
  SHIPPING_OPTIONS.forEach((o, n) => {
    const rate = `shipping_options[${n}][shipping_rate_data]`;
    params.set(`${rate}[type]`, 'fixed_amount');
    params.set(`${rate}[display_name]`, o.label);
    params.set(`${rate}[fixed_amount][amount]`, String(o.cents));
    params.set(`${rate}[fixed_amount][currency]`, 'usd');
    if (TAX_ENABLED) {
      params.set(`${rate}[tax_code]`, SHIPPING_TAX_CODE);
      params.set(`${rate}[tax_behavior]`, 'exclusive');
    }
  });
  if (TAX_ENABLED) {
    // Tax is added on top of the prices, from the shipping address.
    params.set('automatic_tax[enabled]', 'true');
  }
  // Make Stripe's page look like GÜSH (settings in src/data/store.ts).
  params.set('branding_settings[display_name]', CHECKOUT_LOOK.displayName);
  params.set('branding_settings[font_family]', CHECKOUT_LOOK.font);
  params.set('branding_settings[border_style]', CHECKOUT_LOOK.borderStyle);
  params.set('branding_settings[background_color]', CHECKOUT_LOOK.background);
  params.set('branding_settings[button_color]', CHECKOUT_LOOK.button);
  params.set('branding_settings[logo][type]', 'url');
  params.set('branding_settings[logo][url]', `${images}/stripe/logo.png?v=${IMAGE_VERSION}`);
  params.set('branding_settings[icon][type]', 'url');
  params.set('branding_settings[icon][url]', `${images}/icon-512.png`);
  if (CHECKOUT_TEXT.shipping) params.set('custom_text[shipping_address][message]', CHECKOUT_TEXT.shipping);
  if (CHECKOUT_TEXT.submit) params.set('custom_text[submit][message]', CHECKOUT_TEXT.submit);
  if (ORDER_NOTE_LABEL) {
    params.set('custom_fields[0][key]', 'note');
    params.set('custom_fields[0][label][type]', 'custom');
    params.set('custom_fields[0][label][custom]', ORDER_NOTE_LABEL);
    params.set('custom_fields[0][type]', 'text');
    params.set('custom_fields[0][optional]', 'true');
    params.set('custom_fields[0][text][maximum_length]', '255');
  }
  // Checkout links expire after 30 minutes (Stripe's minimum), so a stale tab can't pay for
  // stock that has since sold out.
  params.set('expires_at', String(Math.floor(Date.now() / 1000) + 30 * 60));
  // What was bought, read back by the webhook to count stock down (and handy when packing
  // orders: it shows on the payment in the Stripe dashboard). Format: "slug:size:qty,...".
  params.set('metadata[items]', [...wanted].map(([k, q]) => `${k}:${q}`).join(','));

  return params;
}
