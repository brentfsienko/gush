# Makes every "drawing" in src/assets/drawn/ in the style of the GÜSH sewn tag: slab-serif capitals
# (Super Clarendon Bold) traced as a single thin, slightly wobbly line of dark green thread, hollow so the
# fabric shows through, with a soft shadow where the thread sits on the cloth.
# Toggles (tabs, filters, sizes) get an "-on" twin on the same canvas with a stitched underline.
# The logo is a stitched label like the tag, with the umlaut as two little hearts in red thread.
#
# Usage (needs numpy + Pillow): python3 scripts/stitch_drawings.py src/assets/drawn [only-these-names...]
import math
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

OUT = sys.argv[1]
ONLY = set(sys.argv[2:])
FONT = ImageFont.truetype('/System/Library/Fonts/Supplemental/SuperClarendon.ttc', 520, index=5)  # Bold
SS = 2                         # supersampling for smooth edges
CAP = FONT.getbbox('H')[3] - FONT.getbbox('H')[1]  # cap height at the render size, in px
THREAD = np.array([47, 74, 51.0])   # #2f4a33, dark green thread (same as the header stitch)
RED = np.array([196, 32, 42.0])     # red thread for the hearts
rng = np.random.default_rng(5)


# ---------- shapes (white on black "L" masks at SS scale) ----------

def text_mask(text, tracking=0.16):
    """Capitals set one by one with wide spacing, like the tag."""
    f = ImageFont.truetype(FONT.path, FONT.size * SS, index=5)
    track = tracking * f.size
    widths = [f.getlength(c) for c in text]
    w = int(sum(widths) + track * (len(text) - 1) + f.size)
    asc, desc = f.getmetrics()
    m = Image.new('L', (w, asc + desc + f.size // 2), 0)
    d = ImageDraw.Draw(m)
    x = f.size // 2
    for c, cw in zip(text, widths):
        if c != ' ':
            d.text((x, f.size // 4), c, font=f, fill=255)
        x += cw + track
    return m


def arrow_mask(direction, length=1.25, with_text=None):
    """An outlined arrow (shaft + head) about one cap-height tall, optionally followed/preceded by text."""
    h = CAP * SS
    L = int(h * length)
    shaft = h * 0.28
    head_w = h * 0.62
    m = Image.new('L', (L + h, int(h * 1.6)), 0)
    d = ImageDraw.Draw(m)
    cy = m.height / 2
    x0 = h / 2
    pts = [(x0, cy), (x0 + head_w, cy - h * 0.48), (x0 + head_w, cy - shaft / 2), (x0 + L, cy - shaft / 2),
           (x0 + L, cy + shaft / 2), (x0 + head_w, cy + shaft / 2), (x0 + head_w, cy + h * 0.48)]
    d.polygon(pts, fill=255)
    if direction == 'right':
        m = m.transpose(Image.FLIP_LEFT_RIGHT)
    return m


def plus_mask(minus=False):
    h = CAP * SS
    bar = h * 0.3
    m = Image.new('L', (int(h * 1.6), int(h * 1.6)), 0)
    d = ImageDraw.Draw(m)
    c = m.width / 2
    d.rectangle([c - h / 2, c - bar / 2, c + h / 2, c + bar / 2], fill=255)
    if not minus:
        d.rectangle([c - bar / 2, c - h / 2, c + bar / 2, c + h / 2], fill=255)
    return m


def heart_mask(size):
    """A filled heart, `size` px wide (SS scale)."""
    m = Image.new('L', (size * 2, size * 2), 0)
    d = ImageDraw.Draw(m)
    pts = []
    for i in range(200):
        t = math.tau * i / 200
        x = 16 * math.sin(t) ** 3
        y = 13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t)
        pts.append((size + x * size / 34, size - y * size / 34))
    d.polygon(pts, fill=255)
    return m


def join(a, b, gap):
    """Place mask b to the right of mask a (vertically centered), `gap` px apart."""
    h = max(a.height, b.height)
    m = Image.new('L', (a.width + gap + b.width, h), 0)
    m.paste(a, (0, (h - a.height) // 2))
    m.paste(b, (a.width + gap, (h - b.height) // 2), b)
    return m


def crop(m, pad):
    bb = m.getbbox()
    return m.crop((bb[0] - pad, bb[1] - pad, bb[2] + pad, bb[3] + pad))


# ---------- turning a shape into thread ----------

def smooth_noise(w, h, cell):
    """Smooth random field in [-1, 1], features about `cell` px across."""
    g = rng.uniform(-1, 1, (max(2, h // cell + 2), max(2, w // cell + 2))).astype(np.float32)
    return np.asarray(Image.fromarray(g, 'F').resize((w, h), Image.BICUBIC))


def wobble(mask, amount):
    """Nudge the line around a little, like a hand guiding fabric under the needle."""
    a = np.asarray(mask)
    h, w = a.shape
    dx = smooth_noise(w, h, int(CAP * SS * 0.6)) * amount
    dy = smooth_noise(w, h, int(CAP * SS * 0.6)) * amount
    yy, xx = np.mgrid[0:h, 0:w]
    sx = np.clip((xx + dx).round().astype(int), 0, w - 1)
    sy = np.clip((yy + dy).round().astype(int), 0, h - 1)
    return Image.fromarray(a[sy, sx])


def outline(mask, stroke):
    """A line of thread `stroke` px wide running along the edge of the shape."""
    k = max(3, int(stroke) | 1)
    outer = mask.filter(ImageFilter.MaxFilter(k))
    inner = mask.filter(ImageFilter.MinFilter(k))
    return Image.fromarray(np.asarray(outer) - np.minimum(np.asarray(inner), np.asarray(outer)))


def threadify(line, color, shadow=True):
    """Alpha from the (supersampled) line, thread color with a little unevenness, and a soft shadow.
    Returns an RGBA image at final (1x) scale."""
    line = line.filter(ImageFilter.GaussianBlur(SS * 0.6))
    w, h = line.size
    a = np.asarray(line.resize((w // SS, h // SS), Image.LANCZOS)).astype(np.float32) / 255
    h1, w1 = a.shape
    shade = 1 + 0.10 * smooth_noise(w1, h1, 6) + 0.05 * rng.normal(size=(h1, w1))  # uneven thread
    rgb = np.clip(color[None, None, :] * shade[..., None], 0, 255)
    out = np.zeros((h1, w1, 4), np.float32)
    if shadow:
        s = Image.fromarray((a * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(2.2))
        s = np.asarray(s.transform(s.size, Image.AFFINE, (1, 0, -2, 0, 1, -3))).astype(np.float32) / 255 * 0.22
        out[..., 3] = s                                     # black shadow, nudged down-right
    # thread over shadow
    alpha = a + out[..., 3] * (1 - a)
    out[..., :3] = rgb * (a / np.maximum(alpha, 1e-6))[..., None]
    out[..., 3] = alpha * 255
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))


def stitched(mask, stroke_ratio=0.052, color=THREAD):
    stroke = CAP * SS * stroke_ratio
    line = outline(wobble(mask, CAP * SS * 0.012), stroke)
    return threadify(line, color)


def underline_line(width, height, y, stroke):
    """A single wavy line of thread across the canvas (SS scale)."""
    m = Image.new('L', (width, height), 0)
    d = ImageDraw.Draw(m)
    pts = []
    n = 40
    for i in range(n + 1):
        x = width * 0.04 + (width * 0.92) * i / n
        pts.append((x, y + math.sin(i * 0.9 + rng.uniform(0, 0.4)) * stroke * 0.5))
    d.line(pts, fill=255, width=int(stroke), joint='curve')
    return wobble(m, CAP * SS * 0.006)


def save(img, name):
    if ONLY and name not in ONLY:
        return
    img.save(f'{OUT}/{name}.png', optimize=True)
    print(name, img.size)


# ---------- the drawings ----------

def word(name, text, stroke_ratio=0.052, toggle=False, tracking=0.16):
    m = crop(text_mask(text, tracking), int(CAP * SS * 0.12))
    if not toggle:
        save(stitched(m, stroke_ratio), name)
        return
    # Toggle: the word in the top 80%, room for the underline in the bottom 20% (see Drawn.astro).
    H = int(m.height / 0.8)
    canvas = Image.new('L', (m.width, H), 0)
    canvas.paste(m, (0, 0))
    off = stitched(canvas, stroke_ratio)
    stroke = CAP * SS * stroke_ratio * 1.1
    ul = threadify(underline_line(m.width, H, H - CAP * SS * 0.16, stroke), THREAD)
    on = Image.alpha_composite(off, ul)
    save(off, name)
    save(on, name + '-on')


def logo():
    # GÜSH with hearts for the umlaut, inside a stitched label border like the tag.
    m = text_mask('GUSH', 0.22)
    bb = m.getbbox()
    m = m.crop((bb[0], bb[1], bb[2], bb[3]))
    pad_x, pad_top, pad_bot = int(CAP * SS * 0.45), int(CAP * SS * 0.62), int(CAP * SS * 0.32)
    W, H = m.width + 2 * pad_x, m.height + pad_top + pad_bot
    canvas = Image.new('L', (W, H), 0)
    canvas.paste(m, (pad_x, pad_top))
    letters = stitched(canvas)
    # where the U is: second letter
    f = ImageFont.truetype(FONT.path, FONT.size * SS, index=5)
    gw = f.getlength('G') + 0.22 * f.size
    uw = f.getlength('U')
    u_left = pad_x + gw - (bb[0] - f.size // 2)
    hs = int(CAP * SS * 0.26)
    hearts = Image.new('L', (W, H), 0)
    for cx in (u_left + uw * 0.3, u_left + uw * 0.72):
        hm = heart_mask(hs)
        hearts.paste(hm, (int(cx - hm.width / 2), int(pad_top - hs * 1.05)), hm)
    heart_art = threadify(outline(wobble(hearts, CAP * SS * 0.01), CAP * SS * 0.05), RED)
    # label border: a rectangle of thread with a little inset
    border = Image.new('L', (W, H), 0)
    inset = int(CAP * SS * 0.08)
    ImageDraw.Draw(border).rectangle([inset, inset, W - inset, H - inset], outline=255, width=int(CAP * SS * 0.045))
    border_art = threadify(wobble(border, CAP * SS * 0.008), THREAD)
    out = Image.alpha_composite(Image.alpha_composite(letters, heart_art), border_art)
    save(out, 'logo')


if __name__ == '__main__':
    for name, text in [('tab-shop', 'SHOP'), ('tab-about', 'ABOUT'), ('tab-cart', 'CART'),
                       ('filter-all', 'ALL'), ('filter-thermals', 'THERMALS'), ('filter-shirts', 'SHIRTS'),
                       ('size-s', 'S'), ('size-m', 'M'), ('size-l', 'L'), ('size-xl', 'XL')]:
        word(name, text, toggle=True)
    word('btn-add-to-cart', 'ADD TO CART', tracking=0.12)
    word('btn-checkout', 'CHECKOUT', tracking=0.12)
    word('btn-remove', 'REMOVE', 0.075)
    for d in '0123456789':
        word(f'digit-{d}', d, 0.085)
    # Arrows and arrow+word buttons
    pad = int(CAP * SS * 0.12)
    save(stitched(crop(arrow_mask('left'), pad)), 'arrow-left')
    save(stitched(crop(arrow_mask('right'), pad)), 'arrow-right')
    back = join(crop(arrow_mask('left', 1.0), 0), crop(text_mask('BACK'), 0), int(CAP * SS * 0.3))
    save(stitched(crop(back, pad)), 'btn-back')
    shop = join(crop(text_mask('SHOP'), 0), crop(arrow_mask('right', 1.0), 0), int(CAP * SS * 0.3))
    save(stitched(crop(shop, pad)), 'btn-keep-shopping')
    save(stitched(crop(plus_mask(), pad), 0.09), 'btn-plus')
    save(stitched(crop(plus_mask(minus=True), pad), 0.09), 'btn-minus')
    logo()
