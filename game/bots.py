"""Простые боты: чтобы проверить игру в одиночку или добрать команду."""
from __future__ import annotations

import math
import random

WALK_SPEED = 3.9
TURN_RATE = 4.0
AIM_ERROR = 0.035
SCAN_INTERVAL = 0.2
VIEW_RANGE = 40.0


def auto_buy(room, bot, now: float):
    """Боты покупают по тем же правилам, что и люди. Оптикой они не пользуются."""
    if not room.cfg["shop"]:
        return
    if bot.primary is None:
        from .engine import WEAPONS  # движок сам импортирует ботов, поэтому здесь, а не вверху

        # Боты не умеют пользоваться оптикой, поэтому снайперские винтовки им ни к чему.
        options = [w for w in room.affordable_primaries(bot) if WEAPONS[w]["cat"] != "sniper"]
        if options:
            room.try_buy(bot, random.choice(options), now)
    if bot.money >= 1000:
        room.try_buy(bot, "helmet", now)
    elif bot.money >= 650:
        room.try_buy(bot, "vest", now)


def _turn(current: float, wanted: float, max_step: float) -> float:
    return current + max(-max_step, min(max_step, math.remainder(wanted - current, math.tau)))


def _aim(bot, target):
    dx, dz = target.x - bot.x, target.z - bot.z
    dy = (target.y + (0.8 if target.crouch else 1.1)) - bot.eye()[1]
    return math.atan2(-dx, -dz), math.atan2(dy, math.hypot(dx, dz))


def _scan(room, bot):
    eye = bot.eye()
    best, best_dist = None, VIEW_RANGE
    for other in room.players.values():
        if not other.alive or not room.hostile(bot, other):
            continue
        dist = math.dist((bot.x, bot.z), (other.x, other.z))
        if dist >= best_dist:
            continue
        if room.map.segment_blocked(eye, other.eye()) or room.smoke_blocks(eye, other.eye()):
            continue
        best, best_dist = other, dist
    return best


def _step(room, bot, dx, dz, speed, dt, pad=0.35) -> bool:
    """Шаг по земле. Возвращает False, если дорогу перекрыло."""
    length = math.hypot(dx, dz)
    if length < 1e-6:
        return True
    nx = bot.x + dx / length * speed * dt
    nz = bot.z + dz / length * speed * dt
    game_map = room.map
    if game_map.point_inside(nx, 0.5, nz, pad) or game_map.point_inside(nx, 1.0, nz, pad):
        return False
    bot.x, bot.z = nx, nz
    bot.speed = speed
    return True


def _engage(room, bot, target, now, dt):
    ai = bot.ai
    ai.setdefault("seen_since", now)
    yaw, pitch = _aim(bot, target)
    bot.yaw = _turn(bot.yaw, yaw, TURN_RATE * dt)
    bot.pitch = _turn(bot.pitch, pitch, TURN_RATE * dt)
    bot.speed = 0.0

    if bot.weapon == "knife":
        # С ножом надо подойти вплотную.
        if math.hypot(target.x - bot.x, target.z - bot.z) > 1.6:
            _step(room, bot, target.x - bot.x, target.z - bot.z, WALK_SPEED * 1.2, dt)
    else:
        # Стрейф, чтобы по боту было не так просто попасть.
        if now >= ai.get("strafe_until", 0):
            ai["strafe"] = random.choice((-1, 0, 1))
            ai["strafe_until"] = now + random.uniform(0.4, 1.1)
        if ai.get("strafe"):
            side = ai["strafe"]
            if not _step(room, bot, math.cos(yaw) * side, -math.sin(yaw) * side, WALK_SPEED * 0.7, dt):
                ai["strafe"] = -side

    on_target = abs(math.remainder(yaw - bot.yaw, math.tau)) < 0.12
    reacted = now - ai["seen_since"] >= ai.setdefault("reaction", random.uniform(0.35, 0.75))
    if on_target and reacted and now >= ai.get("pause_until", 0) and room.can_shoot():
        fired = room.try_fire(
            bot,
            bot.yaw + random.gauss(0, AIM_ERROR),
            bot.pitch + random.gauss(0, AIM_ERROR),
            False,
            now,
            now,
        )
        if fired:
            ai["burst"] = ai.get("burst", 0) + 1
            if ai["burst"] >= random.randint(3, 6):
                ai["burst"] = 0
                ai["pause_until"] = now + random.uniform(0.4, 0.9)


def _objective(room, bot):
    """Цель бота в обезвреживании: точка на карте или None, если просто ищет врагов."""
    b = room.bomb
    if room.mode != "defuse" or b is None:
        return None
    if bot.team == room.attackers:
        if b.planted:
            return (b.x, b.z)
        if b.carrier == bot.id:
            site = bot.ai.setdefault("site", random.choice(room.map.sites))
            return (site["x"], site["z"])
        if b.carrier is None:
            return (b.x, b.z)
        return None
    return (b.x, b.z) if b.planted else None


def _try_objective_action(room, bot) -> bool:
    """Если бот уже может заложить или обезвредить бомбу, он останавливается и делает это."""
    if room._action_for(bot):
        bot.using = True
        bot.speed = 0.0
        return True
    return False


def _walk(room, bot, now, dt):
    ai = bot.ai
    ai.pop("seen_since", None)
    ai.pop("reaction", None)
    bot.pitch = _turn(bot.pitch, 0.0, TURN_RATE * dt)
    if _try_objective_action(room, bot):
        return

    nav = room.map.nav
    goal = _objective(room, bot)
    path = ai.get("path")
    if not path or now >= ai.get("repath_at", 0):
        if goal is not None:
            goal_node = nav.nearest(*goal)
        else:
            enemies = [p for p in room.players.values() if p.alive and room.hostile(bot, p)]
            if enemies:
                near = min(enemies, key=lambda p: math.dist((bot.x, bot.z), (p.x, p.z)))
                goal_node = nav.nearest(near.x, near.z)
            else:
                goal_node = random.randrange(len(nav.points))
        path = nav.path(nav.nearest(bot.x, bot.z), goal_node)
        ai["path"] = path
        ai["repath_at"] = now + random.uniform(1.5, 3.0)
    if not path:
        # Сетка закончилась: цель рядом, последние шаги идём напрямую.
        if goal is not None and math.dist((bot.x, bot.z), goal) > 0.4:
            bot.yaw = _turn(bot.yaw, math.atan2(-(goal[0] - bot.x), -(goal[1] - bot.z)), TURN_RATE * dt)
            _step(room, bot, goal[0] - bot.x, goal[1] - bot.z, WALK_SPEED, dt)
        else:
            bot.speed = 0.0
        return
    tx, tz = path[0]
    if math.dist((bot.x, bot.z), (tx, tz)) < 0.5:
        path.pop(0)
        return
    dx, dz = tx - bot.x, tz - bot.z
    bot.yaw = _turn(bot.yaw, math.atan2(-dx, -dz), TURN_RATE * dt)
    if not _step(room, bot, dx, dz, WALK_SPEED, dt):
        ai["path"] = None
        bot.speed = 0.0


def update(room, bot, now: float, dt: float):
    bot.using = False
    if not bot.alive or room.phase in ("freeze", "end", "round_end", "lobby"):
        bot.speed = 0.0
        return
    ai = bot.ai
    if now < ai.get("blind_until", 0):
        # Ослеплён светошумовой гранатой.
        bot.speed = 0.0
        ai["target"] = None
        return
    if now >= ai.get("scan_at", 0):
        ai["scan_at"] = now + SCAN_INTERVAL
        ai["target"] = _scan(room, bot)
    target = ai.get("target")
    if target is not None and target.alive and target.id in room.players:
        _engage(room, bot, target, now, dt)
    else:
        _walk(room, bot, now, dt)
