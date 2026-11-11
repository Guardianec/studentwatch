import os
from pathlib import Path

from django.core.exceptions import ImproperlyConfigured
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parents[1]
load_dotenv(BASE_DIR.parent / ".env")


def values(name):
    return [item.strip() for item in os.getenv(name, "").split(",") if item.strip()]


MODE = os.getenv("POSTUP_MODE", "development")
if MODE not in ("development", "production"):
    raise ImproperlyConfigured("POSTUP_MODE must be development or production")
PRODUCTION = MODE == "production"
SECRET_KEY = os.getenv("DJANGO_SECRET_KEY") or ("" if PRODUCTION else "postup-loopback-development-only-do-not-deploy")
ALLOWED_HOSTS = values("POSTUP_ALLOWED_HOSTS") if PRODUCTION else ["127.0.0.1", "localhost"]
RENDER_HOST = os.getenv("RENDER_EXTERNAL_HOSTNAME") if PRODUCTION and os.getenv("RENDER") == "true" else None
if RENDER_HOST:
    ALLOWED_HOSTS.append(RENDER_HOST)
SERVE_WEB = os.getenv("POSTUP_SERVE_WEB") == "1"
CSRF_TRUSTED_ORIGINS = values("POSTUP_TRUSTED_ORIGINS")
TRUSTED_PROXY_IPS = values("POSTUP_TRUSTED_PROXY_IPS") if PRODUCTION else []
DEBUG = False

database_url = os.getenv("POSTUP_DATABASE_URL")
if database_url:
    from psycopg import ProgrammingError
    from psycopg.conninfo import conninfo_to_dict

    if not database_url.startswith(("postgresql://", "postgres://")):
        raise ImproperlyConfigured("POSTUP_DATABASE_URL requires a PostgreSQL URL")
    try:
        parameters = conninfo_to_dict(database_url)
        database = {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": parameters.pop("dbname"),
            "HOST": parameters.pop("host"),
            "USER": parameters.pop("user"),
            "PORT": parameters.pop("port", "5432"),
            "PASSWORD": parameters.pop("password", ""),
        }
    except (ValueError, KeyError, ProgrammingError):
        raise ImproperlyConfigured("Invalid POSTUP_DATABASE_URL") from None
    parameters.setdefault("sslmode", "require" if PRODUCTION else "prefer")
    if PRODUCTION and parameters["sslmode"] not in ("require", "verify-ca", "verify-full"):
        raise ImproperlyConfigured("Production PostgreSQL requires TLS")
    DATABASES = {"default": {**database, "OPTIONS": parameters}}
elif os.getenv("POSTUP_DB_NAME"):
    DATABASES = {"default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": os.environ["POSTUP_DB_NAME"],
        "USER": os.environ["POSTUP_DB_USER"],
        "PASSWORD": os.environ["POSTUP_DB_PASSWORD"],
        "HOST": os.getenv("POSTUP_DB_HOST", "127.0.0.1"),
        "PORT": os.getenv("POSTUP_DB_PORT", "5432"),
        "OPTIONS": {"sslmode": os.getenv("POSTUP_DB_SSLMODE") or ("require" if PRODUCTION else "prefer")},
    }}
elif PRODUCTION:
    raise ImproperlyConfigured("Production requires PostgreSQL")
else:
    DATABASES = {"default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": os.getenv("POSTUP_SQLITE_PATH", BASE_DIR / "db.sqlite3"),
        "OPTIONS": {"transaction_mode": "IMMEDIATE"},
    }}

if PRODUCTION:
    if len(SECRET_KEY) < 50 or not ALLOWED_HOSTS or any("*" in host or host.startswith(".") for host in ALLOWED_HOSTS):
        raise ImproperlyConfigured("Set a strong DJANGO_SECRET_KEY and explicit POSTUP_ALLOWED_HOSTS")
    if any("*" in origin or not origin.startswith("https://") for origin in CSRF_TRUSTED_ORIGINS):
        raise ImproperlyConfigured("POSTUP_TRUSTED_ORIGINS requires explicit HTTPS origins")

ROOT_URLCONF = "postup.urls"
WSGI_APPLICATION = "postup.wsgi.application"
INSTALLED_APPS = [
    "django.contrib.admin", "django.contrib.auth", "django.contrib.contenttypes",
    "django.contrib.sessions", "django.contrib.messages", "django.contrib.staticfiles", "postup",
]
MIDDLEWARE = [
    "postup.middleware.TrustedProxy",
    "django.middleware.security.SecurityMiddleware",
    "postup.middleware.ApiHeaders",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]
if SERVE_WEB:
    MIDDLEWARE.insert(2, "whitenoise.middleware.WhiteNoiseMiddleware")
    WHITENOISE_ROOT = BASE_DIR.parent / "dist"
    WHITENOISE_ALLOW_ALL_ORIGINS = False
TEMPLATES = [{
    "BACKEND": "django.template.backends.django.DjangoTemplates",
    "APP_DIRS": True,
    "OPTIONS": {"context_processors": [
        "django.template.context_processors.request",
        "django.contrib.auth.context_processors.auth",
        "django.contrib.messages.context_processors.messages",
    ]},
}]
AUTH_USER_MODEL = "postup.User"
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator",
     "OPTIONS": {"user_attributes": ["username", "full_name"]}},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator", "OPTIONS": {"min_length": 12}},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]
LANGUAGE_CODE = "uk"
TIME_ZONE = "Europe/Kyiv"
USE_TZ = True
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
DATA_UPLOAD_MAX_MEMORY_SIZE = 64 * 1024

SESSION_COOKIE_NAME = "postup_session"
SESSION_COOKIE_AGE = 12 * 60 * 60
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
SESSION_COOKIE_SECURE = PRODUCTION
CSRF_USE_SESSIONS = True
CSRF_FAILURE_VIEW = "postup.middleware.csrf_failure"
SECURE_SSL_REDIRECT = PRODUCTION
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https") if TRUSTED_PROXY_IPS else None
SECURE_HSTS_SECONDS = 31536000 if PRODUCTION else 0
SECURE_REFERRER_POLICY = "same-origin"
