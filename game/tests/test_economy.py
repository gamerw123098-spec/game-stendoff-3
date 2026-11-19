import json
import random
from collections import Counter
from unittest.mock import patch

from channels.testing import WebsocketCommunicator
from django.test import Client, SimpleTestCase, TestCase, TransactionTestCase

from config.asgi import application
from game import profiles, rooms, skins
from game.engine import BUY_TIME, MODES, ROUND_LOSS_MONEY, ROUND_WIN_MONEY, WEAPONS, Room
from game.models import Item, Profile

from .test_engine import aim_at, place_duel


class ShopTests(SimpleTestCase):
    def setUp(self):
        self.room = Room("TEST", "rounds", 5, now=0.0)
        self.p = self.room.add_player("A", 0, "a", 0.0)

    def test_start_loadout(self):
        self.assertEqual(self.p.money, MODES["rounds"]["money"])
        self.assertEqual(self.room.owned(self.p), ["pistol", "knife"])
        self.assertEqual(self.p.weapon, "pistol")

    def test_buy_takes_money_and_equips(self):
        self.p.money = 3000
        self.assertTrue(self.room.try_buy(self.p, "rifle", 1.0))
        self.assertEqual(self.p.money, 3000 - WEAPONS["rifle"]["price"])
        self.assertEqual((self.p.primary, self.p.weapon), ("rifle", "rifle"))

    def test_cannot_buy_without_money_or_twice(self):
        self.assertFalse(self.room.try_buy(self.p, "sniper", 1.0))
        self.p.money = 9000
        self.assertTrue(self.room.try_buy(self.p, "smg", 1.0))
        money = self.p.money
        self.assertFalse(self.room.try_buy(self.p, "smg", 1.0))
        self.assertEqual(self.p.money, money)

    def test_shop_closes_after_buy_time(self):
        self.p.money = 9000
        self.assertFalse(self.room.try_buy(self.p, "rifle", BUY_TIME + 0.1))
        self.assertTrue(self.room.try_buy(self.p, "rifle", BUY_TIME - 0.1))

    def test_garbage_items_rejected(self):
        self.p.money = 9000
        for item in ("knife", "nope", ["rifle"], None, 5):
            self.assertFalse(self.room.try_buy(self.p, item, 1.0))
        self.assertEqual(self.p.money, 9000)

    def test_cannot_switch_to_weapon_not_owned(self):
        self.room.switch_weapon(self.p, "sniper", 1.0)
        self.assertEqual(self.p.weapon, "pistol")
        self.room.switch_weapon(self.p, "knife", 1.0)
        self.assertEqual(self.p.weapon, "knife")

    def test_armor_upgrade_and_damage(self):
        self.p.money = 2000
        self.assertTrue(self.room.try_buy(self.p, "vest", 1.0))
        self.assertTrue(self.room.try_buy(self.p, "helmet", 1.0))
        self.assertFalse(self.room.try_buy(self.p, "vest", 1.0))
        self.assertEqual(self.p.money, 2000 - 650 - 1000)
        attacker = self.room.add_player("B", 1, "b", 0.0)
        self.room._damage(self.p, attacker, 100, False, 1.0)
        self.assertEqual(self.p.hp, 30)
        self.p.hp = 100
        self.room._damage(self.p, attacker, 100, True, 1.0)
        self.assertEqual(self.p.hp, 40)


class ShopProtectionTests(SimpleTestCase):
    def setUp(self):
        self.room = Room("TEST", "tdm", 30, now=0.0)
        self.p = self.room.add_player("A", 0, "a", 0.0)

    def test_protected_while_choosing(self):
        self.room.handle(self.p.id, {"t": "shop", "open": 1}, 0.5)
        self.assertEqual(self.p.protected_until, BUY_TIME)
        self.room.handle(self.p.id, {"t": "shop", "open": 0}, 3.0)
        self.assertEqual(self.p.protected_until, 3.5)

    def test_no_protection_after_moving_or_second_open(self):
        self.room.handle(self.p.id, {"t": "shop", "open": 0}, 2.0)
        self.room.handle(self.p.id, {"t": "shop", "open": 1}, 3.0)
        self.assertLess(self.p.protected_until, 3.0)

        self.room._spawn(self.p, 5.0)
        self.room.handle(self.p.id, {"t": "pos", "x": self.p.x + 0.3, "y": 0, "z": self.p.z,
                                     "yaw": 0, "pitch": 0, "life": self.p.life}, 5.2)
        self.room.handle(self.p.id, {"t": "shop", "open": 1}, 7.0)
        self.assertLess(self.p.protected_until, 7.0)

    def test_no_shop_protection_in_rounds(self):
        room = Room("TEST", "rounds", 5, now=0.0)
        a = room.add_player("A", 0, "a", 0.0)
        room.add_player("B", 1, "b", 0.0)
        room.tick(0.05)
        room.handle(a.id, {"t": "shop", "open": 1}, 0.1)
        self.assertLess(a.protected_until, 0.1)


class RewardMoneyTests(SimpleTestCase):
    def test_kill_gives_money_and_death_loses_weapons(self):
        room = Room("TEST", "rounds", 5, now=0.0)
        a = room.add_player("A", 0, "a", 0.0)
        b = room.add_player("B", 1, "b", 0.0)
        room.tick(0.05)
        room.tick(3.2)
        self.assertEqual(room.phase, "live")
        b.primary, b.armor, b.weapon = "rifle", 2, "rifle"
        place_duel(a, b)
        a.money, b.hp = 0, 1
        a.next_shot = 0
        yaw, pitch = aim_at(a, b)
        room.try_fire(a, yaw, pitch, True, None, 3.3)
        self.assertEqual(a.money, WEAPONS["pistol"]["reward"])
        self.assertEqual((b.primary, b.armor), (None, 0))

        money_a, money_b = a.money, b.money
        room.tick(3.4)
        self.assertEqual(room.phase, "round_end")
        self.assertEqual(a.money, money_a + ROUND_WIN_MONEY)
        self.assertEqual(b.money, money_b + ROUND_LOSS_MONEY)

        # Следующий раунд: выживший хранит покупки, а погибший с пистолетом и новым окном магазина
        a.primary, a.weapon = "rifle", "rifle"
        room.tick(8.0)
        self.assertEqual(room.phase, "freeze")
        self.assertEqual((a.weapon, a.primary), ("rifle", "rifle"))
        self.assertEqual((b.weapon, b.primary), ("pistol", None))
        self.assertEqual(b.buy_until, 8.0 + BUY_TIME)

    def test_money_is_capped(self):
        room = Room("TEST", "tdm", 30, now=0.0)
        p = room.add_player("A", 0, "a", 0.0)
        p.money = 15900
        room._earn(p, 500)
        self.assertEqual(p.money, 16000)

    def test_only_active_winners_with_profile_get_reward(self):
        room = Room("TEST", "tdm", 30, now=0.0)
        played = room.add_player("A", 0, "a", 0.0, profile_id=11)
        room.add_player("Новичок", 0, "b", 0.0, profile_id=12)
        room.add_player("Гость", 0, "c", 0.0)
        loser = room.add_player("Д", 1, "d", 0.0, profile_id=13)
        played.kills = loser.deaths = 1
        room._finish_match(0, 1.0)
        self.assertEqual(room.pending_rewards, [(played.id, 11)])

    def test_draw_gives_no_reward(self):
        room = Room("TEST", "tdm", 30, now=0.0)
        p = room.add_player("A", 0, "a", 0.0, profile_id=11)
        p.kills = 1
        room._finish_match(-1, 1.0)
        self.assertEqual(room.pending_rewards, [])


class SkinCatalogTests(SimpleTestCase):
    def test_odds_sum_to_100(self):
        self.assertAlmostEqual(sum(r["weight"] for r in skins.RARITIES.values()), 100.0)

    def test_catalog_is_valid(self):
        for skin in skins.SKINS.values():
            self.assertIn(skin["weapon"], WEAPONS)
            self.assertIn(skin["rarity"], skins.RARITIES)

    def test_every_rarity_can_drop_with_right_share(self):
        rng = random.Random(7)
        counts = Counter(skins.roll_skin(rng)["rarity"] for _ in range(20000))
        for rarity, info in skins.RARITIES.items():
            self.assertGreater(counts[rarity], 0)
            self.assertAlmostEqual(counts[rarity] / 200, info["weight"], delta=1.5)


class ProfileApiTests(TestCase):
    def post(self, url, data, status=200):
        response = Client().post(url, json.dumps(data), content_type="application/json")
        self.assertEqual(response.status_code, status, response.content)
        return response.json()

    def test_new_profile_has_no_free_case_and_can_be_restored_by_code(self):
        created = self.post("/api/profile/", {})
        self.assertEqual(created["cases"], 0)
        again = self.post("/api/profile/", {"code": created["code"].lower()})
        self.assertEqual(again["code"], created["code"])
        self.post("/api/profile/", {"code": "NOSUCHCODE"}, status=404)

    def test_open_case_spends_it_and_gives_skin(self):
        code = self.post("/api/profile/", {})["code"]
        Profile.objects.filter(code=code).update(cases=1)
        opened = self.post("/api/case/open/", {"code": code})
        self.assertIn(opened["skin"], skins.SKINS)
        self.assertEqual(opened["profile"]["cases"], 0)
        self.assertEqual(opened["profile"]["items"], [{"skin": opened["skin"], "count": 1}])
        self.post("/api/case/open/", {"code": code}, status=409)
        self.assertEqual(Item.objects.count(), 1)

    def test_equip_only_owned_and_one_per_weapon(self):
        code = self.post("/api/profile/", {})["code"]
        profile = Profile.objects.get(code=code)
        self.post("/api/equip/", {"code": code, "skin": "rifle_magma"}, status=409)
        self.post("/api/equip/", {"code": code, "skin": ["x"]}, status=409)

        Item.objects.create(profile=profile, skin="rifle_magma")
        Item.objects.create(profile=profile, skin="rifle_dune")
        self.post("/api/equip/", {"code": code, "skin": "rifle_magma"})
        result = self.post("/api/equip/", {"code": code, "skin": "rifle_dune"})
        self.assertEqual(result["equipped"], {"rifle": "rifle_dune"})
        result = self.post("/api/equip/", {"code": code, "skin": "rifle_dune", "equip": False})
        self.assertEqual(result["equipped"], {})

    def test_bad_requests_do_not_crash(self):
        response = Client().post("/api/profile/", "not json", content_type="application/json")
        self.assertEqual(response.status_code, 200)
        self.post("/api/case/open/", {"code": 5}, status=404)
        self.post("/api/equip/", {}, status=404)
        # Инвентарь переехал в главное меню, старый адрес ведёт туда.
        self.assertRedirects(Client().get("/inventory/"), "/#cases", fetch_redirect_response=False)

    def test_currency_cases_and_spray_case_reward(self):
        created = self.post("/api/profile/", {})
        code = created["code"]
        self.assertEqual((created["credits"], created["gold"]), (100, 0))
        standard = self.post("/api/case/buy/", {"code": code, "type": "standard"})
        self.assertEqual((standard["credits"], standard["standardCases"]), (0, 1))
        with patch("game.profiles._roll_case_reward", return_value={"type": "spray", "id": "gg"}):
            opened = self.post("/api/case/open/", {"code": code, "type": "standard"})
        self.assertEqual(opened["reward"], {"type": "spray", "id": "gg"})
        self.assertIn("gg", opened["profile"]["sprays"])
        self.assertEqual(opened["profile"]["standardCases"], 0)
        self.post("/api/case/open/", {"code": code, "type": "standard"}, status=409)

    def test_win_reward_has_exactly_twenty_percent_case_threshold(self):
        profile = Profile.objects.create(code="CHANCE0001", cases=0)
        with patch("game.profiles._rng.random", return_value=0.199):
            profiles.grant_wins([profile.pk])
        profile.refresh_from_db()
        self.assertEqual((profile.cases, profile.wins), (1, 1))
        with patch("game.profiles._rng.random", return_value=0.2):
            profiles.grant_wins([profile.pk])
        profile.refresh_from_db()
        self.assertEqual((profile.cases, profile.wins), (1, 2))

    def test_gold_shop_buys_skin_and_premium_case(self):
        created = self.post("/api/profile/", {})
        code = created["code"]
        Profile.objects.filter(code=code).update(gold=100)
        result = self.post("/api/store/skin/", {"code": code, "skin": "knife_carbon"})
        self.assertEqual(result["gold"], 50)
        self.assertEqual(result["items"], [{"skin": "knife_carbon", "count": 1}])
        result = self.post("/api/case/buy/", {"code": code, "type": "premium"})
        self.assertEqual((result["gold"], result["premiumCases"]), (20, 1))
        self.post("/api/store/skin/", {"code": code, "skin": "unknown"}, status=409)

    def test_market_listing_transfers_item_and_gold(self):
        seller_code = self.post("/api/profile/", {})["code"]
        buyer_code = self.post("/api/profile/", {})["code"]
        seller = Profile.objects.get(code=seller_code)
        buyer = Profile.objects.get(code=buyer_code)
        seller.gold = 20
        buyer.gold = 500
        seller.save(update_fields=["gold"])
        buyer.save(update_fields=["gold"])
        item = Item.objects.create(profile=seller, skin="rifle_dune")
        listing = self.post("/api/market/", {"code": seller_code, "action": "list", "skin": "rifle_dune", "price": 180})
        listing_id = listing["listings"][0]["id"]
        self.assertEqual(listing["profile"]["items"][0]["listed"], 1)
        self.post("/api/market/", {"code": seller_code, "action": "buy", "listing": listing_id}, status=409)
        bought = self.post("/api/market/", {"code": buyer_code, "action": "buy", "listing": listing_id})
        item.refresh_from_db()
        seller.refresh_from_db()
        self.assertEqual(item.profile_id, buyer.pk)
        self.assertEqual((seller.gold, bought["profile"]["gold"]), (200, 320))
        self.assertEqual(bought["listings"], [])

    def test_market_rejects_equipped_skins_and_items_on_sale(self):
        code = self.post("/api/profile/", {})["code"]
        profile = Profile.objects.get(code=code)
        Item.objects.create(profile=profile, skin="rifle_dune")
        self.post("/api/equip/", {"code": code, "skin": "rifle_dune"})
        self.post("/api/market/", {"code": code, "action": "list", "skin": "rifle_dune", "price": 25}, status=409)
        self.post("/api/equip/", {"code": code, "skin": "rifle_dune", "equip": False})
        result = self.post("/api/market/", {"code": code, "action": "list", "skin": "rifle_dune", "price": 25})
        self.post("/api/equip/", {"code": code, "skin": "rifle_dune"}, status=409)
        self.assertEqual(result["profile"]["items"][0]["listed"], 1)

    def test_main_menu_has_cases_inventory_sprays_and_profile(self):
        page = Client().get("/")
        for text in ("Кейсы", "Инвентарь", "Спреи", "Рынок", "Настройки", "Профиль", 'id="open-case"',
                     'id="market-listings"', 'id="settings-sound-toggle"', 'id="spray-grid"', 'id="catalog"'):
            self.assertContains(page, text)


class GameProfileTests(TransactionTestCase):
    async def _recv_until(self, ws, kind, limit=80):
        for _ in range(limit):
            msg = await ws.receive_json_from(timeout=3)
            if msg.get("t") == kind:
                return msg
        self.fail(f"Сообщение {kind} не пришло")

    @patch("game.profiles._rng.random", return_value=0.1)
    async def test_skins_are_sent_and_win_can_grant_case(self, mock_random):
        from channels.db import database_sync_to_async as db

        profile = await db(profiles.create_profile)()
        await Item.objects.acreate(profile=profile, skin="rifle_magma")
        await db(profiles.set_equipped)(profile, "rifle_magma", True)
        cases_before = profile.cases
        credits_before, gold_before = profile.credits, profile.gold

        room = rooms.create_room("tdm", 10)
        ws = WebsocketCommunicator(application, f"/ws/room/{room.code}/")
        try:
            await ws.connect()
            await ws.send_to(text_data=json.dumps(
                {"t": "join", "name": "Аня", "team": 0, "profile": profile.code}))
            await self._recv_until(ws, "welcome")
            roster = await self._recv_until(ws, "roster")
            self.assertEqual(roster["players"][0]["skins"], {"rifle": "rifle_magma"})

            player = next(iter(room.players.values()))
            player.kills = 1
            room._finish_match(0, 1.0)
            reward = await self._recv_until(ws, "reward")
            self.assertEqual(reward["ids"], [player.id])
            await profile.arefresh_from_db()
            self.assertEqual((profile.cases, profile.wins), (cases_before + 1, 1))
            self.assertEqual((profile.credits, profile.gold), (credits_before + 100, gold_before + 25))
            self.assertEqual(profile.nick, "Аня")

            # Скин сняли в инвентаре: игра узнаёт об этом при возвращении на вкладку
            await db(profiles.set_equipped)(profile, "rifle_magma", False)
            await ws.send_to(text_data=json.dumps({"t": "refresh"}))
            for _ in range(80):
                roster = await self._recv_until(ws, "roster")
                if roster["players"][0]["skins"] == {}:
                    break
            self.assertEqual(roster["players"][0]["skins"], {})
        finally:
            await ws.disconnect()
            handle = rooms.ROOMS.pop(room.code, None)
            if handle and handle.task:
                handle.task.cancel()

    async def test_unknown_profile_plays_as_guest(self):
        room = rooms.create_room("tdm", 10)
        ws = WebsocketCommunicator(application, f"/ws/room/{room.code}/")
        try:
            await ws.connect()
            for bad in ("NOSUCHCODE", 5):
                await ws.send_to(text_data=json.dumps({"t": "join", "name": "Г", "profile": bad}))
                await self._recv_until(ws, "welcome")
                self.assertIsNone(next(iter(room.players.values())).profile_id)
                break
        finally:
            await ws.disconnect()
            handle = rooms.ROOMS.pop(room.code, None)
            if handle and handle.task:
                handle.task.cancel()
