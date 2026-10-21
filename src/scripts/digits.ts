// Writes a number using the hand-drawn digits (digit-0.png ... digit-9.png).
// Their URLs are put on window by the header script in Base.astro; without them it falls back to plain text.

declare global {
  interface Window {
    GUSH_DIGITS?: string[] | null;
  }
}

const digitUrls = () => window.GUSH_DIGITS ?? null;

export function drawNumber(el: HTMLElement, n: number) {
  const text = String(n);
  // Already showing this number: leave the images alone so they don't blink.
  if (el.dataset.n === text) return;
  el.dataset.n = text;
  const u = digitUrls();
  if (!u) {
    el.textContent = text;
    return;
  }
  el.replaceChildren(
    ...[...text].map((d) => {
      const img = new Image();
      img.src = u[Number(d)];
      img.alt = '';
      img.draggable = false;
      return img;
    }),
  );
  el.classList.add('digits');
  el.setAttribute('aria-label', text);
}
