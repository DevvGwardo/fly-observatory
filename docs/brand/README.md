# Fly Observatory visual identity

**Real wiring. An engineered world.**

A restrained natural-history atlas: charcoal backgrounds, mint observation
marks, amber stimuli, editorial serif titles, and monospace technical labels.
The palette follows the existing app; no runtime UI changes are required.

## Assets

| Asset | Format / size | Use |
| --- | --- | --- |
| [README banner](../assets/banner.png) | PNG, 1920 × 800 | README introduction |
| [Fly mark](../assets/logo.svg) | SVG, 256 × 256 | Scalable project icon |
| [Raster mark](../assets/logo.png) | PNG, 256 × 256 | Avatars and raster layouts |
| [Signal-flow infographic](../assets/signal-flow.svg) | Editable SVG, 1440 × 1120 | Architecture and scientific boundaries |
| [Raster infographic](../assets/signal-flow.png) | PNG, 1440 × 1120 | README and sharing |
| [Social card](../assets/social-card.png) | PNG, 1200 × 630 | Repository social preview, uploaded manually |
| [Source illustration](../assets/hero-art.png) | PNG | Text-free background artwork |

## Palette and type

| Role | Color |
| --- | --- |
| Charcoal / background | `#0b1216` |
| Off-white / primary text | `#e7ede9` |
| Mint / neural signal | `#8cddcd` |
| Amber / stimulus and trained readout | `#edb973` |
| Slate / secondary text | `#a9bdbe` |
| Rule / diagram boundaries | `#395451` |

Export typography uses Georgia, Arial, and Courier New, with DejaVu fallbacks in
the banner script. Fonts are not bundled. SVGs use local font stacks and make no
network requests; PNGs retain their typography everywhere.

Keep clear space around the mark equal to at least one head diameter. Use the
SVG for resizing; avoid stretching, recoloring, or placing it over busy artwork.

## Scientific honesty and provenance

The hero is an AI-generated illustration made for this project, not a
microscope image, app screenshot, measured neural graph, or anatomical reference.
The mark is a geometric symbol, not a specimen drawing.

The infographic is an authored schematic based on `observatory.py` and the
README. Its measured/engineered distinction is intentional. A decoder test score
is not behavioral accuracy or evidence of a biological-wiring advantage.
Keep the README's scientific boundaries alongside these visuals.

This identity guide does not choose a software license or establish
redistribution rights for the external connectome dataset.

## Rebuilding exports

With Python and Pillow available:

```sh
python3 docs/brand/render.py
```

This uses the local `hero-art.png` and `logo.png`, writes only `banner.png` and
`social-card.png`, and does not generate new artwork or contact any service.
The script lists its supported system font locations. Different fallback fonts
can produce different line lengths.

The mark and infographic remain editable as SVG. To refresh their PNG exports,
open each SVG in a browser at its declared pixel size and capture the viewport
at device scale 1 with no surrounding page margins. Review all labels after
editing before replacing the checked-in PNG.
