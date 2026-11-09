import json
import time

from autobahn.exception import Disconnected
from channels.consumer import get_handler_name
from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer

from . import profiles, rooms
from .engine import clean_name

MAX_MESSAGE_SIZE = 2048
REFRESH_INTERVAL = 2.0


class GameConsumer(AsyncJsonWebsocketConsumer):
    handle = None
    player_id = None
    profile_code = None
    last_refresh = 0.0

    async def dispatch(self, message):
        # Обычный обработчик Channels перед каждым сообщением уходит в общий служебный поток,
        # чтобы закрыть старые подключения к базе. Здесь это 20 раз в секунду на игрока, а под
        # нагрузкой такое ожидание однажды повисло навсегда, и игрок перестал получать игру.
        # Сообщения игры базу не трогают, а там, где она нужна (database_sync_to_async),
        # подключения закрываются и так.
        handler = getattr(self, get_handler_name(message), None)
        if handler is None:
            raise ValueError(f"No handler for message type {message['type']}")
        await handler(message)

    async def connect(self):
        code = self.scope["url_route"]["kwargs"]["code"]
        self.handle = rooms.get_handle(code)
        await self.accept()
        if self.handle is None:
            await self.send_json({"t": "error", "msg": "Комната не найдена"})
            await self.close(code=4404)

    async def receive(self, text_data=None, bytes_data=None, **kwargs):
        if not text_data or len(text_data) > MAX_MESSAGE_SIZE or self.handle is None:
            return
        try:
            msg = json.loads(text_data)
        except ValueError:
            return
        if not isinstance(msg, dict):
            return

        room = self.handle.room
        if self.player_id is None:
            if msg.get("t") == "join":
                await self._join(msg)
            return
        if msg.get("t") == "refresh":
            await self._refresh_skins()
        else:
            room.handle(self.player_id, msg, time.monotonic())
        await rooms.flush(room)

    async def _join(self, msg):
        room = self.handle.room
        name = clean_name(msg.get("name"))
        profile_id, skins = None, {}
        found = None
        if msg.get("profile"):
            found = await database_sync_to_async(profiles.for_game)(msg["profile"], name)
        if found:
            profile_id, skins = found
            self.profile_code = msg["profile"]

        await self.channel_layer.group_add(rooms.group_name(room.code), self.channel_name)
        player = room.add_player(name, msg.get("team"), self.channel_name, time.monotonic(),
                                 profile_id=profile_id, player_skins=skins)
        if player is None:
            await self.channel_layer.group_discard(rooms.group_name(room.code), self.channel_name)
            await self.send_json({"t": "error", "msg": "В комнате нет свободных мест"})
            await self.close(code=4403)
            return
        self.player_id = player.id
        await self.send_json(room.welcome_payload(player))
        rooms.ensure_running(self.handle)
        await rooms.flush(room)

    async def _refresh_skins(self):
        """Игрок мог надеть другой скин в инвентаре, пока идёт матч."""
        now = time.monotonic()
        if not self.profile_code or now - self.last_refresh < REFRESH_INTERVAL:
            return
        self.last_refresh = now
        found = await database_sync_to_async(profiles.for_game)(self.profile_code)
        if found:
            self.handle.room.set_skins(self.player_id, found[1])

    async def disconnect(self, code):
        if self.handle is None or self.player_id is None:
            return
        room = self.handle.room
        room.remove_player(self.player_id)
        await self.channel_layer.group_discard(rooms.group_name(room.code), self.channel_name)
        await rooms.flush(room)

    async def game_msg(self, event):
        try:
            await self.send_json(event["data"])
        except Disconnected:
            # Вкладку уже закрыли. Без этой проверки обработчик упадёт раньше, чем дойдёт
            # до отключения, и игрок останется в комнате неподвижным «призраком».
            pass
