from django.urls import re_path

from .consumers import GameConsumer

websocket_urlpatterns = [re_path(r"^ws/room/(?P<code>[A-Za-z]{4})/$", GameConsumer.as_asgi())]
