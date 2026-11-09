"""Карты: коробки, лучи и графы путей для ботов.

Каждая карта симметрична относительно центра, чтобы стороны были в равных условиях.
Сторона 0 появляется на западе, сторона 1 на востоке. Точки закладки бомбы стоят
на восточной половине, поэтому в обезвреживании атакует сторона 0.
"""
from __future__ import annotations

import math
import random
import zlib
from collections import defaultdict, deque
from dataclasses import dataclass
from functools import cached_property

EPS = 1e-9
SITE_RADIUS = 3.5
# Во сколько раз карты больше своих чертежей ниже. Растут расстояния и длинные стены,
# а ящики, бочки и толщина стен остаются прежними.
MAP_SCALE = 2.2
KEEP_SIZE = 3.0
TOUCH_GAP = 0.2  # ящики ближе этого приставлены друг к другу: по ним можно забраться наверх
# Дополнительные укрытия: шаг сетки и свободный проход вокруг каждого.
COVER_STEP = 7.0
COVER_GAP = 2.2
COVER_SPAWN_CLEAR = 3.0
COVER_SITE_CLEAR = 5.5
# Комнаты и коридоры: какая доля площади закрыта стенами и как устроены стены.
CLOSED_SHARE = 0.8
WALL_HEIGHT = 4.5
DOOR_WIDTH = 4.0
DOOR_HEIGHT = 3.0
ROOF_CHANCE = 0.6
SHORT_EDGE = 9.0  # поперёк коридора стен нет, иначе он не был бы коридором
WALL_KINDS = {"oasis": "plaster", "pass": "metal", "market": "brick", "pit": "concrete", "terminal": "metal"}
# Быстрый поиск коробок рядом с лучом: размер клетки и запас вокруг коробки.
INDEX_CELL = 6.0
INDEX_PAD = 0.6


@dataclass(frozen=True)
class Box:
    minx: float
    maxx: float
    miny: float
    maxy: float
    minz: float
    maxz: float
    kind: str = "wall"

    def to_dict(self):
        return {
            "minx": self.minx, "maxx": self.maxx,
            "miny": self.miny, "maxy": self.maxy,
            "minz": self.minz, "maxz": self.maxz,
            "kind": self.kind,
        }


def _box(cx, cz, sx, sz, h, kind="wall", y0=0.0):
    return Box(cx - sx / 2, cx + sx / 2, y0, y0 + h, cz - sz / 2, cz + sz / 2, kind)


def _mirror(b: Box) -> Box:
    return Box(-b.maxx, -b.minx, b.miny, b.maxy, -b.maxz, -b.minz, b.kind)


def _scale_box(b: Box, s: float) -> Box:
    def axis(low, high):
        center, size = (low + high) / 2 * s, high - low
        if size > KEEP_SIZE and b.kind != "crate":
            size *= s
        return center - size / 2, center + size / 2

    minx, maxx = axis(b.minx, b.maxx)
    minz, maxz = axis(b.minz, b.maxz)
    return Box(minx, maxx, b.miny, b.maxy, minz, maxz, b.kind)


def _keeps_size(b: Box) -> bool:
    return b.kind == "crate" or (b.maxx - b.minx <= KEEP_SIZE and b.maxz - b.minz <= KEEP_SIZE)


def _touching(a: Box, b: Box) -> bool:
    return (a.minx <= b.maxx + TOUCH_GAP and b.minx <= a.maxx + TOUCH_GAP
            and a.minz <= b.maxz + TOUCH_GAP and b.minz <= a.maxz + TOUCH_GAP)


def _attached_center(low, high, ref_low, ref_high, new_low, new_high, s):
    """Центр приставленного ящика по одной оси: он остаётся вплотную к тому, к чему приставлен."""
    center = (low + high) / 2
    if low >= ref_high - TOUCH_GAP:
        return new_high + center - ref_high
    if high <= ref_low + TOUCH_GAP:
        return new_low - (ref_low - center)
    if abs((new_high - new_low) - (ref_high - ref_low)) < EPS:
        return (new_low + new_high) / 2 + center - (ref_low + ref_high) / 2
    return center * s


def _scale_boxes(boxes: list[Box], s: float) -> list[Box]:
    """Растягивает чертёж, но приставленные ящики переносит вместе с опорой, иначе лесенки разваливаются."""
    result = [_scale_box(b, s) for b in boxes]
    placed = [i for i, b in enumerate(boxes) if not _keeps_size(b)]
    waiting = [i for i in range(len(boxes)) if i not in placed]
    while waiting:
        pair = next(((i, p) for i in waiting for p in placed if _touching(boxes[i], boxes[p])), None)
        if pair is None:
            placed.append(waiting.pop(0))  # этот ящик ни к чему не приставлен
            continue
        i, parent = pair
        b, ref, moved = boxes[i], boxes[parent], result[parent]
        x = _attached_center(b.minx, b.maxx, ref.minx, ref.maxx, moved.minx, moved.maxx, s)
        z = _attached_center(b.minz, b.maxz, ref.minz, ref.maxz, moved.minz, moved.maxz, s)
        hx, hz = (b.maxx - b.minx) / 2, (b.maxz - b.minz) / 2
        result[i] = Box(x - hx, x + hx, b.miny, b.maxy, z - hz, z + hz, b.kind)
        waiting.remove(i)
        placed.append(i)
    return result


def _gap(a: Box, b: Box) -> float:
    dx = max(a.minx - b.maxx, b.minx - a.maxx, 0.0)
    dz = max(a.minz - b.maxz, b.minz - a.maxz, 0.0)
    return math.hypot(dx, dz)


# Виды укрытий: сдвиг по x и z, размер по x и z, высота, материал и высота низа.
COVER_DESIGNS = {
    "ящик": [(0, 0, 1.6, 1.6, 0.9, "crate")],
    "ступенька из ящиков": [(0, 0, 1.6, 1.6, 1.8, "crate"), (1.6, 0, 1.6, 1.6, 0.9, "crate")],
    "пирамида из ящиков": [(-0.8, 0, 1.6, 1.6, 0.9, "crate"), (0.8, 0, 1.6, 1.6, 0.9, "crate"),
                           (0, 0, 1.6, 1.6, 0.9, "crate", 0.9)],
    "широкий ящик": [(0, 0, 3.0, 1.6, 1.1, "crate")],
    "бетонный блок": [(0, 0, 4.0, 0.8, 1.25, "concrete")],
    "угол из блоков": [(0, 0, 4.0, 0.8, 1.25, "concrete"), (-1.6, 1.6, 0.8, 2.4, 1.25, "concrete")],
    "ряд блоков": [(-2.4, 0, 1.6, 0.8, 1.25, "concrete"), (0, 0, 1.6, 0.8, 1.25, "concrete"),
                   (2.4, 0, 1.6, 0.8, 1.25, "concrete")],
    "мешки": [(0, 0, 3.6, 0.9, 1.0, "sandbag")],
    "гнездо из мешков": [(0, -1.4, 3.6, 0.9, 1.0, "sandbag"), (-1.35, 0, 0.9, 1.9, 1.0, "sandbag"),
                         (1.35, 0, 0.9, 1.9, 1.0, "sandbag")],
    "бочки": [(-0.55, 0, 0.9, 0.9, 1.2, "barrel"), (0.55, 0, 0.9, 0.9, 1.2, "barrel"), (0, 0.95, 0.9, 0.9, 1.2, "barrel")],
    "колонна": [(0, 0, 1.2, 1.2, 3.6, "concrete")],
    "арка": [(-2.0, 0, 0.9, 0.9, 2.6, "brick"), (2.0, 0, 0.9, 0.9, 2.6, "brick"), (0, 0, 4.9, 0.9, 0.6, "brick", 2.6)],
    "кирпичная стенка": [(0, 0, 5.0, 0.6, 1.25, "brick"), (-2.5, 0, 0.9, 0.9, 2.0, "brick"), (2.5, 0, 0.9, 0.9, 2.0, "brick")],
    "стеллаж": [(0, 0, 6.0, 0.9, 2.2, "metal")],
    "трубы": [(0, 0, 5.0, 0.9, 0.9, "metal")],
    "машина": [(0, 0, 4.2, 1.9, 1.05, "metal"), (-0.2, 0, 2.2, 1.7, 0.7, "metal", 1.05)],
    "контейнер": [(0, 0, 6.0, 2.6, 2.6, "container")],
    "киоск": [(0, 0, 3.0, 2.4, 2.2, "plaster"), (0, 0, 3.6, 3.0, 0.2, "metal", 2.2)],
}
COVER_NAMES = sorted(COVER_DESIGNS)


def _cover_piece(rng: random.Random, x: float, z: float) -> list[Box]:
    design = COVER_DESIGNS[rng.choice(COVER_NAMES)]
    turned = rng.random() < 0.5
    pieces = []
    for dx, dz, sx, sz, height, kind, *rest in design:
        if turned:
            dx, dz, sx, sz = dz, dx, sz, sx
        pieces.append(_box(x + dx, z + dz, sx, sz, height, kind, rest[0] if rest else 0.0))
    return pieces


def _strips(rng: random.Random, start: float, stop: float) -> list[float]:
    """Делит отрезок на чередующиеся комнаты и коридоры."""
    edges = [start]
    pos = start
    corridor = False
    while True:
        pos += rng.uniform(6.0, 8.0) if corridor else rng.uniform(15.0, 23.0)
        corridor = not corridor
        if stop - pos < SHORT_EDGE:
            return edges + [stop]
        edges.append(pos)


def _subtract(low: float, high: float, gaps: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """Что остаётся от отрезка, если вырезать из него проёмы."""
    pieces = []
    pos = low
    for a, b in sorted(gaps):
        if a > pos:
            pieces.append((pos, min(a, high)))
        pos = max(pos, b)
    if pos < high:
        pieces.append((pos, high))
    return [(a, b) for a, b in pieces if b - a >= 0.8]


def _overlaps(a: Box, b: Box) -> bool:
    return a.minx < b.maxx and b.minx < a.maxx and a.minz < b.maxz and b.minz < a.maxz


def _rooms(map_id, half_x, half_z, boxes, spawns, sites) -> tuple[list[Box], float]:
    """Стены с проходами на западной половине: комнаты, коридоры и немного открытых дворов.

    Западная полоса с точками появления остаётся одной большой комнатой. Возвращает коробки
    и долю закрытой площади.
    """
    rng = random.Random(zlib.crc32(map_id.encode()) + 1)
    kind = WALL_KINDS.get(map_id, "wall")
    xs = [-half_x] + _strips(rng, max(x for x, _ in spawns) + 4.0, 0.0)
    zs = _strips(rng, -half_z, half_z)
    columns, rows = len(xs) - 1, len(zs) - 1
    keep_free = [(x, z, 2.0) for x, z in spawns] + [(-x, -z, 2.0) for x, z in spawns]
    keep_free += [(s["x"], s["z"], SITE_RADIUS + 1.2) for s in sites]
    keep_free += [(-s["x"], -s["z"], SITE_RADIUS + 1.2) for s in sites]

    def area(cell):
        return (xs[cell[0] + 1] - xs[cell[0]]) * (zs[cell[1] + 1] - zs[cell[1]])

    def holds(cell, x, z):
        return xs[cell[0]] <= x <= xs[cell[0] + 1] and zs[cell[1]] <= z <= zs[cell[1] + 1]

    # Открытыми остаются дворы у точек бомбы, остальные дворы выбираем случайно до нужной доли.
    cells = [(i, j) for i in range(1, columns) for j in range(rows)]
    yards = {c for c in cells for s in sites if holds(c, -s["x"], -s["z"])}
    limit = (1 - CLOSED_SHARE) * half_x * half_z * 2
    open_area = sum(area(c) for c in yards)
    shuffled = list(cells)
    rng.shuffle(shuffled)
    for cell in shuffled:
        if cell not in yards and open_area + area(cell) <= limit:
            yards.add(cell)
            open_area += area(cell)

    result: list[Box] = []

    def door_is_free(vertical, at, center):
        half = DOOR_WIDTH / 2 + 0.4
        probe = (Box(at - 2.2, at + 2.2, 0, 4, center - half, center + half) if vertical
                 else Box(center - half, center + half, 0, 4, at - 2.2, at + 2.2))
        return not any(_overlaps(probe, b) for b in boxes if b.miny < 2.0 and b.kind != "perimeter")

    def panel(vertical, at, low, high, bottom, top):
        return (Box(at - 0.4, at + 0.4, bottom, top, low, high, kind) if vertical
                else Box(low, high, bottom, top, at - 0.4, at + 0.4, kind))

    def edge(gaps, vertical, at, a, b, both_open=False):
        """Участок стены между двумя соседними клетками: один или два прохода."""
        if both_open or b - a < SHORT_EDGE:
            gaps.append((a, b))
            return
        count = 2 if b - a > 18.0 and rng.random() < 0.5 else 1
        for n in range(count):
            low = a + (b - a) * n / count
            high = a + (b - a) * (n + 1) / count
            spots = [rng.uniform(low + 1.0 + DOOR_WIDTH / 2, high - 1.0 - DOOR_WIDTH / 2) for _ in range(10)]
            center = next((c for c in spots if door_is_free(vertical, at, c)), None)
            if center is None:
                gaps.append((low, high))  # проход занят: здесь стены не будет, зато путь есть
                continue
            door = (center - DOOR_WIDTH / 2, center + DOOR_WIDTH / 2)
            gaps.append(door)
            result.append(panel(vertical, at, *door, DOOR_HEIGHT, WALL_HEIGHT))

    def finish(gaps, vertical, at, low, high):
        for x, z, radius in keep_free:
            distance, along = abs(x - at), z
            if not vertical:
                distance, along = abs(z - at), x
            if distance < radius:
                half = math.sqrt(radius ** 2 - distance ** 2)
                gaps.append((along - half, along + half))
        result.extend(panel(vertical, at, a, b, 0.0, WALL_HEIGHT) for a, b in _subtract(low, high, gaps))

    for i in range(1, columns):  # стены вдоль z
        gaps: list[tuple[float, float]] = []
        for j in range(rows):
            edge(gaps, True, xs[i], zs[j], zs[j + 1], (i - 1, j) in yards and (i, j) in yards)
        finish(gaps, True, xs[i], zs[0], zs[-1])
    gaps = [(-5.0, 0.0)]  # центральная линия: вторая её половина получится отражением
    for j in range(rows):
        if zs[j] < 0:
            edge(gaps, True, 0.0, zs[j], min(zs[j + 1], 0.0))
    finish(gaps, True, 0.0, zs[0], 0.0)
    for j in range(1, rows):  # стены вдоль x
        gaps = []
        for i in range(1, columns):
            edge(gaps, False, zs[j], xs[i], xs[i + 1], (i, j - 1) in yards and (i, j) in yards)
        finish(gaps, False, zs[j], xs[1], 0.0)

    for cell in cells:
        room = Box(xs[cell[0]], xs[cell[0] + 1], WALL_HEIGHT, WALL_HEIGHT + 0.3,
                   zs[cell[1]], zs[cell[1] + 1], "concrete")
        too_tall = any(b.maxy > WALL_HEIGHT - 0.3 and b.kind != "perimeter" and _overlaps(room, b) for b in boxes)
        if cell not in yards and not too_tall and rng.random() < ROOF_CHANCE:
            result.append(room)
    return result, 1 - open_area / (half_x * half_z * 2)


def _fill_cover(map_id, half_x, half_z, boxes, spawns, sites) -> list[Box]:
    """Расставляет разные укрытия на западной половине там, где есть место. Раскладка у карты всегда одна."""
    rng = random.Random(zlib.crc32(map_id.encode()))
    keep_clear = [(x, z, COVER_SPAWN_CLEAR) for x, z in spawns]
    keep_clear += [(-x, -z, COVER_SPAWN_CLEAR) for x, z in spawns]
    keep_clear += [(s["x"], s["z"], COVER_SITE_CLEAR) for s in sites]
    keep_clear += [(-s["x"], -s["z"], COVER_SITE_CLEAR) for s in sites]
    taken = [b for b in boxes if b.miny < WALL_HEIGHT]  # под крышей укрытия тоже нужны
    added: list[Box] = []
    x = -half_x + 6.0
    while x < -3.0:
        z = -half_z + 6.0
        while z <= half_z - 6.0:
            piece = _cover_piece(rng, x + rng.uniform(-2.5, 2.5), z + rng.uniform(-2.5, 2.5))
            twins = piece + [_mirror(b) for b in piece]
            fits = all(
                -half_x + COVER_GAP < b.minx and b.maxx < -1.5 and -half_z + COVER_GAP < b.minz < b.maxz < half_z - COVER_GAP
                for b in piece
            )
            if (fits
                    and all(_gap(b, other) >= COVER_GAP for b in twins for other in taken)
                    and all(_gap(b, Box(px, px, 0, 0, pz, pz)) >= clear for b in twins for px, pz, clear in keep_clear)):
                added += piece
                taken += twins
            z += COVER_STEP
        x += COVER_STEP
    return added


def _perimeter(hx: float, hz: float) -> list[Box]:
    return [
        Box(-hx - 1, hx + 1, 0, 6, -hz - 1, -hz, "perimeter"),
        Box(-hx - 1, hx + 1, 0, 6, hz, hz + 1, "perimeter"),
        Box(-hx - 1, -hx, 0, 6, -hz, hz, "perimeter"),
        Box(hx, hx + 1, 0, 6, -hz, hz, "perimeter"),
    ]


def ray_box(o, d, b: Box, tmax: float, pad: float = 0.0):
    """Пересечение луча с коробкой. Возвращает расстояние или None."""
    tnear, tfar = 0.0, tmax
    for origin, delta, low, high in (
        (o[0], d[0], b.minx - pad, b.maxx + pad),
        (o[1], d[1], b.miny, b.maxy),
        (o[2], d[2], b.minz - pad, b.maxz + pad),
    ):
        if abs(delta) < EPS:
            if origin < low or origin > high:
                return None
            continue
        t1, t2 = (low - origin) / delta, (high - origin) / delta
        if t1 > t2:
            t1, t2 = t2, t1
        tnear, tfar = max(tnear, t1), min(tfar, t2)
        if tnear > tfar:
            return None
    return tnear


class NavGraph:
    """Сетка точек, по которым ходят боты (только по земле)."""

    STEP = 2.5
    PAD = 0.45

    def __init__(self, game_map: "GameMap"):
        self.points: list[tuple[float, float]] = []
        self.cells: dict[tuple[int, int], int] = {}  # точка по её месту в сетке
        nx, nz = int(game_map.half_x // self.STEP), int(game_map.half_z // self.STEP)
        self.reach = max(nx, nz) * 2 + 2
        for i in range(-nx, nx + 1):
            for j in range(-nz, nz + 1):
                x, z = i * self.STEP, j * self.STEP
                if abs(x) > game_map.half_x - 0.6 or abs(z) > game_map.half_z - 0.6:
                    continue
                if not game_map.point_inside(x, 1.0, z, self.PAD):
                    self.cells[(i, j)] = len(self.points)
                    self.points.append((x, z))
        self.links: list[list[int]] = [[] for _ in self.points]
        # Соседи только рядом по сетке: перебирать все пары на большой карте слишком долго.
        for (i, j), a in self.cells.items():
            ax, az = self.points[a]
            for di, dj in ((1, 0), (0, 1), (1, 1), (1, -1)):
                b = self.cells.get((i + di, j + dj))
                if b is None:
                    continue
                bx, bz = self.points[b]
                if not game_map.segment_blocked((ax, 0.5, az), (bx, 0.5, bz), self.PAD, low_only=True):
                    self.links[a].append(b)
                    self.links[b].append(a)

    def _around(self, ci: int, cj: int, radius: int) -> list[int]:
        return [
            self.cells[(i, j)]
            for i in range(ci - radius, ci + radius + 1)
            for j in range(cj - radius, cj + radius + 1)
            if (i, j) in self.cells
        ]

    def nearest(self, x: float, z: float) -> int:
        """Ближайшая точка: ищем кольцами вокруг места в сетке, а не по всей карте."""
        ci, cj = round(x / self.STEP), round(z / self.STEP)
        distance = lambda n: (self.points[n][0] - x) ** 2 + (self.points[n][1] - z) ** 2  # noqa: E731
        for radius in range(self.reach):
            if self._around(ci, cj, radius):
                return min(self._around(ci, cj, radius + 1), key=distance)
        return min(range(len(self.points)), key=distance)

    def path(self, start: int, goal: int) -> list[tuple[float, float]]:
        """Кратчайший путь поиском в ширину."""
        prev = {start: None}
        queue = deque([start])
        while queue:
            node = queue.popleft()
            if node == goal:
                break
            for nxt in self.links[node]:
                if nxt not in prev:
                    prev[nxt] = node
                    queue.append(nxt)
        if goal not in prev:
            return []
        out = []
        node = goal
        while node is not None:
            out.append(self.points[node])
            node = prev[node]
        out.reverse()
        return out


class GameMap:
    def __init__(self, map_id, name, text, half_x, half_z, half_boxes, center_boxes, spawns,
                 sites, zone_x, marks, theme):
        s = MAP_SCALE
        half_x, half_z = half_x * s, half_z * s
        half_boxes = _scale_boxes(half_boxes, s)
        center_boxes = _scale_boxes(center_boxes, s)
        spawns = [(x * s, z * s) for x, z in spawns]
        sites = [{**site, "x": site["x"] * s, "z": site["z"] * s} for site in sites]
        zone_x *= s
        marks = {key: [[v * s for v in item] for item in items] for key, items in marks.items()}
        walls = _perimeter(half_x, half_z) + half_boxes + [_mirror(b) for b in half_boxes] + center_boxes
        rooms, self.closed_share = _rooms(map_id, half_x, half_z, walls, spawns, sites)
        walls += rooms + [_mirror(b) for b in rooms]
        half_boxes = half_boxes + rooms + _fill_cover(map_id, half_x, half_z, walls, spawns, sites)
        self.id = map_id
        self.name = name
        self.text = text
        self.half_x = half_x
        self.half_z = half_z
        self.boxes: list[Box] = (
            _perimeter(half_x, half_z) + half_boxes + [_mirror(b) for b in half_boxes] + center_boxes
        )
        self.spawns = {0: spawns, 1: [(-x, -z) for x, z in spawns]}
        self.spawn_yaw = {0: -math.pi / 2, 1: math.pi / 2}
        self.sites = sites
        self.zone_x = zone_x
        self.marks = marks
        self.theme = theme

    @cached_property
    def nav(self) -> NavGraph:
        return NavGraph(self)

    @cached_property
    def grid(self) -> dict[tuple[int, int], list[Box]]:
        """Какие коробки лежат в каждой клетке плана: перебирать все стены на каждый луч слишком долго."""
        grid: dict[tuple[int, int], list[Box]] = defaultdict(list)
        for box in self.boxes:
            for i in range(math.floor((box.minx - INDEX_PAD) / INDEX_CELL), math.floor((box.maxx + INDEX_PAD) / INDEX_CELL) + 1):
                for j in range(math.floor((box.minz - INDEX_PAD) / INDEX_CELL), math.floor((box.maxz + INDEX_PAD) / INDEX_CELL) + 1):
                    grid[(i, j)].append(box)
        return dict(grid)

    def _along_ray(self, o, d, tmax: float):
        """Идёт по клеткам вдоль луча и отдаёт время входа в клетку и коробки в ней."""
        i, j = math.floor(o[0] / INDEX_CELL), math.floor(o[2] / INDEX_CELL)
        step_i, step_j = 1 if d[0] > 0 else -1, 1 if d[2] > 0 else -1
        next_i = ((i + (step_i > 0)) * INDEX_CELL - o[0]) / d[0] if abs(d[0]) > EPS else math.inf
        next_j = ((j + (step_j > 0)) * INDEX_CELL - o[2]) / d[2] if abs(d[2]) > EPS else math.inf
        delta_i = INDEX_CELL / abs(d[0]) if abs(d[0]) > EPS else math.inf
        delta_j = INDEX_CELL / abs(d[2]) if abs(d[2]) > EPS else math.inf
        t = 0.0
        while t <= tmax:
            yield t, self.grid.get((i, j), ())
            if next_i < next_j:
                t, next_i, i = next_i, next_i + delta_i, i + step_i
            else:
                t, next_j, j = next_j, next_j + delta_j, j + step_j

    def raycast(self, o, d, tmax: float) -> float:
        """Расстояние до ближайшей стены или земли (не больше tmax)."""
        best = tmax
        if d[1] < -EPS:
            best = min(best, -o[1] / d[1])
        for entered, boxes in self._along_ray(o, d, tmax):
            if entered > best:
                break
            for b in boxes:
                t = ray_box(o, d, b, best)
                if t is not None and t < best:
                    best = t
        return best

    def segment_blocked(self, a, b, pad: float = 0.0, low_only: bool = False) -> bool:
        """Есть ли коробка между точками a и b."""
        delta = (b[0] - a[0], b[1] - a[1], b[2] - a[2])
        groups = [self.boxes] if pad > INDEX_PAD else (cell for _, cell in self._along_ray(a, delta, 1.0))
        for boxes in groups:
            for box in boxes:
                if low_only and box.miny > 1.8:
                    continue
                if ray_box(a, delta, box, 1.0, pad) is not None:
                    return True
        return False

    def point_inside(self, x, y, z, pad: float = 0.0) -> bool:
        boxes = self.boxes if pad > INDEX_PAD else self.grid.get((math.floor(x / INDEX_CELL), math.floor(z / INDEX_CELL)), ())
        return any(
            b.minx - pad < x < b.maxx + pad and b.miny < y < b.maxy and b.minz - pad < z < b.maxz + pad
            for b in boxes
        )

    def site_at(self, x: float, z: float):
        for site in self.sites:
            if math.hypot(x - site["x"], z - site["z"]) <= SITE_RADIUS:
                return site
        return None

    def payload(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "halfX": self.half_x,
            "halfZ": self.half_z,
            "boxes": [b.to_dict() for b in self.boxes],
            "sites": self.sites,
            "siteRadius": SITE_RADIUS,
            "zoneX": self.zone_x,
            "marks": self.marks,
            "theme": self.theme,
        }


def _spawn_column(x1, x2, zs):
    return [(x1 if i % 2 == 0 else x2, z) for i, z in enumerate(zs)]


DEPOT = GameMap(
    "depot", "Депо", "Средняя карта: ангар в центре и контейнеры по бокам.",
    32.0, 22.0,
    [
        # Центральный ангар с четырьмя проходами
        _box(-5.5, -7, 7, 0.8, 3.6),
        _box(5.5, -7, 7, 0.8, 3.6),
        _box(0, -7, 4, 0.8, 1.1, y0=2.5),
        _box(-9, -4.5, 0.8, 5, 3.6),
        _box(-9, 4.5, 0.8, 5, 3.6),
        _box(-9, 0, 0.8, 4, 1.1, y0=2.5),
        _box(-5, -3.5, 1.6, 1.6, 0.9, "crate"),
        _box(-4.5, 3.5, 1.4, 1.4, 0.9, "crate"),
        # Северный проход
        _box(-14, -13, 6, 2.6, 2.6, "container"),
        _box(-17.8, -13, 1.6, 1.6, 1.8, "crate"),  # по этим ящикам можно залезть на контейнер
        _box(-19.4, -13, 1.6, 1.6, 0.9, "crate"),
        _box(4, -14, 6, 2.6, 2.6, "container"),
        _box(-6, -11.5, 1.6, 1.6, 0.9, "crate"),
        _box(12, -17, 1.6, 1.6, 0.9, "crate"),
        _box(13.7, -17, 1.6, 1.6, 1.8, "crate"),
        _box(20, -14, 0.8, 8, 3.2),
        # Укрытия у баз
        _box(-22, -11, 0.8, 8, 3.2),
        _box(-22, 3, 0.8, 10, 3.2),
        _box(-15, 0, 0.8, 6, 1.25, "concrete"),
    ],
    [_box(0, 0, 2.4, 2.4, 1.8, "crate")],
    [(-28.0 + (i % 2) * 3.0, -12.0 + i * 4.0) for i in range(7)]
    + [(-30.5, -16.0), (-30.5, 16.0), (-25.0, -18.0), (-25.0, 18.0)],
    [{"id": "A", "x": 15.0, "z": 7.0}, {"id": "B", "x": 14.0, "z": -12.0}],
    22.4,
    {"lines": [[-21, -17, 21, -17], [-21, 17, 21, 17]], "rects": [[-9, -7, 18, 14]]},
    {
        "ground": "#4d4f4c", "fog": "#bfcfd6", "tint": "#ffffff",
        "sky": ["#3f75b0", "#a9c9dc", "#f0dcb8", "#6d6a62"],
        "hemi": ["#e6eeff", "#8a8170", 2.5], "sun": ["#fff0d8", 1.45],
    },
)

HARBOR = GameMap(
    "harbor", "Гавань", "Большая карта: длинные линии между контейнерами, для снайперов.",
    38.0, 24.0,
    [
        _box(-27, -14, 2.6, 8, 2.6, "container"),
        _box(-27, 8, 2.6, 10, 2.6, "container"),
        _box(-16, -19, 10, 2.6, 2.6, "container"),
        _box(-16, -8, 10, 2.6, 2.6, "container"),
        _box(-16, -8, 6, 2.6, 2.6, "container", y0=2.6),
        _box(-10, -12.5, 1.6, 1.6, 0.9, "crate"),
        _box(-10, -14.2, 1.6, 1.6, 1.8, "crate"),
        _box(-4, -19, 8, 2.6, 2.6, "container"),
        _box(-3, -3, 0.8, 8, 3.4),
        _box(-14, 10, 2.6, 10, 2.6, "container"),
        _box(-21, 0, 0.8, 6, 1.25, "concrete"),
        _box(-8, 3, 6, 0.8, 1.25, "concrete"),
        _box(-7, 9, 1.6, 1.6, 0.9, "crate"),
        _box(-2, 11, 8, 2.6, 2.6, "container"),
    ],
    [_box(0, 0, 2.4, 2.4, 1.8, "crate")],
    _spawn_column(-35.0, -32.0, [-20.0, -15.0, -10.0, -5.0, 0.0, 5.0, 10.0, 15.0, 20.0])
    + [(-36.0, -2.5), (-36.0, 2.5)],
    [{"id": "A", "x": 20.0, "z": 13.0}, {"id": "B", "x": 8.5, "z": -14.5}],
    30.0,
    {"lines": [[-29, 22, 29, 22], [-29, -22, 29, -22], [0, -6, 0, 6]], "rects": []},
    {
        "ground": "#585c5e", "fog": "#cbe1ec", "tint": "#e4eef5",
        "sky": ["#2f7fc4", "#9fd2ec", "#e9f4f4", "#5d7078"],
        "hemi": ["#e8f4ff", "#7f8a8c", 2.6], "sun": ["#fffaf0", 1.5],
    },
)

FACTORY = GameMap(
    "factory", "Цех", "Маленькая карта: тесные помещения и ближний бой.",
    26.0, 18.0,
    [
        _box(-18, -12, 0.8, 12, 3.6),
        _box(-18, 7, 0.8, 14, 3.6),
        _box(-18, -3, 0.8, 6, 1.1, y0=2.5),
        _box(-10, -13, 0.8, 10, 3.6),
        _box(-10, 3, 0.8, 10, 3.6),
        _box(-14, 2, 5, 0.8, 3.6),
        _box(-14, -12, 3, 3, 1.25, "concrete"),
        _box(-14, -8, 1.6, 1.6, 0.9, "crate"),
        _box(-14, 12, 5, 2.6, 2.6, "container"),
        _box(-4, -8, 7, 0.8, 3.6),
        _box(-4, 9, 7, 0.8, 3.6),
        _box(-5, -13, 1.6, 1.6, 0.9, "crate"),
        _box(-3.4, -13, 1.6, 1.6, 1.8, "crate"),
        _box(-5, 2, 0.8, 5, 1.25, "concrete"),
    ],
    [_box(0, 0, 3, 3, 1.25, "concrete")],
    _spawn_column(-23.5, -21.0, [-15.0, -11.0, -7.0, -3.0, 1.0, 5.0, 9.0, 13.0])
    + [(-24.5, -9.0), (-24.5, 3.0), (-24.5, 15.0)],
    [{"id": "A", "x": 14.0, "z": 3.0}, {"id": "B", "x": 5.0, "z": -13.5}],
    18.4,
    {"lines": [[-9, -16, 9, -16], [-9, 16, 9, 16]], "rects": [[-2.5, -2.5, 5, 5]]},
    {
        "ground": "#524a44", "fog": "#d7a98c", "tint": "#f4d9c2",
        "sky": ["#2b2440", "#a0556a", "#f2a65e", "#3d3330"],
        "hemi": ["#ffd9c0", "#6d5a50", 2.3], "sun": ["#ffb878", 1.7],
    },
)

OASIS = GameMap(
    "oasis", "Оазис", "Глиняный посёлок в пустыне: дворы, переулки и мешки с песком.",
    30.0, 22.0,
    [
        _box(-19, -14, 8, 0.8, 3.4, "plaster"),
        _box(-15.4, -17.5, 0.8, 7, 3.4, "plaster"),
        _box(-8, -8, 0.8, 8, 3.0, "plaster"),
        _box(-11, -4, 6, 0.8, 3.0, "plaster"),
        _box(-20, 6, 0.8, 10, 3.4, "plaster"),
        _box(-16, 11, 8, 0.8, 3.4, "plaster"),
        _box(-6, 15, 5, 4, 3.0, "brick"),
        _box(-12, 2, 3, 0.9, 1.0, "sandbag"),
        _box(-4, -14, 0.9, 3, 1.0, "sandbag"),
        _box(-9, 8, 0.9, 0.9, 1.2, "barrel"),
        _box(-21, -4, 0.9, 0.9, 1.2, "barrel"),
        _box(-14, -9, 1.6, 1.6, 0.9, "crate"),
    ],
    [_box(0, 0, 3, 3, 1.1, "brick")],
    _spawn_column(-27.0, -24.5, [-18.0, -14.0, -10.0, -6.0, -2.0, 2.0, 6.0, 10.0, 14.0, 18.0]),
    [{"id": "A", "x": 17.0, "z": 9.0}, {"id": "B", "x": 14.0, "z": -16.0}],
    23.4,
    {"lines": [[-22, 19, 22, 19], [-22, -19, 22, -19]], "rects": [[-3, -3, 6, 6]]},
    {
        "ground": "#c4a06a", "fog": "#f0dcc0", "tint": "#f6e3c2",
        "sky": ["#3c8ad0", "#a8d4f0", "#f8e8c8", "#9a8060"],
        "hemi": ["#fff1dc", "#b8955c", 2.5], "sun": ["#fff1d0", 1.6],
    },
)

PASS = GameMap(
    "pass", "Перевал", "Заснеженная горная база: стальные ангары и открытые линии.",
    30.0, 20.0,
    [
        _box(-18, -8, 0.8, 10, 3.2, "metal"),
        _box(-18, 9, 0.8, 8, 3.2, "metal"),
        _box(-10, -14, 8, 0.8, 3.0, "metal"),
        _box(-12, 0, 2.6, 6, 2.6, "container"),
        _box(-5, 8, 6, 0.8, 1.25, "concrete"),
        _box(-6, -6, 1.6, 1.6, 0.9, "crate"),
        _box(-7.6, -6, 1.6, 1.6, 1.8, "crate"),
        _box(-21, -16, 3, 0.9, 1.0, "sandbag"),
        _box(-3, -15, 0.9, 0.9, 1.2, "barrel"),
    ],
    [_box(0, 0, 2, 4, 1.25, "concrete")],
    _spawn_column(-26.5, -24.0, [-16.0, -12.0, -8.0, -4.0, 0.0, 4.0, 8.0, 12.0, 16.0]),
    [{"id": "A", "x": 14.0, "z": 8.0}, {"id": "B", "x": 10.0, "z": -14.0}],
    21.4,
    {"lines": [[-17, 17, 17, 17], [-17, -17, 17, -17]], "rects": []},
    {
        "ground": "#dde4ea", "fog": "#dfe8f0", "tint": "#e6eef6",
        "sky": ["#5d86b8", "#c4d6e8", "#eef3f7", "#9aa6b0"],
        "hemi": ["#eef4ff", "#9fb0c0", 2.4], "sun": ["#fff6ea", 1.4],
    },
)

MARKET = GameMap(
    "market", "Рынок", "Тесные улочки старого города: кирпичные дома и прилавки.",
    28.0, 20.0,
    [
        _box(-17, -11, 6, 6, 4.0, "brick"),
        _box(-17, 9, 6, 7, 4.0, "brick"),
        _box(-8, -14, 5, 4, 3.5, "plaster"),
        _box(-8, 12, 5, 4, 3.5, "plaster"),
        _box(-9, -3, 3, 1.6, 1.1, "crate"),
        _box(-5, 3, 3, 1.6, 1.1, "crate"),
        _box(-12, 0, 0.8, 5, 2.4, "brick"),
        _box(-3, -8, 0.9, 0.9, 1.2, "barrel"),
        _box(-14, -3.5, 0.9, 0.9, 1.2, "barrel"),
    ],
    [_box(0, 0, 2.6, 2.6, 1.0, "plaster")],
    _spawn_column(-25.0, -23.0, [-16.0, -12.0, -8.0, -4.0, 0.0, 4.0, 8.0, 12.0, 16.0]),
    [{"id": "A", "x": 17.0, "z": 1.0}, {"id": "B", "x": 2.0, "z": -16.0}],
    21.0,
    {"lines": [[-11, 17.5, 11, 17.5], [-11, -17.5, 11, -17.5]], "rects": [[-2, -2, 4, 4]]},
    {
        "ground": "#6a5e54", "fog": "#d8c6b0", "tint": "#ffe9d0",
        "sky": ["#4a7fc0", "#b4d0e6", "#f6e0c0", "#7a6a5a"],
        "hemi": ["#ffeedd", "#8a7060", 2.4], "sun": ["#ffe2b8", 1.6],
    },
)

PIT = GameMap(
    "pit", "Котлован", "Стройка: бетонные стены, трубы и строительные леса.",
    30.0, 22.0,
    [
        _box(-16, -10, 10, 0.8, 2.8, "concrete"),
        _box(-16, 10, 10, 0.8, 2.8, "concrete"),
        _box(-8, 0, 0.8, 10, 2.2, "metal"),
        _box(-14, -1, 6, 0.9, 0.9, "metal"),  # трубы: через них можно перепрыгнуть
        _box(-4, -14, 4, 4, 1.8, "crate"),
        _box(-4, 15, 3, 3, 2.6, "container"),
        _box(-12, 6, 0.9, 0.9, 1.2, "barrel"),
        _box(-20, -4, 0.9, 0.9, 1.2, "barrel"),
    ],
    [_box(0, 0, 4, 1.2, 1.2, "concrete")],
    _spawn_column(-26.0, -23.5, [-18.0, -14.0, -10.0, -6.0, -2.0, 2.0, 6.0, 10.0, 14.0, 18.0]),
    [{"id": "A", "x": 15.0, "z": 4.0}, {"id": "B", "x": 13.0, "z": -14.0}],
    22.0,
    {"lines": [[-20, 19, 20, 19], [-20, -19, 20, -19]], "rects": [[-3, -2, 6, 4]]},
    {
        "ground": "#7a6650", "fog": "#cfc3b0", "tint": "#f0e6d8",
        "sky": ["#3f74ad", "#aac6dc", "#eadcc6", "#6e6458"],
        "hemi": ["#fff0dc", "#7d6a52", 2.4], "sun": ["#fff0d4", 1.6],
    },
)

TERMINAL = GameMap(
    "terminal", "Терминал", "Контейнерный терминал на закате: штабеля и узкие проходы.",
    32.0, 20.0,
    [
        _box(-20, -12, 2.6, 8, 2.6, "container"),
        _box(-20, 10, 2.6, 8, 2.6, "container"),
        _box(-12, -4, 8, 2.6, 2.6, "container"),
        _box(-12, -4, 6, 2.6, 2.6, "container", y0=2.6),
        _box(-6, 12, 8, 2.6, 2.6, "container"),
        _box(-6, -15, 2.6, 6, 2.6, "container"),
        _box(-14, 4, 1.6, 1.6, 0.9, "crate"),
        _box(-15.6, 4, 1.6, 1.6, 1.8, "crate"),
        _box(-3, 4, 0.8, 5, 1.25, "concrete"),
    ],
    [_box(0, 0, 2.4, 2.4, 1.8, "crate")],
    _spawn_column(-28.0, -25.5, [-16.0, -12.0, -8.0, -4.0, 0.0, 4.0, 8.0, 12.0, 16.0]),
    [{"id": "A", "x": 15.5, "z": 9.5}, {"id": "B", "x": 13.0, "z": -14.0}],
    23.0,
    {"lines": [[-22, 17.5, 22, 17.5], [-22, -17.5, 22, -17.5]], "rects": []},
    {
        "ground": "#55595c", "fog": "#d8b8a8", "tint": "#f2e4dc",
        "sky": ["#1f2a4a", "#6a5a8a", "#f0a070", "#3a3440"],
        "hemi": ["#ffd2b8", "#5a5060", 2.2], "sun": ["#ffb070", 1.9],
    },
)

MAPS = {m.id: m for m in (DEPOT, HARBOR, FACTORY, OASIS, PASS, MARKET, PIT, TERMINAL)}
