# Makes src/assets/fabric.webp, the site's off-white slub-cotton background: a seamless tile, made at 3x
# (2400px, shown at 800px) so it stays sharp on high-density screens.
# Usage (needs numpy + Pillow): python3 scripts/fabric.py src/assets/fabric.webp [strength] [seed]
# The site's --page color (src/styles/global.css) should match the average color it prints.
#
# Mostly horizontal weft threads that fade in and out along their length, wander slightly and vary in
# thickness; a faint vertical warp; a few tapered slubs; fine grain. All noise is periodic (built from
# whole-number frequencies), so the tile wraps without seams.
import sys
import numpy as np
from PIL import Image

out_path = sys.argv[1]
STRENGTH = float(sys.argv[2]) if len(sys.argv) > 2 else 1.0
rng = np.random.default_rng(int(sys.argv[3]) if len(sys.argv) > 3 else 11)

N = 2400                               # tile size in pixels (displayed at 800 CSS px, so 3x)
S = N / 1600                           # sizes below were tuned at 1600px; scale them with the tile
BASE = np.array([255, 255, 253])       # white, the faintest warmth
THREAD = np.array([1.0, 1.0, 0.985])   # threads are just a shade of the base color (barely tinted)
DARK, LIGHT = 2.0, 1.1                 # how much darker/lighter a thread can get (keep it subtle)


def periodic_noise_1d(rows, n, max_freq, falloff):
    """Smooth random variation along x for each row; wraps at the tile edge."""
    spec = np.zeros((rows, n // 2 + 1), complex)
    k = np.arange(1, max_freq + 1)
    amp = 1.0 / k**falloff
    spec[:, 1 : max_freq + 1] = amp * (rng.normal(size=(rows, max_freq)) + 1j * rng.normal(size=(rows, max_freq)))
    v = np.fft.irfft(spec, n=n, axis=1)
    return v / (v.std() + 1e-9)


def periodic_noise_2d(n, max_freq, falloff):
    """Smooth 2D random field that wraps in both directions."""
    fy = np.fft.fftfreq(n) * n
    fx = np.fft.rfftfreq(n) * n
    f = np.sqrt(fy[:, None] ** 2 + fx[None, :] ** 2)
    spec = (rng.normal(size=f.shape) + 1j * rng.normal(size=f.shape)) / np.maximum(f, 1) ** falloff
    spec[f > max_freq] = 0
    spec[0, 0] = 0
    v = np.fft.irfft2(spec, s=(n, n))
    return v / (v.std() + 1e-9)


def threads(count, length, along_freq, visible_share, thickness):
    """`count` thread lines across the tile (as rows), each fading in and out along its length.
    Only some threads show at all; the rest stay neutral. Returns (count*thickness, length)."""
    strength = rng.gamma(0.6, 1.0, size=(count, 1))                 # most faint, a few strong
    strength *= rng.random((count, 1)) < visible_share              # many threads don't show
    sign = np.where(rng.random((count, 1)) < 0.7, 1.0, -1.0)        # mostly darker, some lighter
    along = periodic_noise_1d(count, length, along_freq, 1.2)       # fade in/out along the thread
    along = np.clip(along * 0.8 + 0.35, 0, None)                    # long gaps where it vanishes
    lines = sign * strength * along
    # each thread is `thickness` pixels tall with a soft round profile
    prof = np.hanning(thickness + 2)[1:-1]
    return (lines[:, None, :] * prof[None, :, None]).reshape(count * thickness, length)


# Weft: horizontal threads with wandering rows. A dense, fine layer gives the cloth its weave; a
# sparser layer of bolder threads adds the uneven, organic lines.
# Threads are 2-3px at 3x: about 2/3 to 1 CSS pixel, so they read as fine cotton, not stripes.
fine = threads(-(-N // 2), N, 60, 0.95, 2)[:N] * 1.1
bold = threads(-(-N // 3), N, 24, 0.4, 3)[:N] * 0.7
weft = fine + bold
wander = periodic_noise_2d(N, 6, 1.0) * 1.6 * S                    # a pixel or two of drift up/down
ys = (np.arange(N)[:, None] + wander).round().astype(int) % N
weft = weft[ys, np.arange(N)[None, :]]

# Warp: vertical threads, much fainter and broken up (no long lines that read as seams).
warp = threads(-(-N // 2), N, 80, 0.9, 2)[:N].T * 0.35

# Slubs: short, thicker, tapered bits along the weft.
slub = np.zeros((N, N))
for _ in range(70):
    y, x = rng.integers(N), rng.integers(N)
    L, t = int(rng.integers(40, 220) * S), int(rng.integers(2, 5) * S)
    shade = rng.choice([-1.0, 1.0], p=[0.35, 0.65]) * rng.uniform(1.0, 1.8)
    taper = np.hanning(L)[None, :] * np.hanning(t + 2)[1:-1, None]
    slub[np.ix_((y + np.arange(t)) % N, (x + np.arange(L)) % N)] += shade * taper

# Fine grain, and a very soft cloudiness so large areas aren't perfectly even.
grain = rng.normal(size=(N, N)) * 0.5
cloud = periodic_noise_2d(N, 5, 1.5) * 0.25

tex = (weft * 1.3 + warp + slub + grain + cloud) * STRENGTH        # >0 = darker thread
dark = np.clip(tex, 0, None)[..., None] * THREAD * DARK
light = np.clip(-tex, 0, None)[..., None] * LIGHT
rgb = np.clip(BASE - dark + light, 0, 255).astype(np.uint8)
Image.fromarray(rgb).save(out_path, quality=92, method=6)
print(out_path, rgb.shape[1], 'x', rgb.shape[0], 'mean', rgb.reshape(-1, 3).mean(0).round(1))
