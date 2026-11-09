import math
import random
import re
from pathlib import Path
from unittest import mock

from django.test import RequestFactory, SimpleTestCase, override_settings

from game import rooms, views, world
from game.engine import MAX_SPRAYS, PLANT_TIME, SPRAY_COOLDOWN, SPRAYS, TEAM_NAMES, Room

from .test_engine import S, aim_at
from .test_modes import live_defuse, to_site


def wall_spray(p, design="smile"):
    """Спрей на земле прямо под игроком."""
    return {"t": "spray", "s": design, "p": [p.x + 1.0, 0.0, p.z], "n": [0, 1, 0], "yaw": 0.3}


class StaticFilesTests(SimpleTestCase):
    def test_browser_must_check_for_new_game_files(self):
        response = self.client.get("/static/game/scene.js")
        self.assertEqual(response.status_code, 200)
        self.assertIn("no-cache", response["Cache-Control"])
        response.close()


class PublicServerTests(SimpleTestCase):
    def test_link_for_friends_uses_the_site_address(self):
        request = RequestFactory().get("/", HTTP_HOST="poligon.example.com", secure=True)
        with override_settings(ALLOWED_HOSTS=["poligon.example.com"]):
            self.assertEqual(views._base_url(request), "https://poligon.example.com")

    def test_full_server_does_not_create_rooms(self):
        with mock.patch.object(rooms, "is_full", return_value=True), mock.patch.object(rooms, "create_room") as create:
            response = self.client.post("/create/", {"mode": "tdm"})
        self.assertEqual(response.status_code, 302)
        self.assertIn("full=1", response["Location"])
        create.assert_not_called()


class SprayTests(SimpleTestCase):
    def setUp(self):
        self.room = Room("TEST", "tdm", 30, now=0.0)
        self.p = self.room.add_player("P", 0, "p", 0.0)
        self.p.x, self.p.y, self.p.z = -26.0 * S, 0.0, 20.0 * S
        self.room.drain()

    def test_spray_is_saved_and_sent_to_everyone(self):
        self.room.handle(self.p.id, wall_spray(self.p, "heart"), 1.0)
        self.assertEqual(len(self.room.sprays), 1)
        row = self.room.sprays[0]
        self.assertEqual((row[1], row[2], row[-1]), (self.p.id, "heart", "P"))
        sent = [m for ch, m in self.room.drain() if m.get("t") == "spray"]
        self.assertEqual(len(sent), 1)
        # Новый игрок сразу видит все рисунки
        q = self.room.add_player("Q", 1, "q", 1.0)
        self.assertEqual(self.room.welcome_payload(q)["sprays"], self.room.sprays)
        self.assertEqual(self.room.sync_payload()["sprays"], self.room.sprays)

    def test_server_knows_every_spray_from_the_menu(self):
        source = (Path(__file__).parent.parent / "static" / "game" / "sprays.js").read_text(encoding="utf-8")
        menu = re.findall(r"\{ id: '(\w+)', name:", source)
        self.assertEqual(menu, SPRAYS)
        self.assertEqual(len(set(menu)), len(menu))
        for design in menu:
            self.assertRegex(source, rf"\n  {design}\(ctx")

    def test_many_sprays_stay(self):
        t = 1.0
        for i in range(40):
            t += SPRAY_COOLDOWN + 0.01
            self.assertTrue(self.room.spray(self.p, wall_spray(self.p, SPRAYS[i % len(SPRAYS)]), t))
        self.assertEqual(len(self.room.sprays), 40)
        self.assertEqual(len({row[0] for row in self.room.sprays}), 40)

    def test_cooldown_unknown_design_far_point_and_bad_numbers_are_rejected(self):
        self.assertTrue(self.room.spray(self.p, wall_spray(self.p), 1.0))
        self.assertFalse(self.room.spray(self.p, wall_spray(self.p), 1.0 + SPRAY_COOLDOWN / 2))
        t = 5.0
        self.assertFalse(self.room.spray(self.p, wall_spray(self.p, "virus"), t))
        far = wall_spray(self.p)
        far["p"] = [self.p.x + 30, 0.0, self.p.z]
        self.assertFalse(self.room.spray(self.p, far, t))
        for bad in ([float("nan"), 0, 0], [0, 0], "x", [0, 0, 0]):
            msg = wall_spray(self.p)
            msg["n"] = bad
            self.assertFalse(self.room.spray(self.p, msg, t), bad)
        self.p.alive = False
        self.assertFalse(self.room.spray(self.p, wall_spray(self.p), t))

    def test_oldest_removed_only_after_limit(self):
        self.room.sprays = [[i, 1, "smile", 0, 0, 0, 0, 1, 0, 0, "P"] for i in range(MAX_SPRAYS)]
        self.assertTrue(self.room.spray(self.p, wall_spray(self.p), 1.0))
        self.assertEqual(len(self.room.sprays), MAX_SPRAYS)
        self.assertEqual(self.room.sprays[0][0], 1)

    def test_map_change_clears_sprays(self):
        self.room.spray(self.p, wall_spray(self.p), 1.0)
        self.room._configure("tdm", "depot", 30)
        self.assertEqual(len(self.room.sprays), 1)
        self.room._configure("tdm", "harbor", 30)
        self.assertEqual(self.room.sprays, [])


class BombSlotTests(SimpleTestCase):
    def test_carrier_has_bomb_in_inventory_and_can_hold_it(self):
        room, a, d, t = live_defuse()
        self.assertIn("bomb", room.owned(a))
        self.assertNotIn("bomb", room.owned(d))
        room.switch_weapon(a, "bomb", t)
        self.assertEqual(a.weapon, "bomb")
        room.switch_weapon(d, "bomb", t)
        self.assertNotEqual(d.weapon, "bomb")
        # Бомбой не выстрелить и её не купить
        yaw, pitch = aim_at(a, d)
        a.next_shot = 0
        self.assertFalse(room.try_fire(a, yaw, pitch, False, None, t + 1))
        d.money, d.buy_until = 16000, t + 10
        self.assertFalse(room.try_buy(d, "bomb", t))

    def test_planting_puts_bomb_away(self):
        room, a, d, t = live_defuse()
        room.switch_weapon(a, "bomb", t)
        to_site(a, room.map.sites[0])
        a.using = True
        room.tick(t)
        room.tick(t + PLANT_TIME + 0.1)
        self.assertTrue(room.bomb.planted)
        self.assertNotEqual(a.weapon, "bomb")
        self.assertNotIn("bomb", room.owned(a))

    def test_dead_carrier_drops_bomb_from_hands(self):
        room, a, d, t = live_defuse()
        room.switch_weapon(a, "bomb", t)
        room._kill_player(a, t)
        room.tick(t + 0.05)
        self.assertIsNone(room.bomb.carrier)
        self.assertNotEqual(a.weapon, "bomb")


    def test_bomb_leaves_hands_when_round_is_cancelled(self):
        # Вся команда вышла, матч вернулся к разминке: у оставшегося не должна остаться бомба в руках.
        room, a, d, t = live_defuse()
        room.switch_weapon(a, "bomb", t)
        room.remove_player(d.id)
        room.tick(t + 0.05)
        self.assertEqual(room.phase, "warmup")
        self.assertIsNone(room.bomb)
        self.assertIn(a.weapon, room.owned(a))
        a.next_shot = 0
        self.assertTrue(room.try_fire(a, 0.0, 0.0, False, None, t + 1))


class SpraySizeTests(SimpleTestCase):
    def setUp(self):
        self.room = Room("TEST", "tdm", 30, now=0.0)
        self.p = self.room.add_player("P", 0, "p", 0.0)
        self.p.x, self.p.y, self.p.z = -26.0 * S, 0.0, 20.0 * S

    def sprayed_size(self, value, t):
        msg = wall_spray(self.p)
        if value is not None:
            msg["size"] = value
        self.assertTrue(self.room.spray(self.p, msg, t))
        row = self.room.sprays[-1]
        self.assertEqual(row[-1], "P")  # ник остаётся последним
        return row[-2]

    def test_size_is_limited(self):
        self.assertEqual(self.sprayed_size(None, 1.0), 1.1)
        self.assertEqual(self.sprayed_size(0.6, 2.0), 0.6)
        self.assertEqual(self.sprayed_size(50, 3.0), 1.1)
        self.assertEqual(self.sprayed_size(0.01, 4.0), 0.3)
        self.assertEqual(self.sprayed_size("x", 5.0), 1.1)
        self.assertEqual(self.sprayed_size(float("nan"), 6.0), 1.1)


class TeamTests(SimpleTestCase):
    def test_team_names(self):
        self.assertEqual(TEAM_NAMES, ["Террористы", "Антитеррористы"])

    def test_maps_are_mostly_closed_and_fully_reachable(self):
        for game_map in world.MAPS.values():
            self.assertGreaterEqual(game_map.closed_share, 0.78, game_map.id)
            self.assertLessEqual(game_map.closed_share, 0.86, game_map.id)
            self.assertTrue(any(box.miny >= world.WALL_HEIGHT for box in game_map.boxes), game_map.id)
            nav = game_map.nav
            start = nav.nearest(*game_map.spawns[0][0])
            seen = {start}
            stack = [start]
            while stack:
                for other in nav.links[stack.pop()]:
                    if other not in seen:
                        seen.add(other)
                        stack.append(other)
            self.assertGreater(len(seen) / len(nav.points), 0.97, game_map.id)

    def test_cover_is_varied(self):
        for game_map in world.MAPS.values():
            kinds = {box.kind for box in game_map.boxes}
            self.assertGreaterEqual(len(kinds & {"crate", "concrete", "sandbag", "barrel", "brick", "metal", "container"}), 5, game_map.id)

    def test_fast_search_gives_the_same_answer_as_checking_every_box(self):
        rng = random.Random(5)
        for game_map in world.MAPS.values():
            for _ in range(400):
                o = (rng.uniform(-game_map.half_x, game_map.half_x), rng.uniform(0.2, 4.0), rng.uniform(-game_map.half_z, game_map.half_z))
                angle, slope = rng.uniform(-math.pi, math.pi), rng.uniform(-0.5, 0.5)
                d = (math.cos(angle) * math.cos(slope), math.sin(slope), math.sin(angle) * math.cos(slope))
                brute = 80.0 if d[1] >= -world.EPS else min(80.0, -o[1] / d[1])
                for box in game_map.boxes:
                    t = world.ray_box(o, d, box, brute)
                    if t is not None and t < brute:
                        brute = t
                self.assertAlmostEqual(game_map.raycast(o, d, 80.0), brute, places=6)

    def test_maps_are_bigger(self):
        self.assertGreater(world.MAP_SCALE, 1.0)
        self.assertGreater(world.DEPOT.half_x, 40)
