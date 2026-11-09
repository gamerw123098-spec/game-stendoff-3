"""Настройки игры: локальная сеть (класс, дом) или сервер в интернете.

Без PUBLIC_HOST игра работает в локальной сети: можно зайти по IP компьютера.
На сервере в PUBLIC_HOST лежит адрес сайта: отладка выключена, принимается только этот адрес.
"""
import os
from pathlib import Path

from django.core.management.utils import get_random_secret_key

BASE_DIR = Path(__file__).resolve().parent.parent

# Сессий в проекте нет, а профиль определяется своим кодом, поэтому ключ не обязан быть постоянным.
SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY") or get_random_secret_key()
PUBLIC_HOST = os.environ.get("RENDER_EXTERNAL_HOSTNAME") or os.environ.get("POLIGON_HOST")
DEBUG = not PUBLIC_HOST
ALLOWED_HOSTS = [PUBLIC_HOST] if PUBLIC_HOST else ["*"]
if PUBLIC_HOST:
    # HTTPS завершается на прокси хостинга, а до игры запрос доходит уже по HTTP.
    CSRF_TRUSTED_ORIGINS = [f"https://{PUBLIC_HOST}"]
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

INSTALLED_APPS = [
    "daphne",  # заменяет runserver на ASGI-версию с поддержкой WebSocket
    "channels",
    "django.contrib.staticfiles",
    "game",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

# Заголовок работает только по HTTPS, а по http://IP браузер пишет из-за него ошибку.
SECURE_CROSS_ORIGIN_OPENER_POLICY = None

ROOT_URLCONF = "config.urls"
ASGI_APPLICATION = "config.asgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "APP_DIRS": True,
        "OPTIONS": {"context_processors": ["django.template.context_processors.request"]},
    }
]

# Комнаты живут в памяти процесса, а в базе хранятся только профили, кейсы и скины.
DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": os.environ.get("POLIGON_DB") or BASE_DIR / "db.sqlite3",
    }
}

# Один процесс на всю игру, поэтому Redis не требуется. Очередь большая: если компьютер
# с сервером подвис на несколько секунд, сообщения не должны теряться.
CHANNEL_LAYERS = {
    "default": {
        "BACKEND": "channels.layers.InMemoryChannelLayer",
        "CONFIG": {"capacity": 1000, "expiry": 30},
    }
}

LANGUAGE_CODE = "ru"
TIME_ZONE = "UTC"
USE_I18N = False
USE_TZ = True

STATIC_URL = "static/"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
