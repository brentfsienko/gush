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
} from '../src/data/store';
import { available } from './stock';
import type { Env } from './index';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export async function checkout(request: Request, env: Env) {
  if (!env.STRIPE_SECRET_KEY) return json({ error: 'checkout isn’t set up yet.' }, 503);

  let items: unknown;
  try {
    items = ((await request.json()) as { items?: unknown }).items;
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

  const params = new URLSearchParams();
  let i = 0;
  for (const [key, qty] of wanted) {
    const [slug, size] = key.split(':') as [string, Size];
    const p = PRODUCTS.find((x) => x.slug === slug);
    if (!p || !SIZES.includes(size) || p.stock[size] === undefined) {
      return json({ error: 'something in your cart isn’t available anymore. try removing it.' }, 400);
    }
    const left = (await available(env, slug, size)) ?? 0;
    if (left <= 0) return json({ error: `${p.title} (${size.toUpperCase()}) is sold out.` }, 409);
    if (qty > Math.min(left, MAX_QTY)) return json({ error: `only ${Math.min(left, MAX_QTY)} ${p.title} (${size.toUpperCase()}) available.` }, 409);

    params.set(`line_items[${i}][quantity]`, String(qty));
    params.set(`line_items[${i}][price_data][currency]`, 'usd');
    params.set(`line_items[${i}][price_data][unit_amount]`, String(p.price));
    params.set(`line_items[${i}][price_data][product_data][name]`, `${p.title} (${size.toUpperCase()})`);
    params.set(`line_items[${i}][price_data][product_data][metadata][slug]`, p.slug);
    params.set(`line_items[${i}][price_data][product_data][metadata][size]`, size);
    params.set(`line_items[${i}][price_data][product_data][images][0]`, `${images}/stripe/${p.slug}.jpg`);
    if (TAX_ENABLED) {
      params.set(`line_items[${i}][price_data][product_data][tax_code]`, CLOTHING_TAX_CODE);
      params.set(`line_items[${i}][price_data][tax_behavior]`, 'exclusive');
    }
    i++;
  }

  params.set('mode', 'payment');
  // Shows Stripe's "Add promotion code" field. Codes are created in the Stripe dashboard
  // (Product catalog → Coupons), so no code changes are needed to add or retire one.
  params.set('allow_promotion_codes', 'true');
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
  params.set('branding_settings[logo][url]', `${images}/stripe/logo.png`);
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

  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: params,
  });
  const data = (await res.json()) as { url?: string; error?: { message?: string } };
  if (!res.ok || !data.url) {
    console.error('stripe error', res.status, data.error?.message);
    return json({ error: 'couldn’t start checkout. try again in a bit.' }, 502);
  }
  return json({ url: data.url });
}
