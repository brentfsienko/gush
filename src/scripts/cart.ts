// The cart lives in the browser (localStorage). Prices are never stored here;
// checkout looks them up on the server.
import { MAX_QTY } from '../data/store';

export type CartLine = { slug: string; size: string; qty: number };

const KEY = 'gush-cart';
let memory: CartLine[] = []; // fallback when storage is blocked (private mode etc.)

const isLine = (l: any): l is CartLine =>
  l && typeof l.slug === 'string' && typeof l.size === 'string' && Number.isInteger(l.qty) && l.qty > 0;

export function readCart(): CartLine[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter(isLine) : [];
  } catch {
    return memory;
  }
}

export function writeCart(lines: CartLine[]) {
  memory = lines;
  try {
    localStorage.setItem(KEY, JSON.stringify(lines));
  } catch {}
  updateBadge();
}

/** Adds one. Returns false if the cart already holds as many as are in stock. */
export function addToCart(slug: string, size: string, stock: number) {
  const lines = readCart();
  const line = lines.find((l) => l.slug === slug && l.size === size);
  if ((line?.qty ?? 0) >= Math.min(stock, MAX_QTY)) return false;
  if (line) line.qty++;
  else lines.push({ slug, size, qty: 1 });
  writeCart(lines);
  return true;
}

export function setQty(slug: string, size: string, qty: number) {
  const lines = readCart()
    .map((l) => (l.slug === slug && l.size === size ? { ...l, qty: Math.min(qty, MAX_QTY) } : l))
    .filter((l) => l.qty > 0);
  writeCart(lines);
}

export const clearCart = () => writeCart([]);

export const cartCount = () => readCart().reduce((n, l) => n + l.qty, 0);

export function updateBadge() {
  const n = cartCount();
  document.querySelectorAll<HTMLElement>('[data-cart-count]').forEach((el) => {
    el.textContent = String(n);
    el.closest('a')?.setAttribute('aria-label', `cart, ${n} ${n === 1 ? 'item' : 'items'}`);
  });
}
