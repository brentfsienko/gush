# GÜSH

The GÜSH store. Every button and tab is a hand drawing; headings and body text use IBM Plex Mono.
Built with Astro (static site), hosted on Cloudflare Workers, payments through Stripe Checkout.
Cost: $0/month + your domain + Stripe's per-sale fee.

## Run it

Needs Node 22 (`fnm use` picks it up from `.node-version`).

```bash
npm install
```

```bash
npm run dev
```

Opens at http://localhost:4321. It also prints a "Network" address. Open that on your phone (same wifi) to try it on a real phone.
`npm run dev` doesn't run checkout. To test the whole thing including checkout, use `npm run preview` (http://localhost:8788).

## Swapping in your drawings

Every drawing lives in `src/assets/drawn/`. Right now they're placeholders.
**To replace one, save your scan with the exact same name** (e.g. `filter-tees.png`) and delete the placeholder if your file has a different extension (.jpg, .webp and .svg all work too).
The site resizes and compresses everything automatically, so scan big.

Scanning tips: dark pen on white paper, scan or photograph in even light, remove the white background so it's transparent (PNG). Crop close to the drawing.

### The checklist

Things with an `-on` version need two drawings: normal, and selected (circled, filled in, highlighted, your call). **Draw both on the same size canvas** so nothing jumps when they swap.

| What | Files | Notes |
|---|---|---|
| Logo | `logo` ✓ done | center of the header; its two hearts are the browser-tab and home-screen icon (`public/favicon.ico`, `favicon-96.png`, `icon-*.png`, `apple-touch-icon.png`) |
| Digits | `digit-0` … `digit-9` ✓ done | cart count + quantities |
| Tabs | `tab-shop`, `tab-about`, `tab-cart` ✓ done | selected one gets the drawn underline (`-on` files are generated) |
| Shop filters | `filter-all`, `filter-thermals` ✓ done. To add another, list it in `CATEGORIES` in `src/data/products.ts` and draw `filter-<name>` | selected one gets the underline |
| Sizes | `size-s`, `size-m`, `size-l`, `size-xl` ✓ done | selected one gets the underline |
| Buttons | `btn-checkout`, `btn-add-to-cart` (ADD+TO+CART), `btn-back` (← BACK), `btn-keep-shopping` (SHOP →) ✓ done | wide |
| Small buttons | `btn-plus`, `btn-minus`, `btn-remove` (REMOVE) ✓ done | used in the cart |

## Products

Edit `src/data/products.ts`: title, price (in cents: 10000 = $100), category, description, details, stock per size, size chart.
Product photos go in `src/assets/products/<slug>/` named `1.jpg`, `2.jpg`, ... (first one is the main photo).
Home page photos go in `src/assets/home/` (first one is the big top photo). Home page text is in `src/data/home.ts`.

Stock: when a size sells out, set it to `0` and redeploy. (Automatic stock counting can come later.)

Shipping rate and countries: `src/data/store.ts`.

## Payments (Stripe)

Checkout uses Stripe's hosted payment page (cards, Apple Pay, Google Pay). Prices come from
`src/data/products.ts`; shipping and tax settings live in `src/data/store.ts`.

### 1. Test locally
1. Make a free account at stripe.com (it starts in test mode).
2. Developers → API keys → copy the **secret** key (`sk_test_...`).
3. Copy `.dev.vars.example` to `.dev.vars` and paste it in as `STRIPE_SECRET_KEY`.
4. `npm run preview`, add something to the cart, check out with card `4242 4242 4242 4242` (any future date, any CVC).
5. The order shows up in the Stripe dashboard (Payments) with the item, size and shipping address, and Stripe emails the receipt (turn on Settings → Customer emails → Successful payments).

### 2. Stock that counts down after each sale (free)
`stock` in `products.ts` is how many of each size you've had in total. After each paid order Stripe
notifies the site (a "webhook"), which adds to a running "sold" count stored in Cloudflare KV.
Available = total − sold; sold-out sizes turn gray and can't be checked out.
To restock, add the new units to the numbers in `products.ts`.

1. Create the storage: `npx wrangler kv namespace create STOCK`, then paste the id into the
   commented `[[kv_namespaces]]` block at the bottom of `wrangler.toml` and uncomment it.
2. In Stripe: Developers → Webhooks → Add endpoint →
   `https://<your site>/api/stripe-webhook`, events `checkout.session.completed` and
   `checkout.session.async_payment_succeeded`. Copy its signing secret (`whsec_...`).
3. In Cloudflare (Worker → Settings → Variables and Secrets) add `STRIPE_WEBHOOK_SECRET` as a Secret.

### 3. Sales tax (optional, Stripe charges ~0.5% per sale)
1. Stripe dashboard → Settings → Tax: add your business address and the state(s) you're registered in.
2. Set `TAX_ENABLED = true` in `src/data/store.ts` and redeploy. Tax is then added on top of the price
   at checkout, based on the shipping address (the thermal is categorized as clothing).

### 4. Promo codes
Checkout shows Stripe's own "Add promotion code" field. To make a code: Stripe dashboard → Product
catalog → Coupons → create a coupon (e.g. 20% off, or $15 off), then add a customer-facing code to it
(e.g. `FRIENDS20`). You can set an expiry date, a max number of uses, first-order-only, or a minimum
order. Turn a code off in the same place. No site changes needed.

### 5. Go live
Finish Stripe's account activation (business details, bank account), then switch to **live** mode:
put the live secret key (`sk_live_...`) in Cloudflare as `STRIPE_SECRET_KEY`, and add the webhook
endpoint again in live mode (live has its own `whsec_...` secret).

## Going live (Cloudflare Workers)

The site deploys as a Cloudflare Worker named `gush` (the name in `wrangler.toml` must match the Worker's name in the dashboard).
Static pages and images are served for free; only checkout runs code.

1. Cloudflare dashboard → Workers & Pages → Create → Import a repository → `brentfsienko/gush`.
   Build command `npm run build`, deploy command `npx wrangler deploy`.
2. The Worker → Settings → Variables and Secrets → add `STRIPE_SECRET_KEY`, type **Secret**.
3. Add your domain under Settings → Domains & Routes.

Every push to `main` redeploys automatically. (Or deploy straight from your computer with `npm run deploy`.)

## Where things are

```
src/assets/drawn/      your drawings
src/assets/products/   product photos
src/assets/home/       home page photos
src/data/              products, home text, shipping
src/pages/             home, shop, item, cart, success
worker/                checkout (talks to Stripe)
```
