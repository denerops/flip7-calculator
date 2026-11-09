#!/usr/bin/env python3
"""Raster icons for the Flip 7 scorekeeper. No third-party deps."""

import math
import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "icons"

RED = (194, 48, 42)
CREAM = (251, 246, 234)
GREEN = (61, 138, 82)
ORANGE = (214, 122, 44)


def sd_round_box(px, py, cx, cy, hw, hh, r):
    dx = abs(px - cx) - hw + r
    dy = abs(py - cy) - hh + r
    return math.hypot(max(dx, 0), max(dy, 0)) + min(max(dx, dy), 0) - r


def dist_seg(px, py, x1, y1, x2, y2):
    vx, vy = x2 - x1, y2 - y1
    l2 = vx * vx + vy * vy or 1.0
    t = max(0.0, min(1.0, ((px - x1) * vx + (py - y1) * vy) / l2))
    return math.hypot(px - (x1 + t * vx), py - (y1 + t * vy))


def cover(sdf, size):
    return max(0.0, min(1.0, 0.5 - sdf * size))


def blend(dst, src, alpha):
    if alpha <= 0:
        return dst
    if alpha >= 1:
        return src
    return tuple(round(dst[i] * (1 - alpha) + src[i] * alpha) for i in range(3))


def shader(size, maskable):
    def pixel(x, y):
        u = (x + 0.5) / size
        v = (y + 0.5) / size
        margin = 0.18 if maskable else 0.085
        radius = 0.07
        col = RED
        card = sd_round_box(u, v, 0.5, 0.5, 0.5 - margin, 0.5 - margin, radius)
        col = blend(col, CREAM, cover(card, size))
        for inset, width in ((0.045, 0.011), (0.068, 0.006)):
            outer = sd_round_box(
                u, v, 0.5, 0.5, 0.5 - margin - inset, 0.5 - margin - inset, radius * 0.75
            )
            inner = sd_round_box(
                u,
                v,
                0.5,
                0.5,
                0.5 - margin - inset - width,
                0.5 - margin - inset - width,
                radius * 0.6,
            )
            col = blend(col, RED, cover(outer, size) * (1 - cover(inner, size)))
        bar = dist_seg(u, v, 0.31, 0.36, 0.70, 0.36) - 0.038
        diag = dist_seg(u, v, 0.662, 0.36, 0.40, 0.73) - 0.036
        col = blend(col, RED, cover(min(bar, diag), size))
        if not maskable:
            for cx, cy, tint in ((margin - 0.012, 0.62, GREEN), (1 - margin + 0.012, 0.62, ORANGE)):
                shell = math.hypot(u - cx, v - cy) - 0.04
                col = blend(col, tint, cover(shell, size))
                highlight = math.hypot(u - (cx - 0.012), v - (cy - 0.014)) - 0.012
                col = blend(col, (255, 255, 255), cover(highlight, size) * 0.4)
        return (*col, 255)

    return pixel


def write_png(path, size, pixel):
    raw = bytearray()
    for y in range(size):
        raw.append(0)
        for x in range(size):
            raw.extend(pixel(x, y))

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(bytes(raw), 9)) + chunk(b"IEND", b"")
    path.write_bytes(png)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    write_png(OUT / "icon-512.png", 512, shader(512, False))
    write_png(OUT / "icon-192.png", 192, shader(192, False))
    write_png(OUT / "apple-touch-icon.png", 180, shader(180, False))
    write_png(OUT / "icon-maskable-512.png", 512, shader(512, True))


if __name__ == "__main__":
    main()
