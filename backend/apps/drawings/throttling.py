from rest_framework.throttling import SimpleRateThrottle


class GuestRoomCreateThrottle(SimpleRateThrottle):
    scope = "guest_room_create"

    def get_cache_key(self, request, view):
        return self.cache_format % {"scope": self.scope, "ident": self.get_ident(request)}
