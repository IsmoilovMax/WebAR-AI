"""Bbox va poligon geometriyasi.

Barcha koordinatalar normallashtirilgan (0..1). Sabab: kamera rezolyutsiyasi
o'zgarsa yoki main/sub stream almashsa, zonalar va bbox lar joyida qoladi.
"""

from __future__ import annotations

from typing import Sequence

BBox = tuple[float, float, float, float]  # (x, y, w, h)
Point = tuple[float, float]
Polygon = Sequence[Point]


def xyxy_to_norm(xyxy: Sequence[float], width: int, height: int) -> BBox:
    x1, y1, x2, y2 = xyxy[:4]
    return (
        max(0.0, min(1.0, x1 / width)),
        max(0.0, min(1.0, y1 / height)),
        max(0.0, min(1.0, (x2 - x1) / width)),
        max(0.0, min(1.0, (y2 - y1) / height)),
    )


def norm_to_pixels(bbox: BBox, width: int, height: int) -> tuple[int, int, int, int]:
    x, y, w, h = bbox
    return (
        int(round(x * width)),
        int(round(y * height)),
        int(round((x + w) * width)),
        int(round((y + h) * height)),
    )


def center(bbox: BBox) -> Point:
    x, y, w, h = bbox
    return (x + w / 2, y + h / 2)


def bottom_center(bbox: BBox) -> Point:
    """Odam uchun oyoq nuqtasi. Zona tekshiruvida markazdan ko'ra to'g'riroq:
    odam zonaga oyog'i bilan kiradi, boshi bilan emas."""
    x, y, w, h = bbox
    return (x + w / 2, y + h)


def area(bbox: BBox) -> float:
    return max(0.0, bbox[2]) * max(0.0, bbox[3])


def aspect_ratio(bbox: BBox) -> float:
    """Kenglik / balandlik. Tik turgan odamda ~0.4, yotganda >1.2."""
    _, _, w, h = bbox
    if h <= 1e-6:
        return 0.0
    return w / h


def iou(a: BBox, b: BBox) -> float:
    ax1, ay1, aw, ah = a
    bx1, by1, bw, bh = b
    ax2, ay2 = ax1 + aw, ay1 + ah
    bx2, by2 = bx1 + bw, by1 + bh

    inter_w = max(0.0, min(ax2, bx2) - max(ax1, bx1))
    inter_h = max(0.0, min(ay2, by2) - max(ay1, by1))
    intersection = inter_w * inter_h
    if intersection <= 0:
        return 0.0

    union = area(a) + area(b) - intersection
    return intersection / union if union > 0 else 0.0


def contains(outer: BBox, point: Point) -> bool:
    x, y, w, h = outer
    return x <= point[0] <= x + w and y <= point[1] <= y + h


def point_in_polygon(point: Point, polygon: Polygon) -> bool:
    """Ray casting. Poligon yopiq deb hisoblanadi (oxirgi nuqta birinchisiga ulanadi)."""
    if len(polygon) < 3:
        return False

    x, y = point
    inside = False
    j = len(polygon) - 1

    for i in range(len(polygon)):
        xi, yi = polygon[i]
        xj, yj = polygon[j]
        # Nuqta qirraning vertikal oralig'ida bo'lsa va kesishma o'ngda bo'lsa,
        # hisoblagich almashadi.
        if (yi > y) != (yj > y):
            x_intersect = (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi
            if x < x_intersect:
                inside = not inside
        j = i

    return inside


def bbox_in_polygon(bbox: BBox, polygon: Polygon) -> bool:
    return point_in_polygon(bottom_center(bbox), polygon)


def distance(a: Point, b: Point) -> float:
    return ((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2) ** 0.5
