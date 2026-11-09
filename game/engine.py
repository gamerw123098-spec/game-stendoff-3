"""Правила игры. Здесь нет сети: всё тестируется вызовами с явным временем `now`.

Сервер главный: он хранит здоровье и патроны, считает выстрелы и проверяет
перемещения. Клиент только рисует и присылает, что делает игрок.
"""
from __future__ import annotations

import math
import random
from collections import deque
from dataclasses import dataclass, field

from . import bots, skins, world

TICK = 1 / 20
MAX_PLAYERS = 16
MOVE_SPEED = 5.5
EYE_STAND = 1.65
EYE_CROUCH = 1.15
RESPAWN_DELAY = 3.0
SPAWN_PROTECTION = 1.5
LAG_WINDOW = 0.3

FREEZE_TIME = 3.0
ROUND_TIME = 125.0  # карты большие: нужно успеть дойти до точки
ROUND_END_TIME = 4.0
MATCH_END_TIME = 10.0

BUY_TIME = 20.0
MAX_MONEY = 16000
ROUND_WIN_MONEY = 3000
ROUND_LOSS_MONEY = 1900
RESPAWN_BONUS = 300
KILL_MULTIPLIER = 2  # в режимах с возрождением
OBJECTIVE_MONEY = 300

# Режимы. target: (по умолчанию, минимум, максимум).
MODES = {
    "tdm": {"name": "Командный бой", "respawn": True, "rounds": False, "ffa": False, "shop": True,
            "target": (30, 5, 100), "money": 3000, "time": 300.0,
            "text": "Возрождение через 3 секунды. Побеждает команда, набравшая нужное число убийств."},
    "rounds": {"name": "Раунды", "respawn": False, "rounds": True, "ffa": False, "shop": True,
               "target": (5, 1, 15), "money": 800, "time": 0.0,
               "text": "Одна жизнь на раунд. Выигрывает команда, в которой кто-то выжил."},
    "defuse": {"name": "Обезвреживание", "respawn": False, "rounds": True, "ffa": False, "shop": True,
               "target": (5, 1, 15), "money": 800, "time": 0.0,
               "text": "Одна команда закладывает бомбу на точке A или B, другая защищает и обезвреживает."},
    "ffa": {"name": "Каждый за себя", "respawn": True, "rounds": False, "ffa": True, "shop": True,
            "target": (20, 5, 100), "money": 3000, "time": 300.0,
            "text": "Все против всех. Побеждает тот, кто первым наберёт нужное число убийств."},
    "gungame": {"name": "Гонка вооружений", "respawn": True, "rounds": False, "ffa": True, "shop": False,
                "target": None, "money": 0, "time": 480.0,
                "text": "Каждое убийство даёт новое оружие. Побеждает тот, кто убьёт ножом."},
}

CATEGORIES = {
    "pistol": "Пистолеты", "smg": "Пистолеты-пулемёты", "shotgun": "Дробовики",
    "rifle": "Автоматы", "sniper": "Снайперские винтовки", "mg": "Пулемёты", "knife": "Ножи",
}


def _weapon(name, cat, price, reward, dmg, head, interval, mag, reload, spread, ads, *, auto=False,
            speed=1.0, heat=0.0, kick=0.0, zoom=1.3, sight="iron", pellets=1, falloff=None,
            weapon_range=200.0, quiet=False):
    """Параметры одного оружия.

    spread разброс от бедра, ads разброс при прицеливании (правая кнопка мыши),
    zoom во сколько раз приближает прицел, sight вид прицела на модели.
    pellets дробинок за выстрел, falloff (с какого расстояния урон падает, до какого, во сколько раз).
    """
    slot = {"pistol": "secondary", "knife": "melee", "bomb": "bomb"}.get(cat, "primary")
    return {
        "name": name, "cat": cat, "slot": slot, "price": price, "reward": reward,
        "dmg": dmg, "head": head, "interval": interval, "mag": mag, "reload": reload,
        "spread": spread, "scoped": ads, "range": weapon_range, "auto": auto, "speed": speed,
        "heat": heat, "kick": kick, "zoom": zoom, "sight": sight, "pellets": pellets,
        "falloff": falloff, "quiet": quiet,
    }


WEAPONS = {
    # Пистолеты
    "pistol": _weapon("Пистолет «Искра»", "pistol", 0, 300, 30, 2.5, 0.22, 12, 1.4, 0.006, 0.004,
                      speed=1.05, heat=0.003, kick=0.007, zoom=1.2),
    "tac_pistol": _weapon("Пистолет «Клык» с глушителем", "pistol", 300, 300, 34, 2.5, 0.25, 10, 1.5,
                          0.005, 0.003, speed=1.05, heat=0.003, kick=0.006, zoom=1.2, quiet=True),
    "auto_pistol": _weapon("Автопистолет «Шмель»", "pistol", 500, 300, 19, 2.2, 0.075, 18, 1.6,
                           0.016, 0.011, auto=True, speed=1.05, heat=0.002, kick=0.004, zoom=1.2),
    "magnum": _weapon("Револьвер «Молот»", "pistol", 700, 300, 52, 2.5, 0.4, 7, 2.2, 0.006, 0.004,
                      heat=0.006, kick=0.014, zoom=1.25),
    "heavy_pistol": _weapon("Пистолет «Кувалда»", "pistol", 800, 300, 48, 2.4, 0.32, 7, 2.0, 0.008,
                            0.004, heat=0.006, kick=0.016, zoom=1.25),
    # Пистолеты-пулемёты
    "smg": _weapon("Пистолет-пулемёт «Оса»", "smg", 1250, 600, 18, 2.2, 0.075, 30, 2.1, 0.014, 0.009,
                   auto=True, speed=1.08, heat=0.0016, kick=0.0025, zoom=1.3),
    "smg2": _weapon("Пистолет-пулемёт «Вьюга»", "smg", 1500, 600, 21, 2.2, 0.085, 32, 2.2, 0.012,
                    0.007, auto=True, speed=1.06, heat=0.0016, kick=0.003, zoom=1.4, sight="dot"),
    "pdw": _weapon("Пистолет-пулемёт «Стриж»", "smg", 1700, 600, 20, 2.2, 0.062, 45, 2.6, 0.013,
                   0.008, auto=True, speed=1.04, heat=0.0015, kick=0.0028, zoom=1.4, sight="holo"),
    # Дробовики: восемь дробинок, урон падает с расстоянием
    "shotgun": _weapon("Дробовик «Гром»", "shotgun", 1100, 900, 14, 1.5, 0.9, 6, 3.0, 0.055, 0.045,
                       kick=0.03, zoom=1.15, pellets=8, falloff=(6.0, 20.0, 0.25), weapon_range=40.0),
    "auto_shotgun": _weapon("Дробовик «Шторм»", "shotgun", 2000, 900, 13, 1.5, 0.3, 8, 3.2, 0.06,
                            0.05, speed=0.97, kick=0.025, zoom=1.15, pellets=6,
                            falloff=(5.0, 18.0, 0.25), weapon_range=40.0),
    # Автоматы
    "rifle": _weapon("Автомат «Шквал»", "rifle", 2700, 300, 24, 2.5, 0.1, 30, 2.2, 0.009, 0.006,
                     auto=True, heat=0.0022, kick=0.004, zoom=1.4),
    "bullpup": _weapon("Автомат «Ястреб»", "rifle", 2900, 300, 25, 2.5, 0.095, 30, 2.4, 0.008, 0.005,
                       auto=True, speed=0.98, heat=0.002, kick=0.0042, zoom=1.6, sight="holo"),
    "carbine": _weapon("Карабин «Буран»", "rifle", 3100, 300, 28, 2.5, 0.12, 25, 2.4, 0.007, 0.004,
                       auto=True, speed=0.96, heat=0.002, kick=0.005, zoom=1.5, sight="dot"),
    "battle": _weapon("Винтовка «Тайфун»", "rifle", 3400, 300, 33, 2.4, 0.14, 20, 2.6, 0.01, 0.003,
                      auto=True, speed=0.95, heat=0.0025, kick=0.007, zoom=2.2, sight="scope2"),
    # Снайперские винтовки
    "dmr": _weapon("Полуавтомат «Сова»", "sniper", 3800, 300, 62, 2.2, 0.35, 10, 2.7, 0.04, 0.001,
                   speed=0.92, heat=0.004, kick=0.018, zoom=3.5, sight="scope"),
    "sniper": _weapon("Винтовка «Гвоздь»", "sniper", 4750, 100, 85, 2.0, 1.25, 5, 2.8, 0.05, 0.0003,
                      speed=0.88, kick=0.025, zoom=4.0, sight="scope", weapon_range=300.0),
    "heavy_sniper": _weapon("Винтовка «Молния»", "sniper", 5500, 100, 115, 2.0, 1.6, 5, 3.4, 0.06,
                            0.0002, speed=0.82, kick=0.035, zoom=5.0, sight="scope",
                            weapon_range=300.0),
    # Пулемёт
    "lmg": _weapon("Пулемёт «Бульдог»", "mg", 5000, 300, 26, 2.3, 0.085, 100, 4.6, 0.016, 0.009,
                   auto=True, speed=0.84, heat=0.0018, kick=0.0045, zoom=1.4),
    # Нож
    "knife": _weapon("Нож", "knife", 0, 1500, 50, 2.0, 0.55, 0, 0.0, 0.0, 0.0, auto=True, speed=1.1,
                     zoom=1.0, sight="none", weapon_range=2.4),
    # Бомба террористов: её не купить, она лежит в инвентаре у того, кто её несёт.
    "bomb": _weapon("Бомба", "bomb", 0, 0, 0, 1.0, 1.0, 0, 0.0, 0.0, 0.0, zoom=1.0, sight="none",
                    weapon_range=0.0),
}
WEAPON_ORDER = list(WEAPONS)
ARMOR_ITEMS = {
    "vest": {"name": "Бронежилет", "price": 650, "level": 1, "text": "Урон по телу на 30% меньше"},
    "helmet": {"name": "Жилет и шлем", "price": 1000, "level": 2, "text": "Защищает тело и голову"},
}
ARMOR_BODY = 0.7
ARMOR_HEAD = 0.6

GRENADES = {
    "he": {"name": "Осколочная граната", "price": 300, "max": 1, "key": "G", "fuse": 1.6,
           "text": "Сильный урон вокруг взрыва"},
    "flash": {"name": "Светошумовая граната", "price": 200, "max": 2, "key": "F", "fuse": 1.4,
              "text": "Ослепляет всех, кто смотрит на неё"},
    "smoke": {"name": "Дымовая граната", "price": 300, "max": 1, "key": "C", "fuse": 1.8,
              "text": "Густой дым на 16 секунд"},
}
KIT_PRICE = 400
THROW_SPEED = 16.0
THROW_COOLDOWN = 0.8
GRENADE_GRAVITY = 14.0
HE_RADIUS = 6.5
HE_DAMAGE = 95
HE_REWARD = 300
FLASH_RADIUS = 25.0
SMOKE_RADIUS = 4.2
SMOKE_TIME = 16.0

PLANT_TIME = 3.0
DEFUSE_TIME = 6.0
DEFUSE_TIME_KIT = 3.0
DEFUSE_RANGE = 2.0
BOMB_TIME = 40.0
BOMB_PICKUP_RANGE = 1.6
BOMB_RADIUS = 14.0
BOMB_DAMAGE = 200

GUNGAME_LADDER = ["pdw", "auto_shotgun", "bullpup", "rifle", "battle", "lmg", "dmr", "sniper",
                  "heavy_pistol", "pistol", "knife"]


def damage_multiplier(weapon: dict, distance: float) -> float:
    """Урон дроби падает с расстоянием: вплотную полный, издалека почти никакой."""
    falloff = weapon.get("falloff")
    if not falloff:
        return 1.0
    start, end, minimum = falloff
    if distance <= start:
        return 1.0
    if distance >= end:
        return minimum
    return 1.0 - (1.0 - minimum) * (distance - start) / (end - start)

# Команда 0 — террористы: появляются на западе и закладывают бомбу. Команда 1 — антитеррористы.
TEAM_NAMES = ["Террористы", "Антитеррористы"]

# Спреи: рисунки на стенах и земле. Остаются до смены карты.
SPRAYS = ["smile", "heart", "skull", "crown", "bolt", "star", "gg", "fire", "cat", "ghost", "eye",
          "rocket", "pizza", "cactus", "target",
          "sun", "moon", "rainbow", "flower", "mushroom", "snowflake", "watermelon", "donut", "icecream", "burger",
          "frog", "duck", "paw", "robot", "alien", "ufo", "bomb", "shuriken", "shield", "diamond", "music", "dice",
          "gamepad", "rip", "ez", "wow", "lol", "e404", "five", "name"]
SPRAY_RANGE = 6.0
SPRAY_COOLDOWN = 0.25
MAX_SPRAYS = 1500
SPRAY_SIZE = (0.3, 1.1)  # на узкой стене или бочке рисунок меньше, чтобы не висел в воздухе
BOT_NAMES = ["Гром", "Вихрь", "Ржавый", "Сокол", "Кактус", "Болт", "Тень", "Пиксель"]


def _num(value):
    """Число из сообщения клиента или None (JSON допускает NaN и Infinity)."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value) if math.isfinite(value) else None


def clean_name(value) -> str:
    name = " ".join(str(value or "").split())[:16]
    return name or "Игрок"


def direction(yaw: float, pitch: float):
    cp = math.cos(pitch)
    return (-math.sin(yaw) * cp, math.sin(pitch), -math.cos(yaw) * cp)


def eye_height(crouch: bool) -> float:
    return EYE_CROUCH if crouch else EYE_STAND


def hitboxes(x, y, z, crouch):
    """Хитбоксы тела и головы."""
    top = 1.3 if crouch else 1.8
    neck = top - 0.36
    body = world.Box(x - 0.32, x + 0.32, y, y + neck, z - 0.32, z + 0.32)
    head = world.Box(x - 0.2, x + 0.2, y + neck, y + top, z - 0.2, z + 0.2)
    return body, head


@dataclass
class Player:
    id: int
    name: str
    team: int
    channel: str | None = None
    is_bot: bool = False
    x: float = 0.0
    y: float = 0.0
    z: float = 0.0
    yaw: float = 0.0
    pitch: float = 0.0
    crouch: bool = False
    hp: int = 100
    alive: bool = False
    life: int = 0
    weapon: str = "pistol"
    primary: str | None = None
    secondary: str | None = "pistol"
    armor: int = 0
    money: int = 0
    buy_until: float = 0.0
    fresh: bool = False  # только что появился и ещё не двигался
    grenades: dict = field(default_factory=dict)
    next_throw: float = 0.0
    kit: bool = False
    level: int = 0  # ступень в гонке вооружений
    using: bool = False  # удерживает клавишу действия
    act_kind: int = 0  # 0 ничего, 1 закладка, 2 обезвреживание
    act_start: float = 0.0
    act_total: float = 0.0
    profile_id: int | None = None
    skins: dict = field(default_factory=dict)
    ammo: dict = field(default_factory=dict)
    reload_until: float = 0.0
    next_shot: float = 0.0
    heat: float = 0.0
    speed: float = 0.0
    kills: int = 0
    deaths: int = 0
    respawn_at: float | None = None
    protected_until: float = 0.0
    last_pos_t: float = 0.0
    rejects: int = 0
    ai: dict = field(default_factory=dict)
    # Статистика матча для экрана результатов
    shots: int = 0
    hits: int = 0
    hs_kills: int = 0
    damage: int = 0
    assists: int = 0
    plants: int = 0
    defuses: int = 0
    damage_from: dict = field(default_factory=dict)  # кто сколько урона нанёс за эту жизнь

    def reset_stats(self):
        self.kills = self.deaths = 0
        self.shots = self.hits = self.hs_kills = self.damage = 0
        self.assists = self.plants = self.defuses = 0
        self.damage_from = {}

    def eye(self):
        return (self.x, self.y + eye_height(self.crouch), self.z)


@dataclass
class Grenade:
    id: int
    kind: str
    owner: int
    x: float
    y: float
    z: float
    vx: float
    vy: float
    vz: float
    explode_at: float


@dataclass
class Bomb:
    x: float
    y: float
    z: float
    carrier: int | None = None
    planted: bool = False
    site: str = ""
    explode_at: float = 0.0


ASSIST_DAMAGE = 30


class Room:
    def __init__(self, code: str, mode: str = "tdm", target: int | None = None, now: float = 0.0,
                 map_id: str = "depot", lobby: bool = False):
        self.code = code
        self._configure(mode, map_id, target)
        # С комнатой ожидания матч начинает ведущий, а после матча все остаются на экране итогов.
        self.use_lobby = lobby
        self.host_id: int | None = None
        self.results: dict | None = None
        # Растёт при каждом важном событии. Снимок состояния несёт это число, и игрок,
        # пропустивший событие, видит отставание и сам просит полную картину.
        self.version = 0
        self.players: dict[int, Player] = {}
        self.scores = [0, 0]
        self.round = 0
        self.phase = ""
        self.phase_until = 0.0
        self.winner = -1
        self.champion = ""
        # Атакуют всегда террористы (команда 0). В середине матча игроки меняются командами.
        self.attackers = 0
        self.bomb: Bomb | None = None
        self.sprays: list[list] = []
        self._next_spray = 1
        self.grenades: list[Grenade] = []
        self.smokes: list[dict] = []
        self.history: deque = deque()
        self.outbox: list = []
        self.pending_rewards: list[tuple[int, int]] = []  # (id игрока, id профиля)
        self._next_id = 1
        self._next_grenade = 1
        self._last_tick = now
        self.created_at = now
        if lobby:
            self._set_phase("lobby", 0.0, now)
        elif self.cfg["rounds"]:
            self._set_phase("warmup", 0.0, now)
        else:
            self._set_phase("live", self.cfg["time"], now)

    def _configure(self, mode, map_id, target):
        # Значения могут прийти от клиента, поэтому чужие типы просто заменяются на обычные.
        self.mode = mode if isinstance(mode, str) and mode in MODES else "tdm"
        self.cfg = MODES[self.mode]
        old_map = getattr(self, "map", None)
        self.map = world.MAPS.get(map_id, world.DEPOT) if isinstance(map_id, str) else world.DEPOT
        if self.map is not old_map:
            self.sprays = []
        limits = self.cfg["target"]
        if limits is None:
            self.target = len(GUNGAME_LADDER)
        else:
            if isinstance(target, bool) or not isinstance(target, int):
                target = None
            self.target = max(limits[1], min(limits[2], target)) if target else limits[0]

    # ---------- Ведущий и комната ожидания ----------
    def _assign_host(self):
        if self.host_id in self.players and not self.players[self.host_id].is_bot:
            return
        humans = [p.id for p in self.players.values() if not p.is_bot]
        self.host_id = min(humans) if humans else None

    def _is_host(self, p: Player) -> bool:
        return self.host_id is None or p.id == self.host_id

    def settings_payload(self) -> dict:
        return {
            "mode": self.mode,
            "modeName": self.cfg["name"],
            "modeText": self.cfg["text"],
            "flags": {"respawn": self.cfg["respawn"], "rounds": self.cfg["rounds"],
                      "ffa": self.cfg["ffa"], "shop": self.cfg["shop"]},
            "target": self.target,
            "world": self.map.payload(),
            "buyTime": BUY_TIME if self.cfg["shop"] else 0,
        }

    def change_settings(self, p: Player, msg: dict, now: float):
        """Ведущий меняет режим, карту или цель, пока матч не идёт."""
        if not self._is_host(p) or self.phase not in ("lobby", "end"):
            return
        target = msg.get("target")
        was_ffa = self.cfg["ffa"]
        self._configure(msg.get("mode", self.mode), msg.get("map", self.map.id), target)
        if was_ffa and not self.cfg["ffa"]:
            # Из режима «все против всех» команды нужно разделить заново.
            for index, player in enumerate(sorted(self.players.values(), key=lambda q: q.id)):
                player.team = index % 2
        elif self.cfg["ffa"]:
            for player in self.players.values():
                player.team = 0
        self.results = None
        self.phase = "lobby"
        for player in self.players.values():
            self._reset_economy(player)
            self._place_at_spawn(player)
        self.version += 1
        self._emit({"t": "settings", **self.settings_payload(), "v": self.version})
        self._set_phase("lobby", 0.0, now)
        self._emit_roster()

    def start_match(self, p: Player, now: float):
        if not self._is_host(p) or self.phase not in ("lobby", "end"):
            return
        self.results = None
        self._reset_match(now)

    def back_to_lobby(self, p: Player, now: float):
        if not self._is_host(p) or self.phase != "end":
            return
        self.results = None
        self._set_phase("lobby", 0.0, now)

    # ---------- Сообщения ----------
    def _emit(self, msg: dict, channel: str | None = None):
        self.outbox.append((channel, msg))

    def drain(self) -> list:
        out, self.outbox = self.outbox, []
        return out

    def _roster_payload(self) -> dict:
        return {
            "t": "roster",
            "players": [
                {"id": p.id, "name": p.name, "team": p.team, "k": p.kills, "d": p.deaths,
                 "a": p.assists, "bot": p.is_bot, "skins": p.skins}
                for p in self.players.values()
            ],
            "host": self.host_id,
        }

    def _emit_roster(self):
        self.version += 1
        self._emit({**self._roster_payload(), "v": self.version})

    def _phase_payload(self, duration: float = 0.0, reason: str = "", swapped: bool = False) -> dict:
        return {"t": "phase", "ph": self.phase, "dur": duration, "round": self.round,
                "winner": self.winner, "scores": self.scores, "champ": self.champion,
                "reason": reason, "swapped": swapped, "attackers": self.attackers}

    def sync_payload(self) -> dict:
        """Полная картина для игрока, который пропустил часть событий."""
        return {
            "t": "sync",
            "v": self.version,
            "settings": self.settings_payload(),
            "roster": self._roster_payload(),
            "phase": self._phase_payload(),
            "results": self.results,
            "sprays": self.sprays,
        }

    def welcome_payload(self, player: Player) -> dict:
        return {
            "t": "welcome",
            "id": player.id,
            "code": self.code,
            "v": self.version,
            **self.settings_payload(),
            "phase": self.phase,
            "lobby": self.use_lobby,
            "results": self.results,
            "modes": {key: {"name": m["name"], "text": m["text"], "target": m["target"]} for key, m in MODES.items()},
            "maps": {m.id: {"name": m.name, "text": m.text} for m in world.MAPS.values()},
            "weapons": {"order": WEAPON_ORDER, "list": WEAPONS, "categories": CATEGORIES},
            "armor": ARMOR_ITEMS,
            "grenades": GRENADES,
            "kitPrice": KIT_PRICE,
            "skins": skins.SKINS,
            "buyTime": BUY_TIME if self.cfg["shop"] else 0,
            "bomb": {"defuseRange": DEFUSE_RANGE, "plant": PLANT_TIME},
            "smokeRadius": SMOKE_RADIUS,
            "teams": TEAM_NAMES,
            "sprays": self.sprays,
            "sprayRange": SPRAY_RANGE,
            "moveSpeed": MOVE_SPEED,
            "eye": [EYE_STAND, EYE_CROUCH],
        }

    def summary(self) -> dict:
        return {
            "code": self.code,
            "mode": self.mode,
            "modeName": self.cfg["name"],
            "mapName": self.map.name,
            "waiting": self.phase in ("lobby", "end"),
            "host": self.players[self.host_id].name if self.host_id in self.players else "",
            "target": self.target,
            "humans": sum(not p.is_bot for p in self.players.values()),
            "bots": sum(p.is_bot for p in self.players.values()),
            "max": MAX_PLAYERS,
        }

    # ---------- Игроки ----------
    def hostile(self, a: Player, b: Player) -> bool:
        if a.id == b.id:
            return False
        return self.cfg["ffa"] or a.team != b.team

    def team_size(self, team: int) -> int:
        return sum(p.team == team for p in self.players.values())

    def _auto_team(self) -> int:
        return 0 if self.team_size(0) <= self.team_size(1) else 1

    def add_player(self, name, team, channel, now: float, is_bot: bool = False,
                   profile_id: int | None = None, player_skins: dict | None = None) -> Player | None:
        if len(self.players) >= MAX_PLAYERS:
            return None
        if self.cfg["ffa"]:
            team = 0
        else:
            team = team if team in (0, 1) else self._auto_team()
        p = Player(self._next_id, clean_name(name), team, channel, is_bot)
        p.profile_id = profile_id
        p.skins = player_skins or {}
        p.ammo = {k: w["mag"] for k, w in WEAPONS.items()}
        self._reset_economy(p)
        self._next_id += 1
        self.players[p.id] = p
        self._assign_host()
        joinable = self.phase in ("warmup", "freeze") or (self.cfg["respawn"] and self.phase == "live")
        if joinable:
            self._spawn(p, now)
        else:
            # Раунд уже идёт: новый игрок ждёт следующего.
            self._place_at_spawn(p)
        self._emit_roster()
        return p

    def remove_player(self, pid: int):
        if self.players.pop(pid, None):
            self._assign_host()
            self._emit_roster()

    def set_skins(self, pid: int, player_skins: dict):
        p = self.players.get(pid)
        if p is not None and p.skins != player_skins:
            p.skins = player_skins
            self._emit_roster()

    # ---------- Экономика ----------
    def _reset_economy(self, p: Player):
        p.money = self.cfg["money"]
        p.level = 0
        self._reset_loadout(p)
        p.respawn_at = None

    def _reset_loadout(self, p: Player):
        """Купленное теряется при смерти: остаются стартовый пистолет и нож."""
        p.armor = 0
        p.kit = False
        p.grenades = {kind: 0 for kind in GRENADES}
        if self.mode == "gungame":
            self._apply_level(p)
            return
        p.primary = None
        p.secondary = "pistol"

    def _apply_level(self, p: Player):
        weapon = GUNGAME_LADDER[min(p.level, len(GUNGAME_LADDER) - 1)]
        p.primary = weapon
        p.secondary = None
        p.weapon = weapon
        p.ammo[weapon] = WEAPONS[weapon]["mag"]
        p.reload_until = 0.0

    @staticmethod
    def _earn(p: Player, amount: int):
        p.money = min(MAX_MONEY, p.money + amount)

    def owned(self, p: Player) -> list[str]:
        items = [w for w in (p.primary, p.secondary, "knife") if w]
        if self.carries_bomb(p):
            items.append("bomb")
        return items

    def carries_bomb(self, p: Player) -> bool:
        b = self.bomb
        return b is not None and not b.planted and b.carrier == p.id

    @staticmethod
    def _best_weapon(p: Player) -> str:
        return p.primary or p.secondary or "knife"

    def try_buy(self, p: Player, item, now: float) -> bool:
        if not isinstance(item, str) or not p.alive or now >= p.buy_until or not self.cfg["shop"]:
            return False
        if item in ARMOR_ITEMS:
            armor = ARMOR_ITEMS[item]
            if p.armor >= armor["level"] or p.money < armor["price"]:
                return False
            p.money -= armor["price"]
            p.armor = armor["level"]
            return True
        if item in GRENADES:
            grenade = GRENADES[item]
            if p.grenades.get(item, 0) >= grenade["max"] or p.money < grenade["price"]:
                return False
            p.money -= grenade["price"]
            p.grenades[item] = p.grenades.get(item, 0) + 1
            return True
        if item == "kit":
            if self.mode != "defuse" or p.team == self.attackers or p.kit or p.money < KIT_PRICE:
                return False
            p.money -= KIT_PRICE
            p.kit = True
            return True
        weapon = WEAPONS.get(item)
        if weapon is None or weapon["slot"] in ("melee", "bomb"):
            return False
        if item in self.owned(p) or p.money < weapon["price"]:
            return False
        p.money -= weapon["price"]
        if weapon["slot"] == "primary":
            p.primary = item
        else:
            p.secondary = item
        p.ammo[item] = weapon["mag"]
        p.weapon = item
        p.reload_until = 0.0
        p.next_shot = max(p.next_shot, now + 0.3)
        return True

    def affordable_primaries(self, p: Player) -> list[str]:
        return [k for k, w in WEAPONS.items() if w["slot"] == "primary" and w["price"] <= p.money]

    def _shop_state(self, p: Player, is_open: bool, now: float):
        """Пока только что появившийся игрок выбирает оружие, его не должны убить на базе."""
        if not p.fresh:
            return
        if is_open:
            if self._respawns() and now < p.buy_until:
                p.protected_until = p.buy_until
        else:
            p.fresh = False
            if p.protected_until > now:
                p.protected_until = now + 0.5

    def add_bot(self, now: float):
        taken = {p.name for p in self.players.values()}
        free = [n for n in BOT_NAMES if f"Бот {n}" not in taken]
        name = f"Бот {random.choice(free)}" if free else "Бот"
        return self.add_player(name, None, None, now, is_bot=True)

    def remove_bot(self):
        found = [p.id for p in self.players.values() if p.is_bot]
        if found:
            self.remove_player(found[-1])

    def change_team(self, p: Player, team, now: float):
        if self.cfg["ffa"] or team not in (0, 1) or team == p.team:
            return
        p.team = team
        p.alive = False
        p.respawn_at = now + RESPAWN_DELAY if self._respawns() else None
        self._emit_roster()

    # ---------- Появление ----------
    def _respawns(self) -> bool:
        return (self.cfg["respawn"] and self.phase == "live") or self.phase == "warmup"

    def side(self, team: int) -> int:
        """Сторона 0 появляется на западе и атакует, сторона 1 защищается."""
        return 0 if team == self.attackers else 1

    def _spawn_points(self, p: Player) -> list:
        if self.cfg["ffa"]:
            return self.map.spawns[0] + self.map.spawns[1]
        return self.map.spawns[self.side(p.team)]

    def _pick_spawn(self, p: Player):
        others = [o for o in self.players.values() if o.alive and o.id != p.id]
        spawns = self._spawn_points(p)
        if not others:
            return random.choice(spawns)
        return max(
            spawns,
            key=lambda s: min((s[0] - o.x) ** 2 + (s[1] - o.z) ** 2 for o in others) + random.random(),
        )

    def _place_at_spawn(self, p: Player):
        p.x, p.z = self._pick_spawn(p)
        p.y = 0.0
        if self.cfg["ffa"]:
            p.yaw = math.atan2(p.x, p.z)  # лицом к центру карты
        else:
            p.yaw = self.map.spawn_yaw[self.side(p.team)]
        p.pitch = 0.0

    def _spawn(self, p: Player, now: float):
        self._place_at_spawn(p)
        if self.cfg["respawn"] and self.cfg["shop"] and p.respawn_at is not None:
            self._earn(p, RESPAWN_BONUS)
        if p.weapon not in self.owned(p):
            p.weapon = self._best_weapon(p)
        p.buy_until = now + BUY_TIME if self.cfg["shop"] else 0.0
        p.fresh = True
        p.hp = 100
        p.alive = True
        p.crouch = False
        p.life += 1
        p.respawn_at = None
        p.reload_until = 0.0
        p.next_shot = 0.0
        p.next_throw = 0.0
        p.heat = 0.0
        p.speed = 0.0
        p.using = False
        p.act_kind = 0
        p.ammo = {k: w["mag"] for k, w in WEAPONS.items()}
        p.protected_until = now + SPAWN_PROTECTION if self._respawns() else 0.0
        p.last_pos_t = now
        p.rejects = 0
        p.ai = {}
        p.damage_from = {}
        self._emit({"t": "spawn", "id": p.id, "x": p.x, "y": p.y, "z": p.z,
                    "yaw": p.yaw, "life": p.life})
        if p.is_bot:
            bots.auto_buy(self, p, now)

    # ---------- Движение ----------
    def update_pos(self, p: Player, msg: dict, now: float) -> bool:
        yaw, pitch = _num(msg.get("yaw")), _num(msg.get("pitch"))
        x, y, z = _num(msg.get("x")), _num(msg.get("y")), _num(msg.get("z"))
        if None in (yaw, pitch, x, y, z) or not p.alive or msg.get("life") != p.life:
            return False
        p.yaw = math.remainder(yaw, math.tau)
        p.pitch = max(-1.55, min(1.55, pitch))
        if self.phase == "freeze":
            return False

        dt = max(now - p.last_pos_t, TICK)
        horizontal = math.hypot(x - p.x, z - p.z)
        limit_h = MOVE_SPEED * 1.15 * dt * 1.5 + 0.3
        limit_v = 12.0 * dt * 1.5 + 0.3
        game_map = self.map
        ok = (
            abs(x) < game_map.half_x and abs(z) < game_map.half_z and -0.01 <= y <= 8.0
            and horizontal <= limit_h and abs(y - p.y) <= limit_v
            and not game_map.point_inside(x, y + 0.9, z)
            and not game_map.segment_blocked((p.x, p.y + 0.9, p.z), (x, y + 0.9, z))
        )
        if not ok:
            p.rejects += 1
            if p.rejects >= 10:
                # Клиент разошёлся с сервером: возвращаем его на проверенную позицию.
                p.rejects = 0
                p.last_pos_t = now
                self._emit({"t": "correct", "x": p.x, "y": p.y, "z": p.z}, p.channel)
            return False

        p.rejects = 0
        p.speed = horizontal / dt
        if horizontal > 0.05:
            p.fresh = False
        p.x, p.y, p.z = x, y, z
        p.crouch = bool(msg.get("c"))
        p.last_pos_t = now
        return True

    # ---------- Оружие ----------
    def can_shoot(self) -> bool:
        return self.phase == "warmup" or self.phase == "live"

    def switch_weapon(self, p: Player, name, now: float):
        if not isinstance(name, str) or name not in self.owned(p) or name == p.weapon or not p.alive:
            return
        p.weapon = name
        p.reload_until = 0.0
        p.next_shot = max(p.next_shot, now + 0.3)

    def start_reload(self, p: Player, now: float):
        w = WEAPONS[p.weapon]
        if not p.alive or not w["mag"] or p.reload_until or p.ammo[p.weapon] >= w["mag"]:
            return
        p.reload_until = now + w["reload"]

    def _rewound(self, rt: float | None, now: float) -> dict:
        """Позиции игроков в момент, который видел стреляющий (компенсация лага)."""
        if rt is None or not self.history:
            return {}
        rt = max(now - LAG_WINDOW, min(now, rt))
        return min(self.history, key=lambda h: abs(h[0] - rt))[1]

    def try_fire(self, p: Player, yaw: float, pitch: float, scoped: bool, rt, now: float) -> bool:
        w = WEAPONS[p.weapon]
        if w["slot"] == "bomb":
            return False
        if not p.alive or not self.can_shoot() or p.reload_until or now < p.next_shot - 0.04:
            return False
        if w["mag"]:
            if p.ammo[p.weapon] <= 0:
                self.start_reload(p, now)
                return False
            p.ammo[p.weapon] -= 1
        p.next_shot = now + w["interval"]
        p.protected_until = 0.0
        p.fresh = False
        p.shots += 1

        spread = (w["scoped"] if scoped else w["spread"]) + p.heat
        spread *= (0.65 if p.crouch else 1.0) * (1.0 + min(p.speed / MOVE_SPEED, 1.2) * 1.4)
        p.heat = min(p.heat + w["heat"], 0.03)
        o = p.eye()
        past = self._rewound(rt, now)

        # Дробовик выпускает несколько дробинок: урон по каждой цели складывается.
        damage_to: dict[int, list] = {}
        ends = []
        for _ in range(w["pellets"]):
            d = direction(yaw + random.gauss(0, spread), pitch + random.gauss(0, spread))
            best = self.map.raycast(o, d, w["range"])
            victim, is_head = None, False
            for other in self.players.values():
                if not other.alive or not self.hostile(p, other):
                    continue
                ox, oy, oz, oc = past.get(other.id, (other.x, other.y, other.z, other.crouch))
                body, head = hitboxes(ox, oy, oz, oc)
                for box, on_head in ((head, True), (body, False)):
                    t = world.ray_box(o, d, box, best)
                    if t is not None and t < best:
                        best, victim, is_head = t, other, on_head
            ends.append([round(o[i] + d[i] * best, 3) for i in range(3)])
            if victim is not None:
                amount = w["dmg"] * (w["head"] if is_head else 1.0) * damage_multiplier(w, best)
                entry = damage_to.setdefault(victim.id, [victim, 0.0, False])
                entry[1] += amount
                entry[2] = entry[2] or is_head

        message = {"t": "shot", "id": p.id, "w": p.weapon, "o": [round(v, 3) for v in o],
                   "e": ends[0], "hit": bool(damage_to)}
        if len(ends) > 1:
            message["es"] = ends
        self._emit(message)
        targets = [entry for entry in damage_to.values() if entry[0].alive and now >= entry[0].protected_until]
        # Попадание засчитывается до урона: решающий выстрел может закончить матч,
        # и тогда итоги считаются прямо внутри _damage.
        if targets:
            p.hits += 1
        for victim, amount, is_head in targets:
            self._damage(victim, p, int(amount), is_head, now)
        if w["mag"] and p.ammo[p.weapon] == 0 and p.alive:
            self.start_reload(p, now)
        return True

    def _damage(self, victim: Player, attacker: Player, amount: int, head: bool, now: float,
                weapon: str | None = None, origin: tuple[float, float] | None = None):
        if head and victim.armor >= 2:
            amount = int(amount * ARMOR_HEAD)
        elif not head and victim.armor >= 1:
            amount = int(amount * ARMOR_BODY)
        dealt = min(amount, victim.hp)
        victim.hp -= dealt
        attacker.damage += dealt
        victim.damage_from[attacker.id] = victim.damage_from.get(attacker.id, 0) + dealt
        self._emit({"t": "hit", "id": victim.id, "by": attacker.id, "dmg": amount, "hs": head,
                    "from": [round(v, 2) for v in (origin or (attacker.x, attacker.z))]})
        if victim.hp > 0:
            return
        used = weapon or attacker.weapon
        reward = HE_REWARD if used == "he" else WEAPONS[used]["reward"]
        # Помощь засчитывается тем, кто заметно ранил жертву, но не добил её.
        for helper_id, helped in victim.damage_from.items():
            helper = self.players.get(helper_id)
            if helper and helper_id != attacker.id and helped >= ASSIST_DAMAGE and self.hostile(helper, victim):
                helper.assists += 1
        self._kill_player(victim, now)
        attacker.kills += 1
        if head:
            attacker.hs_kills += 1
        self._earn(attacker, reward * KILL_MULTIPLIER if self.cfg["respawn"] else reward)
        self._emit({"t": "kill", "killer": attacker.id, "victim": victim.id, "w": used, "hs": head})
        if self.phase == "live":
            self._score_kill(attacker, now)
        self._emit_roster()

    def _kill_player(self, victim: Player, now: float):
        victim.alive = False
        victim.speed = 0.0
        victim.deaths += 1
        victim.using = False
        victim.act_kind = 0
        self._reset_loadout(victim)
        victim.respawn_at = now + RESPAWN_DELAY if self._respawns() else None

    def _score_kill(self, attacker: Player, now: float):
        if self.mode == "tdm":
            self.scores[attacker.team] += 1
            if self.scores[attacker.team] >= self.target:
                self._finish_match(attacker.team, now)
        elif self.mode == "ffa":
            self.scores[0] = max(self.scores[0], attacker.kills)
            if attacker.kills >= self.target:
                self._finish_match(-1, now, attacker)
        elif self.mode == "gungame":
            attacker.level += 1
            self.scores[0] = max(self.scores[0], attacker.level)
            if attacker.level >= len(GUNGAME_LADDER):
                self._finish_match(-1, now, attacker)
            elif attacker.alive:
                self._apply_level(attacker)

    # ---------- Гранаты ----------
    def throw_grenade(self, p: Player, kind, yaw: float, pitch: float, now: float) -> bool:
        if not isinstance(kind, str) or kind not in GRENADES or not p.alive or not self.can_shoot():
            return False
        if p.grenades.get(kind, 0) <= 0 or now < p.next_throw:
            return False
        p.grenades[kind] -= 1
        p.next_throw = now + THROW_COOLDOWN
        p.protected_until = 0.0
        p.fresh = False
        d = direction(yaw, min(1.4, pitch + 0.12))
        eye = p.eye()
        x, y, z = eye[0] + d[0] * 0.3, eye[1] + d[1] * 0.3, eye[2] + d[2] * 0.3
        if self.map.point_inside(x, y, z):
            x, y, z = eye
        self.grenades.append(Grenade(
            self._next_grenade, kind, p.id, x, y, z,
            d[0] * THROW_SPEED, d[1] * THROW_SPEED, d[2] * THROW_SPEED,
            now + GRENADES[kind]["fuse"],
        ))
        self._next_grenade += 1
        self._emit({"t": "throw", "id": p.id, "kind": kind})
        return True

    def _move_grenade(self, g: Grenade, dt: float):
        game_map = self.map
        g.vy -= GRENADE_GRAVITY * dt
        # Оси считаются по очереди: так понятно, от какой грани отскочить.
        nx = g.x + g.vx * dt
        if abs(nx) >= game_map.half_x or game_map.point_inside(nx, g.y, g.z):
            g.vx *= -0.45
            g.vz *= 0.8
        else:
            g.x = nx
        nz = g.z + g.vz * dt
        if abs(nz) >= game_map.half_z or game_map.point_inside(g.x, g.y, nz):
            g.vz *= -0.45
            g.vx *= 0.8
        else:
            g.z = nz
        ny = g.y + g.vy * dt
        if ny <= 0.08:
            g.y = 0.08
            g.vy *= -0.4
            g.vx *= 0.7
            g.vz *= 0.7
        elif game_map.point_inside(g.x, ny, g.z):
            g.vy *= -0.4
            g.vx *= 0.7
            g.vz *= 0.7
        else:
            g.y = ny

    def _update_grenades(self, now: float, dt: float):
        if not self.grenades and not self.smokes:
            return
        steps = max(1, min(6, int(dt / 0.016)))
        for g in list(self.grenades):
            for _ in range(steps):
                self._move_grenade(g, dt / steps)
            if now >= g.explode_at:
                self.grenades.remove(g)
                self._explode_grenade(g, now)
        self.smokes = [s for s in self.smokes if now < s["until"]]

    def _explode_grenade(self, g: Grenade, now: float):
        center = (g.x, g.y, g.z)
        msg = {"t": "boom", "kind": g.kind, "x": round(g.x, 2), "y": round(g.y, 2), "z": round(g.z, 2)}
        if g.kind == "he":
            self._emit(msg)
            owner = self.players.get(g.owner)
            if owner is None:
                return
            for p in list(self.players.values()):
                if not p.alive or not self.hostile(owner, p) or now < p.protected_until:
                    continue
                target = (p.x, p.y + 1.0, p.z)
                dist = math.dist(center, target)
                if dist < HE_RADIUS and not self.map.segment_blocked(center, target):
                    # Игроку важно, где взорвалось, а не откуда бросили.
                    self._damage(p, owner, int(HE_DAMAGE * (1 - dist / HE_RADIUS)) + 5, False, now, "he", (g.x, g.z))
        elif g.kind == "flash":
            blind = {}
            for p in self.players.values():
                if not p.alive:
                    continue
                eye = p.eye()
                dist = math.dist(center, eye)
                if dist >= FLASH_RADIUS or self.map.segment_blocked(center, eye):
                    continue
                view = direction(p.yaw, p.pitch)
                to_flash = [(center[i] - eye[i]) / max(dist, 0.01) for i in range(3)]
                facing = sum(view[i] * to_flash[i] for i in range(3))
                seconds = (0.5 + 3.2 * (facing + 1) / 2) * (1 - 0.5 * dist / FLASH_RADIUS)
                blind[p.id] = round(seconds, 2)
                if p.is_bot:
                    p.ai["blind_until"] = now + seconds
            msg["blind"] = blind
            self._emit(msg)
        else:
            self.smokes.append({"id": g.id, "x": g.x, "y": g.y, "z": g.z, "until": now + SMOKE_TIME})
            self._emit(msg)

    def smoke_blocks(self, a, b) -> bool:
        """Перекрывает ли дым линию от a до b (нужно ботам, людям дым закрывает экран)."""
        for smoke in self.smokes:
            cx, cy, cz = smoke["x"], smoke["y"] + 1.2, smoke["z"]
            dx, dy, dz = b[0] - a[0], b[1] - a[1], b[2] - a[2]
            length2 = dx * dx + dy * dy + dz * dz
            t = 0.0
            if length2 > 0:
                t = max(0.0, min(1.0, ((cx - a[0]) * dx + (cy - a[1]) * dy + (cz - a[2]) * dz) / length2))
            if math.dist((a[0] + dx * t, a[1] + dy * t, a[2] + dz * t), (cx, cy, cz)) < SMOKE_RADIUS:
                return True
        return False

    def _clear_field(self):
        self.grenades = []
        self.smokes = []
        self.bomb = None
        for p in self.players.values():
            if p.weapon == "bomb":
                p.weapon = self._best_weapon(p)

    # ---------- Бомба ----------
    def _give_bomb(self):
        team = [p for p in self.players.values() if p.team == self.attackers and p.alive]
        if team:
            carrier = random.choice(team)
            self.bomb = Bomb(carrier.x, carrier.y, carrier.z, carrier=carrier.id)

    def _action_for(self, p: Player) -> int:
        b = self.bomb
        if b is None or not p.alive or self.phase != "live":
            return 0
        if p.team == self.attackers:
            if not b.planted and b.carrier == p.id and p.y < 0.1 and self.map.site_at(p.x, p.z):
                return 1
            return 0
        if b.planted and math.hypot(p.x - b.x, p.z - b.z) <= DEFUSE_RANGE:
            return 2
        return 0

    def _update_bomb(self, now: float):
        b = self.bomb
        if b is None or self.phase != "live":
            return
        if not b.planted:
            if b.carrier is not None:
                carrier = self.players.get(b.carrier)
                if carrier is None or not carrier.alive or carrier.team != self.attackers:
                    b.carrier = None
                    if carrier is not None and carrier.weapon == "bomb":
                        carrier.weapon = self._best_weapon(carrier)
                    self._emit({"t": "bomb", "ev": "dropped"})
                else:
                    b.x, b.y, b.z = carrier.x, carrier.y, carrier.z
            if b.carrier is None:
                for p in self.players.values():
                    if p.alive and p.team == self.attackers and math.hypot(p.x - b.x, p.z - b.z) <= BOMB_PICKUP_RANGE:
                        b.carrier = p.id
                        self._emit({"t": "bomb", "ev": "picked", "id": p.id})
                        break

        for p in self.players.values():
            kind = self._action_for(p)
            if not p.using or not kind or p.speed > 0.6:
                p.act_kind = 0
                continue
            if p.act_kind != kind:
                p.act_kind = kind
                p.act_start = now
                if kind == 1:
                    p.act_total = PLANT_TIME
                else:
                    p.act_total = DEFUSE_TIME_KIT if p.kit else DEFUSE_TIME
            if now >= p.act_start + p.act_total:
                p.act_kind = 0
                p.using = False
                if kind == 1:
                    self._plant(p, now)
                else:
                    self._defuse(p, now)
                return

    def _plant(self, p: Player, now: float):
        b = self.bomb
        site = self.map.site_at(p.x, p.z)
        b.carrier = None
        b.planted = True
        if p.weapon == "bomb":
            p.weapon = self._best_weapon(p)
            p.next_shot = max(p.next_shot, now + 0.3)
        b.x, b.y, b.z = p.x, p.y, p.z
        b.site = site["id"] if site else ""
        b.explode_at = now + BOMB_TIME
        self.phase_until = b.explode_at
        p.plants += 1
        self._earn(p, OBJECTIVE_MONEY)
        self._emit({"t": "bomb", "ev": "planted", "id": p.id, "site": b.site})

    def _defuse(self, p: Player, now: float):
        p.defuses += 1
        self._earn(p, OBJECTIVE_MONEY)
        self.bomb = None
        self._emit({"t": "bomb", "ev": "defused", "id": p.id})
        self._finish_round(1 - self.attackers, now, "defused")

    def _explode_bomb(self, now: float):
        b = self.bomb
        self.bomb = None
        center = (b.x, b.y + 0.6, b.z)
        self._emit({"t": "boom", "kind": "bomb", "x": round(b.x, 2), "y": round(b.y, 2), "z": round(b.z, 2)})
        for p in self.players.values():
            if not p.alive:
                continue
            target = (p.x, p.y + 1.0, p.z)
            dist = math.dist(center, target)
            if dist >= BOMB_RADIUS:
                continue
            p.hp = max(0, p.hp - int(BOMB_DAMAGE * (1 - dist / BOMB_RADIUS)))
            if p.hp == 0:
                self._kill_player(p, now)
                self._emit({"t": "kill", "killer": None, "victim": p.id, "w": "bomb", "hs": False})
        self._emit_roster()

    # ---------- Спреи ----------
    def spray(self, p: Player, msg: dict, now: float) -> bool:
        """Рисунок на поверхности, куда смотрит игрок. Точку и сторону поверхности считает клиент."""
        design = msg.get("s")
        point, normal = msg.get("p"), msg.get("n")
        if design not in SPRAYS or not p.alive or now < p.ai.get("spray_at", 0.0):
            return False
        if not (isinstance(point, list) and isinstance(normal, list) and len(point) == 3 and len(normal) == 3):
            return False
        point = [_num(v) for v in point]
        normal = [_num(v) for v in normal]
        yaw = _num(msg.get("yaw")) or 0.0
        if None in point or None in normal:
            return False
        length = math.sqrt(sum(v * v for v in normal))
        if length < 0.5:
            return False
        normal = [v / length for v in normal]
        if math.dist(p.eye(), point) > SPRAY_RANGE + 1.0:
            return False
        if abs(point[0]) > self.map.half_x + 1 or abs(point[2]) > self.map.half_z + 1 or not -0.1 <= point[1] <= 9.0:
            return False
        p.ai["spray_at"] = now + SPRAY_COOLDOWN
        size = _num(msg.get("size"))
        size = SPRAY_SIZE[1] if size is None else max(SPRAY_SIZE[0], min(SPRAY_SIZE[1], size))
        row = [self._next_spray, p.id, design, *(round(v, 3) for v in point),
               *(round(v, 3) for v in normal), round(math.remainder(yaw, math.tau), 3), round(size, 2), p.name]
        self._next_spray += 1
        self.sprays.append(row)
        if len(self.sprays) > MAX_SPRAYS:
            del self.sprays[: len(self.sprays) - MAX_SPRAYS]
        self._emit({"t": "spray", "row": row})
        return True

    # ---------- Сообщения клиента ----------
    def handle(self, pid: int, msg: dict, now: float):
        p = self.players.get(pid)
        if p is None:
            return
        kind = msg.get("t")
        if kind == "pos":
            self.update_pos(p, msg, now)
        elif kind == "shoot":
            self.update_pos(p, msg, now)
            yaw, pitch = _num(msg.get("yaw")), _num(msg.get("pitch"))
            if yaw is not None and pitch is not None and msg.get("life") == p.life:
                self.try_fire(p, yaw, pitch, bool(msg.get("s")), _num(msg.get("rt")), now)
        elif kind == "throw":
            self.update_pos(p, msg, now)
            yaw, pitch = _num(msg.get("yaw")), _num(msg.get("pitch"))
            if yaw is not None and pitch is not None and msg.get("life") == p.life:
                self.throw_grenade(p, msg.get("kind"), yaw, pitch, now)
        elif kind == "use":
            p.using = bool(msg.get("on"))
        elif kind == "reload":
            self.start_reload(p, now)
        elif kind == "spray":
            self.spray(p, msg, now)
        elif kind == "weapon":
            self.switch_weapon(p, msg.get("w"), now)
        elif kind == "buy":
            self.try_buy(p, msg.get("item"), now)
        elif kind == "shop":
            self._shop_state(p, bool(msg.get("open")), now)
        elif kind == "team":
            self.change_team(p, msg.get("team"), now)
        elif kind == "bot":
            # Ботами управляет ведущий, чтобы игроки не мешали друг другу.
            if not self._is_host(p):
                return
            if msg.get("op") == "add":
                self.add_bot(now)
            elif msg.get("op") == "remove":
                self.remove_bot()
        elif kind == "start":
            self.start_match(p, now)
        elif kind == "settings":
            self.change_settings(p, msg, now)
        elif kind == "lobby":
            self.back_to_lobby(p, now)
        elif kind == "ping":
            self._emit({"t": "pong", "c": _num(msg.get("c"))}, p.channel)
        elif kind == "sync":
            self._emit(self.sync_payload(), p.channel)

    # ---------- Ход игры ----------
    def _set_phase(self, phase: str, duration: float, now: float, reason: str = "", swapped: bool = False):
        self.phase = phase
        self.phase_until = now + duration
        self.version += 1
        self._emit({**self._phase_payload(duration, reason, swapped), "v": self.version})

    def _teams_ready(self) -> bool:
        return self.team_size(0) > 0 and self.team_size(1) > 0

    def _alive(self, team: int) -> list:
        return [p for p in self.players.values() if p.team == team and p.alive]

    def _finish_match(self, winner: int, now: float, champion: Player | None = None):
        self.winner = winner
        self.champion = champion.name if champion else ""
        if champion:
            # Победитель в режиме «все против всех» один.
            self.pending_rewards = [(champion.id, champion.profile_id)] if champion.profile_id else []
        else:
            # Кейс получают победители, которые реально играли, а не зашли в последний момент.
            self.pending_rewards = [
                (p.id, p.profile_id)
                for p in self.players.values()
                if p.team == winner and p.profile_id and (p.kills or p.deaths)
            ]
        self._clear_field()
        self.results = self._results()
        self._emit(self.results)
        self._set_phase("end", MATCH_END_TIME, now)

    def _results(self) -> dict:
        """Итоги матча: у каждого игрока своя строка, первым идёт лучший."""
        rows = []
        for p in self.players.values():
            score = p.kills * 3 + p.assists + p.plants * 3 + p.defuses * 4
            if self.mode == "gungame":
                score = p.level * 3 + p.kills
            rows.append({
                "id": p.id, "name": p.name, "team": p.team, "bot": p.is_bot,
                "k": p.kills, "d": p.deaths, "a": p.assists,
                "hs": round(100 * p.hs_kills / p.kills) if p.kills else 0,
                "acc": round(100 * p.hits / p.shots) if p.shots else 0,
                "dmg": p.damage, "plants": p.plants, "defuses": p.defuses,
                "level": p.level, "score": score,
            })
        rows.sort(key=lambda r: (r["score"], r["k"], -r["d"]), reverse=True)
        return {
            "t": "results",
            "winner": self.winner,
            "champ": self.champion,
            "scores": list(self.scores),
            "mode": self.mode,
            "modeName": self.cfg["name"],
            "mapName": self.map.name,
            "rows": rows,
            "mvp": rows[0]["id"] if rows and rows[0]["score"] > 0 else None,
            "rewarded": [player_id for player_id, _ in self.pending_rewards],
        }

    def _reset_match(self, now: float):
        self.scores = [0, 0]
        self.round = 0
        self.winner = -1
        self.champion = ""
        self.attackers = 0
        self._clear_field()
        for p in self.players.values():
            p.reset_stats()
            p.alive = False
            self._reset_economy(p)
        if self.cfg["rounds"]:
            self._begin_warmup(now)
        else:
            self._set_phase("live", self.cfg["time"], now)
            for p in self.players.values():
                self._spawn(p, now)
        self._emit_roster()

    def _begin_warmup(self, now: float):
        self.round = 0
        self.scores = [0, 0]
        self.winner = -1
        self.attackers = 0
        self._clear_field()
        self._set_phase("warmup", 0.0, now)
        for p in self.players.values():
            if not p.alive:
                self._spawn(p, now)

    def _start_round(self, now: float):
        self.round += 1
        self.winner = -1
        self._clear_field()
        # Смена сторон в середине матча, чтобы карта была честной для обеих команд.
        swapped = self.target > 1 and self.round == self.target
        if swapped:
            # Террористы становятся антитеррористами и наоборот, счёт уходит вместе с игроками.
            for p in self.players.values():
                p.team = 1 - p.team
                self._reset_economy(p)
            self.scores = [self.scores[1], self.scores[0]]
            self._emit_roster()
        self._set_phase("freeze", FREEZE_TIME, now, swapped=swapped)
        for p in self.players.values():
            self._spawn(p, now)
        if self.mode == "defuse":
            self._give_bomb()

    def _finish_round(self, winner: int, now: float, reason: str = ""):
        self.winner = winner
        if winner in (0, 1):
            self.scores[winner] += 1
        for p in self.players.values():
            self._earn(p, ROUND_WIN_MONEY if p.team == winner else ROUND_LOSS_MONEY)
            p.using = False
            p.act_kind = 0
        self._set_phase("round_end", ROUND_END_TIME, now, reason=reason)

    def _round_timeout_winner(self) -> int:
        hp = [sum(p.hp for p in self._alive(team)) for team in (0, 1)]
        if hp[0] == hp[1]:
            return -1
        return 0 if hp[0] > hp[1] else 1

    def _finish_timed_match(self, now: float):
        if self.cfg["ffa"]:
            metric = (lambda p: p.level) if self.mode == "gungame" else (lambda p: p.kills)
            ranked = sorted(self.players.values(), key=metric, reverse=True)
            unique = ranked and (len(ranked) == 1 or metric(ranked[0]) > metric(ranked[1]))
            self._finish_match(-1, now, ranked[0] if unique and metric(ranked[0]) > 0 else None)
            return
        s = self.scores
        self._finish_match(-1 if s[0] == s[1] else (0 if s[0] > s[1] else 1), now)

    def _update_defuse_round(self, now: float, expired: bool):
        attackers = len(self._alive(self.attackers))
        defenders = len(self._alive(1 - self.attackers))
        b = self.bomb
        if b is not None and b.planted:
            if now >= b.explode_at:
                self._explode_bomb(now)
                self._finish_round(self.attackers, now, "exploded")
            elif not defenders:
                self._finish_round(self.attackers, now, "killed")
        elif not attackers:
            self._finish_round(1 - self.attackers, now, "killed")
        elif not defenders:
            self._finish_round(self.attackers, now, "killed")
        elif expired:
            self._finish_round(1 - self.attackers, now, "timeout")

    def _update_phase(self, now: float):
        expired = now >= self.phase_until
        if self.phase == "lobby":
            return
        if self.phase == "end":
            # В комнате с ведущим новый матч начинается только по его кнопке.
            if expired and not self.use_lobby:
                self._reset_match(now)
            return
        if not self.cfg["rounds"]:
            if self.phase == "live" and expired:
                self._finish_timed_match(now)
            return

        if not self._teams_ready():
            if self.phase != "warmup":
                self._begin_warmup(now)
            return
        if self.phase == "warmup":
            # Фраги из разминки в счёт матча не идут.
            for p in self.players.values():
                p.reset_stats()
                self._reset_economy(p)
            self._emit_roster()
            self._start_round(now)
        elif self.phase == "freeze" and expired:
            self._set_phase("live", ROUND_TIME, now)
        elif self.phase == "live":
            if self.mode == "defuse":
                self._update_defuse_round(now, expired)
                return
            alive = [len(self._alive(0)), len(self._alive(1))]
            if not alive[0] or not alive[1]:
                self._finish_round(-1 if alive == [0, 0] else (1 if not alive[0] else 0), now)
            elif expired:
                self._finish_round(self._round_timeout_winner(), now, "timeout")
        elif self.phase == "round_end" and expired:
            if max(self.scores) >= self.target:
                self._finish_match(0 if self.scores[0] > self.scores[1] else 1, now)
            else:
                self._start_round(now)

    def tick(self, now: float):
        dt = now - self._last_tick
        self._last_tick = now

        for p in self.players.values():
            if p.reload_until and now >= p.reload_until:
                p.ammo[p.weapon] = WEAPONS[p.weapon]["mag"]
                p.reload_until = 0.0
            p.heat = max(0.0, p.heat - dt * 0.03)
            if not p.alive and p.respawn_at is not None and now >= p.respawn_at and self._respawns():
                self._spawn(p, now)

        for p in list(self.players.values()):
            if p.is_bot:
                bots.update(self, p, now, dt)

        self._update_grenades(now, dt)
        self._update_bomb(now)
        self._update_phase(now)

        self.history.append((now, {p.id: (p.x, p.y, p.z, p.crouch) for p in self.players.values()}))
        while self.history and self.history[0][0] < now - LAG_WINDOW - 0.1:
            self.history.popleft()

        self._emit(self.snapshot(now))

    def _bomb_snapshot(self):
        b = self.bomb
        if b is None:
            return None
        state = 2 if b.planted else (0 if b.carrier is not None else 1)
        return [state, round(b.x, 2), round(b.y, 2), round(b.z, 2), b.carrier, b.site]

    def snapshot(self, now: float) -> dict:
        timed = self.phase in ("live", "freeze", "round_end", "end")
        rows = []
        for p in self.players.values():
            progress = 0.0
            if p.act_kind:
                progress = round(min(1.0, (now - p.act_start) / max(p.act_total, 0.01)), 2)
            rows.append([
                p.id, round(p.x, 3), round(p.y, 3), round(p.z, 3), round(p.yaw, 3), round(p.pitch, 3),
                p.hp, int(p.alive), WEAPON_ORDER.index(p.weapon), p.ammo[p.weapon],
                int(bool(p.reload_until)), int(p.crouch), p.team, int(now < p.protected_until),
                p.money, p.armor, WEAPON_ORDER.index(p.primary) if p.primary else -1,
                WEAPON_ORDER.index(p.secondary) if p.secondary else -1,
                round(max(0.0, p.buy_until - now), 1) if p.alive else 0,
                p.grenades.get("he", 0), p.grenades.get("flash", 0), p.grenades.get("smoke", 0),
                int(p.kit), p.act_kind, progress, p.life,
            ])
        return {
            "t": "s",
            "v": self.version,
            "ts": round(now, 3),
            "ph": self.phase,
            "tl": round(max(0.0, self.phase_until - now), 1) if timed else 0,
            "sc": self.scores,
            "r": self.round,
            "atk": self.attackers,
            "b": self._bomb_snapshot(),
            "g": [[g.id, g.kind, round(g.x, 2), round(g.y, 2), round(g.z, 2)] for g in self.grenades],
            "sm": [[s["id"], round(s["x"], 2), round(s["y"], 2), round(s["z"], 2),
                    round(s["until"] - now, 1)] for s in self.smokes],
            "p": rows,
        }
