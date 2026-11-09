"""Страницы сайта. Представления асинхронные, чтобы работать с комнатами
в том же потоке событий, что и игровой цикл."""
import json
import socket

from django.http import JsonResponse
from django.shortcuts import redirect, render
from django.urls import reverse
from django.utils.http import urlencode
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_POST

from . import profiles, rooms
from .engine import MODES, WEAPON_ORDER, WEAPONS
from .skins import RARITIES, SKINS
from .world import MAPS


def _lan_ip() -> str | None:
    """IP компьютера в локальной сети. Пакеты при этом никуда не отправляются."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.connect(("10.255.255.255", 1))
        return sock.getsockname()[0]
    except OSError:
        return None
    finally:
        sock.close()


def _base_url(request) -> str:
    """Адрес для друзей: по localhost с другого компьютера не зайти."""
    host = request.get_host().rsplit(":", 1)[0]
    if host in ("localhost", "127.0.0.1", "0.0.0.0", "[::1]"):
        return f"http://{_lan_ip() or host}:{request.get_port()}"
    return f"{request.scheme}://{request.get_host()}"


def _catalog() -> dict:
    return {
        "skins": SKINS,
        "rarities": RARITIES,
        "weapons": {key: weapon["name"] for key, weapon in WEAPONS.items()},
        "order": WEAPON_ORDER,
    }


@require_GET
async def lobby(request):
    """Главное меню: вход в игру, кейсы, инвентарь, спреи и профиль на одной странице."""
    return render(request, "game/lobby.html", {
        "catalog": _catalog(),
        "base_url": _base_url(request),
        "missing": request.GET.get("missing", "")[:8],
        "full": "full" in request.GET,
        "modes": [
            {"id": key, "name": mode["name"], "text": mode["text"],
             "default": mode["target"][0] if mode["target"] else "",
             "min": mode["target"][1] if mode["target"] else "",
             "max": mode["target"][2] if mode["target"] else "",
             "unit": "побед в раундах" if mode["rounds"] else "убийств"}
            for key, mode in MODES.items()
        ],
        "maps": MAPS.values(),
    })


@require_POST
async def create(request):
    if rooms.is_full():
        return redirect(f"{reverse('lobby')}?full=1")
    mode = request.POST.get("mode", "tdm")
    try:
        target = int(request.POST.get("target", ""))
    except ValueError:
        target = None
    room_obj = rooms.create_room(mode, target, request.POST.get("map", "depot"))
    return redirect("room", code=room_obj.code)


@require_GET
async def room(request, code):
    handle = rooms.get_handle(code)
    if handle is None:
        return redirect(f"{reverse('lobby')}?{urlencode({'missing': code[:8]})}")
    room_obj = handle.room
    return render(request, "game/room.html", {
        "code": room_obj.code,
        "mode_name": room_obj.cfg["name"],
        "map_name": room_obj.map.name,
        "has_teams": not room_obj.cfg["ffa"],
        "has_shop": room_obj.cfg["shop"],
        "is_defuse": room_obj.mode == "defuse",
        "config": {
            "code": room_obj.code,
            "base": _base_url(request),
            "share": f"{_base_url(request)}/room/{room_obj.code}/",
        },
    })


@require_GET
async def rooms_api(request):
    return JsonResponse({"rooms": rooms.list_rooms()})


# ---------- Профиль и кейсы ----------
# Эти представления обычные, а не асинхронные: они работают с базой, а не с комнатами.
# CSRF не нужен: доступ даёт код профиля в теле запроса, а не куки браузера.

def _json_body(request) -> dict:
    try:
        data = json.loads(request.body or b"{}")
    except ValueError:
        return {}
    return data if isinstance(data, dict) else {}


@require_GET
def inventory(request):
    """Старый адрес инвентаря: теперь это вкладка главного меню."""
    return redirect(f"{reverse('lobby')}#cases")


@csrf_exempt
@require_POST
def profile_api(request):
    """С кодом возвращает его профиль, а без кода создаёт новый."""
    code = _json_body(request).get("code")
    if not code:
        return JsonResponse(profiles.payload(profiles.create_profile()))
    profile = profiles.get_profile(code)
    if profile is None:
        return JsonResponse({"error": "Профиль с таким кодом не найден"}, status=404)
    return JsonResponse(profiles.payload(profile))


@csrf_exempt
@require_POST
def open_case_api(request):
    profile = profiles.get_profile(_json_body(request).get("code"))
    if profile is None:
        return JsonResponse({"error": "Профиль не найден"}, status=404)
    skin = profiles.open_case(profile)
    if skin is None:
        return JsonResponse({"error": "Кейсов нет. Их дают за победу в матче."}, status=409)
    return JsonResponse({"skin": skin["id"], "profile": profiles.payload(profile)})


@csrf_exempt
@require_POST
def equip_api(request):
    data = _json_body(request)
    profile = profiles.get_profile(data.get("code"))
    if profile is None:
        return JsonResponse({"error": "Профиль не найден"}, status=404)
    if not profiles.set_equipped(profile, data.get("skin"), bool(data.get("equip", True))):
        return JsonResponse({"error": "Этого скина нет в инвентаре"}, status=409)
    return JsonResponse(profiles.payload(profile))
