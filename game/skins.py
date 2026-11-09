"""Каталог скинов и выпадение из кейса. Всё игровое: за реальные деньги ничего не продаётся."""
from __future__ import annotations

import random

# Вес равен шансу в процентах, сумма весов равна 100.
RARITIES = {
    "common": {"name": "Обычный", "weight": 60.0, "color": "#9aa7b4"},
    "rare": {"name": "Редкий", "weight": 25.0, "color": "#4c9dff"},
    "epic": {"name": "Эпический", "weight": 11.0, "color": "#b76cff"},
    "legendary": {"name": "Легендарный", "weight": 3.2, "color": "#ff5f56"},
    "mythic": {"name": "Мифический", "weight": 0.8, "color": "#f2c744"},
}


def _skin(skin_id, weapon, name, rarity, pattern, colors, glow=False):
    return {"id": skin_id, "weapon": weapon, "name": name, "rarity": rarity,
            "pattern": pattern, "colors": colors, "glow": glow}


_ALL = [
    _skin("rifle_dune", "rifle", "Дюна", "common", "camo", ["#b9a26f", "#8c7748", "#d8c79a"]),
    _skin("smg_moss", "smg", "Мох", "common", "camo", ["#566b43", "#39492c", "#7f8f58"]),
    _skin("pistol_steel", "pistol", "Сталь", "common", "brushed", ["#8d969e", "#6d757c"]),
    _skin("magnum_ash", "magnum", "Пепел", "common", "digital", ["#55585c", "#36383b", "#797c80"]),
    _skin("carbine_slate", "carbine", "Сланец", "common", "stripes", ["#4d5a66", "#39444e"]),
    _skin("sniper_fog", "sniper", "Туман", "common", "digital", ["#a7b2b8", "#7f8b91", "#c9d1d5"]),

    _skin("rifle_cobalt", "rifle", "Кобальт", "rare", "stripes", ["#1f5fbf", "#123a78"]),
    _skin("smg_mint", "smg", "Мята", "rare", "digital", ["#3fbf9a", "#23876b", "#8ce6cb"]),
    _skin("pistol_coral", "pistol", "Коралл", "rare", "gradient", ["#ff7a6b", "#a12f55"]),
    _skin("sniper_taiga", "sniper", "Тайга", "rare", "camo", ["#2f5a3c", "#1b3524", "#6b8f5a"]),
    _skin("carbine_rust", "carbine", "Ржавчина", "rare", "hex", ["#8a4a24", "#c9793d"]),

    _skin("rifle_ember", "rifle", "Уголёк", "epic", "gradient", ["#ff8a1f", "#3a0d0d"]),
    _skin("carbine_neon", "carbine", "Неон", "epic", "hex", ["#111421", "#25e6ff"], glow=True),
    _skin("sniper_ice", "sniper", "Лёд", "epic", "gradient", ["#d8f4ff", "#2f7fd0"]),
    _skin("magnum_violet", "magnum", "Фиалка", "epic", "carbon", ["#3a1f66", "#9a5cff"]),

    _skin("rifle_magma", "rifle", "Магма", "legendary", "lava", ["#180806", "#ff5a14", "#ffd24a"], glow=True),
    _skin("sniper_aurora", "sniper", "Сияние", "legendary", "gradient", ["#2bffb1", "#7a2bff"], glow=True),
    _skin("smg_circuit", "smg", "Схема", "legendary", "circuit", ["#07170f", "#2dff8e"], glow=True),

    # Скины для нового оружия
    _skin("bullpup_sand", "bullpup", "Бархан", "common", "camo", ["#c9b07a", "#9a8250", "#e0cfa0"]),
    _skin("shotgun_oak", "shotgun", "Дуб", "common", "brushed", ["#7a4e2a", "#5a361c"]),
    _skin("tac_pistol_night", "tac_pistol", "Ночь", "common", "digital", ["#2a2f38", "#1b1f26", "#3e4552"]),
    _skin("lmg_forest", "lmg", "Лес", "common", "camo", ["#3f5a35", "#28391f", "#6b8a4e"]),
    _skin("pdw_wave", "pdw", "Волна", "rare", "stripes", ["#1fa3b5", "#0e5f6b"]),
    _skin("battle_arctic", "battle", "Арктика", "rare", "digital", ["#e6edf2", "#b5c3cc", "#ffffff"]),
    _skin("auto_pistol_toxic", "auto_pistol", "Яд", "rare", "hex", ["#1a2b12", "#7dff3a"]),
    _skin("smg2_candy", "smg2", "Леденец", "epic", "stripes", ["#ff5fa2", "#ffffff"]),
    _skin("dmr_storm", "dmr", "Гроза", "epic", "gradient", ["#5a6cff", "#151a3a"]),
    _skin("auto_shotgun_inferno", "auto_shotgun", "Инферно", "legendary", "lava", ["#140604", "#ff3d0a", "#ffc23a"], glow=True),
    _skin("heavy_sniper_void", "heavy_sniper", "Пустота", "legendary", "circuit", ["#05060f", "#b04dff"], glow=True),
    _skin("heavy_pistol_royal", "heavy_pistol", "Корона", "epic", "brushed", ["#ffd76a", "#8a5a10"]),

    _skin("knife_gold", "knife", "Золото", "mythic", "brushed", ["#ffd76a", "#b98a1e"], glow=True),
    _skin("knife_abyss", "knife", "Бездна", "mythic", "lava", ["#0b0618", "#7a2bff", "#ff4df0"], glow=True),
    _skin("knife_glacier", "knife", "Ледник", "mythic", "gradient", ["#f2fbff", "#2c8fe0"], glow=True),
]

SKINS = {skin["id"]: skin for skin in _ALL}


def roll_skin(rng: random.Random | random.SystemRandom | None = None) -> dict:
    """Сначала выбирается редкость по шансам, затем случайный скин этой редкости."""
    rng = rng or random
    names = list(RARITIES)
    rarity = rng.choices(names, weights=[RARITIES[n]["weight"] for n in names])[0]
    return rng.choice([skin for skin in _ALL if skin["rarity"] == rarity])
