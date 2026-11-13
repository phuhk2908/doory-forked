"""Production settings are security-critical: check them in a subprocess with an explicit baseline environment."""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[3]
PRODUCTION_CHECK_SECRET = "ci-only-secret-key-that-is-long-and-random-enough-for-the-checks-0123456789"
PROBE = """
import json
from django.conf import settings
names = [
    "DEBUG", "SECURE_SSL_REDIRECT", "SESSION_COOKIE_SECURE", "CSRF_COOKIE_SECURE", "SECURE_HSTS_SECONDS",
    "CSRF_TRUSTED_ORIGINS", "CORS_ALLOWED_ORIGINS", "X_FRAME_OPTIONS", "SECURE_REFERRER_POLICY",
    "SECURE_CONTENT_TYPE_NOSNIFF", "SECRET_KEY_FALLBACKS", "SECURE_REDIRECT_EXEMPT", "AUTHENTICATION_BACKENDS",
    "PASSWORD_RESET_TIMEOUT",
]
data = {name: getattr(settings, name) for name in names}
data["NUM_PROXIES"] = settings.REST_FRAMEWORK["NUM_PROXIES"]
data["RENDERERS"] = settings.REST_FRAMEWORK["DEFAULT_RENDERER_CLASSES"]
data["CACHE"] = settings.CACHES["default"]["BACKEND"]
print(json.dumps(data))
"""


def load_settings(**env: str) -> dict:
    environment = {
        "PATH": os.environ.get("PATH", ""),
        "PYTHONPATH": str(BACKEND_DIR),
        "DJANGO_SETTINGS_MODULE": "doory.settings.prod",
        "DJANGO_SECRET_KEY": PRODUCTION_CHECK_SECRET,
        "SITE_URL": "https://doory.example.org",
        # base.py reads backend/.env for local convenience. Pin optional origin lists so a developer's local
        # values cannot change what this production-settings probe is asserting.
        "CSRF_TRUSTED_ORIGINS": "https://doory.example.org",
        "CORS_ALLOWED_ORIGINS": "",
        **env,
    }
    result = subprocess.run(
        [sys.executable, "-c", f"import django; django.setup(); {PROBE}"],
        env=environment,
        cwd=BACKEND_DIR,
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout.strip().splitlines()[-1])


def run_production_check(**env: str) -> subprocess.CompletedProcess[str]:
    environment = {
        "PATH": os.environ.get("PATH", ""),
        "PYTHONPATH": str(BACKEND_DIR),
        "DJANGO_SETTINGS_MODULE": "doory.settings.prod",
        "DJANGO_SECRET_KEY": PRODUCTION_CHECK_SECRET,
        "DJANGO_ALLOWED_HOSTS": "example.com",
        "IMAGE_OPTIMIZERS": "",
        **env,
    }
    return subprocess.run(
        [sys.executable, "manage.py", "check", "--deploy", "--fail-level", "WARNING"],
        env=environment,
        cwd=BACKEND_DIR,
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )


@pytest.fixture(scope="module")
def prod() -> dict:
    return load_settings()


def test_production_is_secure_by_default(prod):
    assert prod["DEBUG"] is False
    assert prod["SECURE_SSL_REDIRECT"] is True
    assert prod["SESSION_COOKIE_SECURE"] is True
    assert prod["CSRF_COOKIE_SECURE"] is True
    assert prod["SECURE_HSTS_SECONDS"] >= 60 * 60 * 24 * 30


def test_production_sends_the_security_headers(prod):
    assert prod["X_FRAME_OPTIONS"] == "DENY"
    assert prod["SECURE_REFERRER_POLICY"] == "strict-origin-when-cross-origin"
    assert prod["SECURE_CONTENT_TYPE_NOSNIFF"] is True


def test_production_trusts_only_its_own_origin(prod):
    assert prod["CSRF_TRUSTED_ORIGINS"] == ["https://doory.example.org"]
    assert prod["CORS_ALLOWED_ORIGINS"] == []


def test_production_rate_limits_behind_one_proxy_by_default(prod):
    assert prod["NUM_PROXIES"] == 1
    assert load_settings(NUM_PROXIES="0")["NUM_PROXIES"] == 0


def test_production_serves_json_only(prod):
    assert prod["RENDERERS"] == ["rest_framework.renderers.JSONRenderer"]


def test_account_security_defaults(prod):
    assert prod["AUTHENTICATION_BACKENDS"] == ["apps.accounts.backends.GuardedModelBackend"]
    assert prod["PASSWORD_RESET_TIMEOUT"] == 24 * 60 * 60
    assert prod["SECRET_KEY_FALLBACKS"] == []


def test_health_checks_are_exempt_from_the_https_redirect(prod):
    assert prod["SECURE_REDIRECT_EXEMPT"] == [r"^api/v1/health/$"]


def test_plain_http_trial_switches(prod):
    trial = load_settings(SECURE_SSL_REDIRECT="false", SECURE_COOKIES="false")
    assert trial["SECURE_SSL_REDIRECT"] is False
    assert trial["SESSION_COOKIE_SECURE"] is False and trial["CSRF_COOKIE_SECURE"] is False


def test_cache_url_selects_the_cache_backend(prod):
    assert prod["CACHE"].endswith("LocMemCache")
    assert load_settings(CACHE_URL="dbcache://doory_cache")["CACHE"].endswith("DatabaseCache")


def test_secret_key_fallbacks_are_read_from_the_environment():
    assert load_settings(DJANGO_SECRET_KEY_FALLBACKS="old-one,older-one")["SECRET_KEY_FALLBACKS"] == [
        "old-one",
        "older-one",
    ]


def test_production_refuses_the_development_secret_key():
    environment = {
        "PATH": os.environ.get("PATH", ""),
        "PYTHONPATH": str(BACKEND_DIR),
        "DJANGO_SETTINGS_MODULE": "doory.settings.prod",
    }
    result = subprocess.run(
        [sys.executable, "-c", "import django; django.setup()"],
        env=environment,
        cwd=BACKEND_DIR,
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )
    assert result.returncode != 0
    assert "DJANGO_SECRET_KEY" in result.stderr


@pytest.mark.parametrize("key", ["changeme", "x" * 31, "dev-insecure-secret-key-change-me" * 3])
def test_production_refuses_a_short_or_development_secret_key(key):
    environment = {
        "PATH": os.environ.get("PATH", ""),
        "PYTHONPATH": str(BACKEND_DIR),
        "DJANGO_SETTINGS_MODULE": "doory.settings.prod",
        "DJANGO_SECRET_KEY": key,
    }
    result = subprocess.run(
        [sys.executable, "-c", "import django; django.setup()"],
        env=environment,
        cwd=BACKEND_DIR,
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )
    assert result.returncode != 0 and "at least 32 characters" in " ".join(result.stderr.split())


def test_a_32_character_key_is_accepted():
    assert load_settings(DJANGO_SECRET_KEY="k" * 32)["DEBUG"] is False


def test_production_deployment_check_is_warning_free():
    result = run_production_check()
    assert result.returncode == 0, f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}"
