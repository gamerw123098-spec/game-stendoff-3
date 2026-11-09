import math

from django.test import SimpleTestCase

from game import skins
from game.engine import CATEGORIES, GUNGAME_LADDER, WEAPON_ORDER, WEAPONS, Room, damage_multiplier

from .test_engine import aim_at, place_duel


class ArsenalTests(SimpleTestCase):
    def test_every_weapon_is_complete_and_buyable(self):
        self.assertGreaterEqual(len(WEAPONS), 18)
        for key, w in WEAPONS.items():
            if w["cat"] == "bomb":
                continue
            self.assertIn(w["cat"], CATEGORIES, key)
            self.assertGreater(w["dmg"], 0, key)
            self.assertGreaterEqual(w["zoom"], 1.0, key)
            if w["cat"] != "knife":
                self.assertGreater(w["mag"], 0, key)
                self.assertLessEqual(w["scoped"], w["spread"], key)  # прицел точнее стрельбы от бедра
        room = Room("TEST", "tdm", 30, now=0.0)
        for key, w in WEAPONS.items():
            if w["cat"] in ("knife", "bomb") or w["price"] == 0:
                continue
            p = room.add_player("P", 0, "p", 0.0) if len(room.players) < 16 else None
            if p is None:
                room = Room("TEST", "tdm", 30, now=0.0)
                p = room.add_player("P", 0, "p", 0.0)
            p.money = 16000
            self.assertTrue(room.try_buy(p, key, 1.0), key)
            self.assertEqual(p.weapon, key)

    def test_every_category_has_a_choice(self):
        cats = {w["cat"] for w in WEAPONS.values()} - {"bomb"}
        self.assertEqual(cats, set(CATEGORIES))
        self.assertGreaterEqual(sum(w["cat"] == "pistol" for w in WEAPONS.values()), 4)
        self.assertGreaterEqual(sum(w["cat"] == "rifle" for w in WEAPONS.values()), 4)

    def test_gungame_ladder_uses_real_weapons(self):
        self.assertEqual(GUNGAME_LADDER[-1], "knife")
        for key in GUNGAME_LADDER:
            self.assertIn(key, WEAPON_ORDER)

    def test_skins_exist_for_new_weapons(self):
        covered = {skin["weapon"] for skin in skins.SKINS.values()}
        for key in ("bullpup", "shotgun", "lmg", "pdw", "battle", "dmr", "heavy_sniper"):
            self.assertIn(key, covered)


class ShotgunTests(SimpleTestCase):
    def setUp(self):
        self.room = Room("TEST", "tdm", 30, now=0.0)
        self.a = self.room.add_player("A", 0, "a", 0.0)
        self.b = self.room.add_player("B", 1, "b", 0.0)
        place_duel(self.a, self.b)
        self.a.protected_until = self.b.protected_until = 0

    def fire(self, distance):
        self.b.x = self.a.x + distance
        self.b.hp, self.b.alive, self.b.armor = 100, True, 0
        self.a.weapon = "shotgun"
        self.a.ammo["shotgun"] = 6
        self.a.next_shot = 0
        self.a.heat = 0
        self.room.drain()
        yaw, pitch = aim_at(self.a, self.b, 1.0)
        self.room.try_fire(self.a, yaw, pitch, True, None, 5.0)
        return 100 - self.b.hp if self.b.alive else 100

    def test_pellets_add_up_close_and_fade_far(self):
        close = sum(self.fire(3.0) for _ in range(5)) / 5
        far = sum(self.fire(19.0) for _ in range(5)) / 5
        self.assertGreater(close, 60)  # почти все дробинки в упор
        self.assertLess(far, close / 2)

    def test_shot_message_has_every_pellet(self):
        self.fire(3.0)
        shot = next(m for _, m in self.room.drain() if m.get("t") == "shot")
        self.assertEqual(len(shot["es"]), WEAPONS["shotgun"]["pellets"])
        self.assertEqual(shot["e"], shot["es"][0])

    def test_one_shot_counts_as_one_hit_for_accuracy(self):
        self.fire(3.0)
        self.assertEqual((self.a.shots, self.a.hits), (1, 1))

    def test_falloff_curve(self):
        w = WEAPONS["shotgun"]
        self.assertEqual(damage_multiplier(w, 2.0), 1.0)
        self.assertAlmostEqual(damage_multiplier(w, 30.0), 0.25)
        self.assertTrue(0.25 < damage_multiplier(w, 13.0) < 1.0)
        self.assertEqual(damage_multiplier(WEAPONS["rifle"], 100.0), 1.0)


class AimTests(SimpleTestCase):
    def test_aiming_tightens_spread(self):
        room = Room("TEST", "tdm", 30, now=0.0)
        a = room.add_player("A", 0, "a", 0.0)
        b = room.add_player("B", 1, "b", 0.0)
        place_duel(a, b)
        b.x = a.x + 31.0  # 31 метр
        b.protected_until = 0
        yaw, pitch = aim_at(a, b, 1.0)
        a.weapon = "battle"

        def hits(aiming):
            count = 0
            for i in range(40):
                b.hp, b.alive = 100, True
                a.next_shot, a.heat, a.ammo["battle"] = 0, 0, 20
                room.try_fire(a, yaw, pitch, aiming, None, 10.0 + i)
                count += b.hp < 100 or not b.alive
            return count

        self.assertGreater(hits(True), hits(False))
