# Makes public/fabric.webp, the site's off-white slub-cotton background (seamless tile).
# Usage: python3 scripts/fabric.py public/fabric.webp 0.5   (last number = how strong the threads are)
# Seamless off-white slub-cotton texture: warp + weft thread streaks, slubs (thick, uneven bits of
# thread), and fine grain. Everything wraps at the edges so the tile repeats without seams.
import random, sys
from PIL import Image, ImageDraw, ImageFilter, ImageChops
random.seed(7)
N = 480                      # tile size (px)
BASE = (247, 245, 239)       # off-white, barely warm
WARP = 0.3                   # vertical threads, relative to the horizontal ones (1 = equal)

def streaks(vertical):
    # one random brightness per thread line, stretched across the tile
    line = Image.new('L', (N, 1) if vertical else (1, N))
    line.putdata([max(0, min(255, int(random.gauss(128, 26)))) for _ in range(N)])
    img = line.resize((N, N), Image.NEAREST)
    return img

def wrap_blur(img, r):
    big = Image.new(img.mode, (N * 3, N * 3))
    for i in range(3):
        for j in range(3):
            big.paste(img, (i * N, j * N))
    return big.filter(ImageFilter.GaussianBlur(r)).crop((N, N, 2 * N, 2 * N))

warp = wrap_blur(streaks(True), 0.6)
weft = wrap_blur(streaks(False), 0.6)
# mostly horizontal weft lines; the vertical warp is toned down toward neutral (128 = no change)
warp = Image.blend(Image.new('L', (N, N), 128), warp, WARP)
weave = ImageChops.add(warp, weft, scale=2.0)

# slubs: short, slightly thicker lighter/darker segments along the weft (and a few along the warp)
slub = Image.new('L', (N, N), 128)
d = ImageDraw.Draw(slub)
for _ in range(90):
    horiz = random.random() < 0.92
    x, y = random.randrange(N), random.randrange(N)
    length = random.randint(18, 90)
    shade = random.choice([random.randint(150, 175), random.randint(92, 112)])
    w = random.choice([1, 1, 2])
    for ox in (-N, 0, N):
        for oy in (-N, 0, N):
            if horiz:
                d.line([(x + ox, y + oy), (x + length + ox, y + oy)], fill=shade, width=w)
            else:
                d.line([(x + ox, y + oy), (x + ox, y + length + oy)], fill=shade, width=w)
slub = wrap_blur(slub, 0.8)

grain = wrap_blur(Image.effect_noise((N, N), 22).point(lambda v: v), 0.4)

# combine the gray layers (128 = no change), then tint onto the base color
mix = Image.blend(Image.blend(weave, slub, 0.45), grain, 0.25)
strength = float(sys.argv[2]) if len(sys.argv) > 2 else 0.18
def tone(v):  # how far from neutral -> lighten/darken the base
    return (v - 128) * strength
out = Image.new('RGB', (N, N))
px = out.load(); mp = mix.load()
for yy in range(N):
    for xx in range(N):
        t = tone(mp[xx, yy])
        px[xx, yy] = tuple(max(0, min(255, int(c + t * (1.0 if i < 2 else 1.15)))) for i, c in enumerate(BASE))
out.save(sys.argv[1], quality=90, method=6)
print(sys.argv[1], out.size)
