from django.urls import path

from . import views

urlpatterns = [
    path("", views.lobby, name="lobby"),
    path("create/", views.create, name="create"),
    path("room/<str:code>/", views.room, name="room"),
    path("api/rooms/", views.rooms_api, name="rooms_api"),
    path("inventory/", views.inventory, name="inventory"),
    path("api/profile/", views.profile_api, name="profile_api"),
    path("api/case/open/", views.open_case_api, name="open_case_api"),
    path("api/equip/", views.equip_api, name="equip_api"),
]
