// Images for Stripe's checkout page, built at fixed URLs Stripe can load (worker/checkout.ts links to
// them): /stripe/logo.png (the GÜSH logo drawing) and /stripe/<slug>.jpg (each product's main photo).
import type { APIRoute, GetStaticPaths } from 'astro';
import sharp from 'sharp';
import { readdir, readFile } from 'node:fs/promises';
import { PRODUCTS } from '../../data/products';

const PRODUCT_DIR = 'src/assets/products';

export const getStaticPaths = (async () => {
  const paths: { params: { file: string }; props: { path: string } }[] = [
    { params: { file: 'logo.png' }, props: { path: 'src/assets/drawn/logo.png' } },
  ];
  for (const p of PRODUCTS) {
    const files = await readdir(`${PRODUCT_DIR}/${p.slug}`).catch(() => [] as string[]);
    const first = files.find((f: string) => /^1\.(jpe?g|png|webp)$/i.test(f));
    if (first) paths.push({ params: { file: `${p.slug}.jpg` }, props: { path: `${PRODUCT_DIR}/${p.slug}/${first}` } });
  }
  return paths;
}) satisfies GetStaticPaths;

export const GET: APIRoute = async ({ params, props }) => {
  const img = sharp(await readFile(props.path as string));
  if (params.file === 'logo.png') {
    const png = await img.resize({ width: 640 }).png().toBuffer();
    return new Response(new Uint8Array(png), { headers: { 'content-type': 'image/png' } });
  }
  // Square, on white (the product photos are cut out on transparent backgrounds).
  const jpg = await img
    .resize({ width: 800, height: 800, fit: 'contain', background: '#ffffff' })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 88 })
    .toBuffer();
  return new Response(new Uint8Array(jpg), { headers: { 'content-type': 'image/jpeg' } });
};
