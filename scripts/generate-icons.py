"""Pantry's app icon.

A pantry jar rather than a shopping bag: the app is about what you keep, not
the trip to buy it, and a jar is a far more distinctive silhouette at 40px than
yet another tote.

Rendered at 4x and downsampled. The ground is a squircle (superellipse) rather
than a rounded rectangle -- iOS and Android apply their own masks, but the
manifest icons are shown unmasked in several places and the difference is
visible there.
"""
from PIL import Image, ImageDraw

# Clay, lit from the top-left. Both ends sit on the accent ramp the app uses.
TOP = (228, 141, 104)
BOTTOM = (194, 92, 58)
BAND = (201, 100, 66)
WHITE = (255, 255, 255, 255)

S = 1024          # design canvas
SS = 2            # supersample factor


# Both of these are computed on a small grid and scaled up. Evaluating either
# per-pixel at 2048 in pure Python is slow, and upscaling a smooth field costs
# nothing visually -- the gradient has no detail to lose, and the mask gains
# antialiased edges from the interpolation.
GRID = 96


def ground(size):
    """Diagonal gradient with a soft radial highlight near the top-left."""
    small = Image.new("RGB", (GRID, GRID))
    px = small.load()
    for j in range(GRID):
        for i in range(GRID):
            t = (i + j) / (2 * GRID - 2)
            r, g, b = (a + (bb - a) * t for a, bb in zip(TOP, BOTTOM))

            # A wide, very soft lift so the surface reads as lit rather than
            # printed. Kept low or it turns into a visible blob.
            dx = (i - GRID * 0.30) / (GRID * 0.85)
            dy = (j - GRID * 0.24) / (GRID * 0.85)
            lift = max(0.0, 1.0 - (dx * dx + dy * dy) ** 0.5) ** 2 * 26.0

            px[i, j] = tuple(min(255, round(c + lift)) for c in (r, g, b))
    return small.resize((size, size), Image.BICUBIC)


def squircle_mask(size, n=4.4):
    """|x|^n + |y|^n <= 1 — the shape iOS uses, rounder than a rounded rect."""
    g = 512
    mask = Image.new("L", (g, g), 0)
    px = mask.load()
    half = (g - 1) / 2
    for j in range(g):
        v = abs((j - half) / half) ** n
        for i in range(g):
            if abs((i - half) / half) ** n + v <= 1.0:
                px[i, j] = 255
    return mask.resize((size, size), Image.LANCZOS)


def jar(draw, s):
    """An outlined jar, filled to about half.

    The first version drew a solid jar with a band across it, which read as a
    minus sign rather than a label. Outlining the vessel and filling the lower
    half instead says "a container with something in it" -- which is the whole
    idea of a pantry -- and leaves the gradient visible through the top.
    """
    k = s / 1024.0
    cx = s / 2
    stroke = round(30 * k)

    # Lid, sitting just above the shoulder.
    lid_w, lid_h, lid_y = 286 * k, 70 * k, 236 * k
    draw.rounded_rectangle(
        [cx - lid_w / 2, lid_y, cx + lid_w / 2, lid_y + lid_h],
        radius=lid_h / 2, fill=WHITE,
    )

    body_w, body_top, body_bottom = 424 * k, 342 * k, 800 * k
    left, right = cx - body_w / 2, cx + body_w / 2
    draw.rounded_rectangle(
        [left, body_top, right, body_bottom],
        radius=78 * k, outline=WHITE, width=stroke,
    )

    # Contents: flat across the top, following the jar's curve at the bottom.
    inset = stroke * 1.9
    fill_top = body_top + (body_bottom - body_top) * 0.46
    draw.rounded_rectangle(
        [left + inset, fill_top, right - inset, body_bottom - inset],
        radius=46 * k,
        fill=WHITE,
        corners=(False, False, True, True),
    )


def render(size, shape="squircle"):
    s = size * SS
    img = ground(s).convert("RGBA")

    if shape == "squircle":
        out = Image.new("RGBA", (s, s), (0, 0, 0, 0))
        out.paste(img, (0, 0), squircle_mask(s))
        img = out

    jar(ImageDraw.Draw(img), s)
    return img.resize((size, size), Image.LANCZOS)


# Shown unmasked in browser tabs, install prompts and the manifest.
render(192).save("public/icon-192.png")
render(512).save("public/icon-512.png")

# iOS applies its own mask and dislikes alpha: full-bleed, opaque.
render(180, shape="square").convert("RGB").save("public/apple-touch-icon.png")

# Android masks to whatever shape the launcher uses, and crops to the centre
# 80%. A pre-rounded icon here gets rounded twice and ends up floating inside
# its own tile, so this one is full-bleed with the jar inside the safe circle.
render(512, shape="square").save("public/icon-maskable-512.png")

SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#e48d68"/>
      <stop offset="1" stop-color="#c25c3a"/>
    </linearGradient>
  </defs>
  <path d="M512 0C158 0 0 158 0 512s158 512 512 512 512-158 512-512S866 0 512 0Z" fill="url(#g)"/>
  <rect x="369" y="236" width="286" height="70" rx="35" fill="#fff"/>
  <rect x="315" y="357" width="394" height="428" rx="63" fill="none" stroke="#fff" stroke-width="30"/>
  <path d="M357 553h310v146a48 48 0 0 1-48 48H405a48 48 0 0 1-48-48V553Z" fill="#fff"/>
</svg>
"""
open("public/icon.svg", "w").write(SVG)
print("wrote icon-192 icon-512 apple-touch-icon icon-maskable-512 icon.svg")
