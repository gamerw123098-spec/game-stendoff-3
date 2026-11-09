"""Список комнат и игровой цикл. Всё выполняется в одном потоке событий asyncio."""
from __future__ import annotations

import asyncio
import logging
import random
import time

from channels.db import database_sync_to_async
from channels.exceptions import ChannelFull
from channels.layers import get_channel_layer

from . import profiles
from .engine import TICK, Room

log = logging.getLogger(__name__)

CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ"
EMPTY_ROOM_TTL = 30.0
UNUSED_ROOM_TTL = 300.0


class RoomHandle:
    def __init__(self, room: Room):
        self.room = room
        self.task: asyncio.Task | None = None
        self.empty_since: float | None = None
        self.used = False


ROOMS: dict[str, RoomHandle] = {}
MAX_ROOMS = 20  # каждая комната считается 20 раз в секунду, а сервер в интернете слабый


def is_full() -> bool:
    cleanup_unused()
    return len(ROOMS) >= MAX_ROOMS


def group_name(code: str) -> str:
    return f"room_{code}"


def create_room(mode: str, target: int | None, map_id: str = "depot") -> Room:
    cleanup_unused()
    while True:
        code = "".join(random.choices(CODE_ALPHABET, k=4))
        if code not in ROOMS:
            break
    room = Room(code, mode, target, time.monotonic(), map_id, lobby=True)
    ROOMS[code] = RoomHandle(room)
    return room


def get_handle(code: str) -> RoomHandle | None:
    return ROOMS.get((code or "").upper())


def list_rooms() -> list[dict]:
    cleanup_unused()
    return [h.room.summary() for h in ROOMS.values()]


def cleanup_unused():
    """Удаляет комнаты, в которые так никто и не зашёл."""
    now = time.monotonic()
    for code, handle in list(ROOMS.items()):
        if not handle.used and now - handle.room.created_at > UNUSED_ROOM_TTL:
            del ROOMS[code]


async def _grant_rewards(room: Room):
    rewards, room.pending_rewards = room.pending_rewards, []
    try:
        await database_sync_to_async(profiles.grant_wins)([profile for _, profile in rewards])
    except Exception:
        # Сбой базы не должен останавливать матч у всех игроков.
        log.exception("Не удалось выдать кейсы в комнате %s", room.code)
        return
    room._emit({"t": "reward", "ids": [player for player, _ in rewards]})


async def flush(room: Room):
    layer = get_channel_layer()
    if room.pending_rewards:
        await _grant_rewards(room)
    for channel, msg in room.drain():
        event = {"type": "game.msg", "data": msg}
        if channel:
            try:
                await layer.send(channel, event)
            except ChannelFull:
                # Компьютер игрока подвис и не успевает читать. Отключать его из-за этого
                # нельзя: личные сообщения (пинг, поправка позиции) можно просто пропустить.
                pass
        else:
            await layer.group_send(group_name(room.code), event)


def ensure_running(handle: RoomHandle):
    handle.used = True
    if handle.task is None or handle.task.done():
        handle.task = asyncio.get_running_loop().create_task(_run(handle))


async def _run(handle: RoomHandle):
    room = handle.room
    next_tick = time.monotonic()
    while True:
        now = time.monotonic()
        try:
            room.tick(now)
            await flush(room)
        except Exception:
            # Ошибка одного тика не должна останавливать игру у всех.
            log.exception("Ошибка в игровом цикле комнаты %s", room.code)

        if any(not p.is_bot for p in room.players.values()):
            handle.empty_since = None
        elif handle.empty_since is None:
            handle.empty_since = now
        elif now - handle.empty_since > EMPTY_ROOM_TTL:
            ROOMS.pop(room.code, None)
            return

        next_tick += TICK
        delay = next_tick - time.monotonic()
        if delay < -1.0:  # процесс сильно притормозил: не пытаемся догонять
            next_tick = time.monotonic()
            delay = 0
        await asyncio.sleep(max(delay, 0))
