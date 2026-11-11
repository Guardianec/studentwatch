import json
import re
from functools import wraps

from django.conf import settings
from django.contrib.auth import authenticate, login, logout
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import RequestDataTooBig, ValidationError
from django.db import IntegrityError, transaction
from django.http import FileResponse, HttpResponse, JsonResponse
from django.middleware.csrf import get_token
from django.views.decorators.http import require_GET, require_http_methods, require_POST

from .middleware import limit
from .models import ReleaseApproval, User

VERSION = "0.2.0"
IDENTIFIER = re.compile(r"[a-z0-9._-]{3,40}", re.ASCII)


def error(code, message, status=400, fields=None, headers=None):
    data = {"code": code, "message": message}
    if fields:
        data["fields"] = fields
    return JsonResponse(data, status=status, headers=headers)


class ApiError(Exception):
    def __init__(self, code, message, status=400, fields=None):
        self.response = error(code, message, status, fields)


def endpoint(role=None):
    def decorate(view):
        @wraps(view)
        def handle(request, *args, **kwargs):
            if role and not request.user.is_authenticated:
                return error("session", "Увійдіть, щоб продовжити.", 401)
            if role and user_role(request.user) != role:
                return error("forbidden", "Ця дія недоступна для вашої ролі.", 403)
            try:
                return view(request, *args, **kwargs)
            except ApiError as exc:
                return exc.response
        return handle
    return decorate


def json_body(request):
    if request.content_type != "application/json":
        raise ApiError("input", "Очікується запит у форматі JSON.", 415)
    try:
        data = json.loads(request.body)
    except RequestDataTooBig:
        raise ApiError("input", "Запит завеликий.", 413) from None
    except (ValueError, UnicodeError):
        raise ApiError("input", "Запит містить некоректні дані.") from None
    if not isinstance(data, dict):
        raise ApiError("input", "Запит містить некоректні дані.")
    return data


def invalid(fields):
    raise ApiError("validation", "Перевірте позначені поля.", fields=fields)


def text_field(data, field, minimum, maximum):
    value = data.get(field, "")
    if not isinstance(value, str):
        invalid({field: "Введіть текст."})
    value = value.strip()
    if "\x00" in value or any(0xD800 <= ord(char) <= 0xDFFF for char in value):
        invalid({field: "Приберіть некоректні символи."})
    if len(value) < minimum:
        invalid({field: "Заповніть це поле."})
    if len(value) > maximum:
        invalid({field: f"Максимум {maximum} символів."})
    return value


def user_role(user):
    return "admin" if user.is_superuser else user.role


def user_data(user):
    return {"id": user.pk, "username": user.username, "full_name": user.full_name, "role": user_role(user)}


def session_data(request):
    return {"user": user_data(request.user) if request.user.is_authenticated else None, "csrf": get_token(request)}


def throttled(request, scope, maximum, seconds):
    wait = limit(request, scope, maximum, seconds)
    if wait:
        return error("throttled", "Забагато спроб. Зачекайте і спробуйте знову.", 429, headers={"Retry-After": str(wait)})
    return None


@require_GET
def health(request):
    return JsonResponse({"service": "postup", "status": "ok", "version": VERSION})


@require_http_methods(["GET", "HEAD"])
def student_site(request):
    try:
        index = (settings.WHITENOISE_ROOT / "index.html").open("rb")
    except FileNotFoundError:
        return HttpResponse("Учнівський сайт готується.", status=503)
    return FileResponse(index, headers={"Cache-Control": "no-cache"})


@require_http_methods(["GET", "POST"])
@endpoint(User.Role.TEACHER)
def release_review(request):
    if request.method == "POST":
        if json_body(request).get("version") != VERSION:
            return error("release", "Версія змінилася. Оновіть програму й повторіть перевірку.", 409)
        ReleaseApproval.objects.get_or_create(teacher=request.user, version=VERSION)
        return JsonResponse({"version": VERSION, "approved": True})
    approved = ReleaseApproval.objects.filter(teacher=request.user, version=VERSION).exists()
    return JsonResponse({"version": VERSION, "approved": approved})


@require_GET
def session(request):
    if not request.user.is_authenticated and not request.session.session_key:
        blocked = throttled(request, "session", 120, 300)
        if blocked:
            return blocked
    return JsonResponse(session_data(request))


@require_POST
@endpoint()
def register(request):
    blocked = throttled(request, "register", 60, 3600)
    if blocked:
        return blocked
    if request.user.is_authenticated:
        return error("conflict", "Спочатку вийдіть із поточного облікового запису.", 409)
    data = json_body(request)
    full_name = text_field(data, "full_name", 1, 120)
    username = text_field(data, "username", 1, 40).lower()
    if not IDENTIFIER.fullmatch(username):
        invalid({"username": "Введіть 3–40 латинських літер, цифр, крапок, дефісів або підкреслень."})
    password = data.get("password")
    if not isinstance(password, str) or not 12 <= len(password) <= 128:
        invalid({"password": "Пароль має містити від 12 до 128 символів."})
    if any(0xD800 <= ord(char) <= 0xDFFF for char in password):
        invalid({"password": "Пароль містить некоректні символи."})
    user = User(username=username, full_name=full_name, role=User.Role.STUDENT)
    try:
        validate_password(password, user)
    except ValidationError as exc:
        invalid({"password": " ".join(exc.messages)})
    user.set_password(password)
    try:
        with transaction.atomic():
            user.save(force_insert=True)
    except IntegrityError:
        invalid({"username": "Цей логін уже зайнятий."})
    login(request, user)
    return JsonResponse(session_data(request), status=201)


@require_POST
@endpoint()
def sign_in(request):
    blocked = throttled(request, "login", 120, 600)
    if blocked:
        return blocked
    data = json_body(request)
    client = data.get("client")
    if client not in ("teacher", "student"):
        invalid({"client": "Оберіть відповідний кабінет."})
    username = text_field(data, "username", 1, 150).lower()
    blocked = throttled(request, "login:" + username, 20, 600)
    if blocked:
        return blocked
    password = data.get("password")
    if not isinstance(password, str) or not password or len(password) > 128:
        invalid({"password": "Введіть пароль (до 128 символів)."})
    if any(0xD800 <= ord(char) <= 0xDFFF for char in password):
        invalid({"password": "Пароль містить некоректні символи."})
    user = authenticate(request, username=username, password=password)
    if user is None:
        return error("credentials", "Логін або пароль не збігаються.", 401)
    if user_role(user) != client:
        return error("forbidden", "Цей обліковий запис належить до іншого кабінету.", 403)
    login(request, user)
    return JsonResponse(session_data(request))


@require_POST
def sign_out(request):
    logout(request)
    return JsonResponse({"user": None})


@require_POST
@endpoint(User.Role.STUDENT)
def profile(request):
    request.user.full_name = text_field(json_body(request), "full_name", 1, 120)
    request.user.save(update_fields=["full_name"])
    return JsonResponse({"user": user_data(request.user)})
