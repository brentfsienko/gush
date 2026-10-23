// Store-wide settings used by checkout.

// TODO: set your real flat shipping rate (in cents). 0 = free shipping.
export const SHIPPING_CENTS = 800;
export const SHIPPING_LABEL = 'standard shipping';

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
// Small notes on the checkout page, in the site's voice. Set one to '' to leave it out.
export const CHECKOUT_TEXT = {
  shipping: 'every GÜSH piece is hand sewn. we pack and ship it ourselves.',
  submit: 'thank you for supporting handmade ♥',
};
// The live site, for images on the checkout page when testing on your own computer (Stripe can't
// load images from localhost).
export const SITE_URL = 'https://gush.brentfsienko.workers.dev';
