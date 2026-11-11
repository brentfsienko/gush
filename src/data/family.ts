// The family Christmas gift list: a page only reachable through a secret link (the link's secret part
// lives in Cloudflare KV as family:key, not in this public code). Each person picks one gift: a style,
// a color, a size (or what kind of bag), and a fit note. It's an interest form: no prices, no Stripe.
// Picks land on the orders page (gush.supply/admin) tagged "family". See worker/family.ts.

/** The code revealed on the page. It only works through the family link (checked by the site). */
export const FAMILY_CODE = 'NORUTS100';

/** Last day to pick (through the end of this day, Seattle time). */
export const FAMILY_DEADLINE = '2026-12-01';
export const FAMILY_DEADLINE_LABEL = 'dec 1';

/** How it gets to them. */
export const FAMILY_DELIVERY = 'we’ll give it to you at christmas';

/** What they can pick. A bag has no size (they describe the bag instead); a mystery is your pick, so
 *  its color is optional ("surprise me"). */
export const FAMILY_STYLES = [
  { key: 'thermal', label: 'thermal' },
  { key: 't-shirt', label: 't-shirt' },
  { key: 'long-sleeve', label: 'long sleeve shirt' },
  { key: 'button-up-short', label: 'button up (short sleeve)' },
  { key: 'button-up-long', label: 'button up (long sleeve)' },
  { key: 'jacket', label: 'jacket' },
  { key: 'pants', label: 'pants' },
  { key: 'skirt', label: 'skirt' },
  { key: 'dress', label: 'dress' },
  { key: 'bag', label: 'bag' },
  { key: 'mystery', label: 'mystery (we pick)' },
] as const;
export type FamilyStyle = (typeof FAMILY_STYLES)[number]['key'];

export const FAMILY_COLORS = [
  { key: 'red', hex: '#c8372d' },
  { key: 'blue', hex: '#2f5d9e' },
  { key: 'yellow', hex: '#e8c547' },
  { key: 'green', hex: '#2f6b45' },
  { key: 'purple', hex: '#6b4a9e' },
  { key: 'pink', hex: '#e9a3b8' },
  { key: 'orange', hex: '#e07b2e' },
  { key: 'black', hex: '#1f1b16' },
  { key: 'white', hex: '#ffffff' },
] as const;

export const FAMILY_SIZES = ['xs', 's', 'm', 'l', 'xl'] as const;

/** Ideas shown for bags (they can write anything). */
export const BAG_IDEAS = ['duffle', 'shopping', 'shoulder', 'tote', 'backpack', 'crossbody'];
