from django.test import SimpleTestCase

from game.engine import Room

from .test_engine import aim_at, place_duel


def lobby_room(mode="tdm", target=None, map_id="depot"):
    return Room("TEST", mode, target, now=0.0, map_id=map_id, lobby=True)


class LobbyTests(SimpleTestCase):
    def test_players_wait_until_host_starts(self):
        room = lobby_room()
        host = room.add_player("Ведущий", 0, "h", 0.0)
        guest = room.add_player("Гость", 1, "g", 0.0)
        room.tick(5.0)
        self.assertEqual(room.phase, "lobby")
        self.assertFalse(host.alive or guest.alive)
        self.assertEqual(room.host_id, host.id)

        room.handle(guest.id, {"t": "start"}, 6.0)
        self.assertEqual(room.phase, "lobby")  # начать может только ведущий
        room.handle(host.id, {"t": "start"}, 6.0)
        self.assertEqual(room.phase, "live")
        self.assertTrue(host.alive and guest.alive)

    def test_bots_do_nothing_in_lobby_and_only_host_adds_them(self):
        room = lobby_room()
        host = room.add_player("Ведущий", 0, "h", 0.0)
        guest = room.add_player("Гость", 1, "g", 0.0)
        room.handle(guest.id, {"t": "bot", "op": "add"}, 1.0)
        self.assertEqual(len(room.players), 2)
        room.handle(host.id, {"t": "bot", "op": "add"}, 1.0)
        bot = next(p for p in room.players.values() if p.is_bot)
        start = (bot.x, bot.z)
        for i in range(40):
            room.tick(1.0 + i * 0.05)
        self.assertEqual((bot.x, bot.z), start)
        self.assertFalse(bot.alive)

    def test_host_passes_to_next_human_when_leaving(self):
        room = lobby_room()
        host = room.add_player("Ведущий", 0, "h", 0.0)
        room.add_bot(0.0)
        guest = room.add_player("Гость", 1, "g", 0.0)
        room.remove_player(host.id)
        self.assertEqual(room.host_id, guest.id)
        room.remove_player(guest.id)
        self.assertIsNone(room.host_id)

    def test_host_changes_mode_map_and_target(self):
        room = lobby_room()
        host = room.add_player("Ведущий", 0, "h", 0.0)
        guest = room.add_player("Гость", 1, "g", 0.0)
        room.handle(guest.id, {"t": "settings", "mode": "ffa"}, 1.0)
        self.assertEqual(room.mode, "tdm")
        room.handle(host.id, {"t": "settings", "mode": "defuse", "map": "harbor", "target": 3}, 1.0)
        self.assertEqual((room.mode, room.map.id, room.target), ("defuse", "harbor", 3))
        settings = [m for _, m in room.drain() if m.get("t") == "settings"]
        self.assertEqual(settings[-1]["world"]["id"], "harbor")

        room.handle(host.id, {"t": "settings", "mode": "ffa", "map": "factory"}, 2.0)
        self.assertEqual({p.team for p in room.players.values()}, {0})
        room.handle(host.id, {"t": "settings", "mode": "tdm", "target": "много", "map": ["x"]}, 3.0)
        self.assertEqual((room.mode, room.map.id, room.target), ("tdm", "depot", 30))
        self.assertEqual(sorted(p.team for p in room.players.values()), [0, 1])

    def test_settings_cannot_change_during_match(self):
        room = lobby_room()
        host = room.add_player("Ведущий", 0, "h", 0.0)
        room.handle(host.id, {"t": "start"}, 1.0)
        room.handle(host.id, {"t": "settings", "mode": "ffa"}, 2.0)
        self.assertEqual(room.mode, "tdm")

    def test_match_end_shows_results_and_waits_for_host(self):
        room = lobby_room("tdm", 5)
        host = room.add_player("Ведущий", 0, "h", 0.0)
        guest = room.add_player("Гость", 1, "g", 0.0)
        room.handle(host.id, {"t": "start"}, 1.0)
        host.protected_until = guest.protected_until = 0
        place_duel(host, guest)
        for i in range(5):
            guest.alive, guest.hp = True, 1
            host.next_shot = 0
            host.heat = 0  # иначе разброс копится и пуля изредка уходит выше головы
            yaw, pitch = aim_at(host, guest, 1.62)
            room.try_fire(host, yaw, pitch, True, None, 2.0 + i)
        self.assertEqual(room.phase, "end")
        results = [m for _, m in room.drain() if m.get("t") == "results"][-1]
        self.assertEqual(results["winner"], 0)
        self.assertEqual(results["mvp"], host.id)
        top = results["rows"][0]
        self.assertEqual((top["name"], top["k"], top["hs"], top["acc"]), ("Ведущий", 5, 100, 100))
        self.assertEqual(results["rows"][1]["d"], 5)

        room.tick(100.0)  # без ведущего новый матч не начинается
        self.assertEqual(room.phase, "end")
        self.assertIsNotNone(room.welcome_payload(guest)["results"])
        room.handle(host.id, {"t": "lobby"}, 101.0)
        self.assertEqual(room.phase, "lobby")
        room.handle(host.id, {"t": "start"}, 102.0)
        self.assertEqual(room.phase, "live")
        self.assertEqual((host.kills, host.shots), (0, 0))


class ResyncTests(SimpleTestCase):
    """Игрок, у которого потерялись сообщения, должен восстановить картину сам."""

    def test_snapshot_shows_version_and_sync_has_everything(self):
        room = lobby_room()
        host = room.add_player("Ведущий", 0, "h", 0.0)
        version_before = room.version
        guest = room.add_player("Гость", 1, "g", 0.0)
        self.assertGreater(room.version, version_before)
        self.assertEqual(room.snapshot(1.0)["v"], room.version)

        room.drain()
        room.handle(host.id, {"t": "sync"}, 1.0)
        (channel, sync), = room.drain()
        self.assertEqual(channel, "h")  # ответ только тому, кто спросил
        self.assertEqual(sync["v"], room.version)
        self.assertEqual([p["name"] for p in sync["roster"]["players"]], ["Ведущий", "Гость"])
        self.assertEqual(sync["roster"]["host"], host.id)
        self.assertEqual(sync["phase"]["ph"], "lobby")
        self.assertEqual(sync["settings"]["world"]["id"], "depot")
        self.assertIsNone(sync["results"])

    def test_every_important_event_raises_version(self):
        room = lobby_room()
        host = room.add_player("Ведущий", 0, "h", 0.0)
        for message in ({"t": "settings", "mode": "ffa"}, {"t": "start"}):
            before = room.version
            room.handle(host.id, message, 1.0)
            self.assertGreater(room.version, before, message)

    def test_snapshot_carries_life_for_lost_spawn(self):
        room = Room("TEST", "tdm", 30, now=0.0)
        p = room.add_player("A", 0, "a", 0.0)
        row = next(r for r in room.snapshot(1.0)["p"] if r[0] == p.id)
        self.assertEqual(row[25], p.life)


class StatsTests(SimpleTestCase):
    def setUp(self):
        self.room = Room("TEST", "tdm", 30, now=0.0)
        self.a = self.room.add_player("A", 0, "a", 0.0)
        self.helper = self.room.add_player("H", 0, "h", 0.0)
        self.b = self.room.add_player("B", 1, "b", 0.0)

    def test_assist_needs_real_damage(self):
        self.room._damage(self.b, self.helper, 40, False, 1.0)
        self.room._damage(self.b, self.a, 100, False, 1.0)
        self.assertEqual((self.a.kills, self.helper.assists), (1, 1))
        self.assertEqual(self.helper.damage, 40)
        self.assertEqual(self.a.damage, 60)  # засчитывается только реально снятое здоровье

    def test_small_damage_is_not_assist(self):
        self.room._damage(self.b, self.helper, 10, False, 1.0)
        self.room._damage(self.b, self.a, 100, False, 1.0)
        self.assertEqual(self.helper.assists, 0)

    def test_damage_from_previous_life_does_not_count(self):
        self.room._damage(self.b, self.helper, 50, False, 1.0)
        self.room._kill_player(self.b, 1.5)
        self.room._spawn(self.b, 5.0)
        self.room._damage(self.b, self.a, 100, False, 6.0)
        self.assertEqual(self.helper.assists, 0)

    def test_accuracy_counts_shots_and_hits(self):
        place_duel(self.a, self.b)
        self.b.protected_until = 0
        yaw, pitch = aim_at(self.a, self.b)
        self.a.next_shot = 0
        self.room.try_fire(self.a, yaw, pitch, True, None, 5.0)
        self.a.next_shot = 0
        self.room.try_fire(self.a, yaw + 1.0, pitch, True, None, 6.0)
        self.assertEqual((self.a.shots, self.a.hits), (2, 1))
