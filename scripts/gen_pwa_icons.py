"""PWA icons from the spaceman mark. Run once; outputs land in frontend/public/icons."""
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "backend" / "assets" / "spaceman-black.png"
OUT = ROOT / "frontend" / "public" / "icons"
OUT.mkdir(parents=True, exist_ok=True)

src = Image.open(SRC).convert("RGBA")

def square(size: int, pad: float) -> Image.Image:
    # iOS composites on an opaque tile; black matches the artwork's background.
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 255))
    inner = int(size * (1 - 2 * pad))
    art = src.resize((inner, inner), Image.LANCZOS)
    canvas.paste(art, ((size - inner) // 2, (size - inner) // 2), art)
    return canvas

square(192, 0.0).save(OUT / "icon-192.png")
square(512, 0.0).save(OUT / "icon-512.png")
# Maskable: platform crops to a circle/squircle, so keep the art inside the safe zone.
square(512, 0.1).save(OUT / "icon-512-maskable.png")
square(180, 0.0).save(OUT / "apple-touch-icon.png")
for f in sorted(OUT.iterdir()):
    print(f.name, f.stat().st_size)
