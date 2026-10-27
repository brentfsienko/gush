// Store-wide settings used by checkout.

// Shipping choices on the checkout page (in cents; 0 = free). The shopper picks one; the first is
// preselected. `where` is how the cart page describes it ("free in Seattle, $8 elsewhere in the US").
// Stripe's page can't check the address against a choice, so the Seattle one says so in its name.
export const SHIPPING_OPTIONS = [
  // A soft mailer with one thermal is about 1 lb: USPS Ground Advantage runs ~$5–10 depending on
  // distance (cheapest through Pirate Ship or Stripe's shipping labels).
  { label: 'USPS Ground Advantage', cents: 800, where: 'elsewhere in the US' },
  { label: 'free Seattle delivery (Seattle addresses only)', cents: 0, where: 'in Seattle' },
];

// Countries you'll ship to (two-letter codes).
export const SHIP_TO_COUNTRIES = ['US'];

// Max of one item/size in a single order.
export const MAX_QTY = 5;

// Sales tax via Stripe Tax. Leave false until Stripe Tax is set up in the Stripe dashboard
// (Settings → Tax: business address + where you're registered); turning it on before that makes
// checkout fail. When on, tax is added on top of the price at checkout, worked out from the
// shipping address.
export const TAX_ENABLED = false;
// Stripe tax categories (https://docs.stripe.com/tax/tax-codes): clothing, and shipping.
export const CLOTHING_TAX_CODE = 'txcd_30011000';
export const SHIPPING_TAX_CODE = 'txcd_92010001';

// How Stripe's checkout page looks (https://docs.stripe.com/payments/checkout/customization/appearance).
// Stripe only offers its own font list; Inconsolata is the closest to IBM Plex Mono.
export const CHECKOUT_LOOK = {
  displayName: 'GÜSH',
  font: 'inconsolata',
  borderStyle: 'rectangular', // or 'rounded' / 'pill'
  background: '#ffffff',
  button: '#1f1b16', // the ink color
};
// An optional "note for us" box on the checkout page (gift message, sizing question...). Notes show on
// the payment in the Stripe dashboard. Label max 50 characters; '' turns the box off.
export const ORDER_NOTE_LABEL = 'note for us (optional)';

// Small notes on the checkout page, in the site's voice. Set one to '' to leave it out.
export const CHECKOUT_TEXT = {
  shipping: 'every GÜSH piece is hand sewn. orders ship within 1–2 weeks.',
  submit: 'returns and exchanges within 14 days of delivery. thank you for supporting handmade ♥',
};
// The live site, for images on the checkout page when testing on your own computer (Stripe can't
// load images from localhost).
export const SITE_URL = 'https://gush.supply';

// Shown under the title when a GÜSH link is shared (and to search engines).
export const TAGLINE = 'Small Batch Clothing Made in Seattle';

// Shipping, returns & contact: the section at the bottom of the about page.
export const CONTACT_EMAIL = 'hi@gush.supply';
export const POLICIES = [
  {
    heading: 'shipping',
    text: 'every piece is sewn by hand, so orders ship within 1–2 weeks. we ship within the US by USPS Ground Advantage ($8), and delivery is free to Seattle addresses. we’ll send tracking once it’s on its way.',
  },
  {
    heading: 'returns',
    text: 'returns and exchanges are welcome within 14 days of delivery, as long as the piece is unworn and unwashed (trying it on is fine). email us to start one. you cover the return shipping, and once it’s back we’ll refund you or send a different size, your choice. if your order arrives damaged or isn’t what you ordered, we’ll make it right and cover the shipping.',
  },
  {
    heading: 'contact',
    text: 'questions about sizing, an order, or anything else:',
  },
];

// The thank-you receipt emailed to buyers (worker/notify.ts). Replies go to CONTACT_EMAIL.
export const RECEIPT = {
  subject: 'your GÜSH order ♥',
  intro: 'we got your order. every piece is sewn by hand, so it ships within 1–2 weeks, and we’ll send tracking once it’s on its way.',
  outro: 'questions about your order? just reply to this email.',
};
