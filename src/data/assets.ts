// Finds images by name, whatever the file extension (.png, .jpg, .webp, .svg).
// Swap a drawing by dropping a new file with the same name into src/assets/drawn/
// (delete the old placeholder if the extension differs).
import type { ImageMetadata } from 'astro';

type Mod = { default: ImageMetadata };
const baseName = (p: string) => p.split('/').pop()!.replace(/\.[^.]+$/, '');

const drawnFiles = import.meta.glob<Mod>('../assets/drawn/*.{png,jpg,jpeg,webp,svg}', { eager: true });
const drawnByName = new Map(Object.entries(drawnFiles).map(([p, m]) => [baseName(p), m.default]));

export const drawn = (name: string) => drawnByName.get(name);

const byNumber = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

const productFiles = import.meta.glob<Mod>('../assets/products/*/*.{png,jpg,jpeg,webp}', { eager: true });

/** Photos in src/assets/products/<slug>/, in filename order. */
export const productPhotos = (slug: string) =>
  Object.keys(productFiles)
    .filter((p) => p.split('/').at(-2) === slug)
    .sort(byNumber)
    .map((p) => productFiles[p].default);

const homeFiles = import.meta.glob<Mod>('../assets/home/*.{png,jpg,jpeg,webp}', { eager: true });

/** Photos in src/assets/home/, in filename order. */
export const homePhotos = () => Object.keys(homeFiles).sort(byNumber).map((p) => homeFiles[p].default);
