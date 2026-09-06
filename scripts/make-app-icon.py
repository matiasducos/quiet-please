"""
Render the 1024x1024 app icon Meta requires for Facebook Login (todo.md item 4).

The largest existing asset is public/pwa-512.png; upscaling a raster logo softens
exactly the edges a reviewer looks at, so this redraws it at 1024 instead.

Two things had to be recovered rather than assumed:

  * The face is GEORGIA, not the site's display font. favicon.svg's stack reads
    "Georgia, 'DM Serif Display', serif" — Georgia first — and DM Serif Display's
    Q carries a long swash tail the 512 asset plainly does not have.
  * The geometry is favicon.svg's own, scaled x32: font-size 20 -> 640,
    letter-spacing -1 -> -32, baseline y 23 -> 736. Solving for the best overlap
    against the 512 asset independently landed on 639.3 / -30 / 735, which is
    what identifies the reference as that SVG rendered in Georgia.

Verified by intersection-over-union against the 512 asset, not by eye: matching
the ink box's extent proves nothing about its shape. An earlier attempt using
the next/font subset converged to within half a pixel on two .notdef tofu boxes,
because that subset carries no Q or P.

    python make_icon.py            # writes public/app-icon-1024.png
"""
from PIL import Image, ImageDraw, ImageFont

FONT = '/System/Library/Fonts/Supplemental/Georgia.ttf'
GREEN, CREAM, WHITE = (26, 107, 60, 255), (245, 242, 235, 255), (255, 255, 255, 255)
S, SS = 1024, 4                     # output size, supersample factor
FONT_PX, TRACK, BASELINE = 640, -32, 736    # favicon.svg's geometry at 32x
RADIUS = 0.215                      # corner radius as a fraction of the tile
REF = 'public/pwa-512.png'
OUT = 'public/app-icon-1024.png'


def mask(img):
    """Cream ink only — not the white surround, not the green tile."""
    px = img.convert('RGBA').resize((S, S), Image.LANCZOS).load()
    m = bytearray(S * S)
    for y in range(S):
        for x in range(S):
            r, g, b, a = px[x, y]
            if a > 128 and r > 200 and 190 < b < 250 and (r - b) > 4:
                m[y * S + x] = 1
    return m


def render():
    big = S * SS
    im = Image.new('RGBA', (big, big), WHITE)
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([0, 0, big - 1, big - 1], radius=int(big * RADIUS), fill=GREEN)
    f = ImageFont.truetype(FONT, FONT_PX * SS)
    # Drawn glyph by glyph because Pillow has no letter-spacing, and the tracking
    # is what makes this the same drawing as favicon.svg rather than a lookalike.
    wQ, wP, t = d.textlength('Q', font=f), d.textlength('P', font=f), TRACK * SS
    x0 = big / 2 - (wQ + t + wP) / 2
    d.text((x0, BASELINE * SS), 'Q', font=f, fill=CREAM, anchor='ls')
    d.text((x0 + wQ + t, BASELINE * SS), 'P', font=f, fill=CREAM, anchor='ls')
    return im.resize((S, S), Image.LANCZOS)


im = render()
a, b = mask(Image.open(REF)), mask(im)
inter = sum(1 for x, y in zip(a, b) if x and y)
union = sum(1 for x, y in zip(a, b) if x or y)
iou = inter / union
print(f'IoU vs {REF}: {iou:.4f}   ink {sum(b)/(S*S):.4f} vs {sum(a)/(S*S):.4f}')
assert iou > 0.95, 'does not match the 512 asset — wrong face, glyphs or geometry'

im.convert('RGB').save(OUT, optimize=True)     # RGB, no alpha: Meta rejects transparency
print(f'saved {OUT}')
