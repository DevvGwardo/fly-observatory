"""Rebuild the README banner and social card from the local illustration."""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps

ASSETS = Path(__file__).resolve().parents[1] / "assets"
BG = "#0b1216"
INK = "#e7ede9"
MINT = "#8cddcd"
AMBER = "#edb973"
MUTED = "#a9bdbe"
LINE = "#395451"
FONT_PATHS = {
    "serif": [
        "/System/Library/Fonts/Supplemental/Georgia.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf",
    ],
    "sans": [
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ],
    "mono": [
        "/System/Library/Fonts/Supplemental/Courier New.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
    ],
}


def font(family, size):
    for candidate in FONT_PATHS[family]:
        if Path(candidate).is_file():
            return ImageFont.truetype(candidate, size)
    raise SystemExit(f"Install a {family} font listed in FONT_PATHS before rendering.")


def background(size):
    art = Image.open(ASSETS / "hero-art.png").convert("RGB")
    canvas = ImageOps.fit(art, size, centering=(1, 0.5)).convert("RGBA")
    # Protect exact, typeset labels from the decorative neural filaments.
    mask = Image.new("L", (size[0], 1))
    mask.putdata([
        round(255 * max(0, min(1, (0.61 - x / size[0]) / 0.21)))
        for x in range(size[0])
    ])
    canvas = Image.composite(
        Image.new("RGBA", size, BG),
        canvas,
        mask.resize(size),
    )
    return canvas


def label(draw, position, text, family="sans", size=24, color=INK):
    draw.text(position, text, font=font(family, size), fill=color, anchor="lt")


def mark(canvas, position, size):
    logo = Image.open(ASSETS / "logo.png").convert("RGBA")
    canvas.alpha_composite(logo.resize((size, size), Image.Resampling.LANCZOS), position)


def banner():
    canvas = background((1920, 800))
    draw = ImageDraw.Draw(canvas)
    mark(canvas, (76, 58), 72)
    label(draw, (166, 83), "FLY OBSERVATORY", "mono", 22, MINT)
    label(draw, (88, 161), "CONNECTOME-DRIVEN / LIVE EXHIBIT", "mono", 18, MUTED)
    label(draw, (82, 217), "Fly", "serif", 114)
    label(draw, (82, 334), "Observatory", "serif", 114)
    label(draw, (88, 495), "Real wiring. An engineered world.", size=34, color=MINT)
    label(draw, (88, 549), "A live fly-connectome exhibit.", size=26, color=MUTED)
    draw.line((88, 632, 888, 632), fill=LINE, width=1)
    for x, value, caption in [
        (88, "166,700", "NEURONS SIMULATED"),
        (366, "25.58M", "SIGNED CONNECTIONS"),
        (654, "16,000", "DISPLAYED LOCATIONS"),
    ]:
        label(draw, (x, 659), value, "serif", 43)
        label(draw, (x, 721), caption, "mono", 16, MUTED)
    label(draw, (1453, 754), "ILLUSTRATIVE BRAND ART", "mono", 15, MUTED)
    canvas.convert("RGB").save(ASSETS / "banner.png", optimize=True)


def social_card():
    canvas = background((1200, 630))
    draw = ImageDraw.Draw(canvas)
    mark(canvas, (42, 38), 60)
    label(draw, (118, 58), "FLY OBSERVATORY", "mono", 17, MINT)
    label(draw, (48, 162), "Fly", "serif", 78)
    label(draw, (48, 252), "Observatory", "serif", 78)
    label(draw, (54, 379), "Real wiring.", size=29, color=MINT)
    label(draw, (54, 420), "An engineered world.", size=29, color=MINT)
    draw.line((54, 497, 560, 497), fill=LINE, width=1)
    label(draw, (54, 525), "166,700 neurons / 25.58M synapses", size=23)
    label(draw, (54, 570), "LIVE CONNECTOME EXHIBIT", "mono", 17, MUTED)
    label(draw, (938, 599), "ILLUSTRATIVE ART", "mono", 14, MUTED)
    canvas.convert("RGB").save(ASSETS / "social-card.png", optimize=True)


if __name__ == "__main__":
    banner()
    social_card()
    print("Rendered banner.png (1920×800) and social-card.png (1200×630).")
