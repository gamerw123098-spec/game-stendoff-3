from django.contrib.staticfiles.views import serve
from django.urls import include, path, re_path
from django.views.decorators.cache import cache_control

urlpatterns = [
    # Браузер каждый раз сверяет файл с сервером: после обновления игры у всех сразу новая версия.
    re_path(r"^static/(?P<path>.*)$", cache_control(no_cache=True)(serve), {"insecure": True}),
    path("", include("game.urls")),
]
