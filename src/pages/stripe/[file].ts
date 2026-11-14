// Images for Stripe's checkout page, built at fixed URLs Stripe can load (worker/checkout.ts links to
// them): /stripe/logo.png (the GÜSH logo drawing) and /stripe/<slug>.jpg (each product's main photo).
// The emails use them too, plus /stripe/keep-shopping.png (the sewn KEEP SHOPPING, worker/waitlist.ts)
// and /stripe/hero-<name>.jpg (photos from the home page, near the top of the emails to buyers).
import type { APIRoute, GetStaticPaths } from 'astro';
import sharp from 'sharp';
import { readdir, readFile } from 'node:fs/promises';
import { PRODUCTS } from '../../data/products';

const PRODUCT_DIR = 'src/assets/products';

export const getStaticPaths = (async () => {
  const paths: { params: { file: string }; props: { path: string } }[] = [
    { params: { file: 'logo.png' }, props: { path: 'src/assets/drawn/logo.png' } },
    { params: { file: 'keep-shopping.png' }, props: { path: 'src/assets/drawn/btn-keep-shopping.png' } },
    { params: { file: 'stitch.png' }, props: { path: 'src/assets/header-stitch.png' } },
    { params: { file: 'hero-bag.jpg' }, props: { path: 'src/assets/stack/bag-wide.webp' } },
    { params: { file: 'hero-tag.jpg' }, props: { path: 'src/assets/stack/tag.webp' } },
  ];
  for (const p of PRODUCTS) {
    const files = await readdir(`${PRODUCT_DIR}/${p.slug}`).catch(() => [] as string[]);
    const first = files.find((f: string) => /^1\.(jpe?g|png|webp)$/i.test(f));
    if (first) paths.push({ params: { file: `${p.slug}.jpg` }, props: { path: `${PRODUCT_DIR}/${p.slug}/${first}` } });
  }
  return paths;
}) satisfies GetStaticPaths;

export const GET: APIRoute = async ({ params, props }) => {
  // Trimmed to the drawing/garment so it fills as much of Stripe's small, fixed-size boxes as it can.
  // The stitched line: the header's repeating strip laid end to end, 960 x 14 (shown at 480 x 7).
  if (params.file === 'stitch.png') {
    const strip = await readFile(props.path as string);
    const png = await sharp({ create: { width: 960, height: 14, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: strip, tile: true, top: 0, left: 0 }])
      .png()
      .toBuffer();
    return new Response(new Uint8Array(png), { headers: { 'content-type': 'image/png' } });
  }
  // Home page photos for the emails: 960 x 640 (shown at 480 x 320), cropped to fill.
  if (params.file?.startsWith('hero-')) {
    const jpg = await sharp(await readFile(props.path as string))
      .resize({ width: 960, height: 640, fit: 'cover', position: 'attention' })
      .jpeg({ quality: 84 })
      .toBuffer();
    return new Response(new Uint8Array(jpg), { headers: { 'content-type': 'image/jpeg' } });
  }
  const img = sharp(await readFile(props.path as string)).trim();
  if (params.file?.endsWith('.png')) {
    const png = await img.resize({ width: 640 }).png().toBuffer();
    return new Response(new Uint8Array(png), { headers: { 'content-type': 'image/png' } });
  }
  // Square, on white (the product photos are cut out on transparent backgrounds).
  const jpg = await img
    .resize({ width: 800, height: 800, fit: 'contain', background: '#ffffffff' })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 88 })
    .toBuffer();
  return new Response(new Uint8Array(jpg), { headers: { 'content-type': 'image/jpeg' } });
};
