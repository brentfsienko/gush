# GÜSH

The GÜSH store. Every button, tab, title and piece of paper is a hand drawing.
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
| Logo | `logo` | shown ~46px tall at the top |
| Tab bar | `tab-home`, `tab-shop`, `tab-cart` + `-on` versions | ~34px tall |
| Shop filters | `filter-all`, `filter-tees`, `filter-thermals`, `filter-pants` + `-on` versions | ~36px tall |
| Sizes | `size-s`, `size-m`, `size-l`, `size-xl` + `-on` versions | roughly square |
| Sold out | `scribble-out` | drawn over sold-out sizes |
| Buttons | `btn-add-to-cart`, `btn-checkout`, `btn-shop-now`, `btn-back`, `btn-keep-shopping` | wide |
| Small buttons | `btn-plus`, `btn-minus`, `btn-remove` | square, used in the cart |
| Headings | `heading-about`, `heading-cart`, `heading-cart-empty`, `heading-details`, `heading-size`, `heading-size-chart`, `heading-thank-you`, `heading-coming-soon`, `heading-nothing-here` | |
| Product titles | `title-<product>` e.g. `title-blue-thermal` | optional, falls back to typewriter text |
| Tall paper | `paper-1`, `paper-2`, ... | shop cards + item page. **Portrait, about 3:5.** Add as many as you want (paper-5, paper-6...) and they join the rotation. |
| Wide scraps | `scrap-1`, `scrap-2`, ... | notes, cart rows. **Landscape, about 2:1.** Same deal, add more anytime. |
| Tape | `tape-1`, `tape-2` | sticks papers down |

Papers get stretched to fit, so keep the middle plain-ish and the torn edges at the border.

## Products

Edit `src/data/products.ts`: title, price (in cents: 10000 = $100), category, description, details, stock per size, size chart.
Product photos go in `src/assets/products/<slug>/` named `1.jpg`, `2.jpg`, ... (first one is the main photo).
Home page photos go in `src/assets/home/` (first one is the big top photo). Home page text is in `src/data/home.ts`.

Stock: when a size sells out, set it to `0` and redeploy. (Automatic stock counting can come later.)

Shipping rate and countries: `src/data/store.ts`.

## Payments (Stripe)

1. Make a free account at stripe.com.
2. Grab your **test** secret key (Developers → API keys, starts with `sk_test_`).
3. Copy `.dev.vars.example` to `.dev.vars` and paste it in. Run `npm run preview` and check out with test card `4242 4242 4242 4242` (any future date, any CVC).
4. Orders show up in the Stripe dashboard (and the Stripe phone app) with the item, size and shipping address.
5. When you're ready to go live, finish Stripe's account activation and use your **live** key (`sk_live_`) in Cloudflare (below).

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
