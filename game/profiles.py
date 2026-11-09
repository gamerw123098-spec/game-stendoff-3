"""Работа с профилями и инвентарём. Функции синхронные, из асинхронного кода
их вызывают через database_sync_to_async."""
from __future__ import annotations

import secrets
from collections import Counter

from django.db import transaction
from django.db.models import F

from .models import Item, Profile
from .skins import SKINS, roll_skin

CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
_rng = secrets.SystemRandom()


def create_profile() -> Profile:
    while True:
        code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(10))
        if not Profile.objects.filter(code=code).exists():
            return Profile.objects.create(code=code)


def get_profile(code) -> Profile | None:
    if not isinstance(code, str) or not code:
        return None
    return Profile.objects.filter(code=code.strip().upper()[:10]).first()


def payload(profile: Profile) -> dict:
    counts = Counter(profile.items.values_list("skin", flat=True))
    return {
        "code": profile.code,
        "nick": profile.nick,
        "cases": profile.cases,
        "wins": profile.wins,
        "equipped": profile.equipped,
        "items": [{"skin": skin, "count": count} for skin, count in counts.items() if skin in SKINS],
    }


def open_case(profile: Profile) -> dict | None:
    """Списывает кейс и выдаёт скин. Если кейсов нет, возвращает None."""
    with transaction.atomic():
        # Условное обновление не даст открыть один кейс дважды при двойном клике.
        taken = Profile.objects.filter(pk=profile.pk, cases__gt=0).update(cases=F("cases") - 1)
        if not taken:
            return None
        skin = roll_skin(_rng)
        Item.objects.create(profile=profile, skin=skin["id"])
    profile.refresh_from_db()
    return skin


def set_equipped(profile: Profile, skin_id, equip: bool) -> bool:
    skin = SKINS.get(skin_id) if isinstance(skin_id, str) else None
    if skin is None or not profile.items.filter(skin=skin_id).exists():
        return False
    if equip:
        profile.equipped[skin["weapon"]] = skin_id
    elif profile.equipped.get(skin["weapon"]) == skin_id:
        del profile.equipped[skin["weapon"]]
    profile.save(update_fields=["equipped"])
    return True


def for_game(code, nick=None) -> tuple[int, dict] | None:
    """Данные профиля для входа в комнату: id и надетые скины."""
    profile = get_profile(code)
    if profile is None:
        return None
    if nick and profile.nick != nick:
        profile.nick = nick
        profile.save(update_fields=["nick"])
    owned = set(profile.items.values_list("skin", flat=True))
    return profile.id, {w: s for w, s in profile.equipped.items() if s in owned and s in SKINS}


def grant_wins(profile_ids: list[int]) -> None:
    """Награда за победу в матче: один кейс."""
    Profile.objects.filter(id__in=profile_ids).update(cases=F("cases") + 1, wins=F("wins") + 1)
