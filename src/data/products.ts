// The GÜSH catalog. This file is read by the site AND by the checkout endpoint,
// so prices here are the prices customers are actually charged.
//
// To add a product:
//   1. Add an entry below (slug = url-friendly name, e.g. "black-tee").
//   2. Put its photos in src/assets/products/<slug>/  (named 1.jpg, 2.jpg, ... shown in that order).

// Filter buttons on the shop page, in order. To add one (e.g. 'thermals'), list it here and
// draw src/assets/drawn/filter-thermals.png (+ filter-thermals-on.png); it shows products with that category.
export const CATEGORIES = ['all', 'thermals'] as const;
export type Category = 'tees' | 'thermals' | 'pants';

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
  /** How many of each size you've had in total. Sales are subtracted automatically once stock
   *  tracking is set up (see README), so to restock, ADD the new units to these numbers.
   *  0 = sold out (shown grayed out). */
  stock: Partial<Record<Size, number>>;
  sizeChart?: { headers: string[]; rows: string[][] };
};

export const PRODUCTS: Product[] = [
  {
    slug: 'blue-thermal',
    title: 'blue thermal',
    price: 15000,
    category: 'thermals',
    description:
      'unisex blue thermal made from 100% cotton waffle knit fabric. designed and hand sewn for a relaxed fit on the body and along the sleeves with a waist cropped trunk. perfect as a daily driver overshirt or as a breathable layer.',
    details: [
      { label: 'material', value: '100% cotton waffle knit' },
      { label: 'fit', value: 'unisex, relaxed, cropped at the waist' },
      { label: 'made in', value: 'Seattle, sewn by hand' },
      { label: 'care', value: 'machine wash cold, hang dry' },
    ],
    // TODO: real counts per size. Checkout refuses sizes at 0.
    stock: { s: 5, m: 5, l: 5, xl: 5 },
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
