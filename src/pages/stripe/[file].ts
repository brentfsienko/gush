// Images for Stripe's checkout page, built at fixed URLs Stripe can load (worker/checkout.ts links to
// them): /stripe/logo.png (the GÜSH logo drawing) and /stripe/<slug>.jpg (each product's main photo).
// The emails use them too, plus /stripe/keep-shopping.png (the sewn KEEP SHOPPING in a sewn box, made
// from the same stitching as the boxes on the site; worker/waitlist.ts). Email apps can't layer
// backgrounds the way the site does, so the box is sewn into the picture.
import type { APIRoute, GetStaticPaths } from 'astro';
import sharp from 'sharp';
import { readdir, readFile } from 'node:fs/promises';
import { PRODUCTS } from '../../data/products';

const PRODUCT_DIR = 'src/assets/products';

export const getStaticPaths = (async () => {
  const paths: { params: { file: string }; props: { path: string } }[] = [
    { params: { file: 'logo.png' }, props: { path: 'src/assets/drawn/logo.png' } },
    { params: { file: 'keep-shopping.png' }, props: { path: 'src/assets/drawn/btn-keep-shopping.png' } },
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
  const img = sharp(await readFile(props.path as string)).trim();
  if (params.file === 'keep-shopping.png') {
    const png = await sewnBox(await img.resize({ width: 600 }).png().toBuffer());
    return new Response(new Uint8Array(png), { headers: { 'content-type': 'image/png' } });
  }
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

/** A drawing inside a sewn box. The picture is shown at about a third of its size in emails, so the
 *  thread strips (7 CSS px on the site) are scaled to 21 px here. */
async function sewnBox(word: Buffer) {
  const T = 21; // thread strip thickness
  const PAD_X = 54, PAD_Y = 40;
  const meta = await sharp(word).metadata();
  const W = meta.width! + 2 * PAD_X, H = meta.height! + 2 * PAD_Y;
  const strip = async (file: string, horizontal: boolean) =>
    sharp(await readFile(`src/assets/${file}`)).resize(horizontal ? { height: T } : { width: T }).png().toBuffer();
  const band = async (file: string, w: number, h: number) => {
    const piece = await strip(file, w > h);
    const m = await sharp(piece).metadata();
    // A strip longer than the band is just cut to length; a shorter one repeats.
    const fit = await sharp(piece).extract({ left: 0, top: 0, width: Math.min(m.width!, w), height: Math.min(m.height!, h) }).toBuffer();
    return sharp({ create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: fit, tile: true, top: 0, left: 0 }])
      .png()
      .toBuffer();
  };
  // Top and bottom run between the sides' threads, so the corners meet without crossing.
  const half = Math.round(T / 2);
  return sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([
      { input: await band('header-stitch.png', W - T, T), top: 0, left: half },
      { input: await band('stitch-bottom.png', W - T, T), top: H - T, left: half },
      { input: await band('stitch-side.png', T, H - T), top: half, left: 0 },
      { input: await band('stitch-side.png', T, H - T), top: half, left: W - T },
      { input: word, top: PAD_Y, left: PAD_X },
    ])
    .png()
    .toBuffer();
}
