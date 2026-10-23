// The preview image shown when a GÜSH link is shared (texts, Instagram, iMessage...): the logo drawing
// centered on white, at the 1200×630 size link previews use.
import type { APIRoute } from 'astro';
import sharp from 'sharp';
import { readFile } from 'node:fs/promises';

export const GET: APIRoute = async () => {
  const logo = await sharp(await readFile('src/assets/drawn/logo.png'))
    .trim()
    .resize({ width: 900, height: 400, fit: 'inside' })
    .toBuffer();
  const png = await sharp({ create: { width: 1200, height: 630, channels: 4, background: '#ffffff' } })
    .composite([{ input: logo, gravity: 'center' }])
    .flatten({ background: '#ffffff' })
    .png()
    .toBuffer();
  return new Response(new Uint8Array(png), { headers: { 'content-type': 'image/png' } });
};
