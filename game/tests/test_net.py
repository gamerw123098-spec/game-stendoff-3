import json
from unittest.mock import AsyncMock, patch

from autobahn.exception import Disconnected
from channels.layers import get_channel_layer
from channels.testing import WebsocketCommunicator
from django.test import Client, SimpleTestCase

from config.asgi import application
from game import rooms
from game.consumers import GameConsumer


class PageTests(SimpleTestCase):
    def test_lobby_create_and_room(self):
        client = Client()
        home = client.get("/")
        self.assertContains(home, "ПОЛИГОН")
        self.assertContains(home, "Войти в игру по коду")
        resp = client.post("/create/", {"mode": "rounds", "target": "3"})
        self.assertEqual(resp.status_code, 302)
        code = resp["Location"].rstrip("/").split("/")[-1]
        self.assertEqual(rooms.get_handle(code).room.target, 3)
        self.assertContains(client.get(resp["Location"]), code)
        listed = client.get("/api/rooms/").json()["rooms"]
        self.assertIn(code, [r["code"] for r in listed])
        del rooms.ROOMS[code]

    def test_create_room_with_map_and_mode(self):
        client = Client()
        for mode, map_id, expected_mode, expected_map in (
            ("defuse", "harbor", "defuse", "harbor"),
            ("gungame", "factory", "gungame", "factory"),
            ("nope", "nope", "tdm", "depot"),
        ):
            resp = client.post("/create/", {"mode": mode, "map": map_id})
            code = resp["Location"].rstrip("/").split("/")[-1]
            room = rooms.get_handle(code).room
            self.assertEqual((room.mode, room.map.id), (expected_mode, expected_map))
            self.assertEqual(client.get(resp["Location"]).status_code, 200)
            del rooms.ROOMS[code]

    def test_unknown_room_redirects_to_lobby(self):
        resp = Client().get("/room/ZZZZ/")
        self.assertEqual(resp.status_code, 302)
        self.assertIn("missing=ZZZZ", resp["Location"])


class SocketTests(SimpleTestCase):
    async def _recv_until(self, ws, kind, limit=60):
        for _ in range(limit):
            msg = await ws.receive_json_from(timeout=2)
            if msg.get("t") == kind:
                return msg
        self.fail(f"Сообщение {kind} не пришло")

    async def test_two_players_play_over_websocket(self):
        room = rooms.create_room("tdm", 10)
        path = f"/ws/room/{room.code}/"
        one = WebsocketCommunicator(application, path)
        two = WebsocketCommunicator(application, path)
        try:
            self.assertTrue((await one.connect())[0])
            self.assertTrue((await two.connect())[0])

            await one.send_to(text_data=json.dumps({"t": "join", "name": "Аня", "team": 0}))
            welcome = await self._recv_until(one, "welcome")
            self.assertEqual(welcome["code"], room.code)
            self.assertTrue(welcome["world"]["boxes"])

            await two.send_to(text_data=json.dumps({"t": "join", "name": "Боря", "team": 1}))
            await self._recv_until(two, "welcome")

            for _ in range(10):
                snapshot = await self._recv_until(one, "s")
                if len(snapshot["p"]) == 2:
                    break
            self.assertEqual(len(snapshot["p"]), 2)

            # Мусор от клиента не должен ронять соединение
            await one.send_to(text_data="not json")
            await one.send_to(text_data="[1, 2]")
            await one.send_to(text_data=json.dumps({"t": "pos", "x": "abc", "life": 1}))
            await one.send_to(text_data=json.dumps({"t": "weapon", "w": ["x"]}))
            await one.send_to(text_data=json.dumps({"t": "ping", "c": 5}))
            self.assertEqual((await self._recv_until(one, "pong"))["c"], 5)

            await two.disconnect()
            for _ in range(30):
                snapshot = await self._recv_until(one, "s")
                if len(snapshot["p"]) == 1:
                    break
            self.assertEqual(len(snapshot["p"]), 1)
        finally:
            await one.disconnect()
            handle = rooms.ROOMS.pop(room.code, None)
            if handle and handle.task:
                handle.task.cancel()

    async def test_full_queue_of_slow_player_does_not_raise(self):
        room = rooms.create_room("tdm", 10)
        layer = get_channel_layer()
        channel = await layer.new_channel()
        try:
            for _ in range(layer.capacity):
                await layer.send(channel, {"type": "game.msg", "data": {}})
            room.handle(room.add_player("Аня", 0, channel, 0.0).id, {"t": "ping", "c": 1}, 0.0)
            await rooms.flush(room)
            self.assertEqual(room.outbox, [])
        finally:
            del rooms.ROOMS[room.code]

    async def test_message_to_closed_tab_does_not_crash_consumer(self):
        consumer = GameConsumer()
        consumer.send_json = AsyncMock(side_effect=Disconnected("closed"))
        await consumer.game_msg({"data": {"t": "s"}})
        consumer.send_json.assert_awaited_once()

    async def test_game_messages_skip_database_thread(self):
        """Снимки игры не должны ждать общий поток базы данных (из-за этого игра зависала)."""
        consumer = GameConsumer()
        consumer.send_json = AsyncMock()
        with patch("channels.consumer.aclose_old_connections", AsyncMock()) as closer:
            await consumer.dispatch({"type": "game.msg", "data": {"t": "s"}})
        closer.assert_not_awaited()
        consumer.send_json.assert_awaited_once_with({"t": "s"})

    async def test_many_snapshots_reach_both_players(self):
        room = rooms.create_room("tdm", 10)
        path = f"/ws/room/{room.code}/"
        one = WebsocketCommunicator(application, path)
        two = WebsocketCommunicator(application, path)
        try:
            await one.connect()
            await two.connect()
            for ws, name in ((one, "А"), (two, "Б")):
                await ws.send_to(text_data=json.dumps({"t": "join", "name": name}))
                await self._recv_until(ws, "welcome")
            room.use_lobby = False
            for ws in (one, two):
                seen = 0
                for _ in range(400):
                    if (await ws.receive_json_from(timeout=3)).get("t") == "s":
                        seen += 1
                        if seen >= 40:
                            break
                self.assertGreaterEqual(seen, 40)
        finally:
            for ws in (one, two):
                await ws.disconnect()
            handle = rooms.ROOMS.pop(room.code, None)
            if handle and handle.task:
                handle.task.cancel()

    async def test_unknown_room_is_rejected(self):
        ws = WebsocketCommunicator(application, "/ws/room/QQQQ/")
        await ws.connect()
        self.assertEqual((await ws.receive_json_from())["t"], "error")
        await ws.disconnect()
