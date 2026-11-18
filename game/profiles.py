"""Работа с профилями и инвентарём. Функции синхронные, из асинхронного кода
их вызывают через database_sync_to_async."""
from __future__ import annotations

import secrets
from collections import Counter

from django.db import transaction
from django.db.models import F

from .models import Item, MarketListing, Profile
from .skins import SKINS, roll_skin

CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
_rng = secrets.SystemRandom()
SPRAYS = {
    "smile": "Смайлик", "heart": "Сердце", "skull": "Череп", "crown": "Корона",
    "bolt": "Молния", "star": "Звезда", "gg": "GG", "fire": "Огонь", "cat": "Кот",
    "ghost": "Призрак", "eye": "Глаз", "rocket": "Ракета", "pizza": "Пицца", "cactus": "Кактус",
    "target": "Мишень", "sun": "Солнце", "moon": "Луна", "rainbow": "Радуга", "flower": "Цветок",
    "mushroom": "Гриб", "snowflake": "Снежинка", "watermelon": "Арбуз", "donut": "Пончик",
    "icecream": "Мороженое", "burger": "Бургер", "frog": "Лягушка", "duck": "Уточка", "paw": "Лапка",
    "robot": "Робот", "alien": "Пришелец", "ufo": "Тарелка", "bomb": "Бомбочка", "shuriken": "Сюрикен",
    "shield": "Щит", "diamond": "Алмаз", "music": "Музыка", "dice": "Кубик", "gamepad": "Геймпад",
    "rip": "Надгробие", "ez": "EZ", "wow": "WOW", "lol": "LOL", "e404": "Ошибка 404",
    "five": "Пятёрка", "name": "Мой ник",
}
CASE_PRICES = {"standard": ("credits", 100), "premium": ("gold", 30)}
SKIN_GOLD_PRICE = {"common": 20, "rare": 50, "epic": 120, "legendary": 300, "mythic": 650}


def create_profile() -> Profile:
    while True:
        code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(10))
        if not Profile.objects.filter(code=code).exists():
            return Profile.objects.create(code=code, sprays=["smile"])


def get_profile(code) -> Profile | None:
    if not isinstance(code, str) or not code:
        return None
    return Profile.objects.filter(code=code.strip().upper()[:10]).first()


def payload(profile: Profile) -> dict:
    counts = Counter(profile.items.values_list("skin", flat=True))
    listed_counts = Counter(MarketListing.objects.filter(seller=profile, active=True).values_list("item__skin", flat=True))
    items = []
    for skin, count in counts.items():
        if skin not in SKINS:
            continue
        item = {"skin": skin, "count": count}
        if listed_counts[skin]:
            item["listed"] = min(count, listed_counts[skin])
        items.append(item)
    return {
        "code": profile.code,
        "nick": profile.nick,
        "cases": profile.cases,
        "credits": profile.credits,
        "gold": profile.gold,
        "standardCases": profile.standard_cases,
        "premiumCases": profile.premium_cases,
        "wins": profile.wins,
        "equipped": profile.equipped,
        "items": items,
        "sprays": sorted({"smile", *[s for s in profile.sprays if s in SPRAYS]}),
    }


def buy_case(profile: Profile, case_type: str) -> bool:
    price = CASE_PRICES.get(case_type)
    if price is None:
        return False
    currency, amount = price
    field = "standard_cases" if case_type == "standard" else "premium_cases"
    with transaction.atomic():
        paid = Profile.objects.filter(pk=profile.pk, **{f"{currency}__gte": amount}).update(**{currency: F(currency) - amount})
        if not paid:
            return False
        Profile.objects.filter(pk=profile.pk).update(**{field: F(field) + 1})
    profile.refresh_from_db()
    return True


def _roll_case_reward(case_type: str, owned_sprays: list[str]) -> dict:
    # Старый бесплатный кейс сохраняет прежний формат награды. Платные кейсы
    # иногда содержат коллекционные спреи, если игрок ещё не собрал их все.
    spray_chance = 0 if case_type == "free" else (10 if case_type == "premium" else 14)
    owned = {"smile", *owned_sprays}
    available_sprays = [spray for spray in SPRAYS if spray not in owned]
    if available_sprays and _rng.random() * 100 < spray_chance:
        return {"type": "spray", "id": _rng.choice(available_sprays)}
    if case_type == "premium":
        rarity_weights = {"common": 35, "rare": 30, "epic": 22, "legendary": 10, "mythic": 3}
        names = list(rarity_weights)
        rarity = _rng.choices(names, weights=[rarity_weights[name] for name in names])[0]
        skin = _rng.choice([skin for skin in SKINS.values() if skin["rarity"] == rarity])
    else:
        skin = roll_skin(_rng)
    return {"type": "skin", "id": skin["id"]}


def open_case(profile: Profile, case_type: str = "free") -> dict | None:
    """Атомарно списывает один кейс и выдаёт серверную награду."""
    field = {"free": "cases", "standard": "standard_cases", "premium": "premium_cases"}.get(case_type)
    if field is None:
        return None
    with transaction.atomic():
        taken = Profile.objects.filter(pk=profile.pk, **{f"{field}__gt": 0}).update(**{field: F(field) - 1})
        if not taken:
            return None
        profile.refresh_from_db()
        reward = _roll_case_reward(case_type, profile.sprays)
        if reward["type"] == "skin":
            Item.objects.create(profile=profile, skin=reward["id"])
        else:
            profile.sprays = sorted({"smile", *profile.sprays, reward["id"]})
            profile.save(update_fields=["sprays"])
    profile.refresh_from_db()
    return reward


def buy_skin(profile: Profile, skin_id: str) -> bool:
    skin = SKINS.get(skin_id) if isinstance(skin_id, str) else None
    if skin is None:
        return False
    price = SKIN_GOLD_PRICE[skin["rarity"]]
    with transaction.atomic():
        paid = Profile.objects.filter(pk=profile.pk, gold__gte=price).update(gold=F("gold") - price)
        if not paid:
            return False
        Item.objects.create(profile=profile, skin=skin_id)
    profile.refresh_from_db()
    return True


def market_payload(profile: Profile | None = None) -> list[dict]:
    listings = MarketListing.objects.filter(active=True).select_related("item", "seller").order_by("created_at")[:100]
    result = []
    for listing in listings:
        skin = SKINS.get(listing.item.skin)
        if skin is None:
            continue
        result.append({"id": listing.pk, "skin": skin, "price": listing.price,
                       "seller": listing.seller.nick or "Игрок", "mine": bool(profile and listing.seller_id == profile.pk)})
    return result


def list_skin(profile: Profile, skin_id: str, price: int) -> bool:
    skin = SKINS.get(skin_id) if isinstance(skin_id, str) else None
    if skin is None or not isinstance(price, int) or isinstance(price, bool) or not 1 <= price <= 100000:
        return False
    if profile.equipped.get(skin["weapon"]) == skin_id:
        return False
    with transaction.atomic():
        listed_ids = MarketListing.objects.filter(active=True).values_list("item_id", flat=True)
        item = Item.objects.select_for_update().filter(profile=profile, skin=skin_id).exclude(pk__in=listed_ids).order_by("created_at").first()
        if item is None:
            return False
        listing, created = MarketListing.objects.select_for_update().get_or_create(item=item, defaults={"seller": profile, "price": price})
        if not created and listing.active:
            return False
        listing.seller = profile
        listing.price = price
        listing.buyer = None
        listing.active = True
        listing.save(update_fields=["seller", "price", "buyer", "active"])
    return True


def cancel_listing(profile: Profile, listing_id) -> bool:
    if not isinstance(listing_id, int) or isinstance(listing_id, bool):
        return False
    return bool(MarketListing.objects.filter(pk=listing_id, seller=profile, active=True).update(active=False))


def buy_listing(profile: Profile, listing_id) -> bool:
    if not isinstance(listing_id, int) or isinstance(listing_id, bool):
        return False
    with transaction.atomic():
        listing = MarketListing.objects.select_for_update().select_related("item", "seller").filter(pk=listing_id, active=True).first()
        if listing is None or listing.seller_id == profile.pk:
            return False
        if listing.item.skin not in SKINS or listing.item.profile_id != listing.seller_id:
            return False
        paid = Profile.objects.filter(pk=profile.pk, gold__gte=listing.price).update(gold=F("gold") - listing.price)
        if not paid:
            return False
        Profile.objects.filter(pk=listing.seller_id).update(gold=F("gold") + listing.price)
        listing.item.profile = profile
        listing.item.save(update_fields=["profile"])
        listing.buyer = profile
        listing.active = False
        listing.save(update_fields=["buyer", "active"])
    profile.refresh_from_db()
    return True


def set_equipped(profile: Profile, skin_id, equip: bool) -> bool:
    skin = SKINS.get(skin_id) if isinstance(skin_id, str) else None
    if skin is None or not profile.items.filter(skin=skin_id).exclude(market_listing__active=True).exists():
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
    """Награды за победу: бесплатный кейс, кредиты и немного золота."""
    Profile.objects.filter(id__in=profile_ids).update(
        cases=F("cases") + 1, wins=F("wins") + 1,
        credits=F("credits") + 100, gold=F("gold") + 25,
    )
