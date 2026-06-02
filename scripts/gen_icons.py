"""Generate minimal but valid placeholder icons for Tauri bundling."""
import struct
import zlib
from pathlib import Path


def make_png(w: int, h: int, r: int, g: int, b: int) -> bytes:
    def chunk(name: bytes, data: bytes) -> bytes:
        crc = zlib.crc32(name + data) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + name + data + struct.pack(">I", crc)

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
    raw = b""
    for _ in range(h):
        row = b"\x00"
        for _ in range(w):
            row += bytes([r, g, b])
        raw += row
    idat = chunk(b"IDAT", zlib.compress(raw, 6))
    iend = chunk(b"IEND", b"")
    return sig + ihdr + idat + iend


def make_ico(png32: bytes) -> bytes:
    """Wrap a 32x32 PNG inside a minimal .ico file."""
    header = struct.pack("<HHH", 0, 1, 1)
    entry = struct.pack("<BBBBHHII", 32, 32, 0, 0, 1, 32, len(png32), 22)
    return header + entry + png32


def make_icns(png128: bytes) -> bytes:
    """Wrap a 128x128 PNG inside a minimal .icns file."""
    block_type = b"ic07"  # ic07 = 128x128 PNG
    block_size = 8 + len(png128)
    total_size = 8 + block_size
    return b"icns" + struct.pack(">I", total_size) + block_type + struct.pack(">I", block_size) + png128


R, G, B = 30, 109, 181  # PMI blue

icons_dir = Path(__file__).parent.parent / "frontend" / "src-tauri" / "icons"
icons_dir.mkdir(parents=True, exist_ok=True)

png32 = make_png(32, 32, R, G, B)
png128 = make_png(128, 128, R, G, B)
png256 = make_png(256, 256, R, G, B)

(icons_dir / "32x32.png").write_bytes(png32)
(icons_dir / "128x128.png").write_bytes(png128)
(icons_dir / "128x128@2x.png").write_bytes(png256)
(icons_dir / "icon.ico").write_bytes(make_ico(png32))
(icons_dir / "icon.icns").write_bytes(make_icns(png128))

print("Icons created:")
for f in sorted(icons_dir.iterdir()):
    print(f"  {f.name}  ({f.stat().st_size} bytes)")
