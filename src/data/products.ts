// The GÜSH catalog. This file is read by the site AND by the checkout endpoint,
// so prices here are the prices customers are actually charged.
//
// To add a product:
//   1. Add an entry below (slug = url-friendly name, e.g. "black-tee").
//   2. Put its photos in src/assets/products/<slug>/  (named 1.jpg, 2.jpg, ... shown in that order).
//   3. Optional: draw its title and save it as src/assets/drawn/title-<slug>.png
//      (until then the title shows in the typewriter font).

export const CATEGORIES = ['all', 'tees', 'thermals', 'pants'] as const;
export type Category = Exclude<(typeof CATEGORIES)[number], 'all'>;

export const SIZES = ['s', 'm', 'l', 'xl'] as const;
export type Size = (typeof SIZES)[number];

export type Product = {
  slug: string;
  title: string;
  /** Price in cents: 10000 = $100.00 */
  price: number;
  category: Category;
  description: string;
  details: { label: string; value: string }[];
  /** How many of each size you have. 0 = sold out (shown scribbled out). */
  stock: Partial<Record<Size, number>>;
  sizeChart?: { headers: string[]; rows: string[][] };
};

export const PRODUCTS: Product[] = [
  {
    slug: 'blue-thermal',
    title: 'blue thermal',
    price: 10000,
    category: 'thermals',
    // TODO: write the real description
    description: 'a blue thermal. write a couple lines here about the fit, the feel, why you made it.',
    // TODO: fill in real details
    details: [
      { label: 'material', value: 'TBD' },
      { label: 'fit', value: 'TBD' },
      { label: 'made in', value: 'TBD' },
      { label: 'care', value: 'TBD' },
    ],
    // TODO: real counts per size. Checkout refuses sizes at 0.
    stock: { s: 1, m: 1, l: 1, xl: 1 },
    // TODO: real measurements
    sizeChart: {
      headers: ['size', 'chest', 'length', 'sleeve'],
      rows: [
        ['S', '-', '-', '-'],
        ['M', '-', '-', '-'],
        ['L', '-', '-', '-'],
        ['XL', '-', '-', '-'],
      ],
    },
  },
];

export const getProduct = (slug: string) => PRODUCTS.find((p) => p.slug === slug);

export const formatPrice = (cents: number) =>
  `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
