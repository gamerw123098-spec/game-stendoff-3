import math

from django.test import SimpleTestCase

from game import world
from game.engine import (
    BOMB_TIME, DEFUSE_TIME, DEFUSE_TIME_KIT, FREEZE_TIME, GRENADES, GUNGAME_LADDER, PLANT_TIME,
    ROUND_END_TIME, Grenade, Room,
)

from .test_engine import WALL_X, WALL_Z, aim_at


def live_defuse(target=5):
    """Комната обезвреживания 1 на 1, раунд уже идёт."""
    room = Room("TEST", "defuse", target, now=0.0)
    a = room.add_player("Атака", 0, "a", 0.0)
    d = room.add_player("Защита", 1, "d", 0.0)
    room.tick(0.05)
    assert room.phase == "freeze"
    room.tick(0.05 + FREEZE_TIME + 0.05)
    assert room.phase == "live"
    return room, a, d, 3.2


def to_site(player, site):
    player.x, player.y, player.z = site["x"], 0.0, site["z"]
    player.speed = 0.0


class GrenadeTests(SimpleTestCase):
    def setUp(self):
        self.room = Room("TEST", "tdm", 30, now=0.0)
        self.a = self.room.add_player("A", 0, "a", 0.0)
        self.b = self.room.add_player("B", 1, "b", 0.0)
        self.a.x, self.a.y, self.a.z = -26.0, 0.0, 20.0
        self.b.x, self.b.y, self.b.z = -22.0, 0.0, 20.0
        self.a.protected_until = self.b.protected_until = 0
        self.a.yaw = -math.pi / 2  # смотрит на +x

    def drop_grenade(self, kind, x, z, explode_at=1.05):
        """Граната, уже лежащая в нужном месте и готовая взорваться."""
        self.room.grenades.append(Grenade(99, kind, self.a.id, x, 0.5, z, 0.0, 0.0, 0.0, explode_at))

    def run_for(self, start, seconds):
        t = start
        while t < start + seconds:
            t += 0.05
            self.room._update_grenades(t, 0.05)
        return t

    def test_buy_respects_limits_and_money(self):
        self.a.money = 2000
        self.assertTrue(self.room.try_buy(self.a, "flash", 1.0))
        self.assertTrue(self.room.try_buy(self.a, "flash", 1.0))
        self.assertFalse(self.room.try_buy(self.a, "flash", 1.0))
        self.assertTrue(self.room.try_buy(self.a, "he", 1.0))
        self.assertFalse(self.room.try_buy(self.a, "he", 1.0))
        self.assertEqual(self.a.money, 2000 - 200 - 200 - 300)

    def test_cannot_throw_without_grenade(self):
        self.assertFalse(self.room.throw_grenade(self.a, "he", 0.0, 0.0, 1.0))
        self.assertFalse(self.room.throw_grenade(self.a, ["he"], 0.0, 0.0, 1.0))
        self.assertEqual(self.room.grenades, [])

    def test_he_hurts_enemy_not_team_or_owner(self):
        mate = self.room.add_player("C", 0, "c", 0.0)
        mate.x, mate.y, mate.z = -23.0, 0.0, 20.0
        mate.protected_until = 0
        self.a.x = -24.0  # взрыв достанет и бросившего, если бы урон по себе был
        self.drop_grenade("he", -23.0, 20.0)
        self.run_for(1.0, 0.2)
        self.assertLess(self.b.hp, 100)
        self.assertEqual((mate.hp, self.a.hp), (100, 100))
        self.assertEqual(self.room.grenades, [])

    def test_he_hit_points_to_explosion_not_thrower(self):
        self.drop_grenade("he", -23.0, 20.0)
        self.room.drain()
        self.run_for(1.0, 0.2)
        hits = [m for _, m in self.room.drain() if m.get("t") == "hit"]
        self.assertEqual(hits[0]["from"], [-23.0, 20.0])

    def test_throw_spends_grenade_and_flies_far(self):
        self.a.grenades["he"] = 1
        self.assertTrue(self.room.throw_grenade(self.a, "he", self.a.yaw, 0.0, 1.0))
        self.assertEqual(self.a.grenades["he"], 0)
        g = self.room.grenades[0]
        start = g.x
        self.run_for(1.0, GRENADES["he"]["fuse"] - 0.1)
        self.assertGreater(g.x - start, 8.0)
        self.assertFalse(self.room.throw_grenade(self.a, "he", self.a.yaw, 0.0, 3.0))

    def test_he_kill_gives_score_and_feed(self):
        self.b.hp = 1
        self.drop_grenade("he", -23.0, 20.0)
        self.room.drain()
        self.run_for(1.0, 0.2)
        self.assertFalse(self.b.alive)
        self.assertEqual((self.a.kills, self.room.scores[0]), (1, 1))
        kills = [m for _, m in self.room.drain() if m.get("t") == "kill"]
        self.assertEqual(kills[0]["w"], "he")

    def test_wall_blocks_explosion(self):
        self.a.x, self.a.z = WALL_X - 2.0, WALL_Z
        self.b.x, self.b.z = WALL_X + 1.5, WALL_Z  # стена между ними
        self.drop_grenade("he", WALL_X - 1.0, WALL_Z)
        self.run_for(1.0, 0.2)
        self.assertEqual(self.b.hp, 100)

    def test_grenade_bounces_and_never_enters_walls_or_ground(self):
        self.a.x, self.a.z = WALL_X - 2.0, WALL_Z
        self.a.grenades["he"] = 1
        self.room.throw_grenade(self.a, "he", self.a.yaw, 0.1, 1.0)
        g = self.room.grenades[0]
        for i in range(30):
            self.room._move_grenade(g, 0.05)
            self.assertGreater(g.y, 0.0)
            self.assertFalse(self.room.map.point_inside(g.x, g.y, g.z), (i, g))
        self.assertLess(g.x, WALL_X - 0.4)  # отскочила от стены и не прошла сквозь неё

    def test_flash_blinds_more_when_looking_at_it(self):
        self.b.yaw = math.pi / 2  # B отвернулся на -x, вспышка у него за спиной
        self.drop_grenade("flash", -18.0, 20.0)
        self.room.drain()
        self.run_for(1.0, 0.2)
        boom = next(m for _, m in self.room.drain() if m.get("t") == "boom")
        self.assertGreater(boom["blind"][self.a.id], boom["blind"][self.b.id])

    def test_flash_stops_bot_from_acting(self):
        bot = self.room.add_bot(0.0)
        bot.x, bot.y, bot.z = -24.0, 0.0, 20.0
        self.a.grenades["flash"] = 1
        self.room.throw_grenade(self.a, "flash", self.a.yaw, -0.3, 1.0)
        self.run_for(1.0, GRENADES["flash"]["fuse"] + 0.1)
        self.assertGreater(bot.ai["blind_until"], 2.5)

    def test_smoke_lasts_and_hides_from_bots(self):
        self.a.grenades["smoke"] = 1
        self.room.throw_grenade(self.a, "smoke", self.a.yaw, -0.3, 1.0)
        t = self.run_for(1.0, GRENADES["smoke"]["fuse"] + 0.1)
        self.assertEqual(len(self.room.smokes), 1)
        smoke = self.room.smokes[0]
        self.assertTrue(self.room.smoke_blocks((smoke["x"] - 6, 1.5, smoke["z"]), (smoke["x"] + 6, 1.5, smoke["z"])))
        self.assertFalse(self.room.smoke_blocks(
            (smoke["x"] - 6, 1.5, smoke["z"] + 9), (smoke["x"] + 6, 1.5, smoke["z"] + 9)))
        self.run_for(t, 16.5)
        self.assertEqual(self.room.smokes, [])

    def test_grenades_lost_on_death(self):
        self.a.grenades["he"] = 1
        self.a.kit = True
        self.room._kill_player(self.a, 1.0)
        self.assertEqual(self.a.grenades["he"], 0)
        self.assertFalse(self.a.kit)


class DefuseTests(SimpleTestCase):
    def plant(self, room, a, t):
        to_site(a, room.map.sites[0])
        a.using = True
        room.tick(t)
        t += PLANT_TIME + 0.1
        room.tick(t)
        self.assertTrue(room.bomb.planted)
        return t

    def test_round_start_gives_bomb_to_attacker(self):
        room, a, d, _ = live_defuse()
        self.assertEqual(room.bomb.carrier, a.id)
        self.assertLess(a.x, 0)
        self.assertGreater(d.x, 0)

    def test_plant_only_on_site_after_full_hold(self):
        room, a, d, t = live_defuse()
        a.using = True
        room.tick(t)
        self.assertEqual(a.act_kind, 0)  # не на точке

        site = room.map.sites[0]
        to_site(a, site)
        room.tick(t + 0.05)
        self.assertEqual(a.act_kind, 1)
        room.tick(t + 0.05 + PLANT_TIME - 0.2)
        self.assertFalse(room.bomb.planted)
        room.tick(t + 0.05 + PLANT_TIME + 0.05)
        self.assertTrue(room.bomb.planted)
        self.assertEqual(room.bomb.site, site["id"])
        self.assertAlmostEqual(room.phase_until, room.bomb.explode_at)

    def test_releasing_or_moving_cancels_plant(self):
        room, a, d, t = live_defuse()
        to_site(a, room.map.sites[0])
        a.using = True
        room.tick(t)
        a.using = False
        room.tick(t + 0.05)
        self.assertEqual(a.act_kind, 0)
        a.using = True
        room.tick(t + 0.1)
        a.speed = 3.0
        room.tick(t + 0.15)
        self.assertEqual(a.act_kind, 0)
        self.assertFalse(room.bomb.planted)

    def test_bomb_explosion_wins_round_for_attackers(self):
        room, a, d, t = live_defuse()
        t = self.plant(room, a, t)
        d.x, d.z = 28.0, -15.0  # далеко от бомбы, но в живых
        room.tick(t + BOMB_TIME + 0.1)
        self.assertEqual((room.phase, room.winner, room.scores), ("round_end", 0, [1, 0]))
        self.assertIsNone(room.bomb)

    def test_explosion_hurts_players_nearby(self):
        room, a, d, t = live_defuse()
        t = self.plant(room, a, t)
        d.x, d.y, d.z = a.x + 1.0, 0.0, a.z
        room.tick(t + BOMB_TIME + 0.1)
        self.assertFalse(d.alive)
        self.assertFalse(a.alive)
        self.assertEqual(room.winner, 0)

    def test_defuse_wins_round_and_kit_is_faster(self):
        for kit, needed in ((False, DEFUSE_TIME), (True, DEFUSE_TIME_KIT)):
            room, a, d, t = live_defuse()
            d.kit = kit
            t = self.plant(room, a, t)
            d.x, d.y, d.z = room.bomb.x + 1.0, 0.0, room.bomb.z
            d.speed = 0.0
            d.using = True
            room.tick(t)
            self.assertEqual(d.act_kind, 2)
            room.tick(t + needed - 0.2)
            self.assertIsNotNone(room.bomb)
            room.tick(t + needed + 0.05)
            self.assertEqual((room.phase, room.winner), ("round_end", 1))
            self.assertIsNone(room.bomb)

    def test_attacker_cannot_defuse_defender_cannot_plant(self):
        room, a, d, t = live_defuse()
        to_site(d, room.map.sites[0])
        d.using = True
        room.tick(t)
        self.assertEqual(d.act_kind, 0)
        t = self.plant(room, a, t + 0.05)
        a.using = True
        room.tick(t + 0.05)
        self.assertEqual(a.act_kind, 0)

    def test_killing_all_attackers_before_plant_wins_for_defenders(self):
        room, a, d, t = live_defuse()
        room._kill_player(a, t)
        room.tick(t + 0.05)
        self.assertEqual((room.phase, room.winner), ("round_end", 1))

    def test_round_continues_if_attackers_die_after_plant(self):
        room, a, d, t = live_defuse()
        t = self.plant(room, a, t)
        room._kill_player(a, t)
        room.tick(t + 0.05)
        self.assertEqual(room.phase, "live")

    def test_killing_all_defenders_wins_for_attackers(self):
        room, a, d, t = live_defuse()
        room._kill_player(d, t)
        room.tick(t + 0.05)
        self.assertEqual((room.phase, room.winner), ("round_end", 0))

    def test_timeout_without_plant_wins_for_defenders(self):
        room, a, d, t = live_defuse()
        room.tick(room.phase_until + 0.1)
        self.assertEqual((room.phase, room.winner), ("round_end", 1))

    def test_bomb_drops_on_death_and_teammate_picks_it_up(self):
        room = Room("TEST", "defuse", 5, now=0.0)
        a = room.add_player("A", 0, "a", 0.0)
        mate = room.add_player("M", 0, "m", 0.0)
        room.add_player("D", 1, "d", 0.0)
        room.tick(0.05)
        room.tick(3.2)
        carrier = room.players[room.bomb.carrier]
        other = mate if carrier is a else a
        carrier.x, carrier.z = -26.0, 18.0
        other.x, other.z = -26.0, 14.0
        room.tick(3.25)
        room._kill_player(carrier, 3.3)
        room.tick(3.35)
        self.assertIsNone(room.bomb.carrier)
        self.assertEqual((room.bomb.x, room.bomb.z), (-26.0, 18.0))
        other.z = 17.0
        room.tick(3.4)
        self.assertEqual(room.bomb.carrier, other.id)

    def test_enemy_cannot_pick_up_bomb(self):
        room, a, d, t = live_defuse()
        room.bomb.carrier = None
        room.bomb.x, room.bomb.z = 28.0, 0.0
        a.x, a.z = -28.0, 0.0
        d.x, d.z = 28.0, 0.5
        room._update_bomb(t)
        self.assertIsNone(room.bomb.carrier)

    def test_kit_only_for_defenders_in_defuse(self):
        room, a, d, t = live_defuse()
        a.money = d.money = 1000
        a.buy_until = d.buy_until = t + 10
        self.assertFalse(room.try_buy(a, "kit", t))
        self.assertTrue(room.try_buy(d, "kit", t))
        self.assertFalse(room.try_buy(d, "kit", t))
        tdm = Room("TEST", "tdm", 30, now=0.0)
        p = tdm.add_player("P", 1, "p", 0.0)
        self.assertFalse(tdm.try_buy(p, "kit", 1.0))

    def test_sides_swap_at_half(self):
        room = Room("TEST", "defuse", 2, now=0.0)
        a = room.add_player("A", 0, "a", 0.0)
        d = room.add_player("D", 1, "d", 0.0)
        room.tick(0.05)
        self.assertEqual((room.round, room.attackers), (1, 0))
        room.tick(3.2)
        room._kill_player(d, 3.3)
        room.tick(3.35)
        self.assertEqual(room.scores, [1, 0])
        a.money = 9000
        room.tick(3.35 + ROUND_END_TIME + 0.1)
        # Террористы стали антитеррористами, счёт ушёл вместе с игроком.
        self.assertEqual((room.round, room.attackers), (2, 0))
        self.assertEqual((a.team, d.team), (1, 0))
        self.assertEqual(room.scores, [0, 1])
        self.assertEqual(a.money, 800)  # деньги сброшены, как в начале матча
        self.assertGreater(a.x, 0)  # теперь на восточной базе
        self.assertLess(d.x, 0)
        self.assertEqual(room.bomb.carrier, d.id)


class FreeForAllTests(SimpleTestCase):
    def setUp(self):
        self.room = Room("TEST", "ffa", 5, now=0.0)
        self.a = self.room.add_player("A", 1, "a", 0.0, profile_id=7)
        self.b = self.room.add_player("B", 1, "b", 0.0, profile_id=8)
        self.a.protected_until = self.b.protected_until = 0

    def test_everyone_is_enemy_and_team_cannot_change(self):
        self.assertTrue(self.room.hostile(self.a, self.b))
        self.assertFalse(self.room.hostile(self.a, self.a))
        self.assertEqual((self.a.team, self.b.team), (0, 0))
        self.room.change_team(self.a, 1, 1.0)
        self.assertTrue(self.a.alive)
        self.assertEqual(self.a.team, 0)

    def test_shots_hurt_same_team_number(self):
        self.a.x, self.a.y, self.a.z = -26.0, 0.0, 20.0
        self.b.x, self.b.y, self.b.z = -21.0, 0.0, 20.0
        self.a.next_shot = 0
        yaw, pitch = aim_at(self.a, self.b)
        self.room.try_fire(self.a, yaw, pitch, True, None, 5.0)
        self.assertLess(self.b.hp, 100)

    def test_first_to_target_wins_alone_and_gets_case(self):
        self.a.kills = 4
        self.room._damage(self.b, self.a, 500, False, 1.0)
        self.assertEqual(self.room.phase, "end")
        self.assertEqual(self.room.champion, "A")
        self.assertEqual(self.room.pending_rewards, [(self.a.id, 7)])

    def test_timeout_with_tie_has_no_winner(self):
        self.a.kills = self.b.kills = 3
        self.room._finish_timed_match(1.0)
        self.assertEqual(self.room.champion, "")
        self.assertEqual(self.room.pending_rewards, [])

    def test_spawns_use_whole_map_and_face_center(self):
        points = set(self.room._spawn_points(self.a))
        self.assertEqual(points, set(self.room.map.spawns[0] + self.room.map.spawns[1]))
        self.room._place_at_spawn(self.a)
        d = (-math.sin(self.a.yaw), -math.cos(self.a.yaw))
        self.assertGreater(d[0] * -self.a.x + d[1] * -self.a.z, 0)


class GunGameTests(SimpleTestCase):
    def setUp(self):
        self.room = Room("TEST", "gungame", None, now=0.0)
        self.a = self.room.add_player("A", 0, "a", 0.0, profile_id=7)
        self.b = self.room.add_player("B", 0, "b", 0.0)
        self.a.protected_until = self.b.protected_until = 0

    def kill_b(self, now=1.0):
        self.b.alive = True
        self.b.hp = 1
        self.room._damage(self.b, self.a, 500, False, now)

    def test_starts_on_first_weapon_without_shop(self):
        self.assertEqual(self.a.weapon, GUNGAME_LADDER[0])
        self.assertEqual(self.room.owned(self.a), [GUNGAME_LADDER[0], "knife"])
        self.a.money = 9000
        self.assertFalse(self.room.try_buy(self.a, "rifle", 1.0))

    def test_each_kill_gives_next_weapon_and_death_keeps_level(self):
        self.kill_b()
        self.assertEqual((self.a.level, self.a.weapon), (1, GUNGAME_LADDER[1]))
        self.room._kill_player(self.a, 1.0)
        self.room._spawn(self.a, 5.0)
        self.assertEqual((self.a.level, self.a.weapon), (1, GUNGAME_LADDER[1]))

    def test_knife_kill_wins(self):
        self.a.level = len(GUNGAME_LADDER) - 1
        self.room._apply_level(self.a)
        self.assertEqual(self.a.weapon, "knife")
        self.kill_b()
        self.assertEqual(self.room.phase, "end")
        self.assertEqual(self.room.champion, "A")
        self.assertEqual(self.room.pending_rewards, [(self.a.id, 7)])


class BotObjectiveTests(SimpleTestCase):
    def test_bots_play_every_mode_on_every_map(self):
        for game_map in world.MAPS:
            for mode in ("tdm", "rounds", "defuse", "ffa", "gungame"):
                room = Room("BOTS", mode, None, now=0.0, map_id=game_map)
                for _ in range(4):
                    room.add_bot(0.0)
                t = 0.0
                for _ in range(20 * 45):
                    t += 0.05
                    room.tick(t)
                    room.drain()
                    for p in room.players.values():
                        self.assertFalse(room.map.point_inside(p.x, 1.0, p.z), (game_map, mode, p.name))

    def test_bots_plant_and_defuse(self):
        planted = defused = exploded = 0
        room = Room("BOTS", "defuse", 15, now=0.0)
        for _ in range(6):
            room.add_bot(0.0)
        # Бой мешает увидеть работу с бомбой: в этом тесте боты не видят друг друга.
        room.smoke_blocks = lambda a, b: True
        t = 0.0
        for _ in range(20 * 400):
            t += 0.05
            room.tick(t)
            for _, msg in room.drain():
                if msg.get("t") == "bomb":
                    planted += msg["ev"] == "planted"
                    defused += msg["ev"] == "defused"
                elif msg.get("t") == "boom" and msg.get("kind") == "bomb":
                    exploded += 1
            if planted and defused:
                break
        self.assertGreater(planted, 0)
        self.assertGreater(defused + exploded, 0)
