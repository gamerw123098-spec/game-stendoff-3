from django.db import models


class Profile(models.Model):
    """Профиль без пароля: его ключ — секретный код, который хранится в браузере игрока."""

    code = models.CharField(max_length=10, unique=True)
    nick = models.CharField(max_length=16, blank=True)
    cases = models.PositiveIntegerField(default=0)
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


class MatchRecord(models.Model):
    """A durable per-profile summary of a finished match."""

    profile = models.ForeignKey(Profile, on_delete=models.CASCADE, related_name="match_records")
    match_key = models.CharField(max_length=32)
    mode = models.CharField(max_length=24)
    map_name = models.CharField(max_length=32)
    result = models.CharField(max_length=1, choices=(("W", "Win"), ("L", "Loss"), ("D", "Draw")))
    kills = models.PositiveIntegerField(default=0)
    deaths = models.PositiveIntegerField(default=0)
    assists = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=("profile", "match_key"), name="uniq_profile_match_record")]
        ordering = ("-created_at",)


class CaseReward(models.Model):
    """History of actual rewards issued by the server's case-opening flow."""

    profile = models.ForeignKey(Profile, on_delete=models.CASCADE, related_name="case_rewards")
    case_type = models.CharField(max_length=12)
    reward_type = models.CharField(max_length=8)
    reward_id = models.CharField(max_length=32)
    created_at = models.DateTimeField(auto_now_add=True)
