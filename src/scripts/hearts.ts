// Heart confetti and a big love note, for a promo code made with a message (worker/codes.ts): the
// cart sets it off when that code is entered. Hearts burst up from where the code was typed, then
// a few more drift down from the top: filled ones, ones outlined in a dashed running stitch, and
// curls of red thread, like the family page's confetti. People who've turned off animations just
// get the note, without the motion.
const COLORS = ['#c8372d', '#d9485f', '#e9a3b8', '#f2c4cf', '#b02a2a'];
const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function heartPath(ctx: CanvasRenderingContext2D, s: number) {
  ctx.beginPath();
  ctx.moveTo(0, s * 0.38);
  ctx.bezierCurveTo(-s * 0.62, -s * 0.02, -s * 0.36, -s * 0.62, 0, -s * 0.2);
  ctx.bezierCurveTo(s * 0.36, -s * 0.62, s * 0.62, -s * 0.02, 0, s * 0.38);
  ctx.closePath();
}

type Bit = {
  x: number; y: number; vx: number; vy: number; rot: number; spin: number;
  size: number; color: string; kind: 'heart' | 'sewn' | 'thread'; wobble: number; delay: number;
};

/** Hearts from (x, y), fractions of the screen. */
export function hearts(x = 0.5, y = 0.6) {
  if (still()) return;
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100dvh;pointer-events:none;z-index:60';
  document.body.append(canvas);
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const w = innerWidth;
  const h = innerHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);

  const pick = <T,>(a: readonly T[]) => a[Math.floor(Math.random() * a.length)];
  const kinds = ['heart', 'heart', 'heart', 'sewn', 'thread'] as const;
  const burst: Bit[] = Array.from({ length: 110 }, () => {
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.15;
    const speed = 8 + Math.random() * 10;
    return {
      x: x * w, y: y * h, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
      rot: (Math.random() - 0.5) * 0.8, spin: (Math.random() - 0.5) * 0.12,
      size: 10 + Math.random() * 16, color: pick(COLORS), kind: pick(kinds), wobble: Math.random() * 10, delay: 0,
    };
  });
  // A soft shower from the top, a moment later.
  const shower: Bit[] = Array.from({ length: 50 }, () => ({
    x: Math.random() * w, y: -30 - Math.random() * 120, vx: (Math.random() - 0.5) * 1.5, vy: 1.5 + Math.random() * 2,
    rot: (Math.random() - 0.5) * 0.6, spin: (Math.random() - 0.5) * 0.05,
    size: 9 + Math.random() * 14, color: pick(COLORS), kind: pick(kinds), wobble: Math.random() * 10, delay: 0.5 + Math.random() * 0.9,
  }));
  const bits = [...burst, ...shower];

  const start = performance.now();
  const END = 4.2;
  const frame = (t: number) => {
    const age = (t - start) / 1000;
    ctx.clearRect(0, 0, w, h);
    ctx.globalAlpha = Math.max(0, 1 - Math.max(0, age - (END - 0.9)) / 0.9);
    for (const b of bits) {
      if (age < b.delay) continue;
      // Hearts are light: they float down slowly and sway.
      b.vy += b.delay ? 0.06 : 0.26;
      b.vx *= 0.982;
      b.vy *= 0.982;
      if (b.vy > 3.2) b.vy = 3.2;
      b.x += b.vx + Math.sin(age * 3 + b.wobble) * 0.9;
      b.y += b.vy;
      b.rot += b.spin;
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(b.rot + Math.sin(age * 2.4 + b.wobble) * 0.15);
      ctx.lineCap = 'round';
      if (b.kind === 'heart') {
        heartPath(ctx, b.size);
        ctx.fillStyle = b.color;
        ctx.fill();
      } else if (b.kind === 'sewn') {
        // an outline of a heart in a dashed running stitch
        heartPath(ctx, b.size * 1.1);
        ctx.setLineDash([3, 2.5]);
        ctx.lineWidth = 1.8;
        ctx.strokeStyle = b.color === '#f2c4cf' ? '#c8372d' : b.color;
        ctx.stroke();
      } else {
        // a curl of red thread
        ctx.setLineDash([]);
        ctx.lineWidth = 1.6;
        ctx.strokeStyle = b.color;
        ctx.beginPath();
        ctx.moveTo(-b.size * 0.7, 0);
        ctx.quadraticCurveTo(-b.size * 0.2, -b.size * 0.45, 0, 0);
        ctx.quadraticCurveTo(b.size * 0.2, b.size * 0.45, b.size * 0.7, 0);
        ctx.stroke();
      }
      ctx.restore();
    }
    if (age < END) requestAnimationFrame(frame);
    else canvas.remove();
  };
  requestAnimationFrame(frame);
}

/** The message, big and red in the middle of the screen for a few seconds. */
export function loveNote(text: string) {
  document.querySelector('[data-love-note]')?.remove();
  const note = document.createElement('div');
  note.setAttribute('data-love-note', '');
  note.setAttribute('role', 'status');
  note.textContent = text;
  const calm = still();
  note.style.cssText = [
    'position:fixed', 'left:50%', 'top:42%', 'z-index:61', 'pointer-events:none',
    'transform:translate(-50%,-50%)', 'width:max-content', 'max-width:92vw', 'text-align:center', 'white-space:pre-wrap',
    'font-family:var(--type)', 'font-size:clamp(34px,9vw,84px)', 'line-height:1.1', 'letter-spacing:0.02em',
    'color:var(--red)',
    // a soft halo of the page color, so it reads over whatever's behind it
    'text-shadow:0 0 14px var(--page),0 0 28px var(--page),0 0 4px var(--page)',
  ].join(';');
  document.body.append(note);
  const pop = calm
    ? [{ opacity: 0 }, { opacity: 1, offset: 0.12 }, { opacity: 1, offset: 0.85 }, { opacity: 0 }]
    : [
        { opacity: 0, transform: 'translate(-50%,-50%) scale(0.35) rotate(-6deg)' },
        { opacity: 1, transform: 'translate(-50%,-50%) scale(1.12) rotate(2deg)', offset: 0.1 },
        { opacity: 1, transform: 'translate(-50%,-50%) scale(1) rotate(0deg)', offset: 0.18 },
        { opacity: 1, transform: 'translate(-50%,-52%) scale(1.03) rotate(-1deg)', offset: 0.8 },
        { opacity: 0, transform: 'translate(-50%,-60%) scale(1.05) rotate(0deg)' },
      ];
  note.animate(pop, { duration: 3400, easing: 'ease-out', fill: 'forwards' }).finished.then(() => note.remove(), () => note.remove());
}
