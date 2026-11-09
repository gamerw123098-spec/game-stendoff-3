from django.db import models


class Profile(models.Model):
    """Профиль без пароля: его ключ — секретный код, который хранится в браузере игрока."""

    code = models.CharField(max_length=10, unique=True)
    nick = models.CharField(max_length=16, blank=True)
    cases = models.PositiveIntegerField(default=1)  # первый кейс в подарок
    wins = models.PositiveIntegerField(default=0)
    equipped = models.JSONField(default=dict)  # оружие -> id скина
    created_at = models.DateTimeField(auto_now_add=True)


class Item(models.Model):
    """Скин в инвентаре. Повторные выпадения хранятся отдельными записями."""

    profile = models.ForeignKey(Profile, on_delete=models.CASCADE, related_name="items")
    skin = models.CharField(max_length=32)
    created_at = models.DateTimeField(auto_now_add=True)
