from datetime import timedelta
from hashlib import sha256
from ipaddress import ip_address

from django.conf import settings
from django.http import HttpResponse, JsonResponse
from django.db import transaction
from django.utils import timezone

from .models import RateBucket


class TrustedProxy:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        trusted = request.META.get("REMOTE_ADDR") in settings.TRUSTED_PROXY_IPS
        if not trusted:
            request.META.pop("HTTP_X_FORWARDED_PROTO", None)
        if settings.RENDER_HOST or trusted:
            header = "HTTP_CF_CONNECTING_IP" if settings.RENDER_HOST else "HTTP_X_REAL_IP"
            try:
                request.META["REMOTE_ADDR"] = str(ip_address(request.META.get(header, "")))
            except ValueError:
                pass
        return self.get_response(request)


def limit(request, scope, maximum, seconds):
    now = timezone.now()
    key = sha256(f"{scope}:{request.META.get('REMOTE_ADDR', '')}".encode()).hexdigest()
    with transaction.atomic():
        bucket, _ = RateBucket.objects.select_for_update().get_or_create(key=key, defaults={"expires_at": now})
        if bucket.expires_at <= now:
            bucket.expires_at = now + timedelta(seconds=seconds)
            bucket.count = 0
        if bucket.count >= maximum:
            return max(1, int((bucket.expires_at - now).total_seconds()) + 1)
        bucket.count += 1
        bucket.save(update_fields=["count", "expires_at"])
    return None


class ApiHeaders:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.path == "/admin/login/" and request.method == "POST":
            wait = limit(request, "admin", 20, 600)
            if wait:
                return HttpResponse("Забагато спроб. Спробуйте пізніше.", status=429, headers={"Retry-After": str(wait)})
        response = self.get_response(request)
        if request.path.startswith("/api/"):
            response["Cache-Control"] = "no-store"
        return response


def csrf_failure(request, reason=""):
    if request.path.startswith("/api/"):
        return JsonResponse({"code": "csrf", "message": "Оновіть сторінку або повторіть дію."}, status=403)
    from django.views.csrf import csrf_failure as default_failure
    return default_failure(request, reason=reason)
