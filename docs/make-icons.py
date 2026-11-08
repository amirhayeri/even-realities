"""Bio HUD icons.

Even Hub store icon: 24x24 PNG, every pixel transparent or opaque #F4F4F4,
lit pixels in aligned 2x2 blocks. So the design is a 12x12 glyph.
Watch icon: 1024x1024 opaque PNG, same glyph scaled up on a dark field.
"""
import sys
from PIL import Image, ImageDraw, ImageFilter

GLYPHS = {
    # A: solid heart, pulse cut out of it
    "A": [
        "............",
        ".XXX....XXX.",
        "XXXXX..XXXXX",
        "XXXX.XXXXXXX",
        "XXX.X.XXXXXX",
        "...XXX.X....",
        ".XXXXXX.XXX.",
        "..XXXXXXXX..",
        "...XXXXXX...",
        "....XXXX....",
        ".....XX.....",
        "............",
    ],
    # B: HUD corner brackets around a heartbeat
    "B": [
        "XXX......XXX",
        "X..........X",
        "X..........X",
        "............",
        ".....X......",
        "....X.X.....",
        "XXXX...X.XXX",
        "........X...",
        "............",
        "X..........X",
        "X..........X",
        "XXX......XXX",
    ],
    # C: heart outline with a pulse inside
    "C": [
        "............",
        ".XXX....XXX.",
        "X...X..X...X",
        "X....XX....X",
        "X...X......X",
        "X.XX.X.XXX.X",
        ".X....X...X.",
        "..X......X..",
        "...X....X...",
        "....X..X....",
        ".....XX.....",
        "............",
    ],
}

WHITE = (0xF4, 0xF4, 0xF4, 255)


def hub_icon(g):
    im = Image.new("RGBA", (24, 24), (0, 0, 0, 0))
    for y, row in enumerate(g):
        for x, c in enumerate(row):
            if c == "X":
                for dy in (0, 1):
                    for dx in (0, 1):
                        im.putpixel((2 * x + dx, 2 * y + dy), WHITE)
    return im


def watch_icon(g, size=1024):
    # Dark field with a soft vignette; glyph at ~64% of the width so the
    # circular mask on watchOS never clips it.
    im = Image.new("RGB", (size, size), (9, 12, 18))
    glow = Image.new("RGB", (size, size), (9, 12, 18))
    d = ImageDraw.Draw(glow)
    d.ellipse((size * 0.15, size * 0.15, size * 0.85, size * 0.85), fill=(24, 40, 56))
    glow = glow.filter(ImageFilter.GaussianBlur(size * 0.12))
    im = Image.blend(im, glow, 1.0)
    cell = int(size * 0.64 / 12)
    ox = (size - cell * 12) // 2
    oy = (size - cell * 12) // 2
    d = ImageDraw.Draw(im)
    # Pulse pixels (the spike rows) in Bio HUD red, frame in off-white.
    for y, row in enumerate(g):
        for x, c in enumerate(row):
            if c != "X":
                continue
            col = (255, 59, 92) if (g is GLYPHS["B"] and 4 <= y <= 7) else (244, 244, 244)
            d.rectangle((ox + x * cell, oy + y * cell, ox + (x + 1) * cell - 1, oy + (y + 1) * cell - 1), fill=col)
    return im


def preview(out):
    # Three candidates, each at 12x, on the dark field the Even app uses.
    scale = 12
    pad = 40
    w = 3 * (24 * scale + pad) + pad
    sheet = Image.new("RGB", (w, 24 * scale + 2 * pad + 300), (18, 18, 20))
    d = ImageDraw.Draw(sheet)
    for i, k in enumerate("ABC"):
        x0 = pad + i * (24 * scale + pad)
        ic = hub_icon(GLYPHS[k]).resize((24 * scale, 24 * scale), Image.NEAREST)
        sheet.paste(ic, (x0, pad), ic)
        d.text((x0, pad + 24 * scale + 12), k, fill=(200, 200, 200))
        # true-size strip
        small = hub_icon(GLYPHS[k])
        for j, s in enumerate((1, 2, 3)):
            r = small.resize((24 * s, 24 * s), Image.NEAREST)
            sheet.paste(r, (x0 + j * 90, pad + 24 * scale + 40), r)
        wi = watch_icon(GLYPHS[k], 184)
        mask = Image.new("L", wi.size, 0)
        ImageDraw.Draw(mask).ellipse((0, 0, wi.size[0] - 1, wi.size[1] - 1), fill=255)
        sheet.paste(wi, (x0 + 24 * scale - 184, pad + 24 * scale + 40), mask)
    sheet.save(out)


if __name__ == "__main__":
    out = sys.argv[1]
    pick = sys.argv[2] if len(sys.argv) > 2 else None
    preview(f"{out}/preview.png")
    for k, g in GLYPHS.items():
        hub_icon(g).save(f"{out}/hub-{k}.png")
        watch_icon(g).save(f"{out}/watch-{k}.png")
    if pick:
        hub_icon(GLYPHS[pick]).save(f"{out}/icon.png")
        watch_icon(GLYPHS[pick]).save(f"{out}/AppIcon-1024.png")
