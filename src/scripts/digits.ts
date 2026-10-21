// Writes a number using the hand-drawn digits (digit-0.png ... digit-9.png).
// Their URLs are put on the page by Base.astro; without them it falls back to plain text.

let urls: string[] | null | undefined;

function digitUrls() {
  if (urls === undefined) {
    try {
      urls = JSON.parse(document.getElementById('digit-urls')?.textContent ?? 'null');
    } catch {
      urls = null;
    }
  }
  return urls;
}

export function drawNumber(el: HTMLElement, n: number) {
  const text = String(n);
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
