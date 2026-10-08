// POST /api/checkout  { items: [{ slug, size, qty }] }  ->  { url }
// Creates a Stripe Checkout session and returns the URL to send the shopper to.
// Prices and stock come from src/data/products.ts, never from the browser.
import { PRODUCTS, SIZES, type Size } from '../src/data/products';
import { SHIPPING_CENTS, SHIPPING_LABEL, SHIP_TO_COUNTRIES, MAX_QTY } from '../src/data/store';
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

  const params = new URLSearchParams();
  let i = 0;
  for (const [key, qty] of wanted) {
    const [slug, size] = key.split(':') as [string, Size];
    const p = PRODUCTS.find((x) => x.slug === slug);
    if (!p || !SIZES.includes(size) || p.stock[size] === undefined) {
      return json({ error: 'something in your cart isn’t available anymore. try removing it.' }, 400);
    }
    const left = p.stock[size] ?? 0;
    if (left <= 0) return json({ error: `${p.title} (${size.toUpperCase()}) is sold out.` }, 409);
    if (qty > Math.min(left, MAX_QTY)) return json({ error: `only ${Math.min(left, MAX_QTY)} ${p.title} (${size.toUpperCase()}) available.` }, 409);

    params.set(`line_items[${i}][quantity]`, String(qty));
    params.set(`line_items[${i}][price_data][currency]`, 'usd');
    params.set(`line_items[${i}][price_data][unit_amount]`, String(p.price));
    params.set(`line_items[${i}][price_data][product_data][name]`, `${p.title} (${size.toUpperCase()})`);
    params.set(`line_items[${i}][price_data][product_data][metadata][slug]`, p.slug);
    params.set(`line_items[${i}][price_data][product_data][metadata][size]`, size);
    i++;
  }

  const origin = new URL(request.url).origin;
  params.set('mode', 'payment');
  params.set('success_url', `${origin}/success?session_id={CHECKOUT_SESSION_ID}`);
  params.set('cancel_url', `${origin}/cart`);
  SHIP_TO_COUNTRIES.forEach((c, n) => params.set(`shipping_address_collection[allowed_countries][${n}]`, c));
  params.set('shipping_options[0][shipping_rate_data][type]', 'fixed_amount');
  params.set('shipping_options[0][shipping_rate_data][display_name]', SHIPPING_LABEL);
  params.set('shipping_options[0][shipping_rate_data][fixed_amount][amount]', String(SHIPPING_CENTS));
  params.set('shipping_options[0][shipping_rate_data][fixed_amount][currency]', 'usd');
  // Handy when packing orders: shows up on the payment in the Stripe dashboard.
  params.set('metadata[items]', [...wanted].map(([k, q]) => `${k}x${q}`).join(', ').slice(0, 500));

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
