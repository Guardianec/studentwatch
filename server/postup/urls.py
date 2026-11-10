from django.http import JsonResponse
from django.urls import path
from django.views.decorators.http import require_GET

LOCAL_CLIENTS = {
    "http://127.0.0.1:1420",
    "http://127.0.0.1:4173",
    "http://tauri.localhost",
}


@require_GET
def health(request):
    response = JsonResponse({"service": "postup", "status": "ok", "version": "0.1.0"})
    response.headers["Cache-Control"] = "no-store"
    response.headers["Vary"] = "Origin"
    origin = request.headers.get("Origin")
    if origin in LOCAL_CLIENTS:
        response.headers["Access-Control-Allow-Origin"] = origin
    return response


urlpatterns = [path("api/health/", health)]
