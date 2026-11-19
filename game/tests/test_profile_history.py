from django.test import TestCase

from django.test import Client

from game import profiles
from game import rooms
from game.engine import Room
from game.models import CaseReward, MatchRecord, Profile


class DurableHistoryTests(TestCase):
    def test_create_room_carries_nickname_into_room_page(self):
        response = self.client.post("/create/", {
            "nick": "TestPlayer", "mode": "tdm", "map": "depot", "target": "30",
        })
        self.assertEqual(response.status_code, 302)
        self.assertIn("nick=TestPlayer", response["Location"])
        code = response["Location"].split("/")[-2]
        room_page = self.client.get(response["Location"])
        self.assertEqual(room_page.status_code, 200)
        self.assertContains(room_page, '"nick": "TestPlayer"')
        rooms.ROOMS.pop(code, None)

    def test_expired_room_returns_player_to_lobby_with_nickname(self):
        response = self.client.get("/room/GONE/?nick=TestPlayer")
        self.assertEqual(response.status_code, 302)
        self.assertIn("missing=GONE", response["Location"])
        self.assertIn("nick=TestPlayer", response["Location"])
        lobby = self.client.get(response["Location"])
        self.assertContains(lobby, 'value="TestPlayer"')

    def test_lobby_shows_persisted_settings_and_profile_history_surfaces(self):
        response = Client().get("/")
        self.assertEqual(response.status_code, 200)
        for element_id in ("volume-setting", "quality-setting", "ui-scale-setting", "match-history", "drop-history"):
            self.assertContains(response, f'id="{element_id}"')

    def test_open_case_records_actual_reward(self):
        profile = Profile.objects.create(code="HISTORY001", sprays=["smile"], cases=1)
        reward = profiles.open_case(profile)
        row = CaseReward.objects.get(profile=profile)
        self.assertEqual((row.reward_type, row.reward_id), (reward["type"], reward["id"]))
        self.assertEqual(profiles.payload(profile)["recentDrops"][0]["id"], reward["id"])

    def test_finished_room_builds_profile_records_for_players(self):
        first = Profile.objects.create(code="PLAYER0001")
        second = Profile.objects.create(code="PLAYER0002")
        room = Room("TEST", "tdm", 5, 0, lobby=True)
        p1 = room.add_player("A", 0, None, 0, profile_id=first.pk)
        p2 = room.add_player("B", 1, None, 0, profile_id=second.pk)
        p1.kills, p1.deaths, p1.assists = 3, 1, 2
        p2.kills, p2.deaths = 1, 3
        room._finish_match(0, 10)
        rows = room.pending_match_records
        profiles.record_matches(rows)
        self.assertEqual(MatchRecord.objects.count(), 2)
        self.assertEqual(MatchRecord.objects.get(profile=first).result, "W")
        self.assertEqual(MatchRecord.objects.get(profile=second).result, "L")
        self.assertEqual(profiles.payload(first)["matchesPlayed"], 1)

    def test_room_ready_state_is_broadcast_in_roster(self):
        room = Room("READY", "tdm", 5, 0, lobby=True)
        player = room.add_player("ReadyPlayer", 0, None, 0)
        room.handle(player.id, {"t": "ready", "ready": True}, 1)
        roster = [msg for _, msg in room.drain() if msg.get("t") == "roster"][-1]
        self.assertTrue(roster["players"][0]["ready"])
