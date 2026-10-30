// Link-preview image for each product (/og/<slug>.png): its main photo on white with the GÜSH logo
// beside it, at the 1200×630 size link previews use. Item pages point their og:image here.
import type { APIRoute, GetStaticPaths } from 'astro';
import sharp from 'sharp';
import { readdir, readFile } from 'node:fs/promises';
import { PRODUCTS } from '../../data/products';

const PRODUCT_DIR = 'src/assets/products';

export const getStaticPaths = (async () => {
  const paths: { params: { slug: string }; props: { photo: string } }[] = [];
  for (const p of PRODUCTS) {
    const files = await readdir(`${PRODUCT_DIR}/${p.slug}`).catch(() => [] as string[]);
    const first = files.find((f: string) => /^1\.(jpe?g|png|webp)$/i.test(f));
    if (first) paths.push({ params: { slug: p.slug }, props: { photo: `${PRODUCT_DIR}/${p.slug}/${first}` } });
  }
  return paths;
}) satisfies GetStaticPaths;

export const GET: APIRoute = async ({ props }) => {
  const W = 1200;
  const H = 630;
  // The garment fills the left side; the logo sits centered in the space on the right.
  const photo = await sharp(await readFile(props.photo as string))
    .trim()
    .resize({ width: 760, height: 570, fit: 'inside' })
    .toBuffer({ resolveWithObject: true });
  const logo = await sharp(await readFile('src/assets/drawn/logo.png'))
    .trim()
    .resize({ width: 300, height: 220, fit: 'inside' })
    .toBuffer({ resolveWithObject: true });
  const photoLeft = Math.round(430 - photo.info.width / 2);
  const logoLeft = Math.round(985 - logo.info.width / 2);
  const png = await sharp({ create: { width: W, height: H, channels: 4, background: '#ffffff' } })
    .composite([
      { input: photo.data, left: photoLeft, top: Math.round((H - photo.info.height) / 2) },
      { input: logo.data, left: logoLeft, top: Math.round((H - logo.info.height) / 2) },
    ])
    .flatten({ background: '#ffffff' })
    .png()
    .toBuffer();
  return new Response(new Uint8Array(png), { headers: { 'content-type': 'image/png' } });
};
