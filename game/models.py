from django.db import models


class Profile(models.Model):
    """Профиль без пароля: его ключ — секретный код, который хранится в браузере игрока."""

    code = models.CharField(max_length=10, unique=True)
    nick = models.CharField(max_length=16, blank=True)
    cases = models.PositiveIntegerField(default=1)  # первый кейс в подарок
    credits = models.PositiveIntegerField(default=100)
    gold = models.PositiveIntegerField(default=0)
    standard_cases = models.PositiveIntegerField(default=0)
    premium_cases = models.PositiveIntegerField(default=0)
    sprays = models.JSONField(default=list)
    wins = models.PositiveIntegerField(default=0)
    equipped = models.JSONField(default=dict)  # оружие -> id скина
    created_at = models.DateTimeField(auto_now_add=True)


class Item(models.Model):
    """Скин в инвентаре. Повторные выпадения хранятся отдельными записями."""

    profile = models.ForeignKey(Profile, on_delete=models.CASCADE, related_name="items")
    skin = models.CharField(max_length=32)
    created_at = models.DateTimeField(auto_now_add=True)


class MarketListing(models.Model):
    """Предмет игрока выставленный на внутренний рынок за виртуальное золото."""

    item = models.OneToOneField(Item, on_delete=models.CASCADE, related_name="market_listing")
    seller = models.ForeignKey(Profile, on_delete=models.CASCADE, related_name="market_listings")
    buyer = models.ForeignKey(Profile, null=True, blank=True, on_delete=models.SET_NULL, related_name="market_purchases")
    price = models.PositiveIntegerField()
    active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
