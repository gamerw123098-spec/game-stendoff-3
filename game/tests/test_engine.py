import math

from django.test import SimpleTestCase

from game import world
from game.engine import FREEZE_TIME, ROUND_END_TIME, WEAPONS, Room


def aim_at(shooter, target, height=1.0):
    dx, dz = target.x - shooter.x, target.z - shooter.z
    dy = target.y + height - shooter.eye()[1]
    return math.atan2(-dx, -dz), math.atan2(dy, math.hypot(dx, dz))


S = world.MAP_SCALE
WALL_X, WALL_Z = -22.0 * S, -11.0 * S  # стена у базы на Депо
DUEL_X, DUEL_Z = -28.0 * S, 10.0 * S  # на этой линии Депо между игроками нет стен


def place_duel(a, b):
    """Ставит двух игроков друг против друга на открытом месте."""
    a.x, a.y, a.z = DUEL_X, 0.0, DUEL_Z
    b.x, b.y, b.z = DUEL_X + 5.0 * S, 0.0, DUEL_Z


class WorldTests(SimpleTestCase):
    def test_every_map_is_playable(self):
        for game_map in world.MAPS.values():
            nav = game_map.nav
            start = nav.nearest(*game_map.spawns[0][0])
            self.assertGreaterEqual(len(game_map.spawns[0]), 8, game_map.id)
            self.assertEqual(game_map.spawns[1][0], (-game_map.spawns[0][0][0], -game_map.spawns[0][0][1]))
            for side in (0, 1):
                for x, z in game_map.spawns[side]:
                    where = (game_map.id, side, x, z)
                    self.assertTrue(abs(x) < game_map.half_x - 0.5 and abs(z) < game_map.half_z - 0.5, where)
                    self.assertFalse(game_map.point_inside(x, 1.0, z, 0.4), where)
                    self.assertTrue(nav.path(start, nav.nearest(x, z)), where)
            self.assertEqual([s["id"] for s in game_map.sites], ["A", "B"])
            for site in game_map.sites:
                where = (game_map.id, site)
                self.assertFalse(game_map.point_inside(site["x"], 1.0, site["z"], 1.0), where)
                self.assertTrue(nav.path(start, nav.nearest(site["x"], site["z"])), where)
                self.assertGreater(site["x"], 0, where)  # на половине защиты

    def test_map_boxes_stay_inside_bounds(self):
        for game_map in world.MAPS.values():
            for box in game_map.boxes:
                if box.kind != "perimeter":
                    # Стена может упираться в забор, но не выходить за него.
                    self.assertLessEqual(max(abs(box.minx), abs(box.maxx)), game_map.half_x, box)
                    self.assertLessEqual(max(abs(box.minz), abs(box.maxz)), game_map.half_z, box)

    def test_ray_stops_at_wall_and_ground(self):
        box = world.Box(5, 6, 0, 3, -1, 1)
        self.assertAlmostEqual(world.ray_box((0, 1, 0), (1, 0, 0), box, 100), 5)
        self.assertIsNone(world.ray_box((0, 5, 0), (1, 0, 0), box, 100))
        self.assertAlmostEqual(world.DEPOT.raycast((-26, 2, 20), (0, -1, 0), 100), 2)


class CombatTests(SimpleTestCase):
    def setUp(self):
        self.room = Room("TEST", "tdm", 30, now=0.0)
        self.a = self.room.add_player("A", 0, "a", 0.0)
        self.b = self.room.add_player("B", 1, "b", 0.0)
        place_duel(self.a, self.b)
        self.now = 10.0
        self.a.protected_until = self.b.protected_until = 0

    def fire(self, weapon="rifle", height=1.0):
        self.a.weapon = weapon
        self.a.next_shot = 0
        self.a.heat = 0
        yaw, pitch = aim_at(self.a, self.b, height)
        return self.room.try_fire(self.a, yaw, pitch, True, None, self.now)

    def test_body_and_head_damage(self):
        self.assertTrue(self.fire(height=1.0))
        self.assertEqual(self.b.hp, 100 - WEAPONS["rifle"]["dmg"])
        self.b.hp = 100
        self.assertTrue(self.fire(height=1.62))
        self.assertEqual(self.b.hp, 100 - int(WEAPONS["rifle"]["dmg"] * WEAPONS["rifle"]["head"]))

    def test_kill_scores_and_respawns(self):
        self.b.hp = 1
        self.fire()
        self.assertFalse(self.b.alive)
        self.assertEqual((self.a.kills, self.b.deaths, self.room.scores[0]), (1, 1, 1))
        self.room.tick(self.now + 3.1)
        self.assertTrue(self.b.alive)
        self.assertEqual(self.b.hp, 100)

    def test_no_friendly_fire(self):
        self.b.team = 0
        self.fire()
        self.assertEqual(self.b.hp, 100)

    def test_wall_blocks_bullet(self):
        self.a.x, self.a.z = WALL_X - 1.0, WALL_Z
        self.b.x, self.b.z = WALL_X + 1.0, WALL_Z  # между ними стена
        self.fire()
        self.assertEqual(self.b.hp, 100)

    def test_spawn_protection(self):
        self.b.protected_until = self.now + 1
        self.fire()
        self.assertEqual(self.b.hp, 100)

    def test_fire_rate_and_ammo_are_enforced(self):
        self.assertTrue(self.fire())
        yaw, pitch = aim_at(self.a, self.b)
        self.assertFalse(self.room.try_fire(self.a, yaw, pitch, False, None, self.now + 0.01))
        self.a.ammo["rifle"] = 1
        self.a.next_shot = 0
        self.assertTrue(self.room.try_fire(self.a, yaw, pitch, False, None, self.now + 1))
        self.assertGreater(self.a.reload_until, 0)  # пустой магазин перезаряжается сам
        self.a.next_shot = 0
        self.assertFalse(self.room.try_fire(self.a, yaw, pitch, False, None, self.now + 1.2))
        self.room.tick(self.now + 1 + WEAPONS["rifle"]["reload"] + 0.1)
        self.assertEqual(self.a.ammo["rifle"], WEAPONS["rifle"]["mag"])

    def test_knife_range(self):
        self.assertTrue(self.fire("knife"))
        self.assertEqual(self.b.hp, 100)  # 5 метров: нож не достаёт
        self.b.x = self.a.x + 1.5
        self.fire("knife")
        self.assertEqual(self.b.hp, 100 - WEAPONS["knife"]["dmg"])

    def test_lag_compensation_uses_past_position(self):
        self.room.tick(self.now - 0.1)
        rt = self.now - 0.1
        yaw, pitch = aim_at(self.a, self.b)
        self.b.z -= 5  # за это время цель ушла, но стрелок видел её на старом месте
        self.a.heat = 0
        self.a.next_shot = 0
        self.room.try_fire(self.a, yaw, pitch, True, rt, self.now)
        self.assertLess(self.b.hp, 100)

    def test_target_score_ends_match_then_restarts(self):
        self.room.scores[0] = 29
        self.b.hp = 1
        self.fire()
        self.assertEqual((self.room.phase, self.room.winner), ("end", 0))
        self.room.tick(self.now + 11)
        self.assertEqual(self.room.phase, "live")
        self.assertEqual(self.room.scores, [0, 0])
        self.assertTrue(self.a.alive and self.b.alive)


class MovementTests(SimpleTestCase):
    def setUp(self):
        self.room = Room("TEST", "tdm", 30, now=0.0)
        self.p = self.room.add_player("A", 0, "a", 0.0)
        self.p.x, self.p.y, self.p.z = -26.0, 0.0, 20.0
        self.p.last_pos_t = 1.0

    def move(self, x, y, z, now=1.05, **kw):
        msg = {"x": x, "y": y, "z": z, "yaw": 0, "pitch": 0, "life": self.p.life, **kw}
        return self.room.update_pos(self.p, msg, now)

    def test_normal_step_accepted(self):
        self.assertTrue(self.move(-25.8, 0, 20))
        self.assertEqual(self.p.x, -25.8)

    def test_teleport_rejected(self):
        self.assertFalse(self.move(10, 0, 0))
        self.assertEqual(self.p.x, -26.0)

    def test_cannot_walk_through_wall(self):
        self.p.x, self.p.z = WALL_X - 0.5, WALL_Z
        self.assertFalse(self.move(WALL_X + 0.5, 0, WALL_Z, now=2.0))

    def test_cannot_stand_inside_box(self):
        self.p.x, self.p.z = WALL_X - 0.5, WALL_Z
        self.assertFalse(self.move(WALL_X, 0, WALL_Z, now=2.0))

    def test_outdated_life_ignored(self):
        self.assertFalse(self.move(-25.8, 0, 20, life=self.p.life - 1))

    def test_bad_numbers_ignored(self):
        self.assertFalse(self.move(float("nan"), 0, 20))
        self.assertFalse(self.move(True, 0, 20))

    def test_repeated_rejects_send_correction(self):
        for _ in range(10):
            self.move(10, 0, 0)
        self.assertTrue(any(m.get("t") == "correct" for _, m in self.room.drain()))


class RoundTests(SimpleTestCase):
    def setUp(self):
        self.room = Room("TEST", "rounds", 2, now=0.0)

    def test_full_flow(self):
        room = self.room
        a = room.add_player("A", 0, "a", 0.0)
        room.tick(0.05)
        self.assertEqual(room.phase, "warmup")

        b = room.add_player("B", 1, "b", 0.1)
        room.tick(0.15)
        self.assertEqual((room.phase, room.round), ("freeze", 1))

        # Во время заморозки двигаться нельзя
        before = (a.x, a.z)
        room.update_pos(a, {"x": a.x + 0.1, "y": 0, "z": a.z, "yaw": 0, "pitch": 0, "life": a.life}, 0.2)
        self.assertEqual((a.x, a.z), before)

        t = 0.15 + FREEZE_TIME + 0.1
        room.tick(t)
        self.assertEqual(room.phase, "live")

        for expected_score in (1, 2):
            place_duel(a, b)
            b.hp = 1
            a.next_shot = 0
            yaw, pitch = aim_at(a, b)
            room.try_fire(a, yaw, pitch, True, None, t)
            self.assertFalse(b.alive)
            room.tick(t + 0.05)
            # Во втором раунде команды поменялись сторонами, счёт ушёл вместе с игроком.
            self.assertEqual((room.phase, room.scores[a.team]), ("round_end", expected_score))
            room.tick(t + 3.0)
            self.assertFalse(b.alive)  # в раундах нет возрождения
            t += ROUND_END_TIME + 0.1
            room.tick(t)
            if expected_score == 1:
                self.assertEqual((room.phase, room.round), ("freeze", 2))
                t += FREEZE_TIME + 0.1
                room.tick(t)

        self.assertEqual((room.phase, room.winner), ("end", a.team))
        t += 11
        room.tick(t)
        self.assertEqual(room.phase, "warmup")
        room.tick(t + 0.05)
        self.assertEqual(room.scores, [0, 0])
        self.assertEqual((room.phase, room.round), ("freeze", 1))
        self.assertTrue(a.alive and b.alive)

    def test_late_joiner_waits_for_next_round(self):
        room = self.room
        room.add_player("A", 0, "a", 0.0)
        room.add_player("B", 1, "b", 0.0)
        room.tick(0.05)
        room.tick(0.05 + FREEZE_TIME + 0.1)
        late = room.add_player("C", 0, "c", 4.0)
        self.assertFalse(late.alive)

    def test_opponent_leaving_returns_to_warmup(self):
        room = self.room
        room.add_player("A", 0, "a", 0.0)
        b = room.add_player("B", 1, "b", 0.0)
        room.tick(0.05)
        room.remove_player(b.id)
        room.tick(0.1)
        self.assertEqual(room.phase, "warmup")


class BotTests(SimpleTestCase):
    def test_bots_fight_without_errors_and_land_kills(self):
        room = Room("BOTS", "tdm", 100, now=0.0)
        for _ in range(4):
            room.add_bot(0.0)
        start = {p.id: (p.x, p.z) for p in room.players.values()}
        t = 0.0
        for _ in range(20 * 90):  # полторы минуты игры
            t += 0.05
            room.tick(t)
            room.drain()
            for p in room.players.values():
                self.assertFalse(world.DEPOT.point_inside(p.x, 1.0, p.z), p)
        self.assertGreater(sum(room.scores), 0)
        self.assertTrue(any((p.x, p.z) != start[p.id] for p in room.players.values()))
