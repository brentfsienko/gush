# Makes src/assets/stitch.svg: the running stitch in dark green thread under the header. A strip of
# stitches that each differ a little (length, tilt, height, thickness, gap), so the repeat isn't
# noticeable. Usage: python3 scripts/stitch.py src/assets/stitch.svg [seed]
import random, sys

random.seed(int(sys.argv[2]) if len(sys.argv) > 2 else 3)
H = 6.0                  # strip height (CSS px); stitches sit around the middle
COUNT = 16

stitches, x = [], 3.0
for _ in range(COUNT):
    length = random.uniform(13.4, 14.8)
    gap = random.uniform(9.3, 10.7)
    stitches.append(dict(
        x=x, length=length,
        y=H / 2 + random.uniform(-0.15, 0.15),
        tilt=random.uniform(-0.7, 0.7),                 # degrees
        thick=random.uniform(1.42, 1.62),
        twist=random.uniform(0.1, 0.15),               # how visible the twist highlights are
        shade=random.uniform(-0.03, 0.03),              # a touch lighter/darker thread
    ))
    x += length + gap
W = float(int(x) + 1)    # whole pixels, so the repeat has no seam; the last gap leads into the first stitch


def tint(hex_color, amount):
    r, g, b = (int(hex_color[i : i + 2], 16) for i in (1, 3, 5))
    f = (lambda c: c + (255 - c) * amount) if amount > 0 else (lambda c: c * (1 + amount))
    return '#%02x%02x%02x' % tuple(round(f(c)) for c in (r, g, b))


parts = []
for i, s in enumerate(stitches):
    top, mid, bot = tint('#557558', s['shade']), tint('#2f4a33', s['shade']), tint('#1d3021', s['shade'])
    parts.append(
        f"<linearGradient id='g{i}' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='{top}'/>"
        f"<stop offset='.5' stop-color='{mid}'/><stop offset='1' stop-color='{bot}'/></linearGradient>"
    )
defs = ''.join(parts)

shapes = []
for i, s in enumerate(stitches):
    L, t, y0 = s['length'], s['thick'], s['y']
    r = t / 2
    cx = s['x'] + L / 2
    body = (f"M{r:.2f} {-r:.2f}L{L - r:.2f} {-r:.2f}A{r:.2f} {r:.2f} 0 0 1 {L - r:.2f} {r:.2f}"
            f"L{r:.2f} {r:.2f}A{r:.2f} {r:.2f} 0 0 1 {r:.2f} {-r:.2f}Z")
    # faint diagonal highlights across the thread, like its twist
    twists = ''.join(f"M{tx:.2f} {-r * 0.85:.2f}l{t * 0.4:.2f} {t * 0.85:.2f}" for tx in [L * k / 5 for k in range(1, 5)])
    shapes.append(
        f"<g transform='translate({s['x']:.2f} {y0:.2f}) rotate({s['tilt']:.2f} {L / 2:.2f} 0)'>"
        # soft shadow where the thread sits on the fabric
        f"<path d='{body}' transform='translate(.45 .55)' fill='#000' fill-opacity='.13'/>"
        f"<path d='{body}' fill='url(#g{i})'/>"
        f"<path d='{twists}' stroke='#fff' stroke-opacity='{s['twist']:.2f}' stroke-width='.28' fill='none'/>"
        "</g>"
    )

svg = (f"<svg xmlns='http://www.w3.org/2000/svg' width='{W}' height='{H:g}' viewBox='0 0 {W} {H:g}'>"
       f"<defs>{defs}</defs>{''.join(shapes)}</svg>\n")
open(sys.argv[1], 'w').write(svg)
print(sys.argv[1], 'width', W)
