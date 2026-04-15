"""
Shared fixtures for PIMv3 API tests.
All tests run against the live server at localhost:4877.
Integration tests (those using client/headers/auth_token fixtures) are
automatically skipped when the server is not reachable — this allows
the CI pipeline to run unit tests without a live server.
"""
import socket
import pytest
import httpx

BASE_URL = "http://localhost:4877/api/v1"

ADMIN_EMAIL = "admin@admin.com"
ADMIN_PASSWORD = "admin"

# Module-level token cache to avoid repeated logins
_cached_token = None

# Check server availability once at collection time
def _server_available() -> bool:
    try:
        s = socket.create_connection(("localhost", 4877), timeout=2)
        s.close()
        return True
    except (ConnectionRefusedError, OSError):
        return False

SERVER_AVAILABLE = _server_available()

# Integration test files — not collected when server is unavailable
# (prevents ImportError from missing deps like 'requests' that only integration tests use)
_INTEGRATION_FILES = {"test_api.py", "test_api_full.py", "test_smoke_backend.py", "test_agent_ai.py"}

# Fixtures that require a live server — tests using any of these are integration tests
_INTEGRATION_FIXTURES = {"auth_token", "headers", "client"}


def pytest_ignore_collect(collection_path, config):
    """Skip collection of integration test files when server is not running.
    This prevents ImportError from deps used only in integration tests (e.g. 'requests').
    """
    if not SERVER_AVAILABLE and collection_path.name in _INTEGRATION_FILES:
        return True


def pytest_runtest_setup(item):
    """Skip integration tests automatically when server is not running."""
    if not SERVER_AVAILABLE and _INTEGRATION_FIXTURES & set(item.fixturenames):
        pytest.skip("PimV3 server not reachable at localhost:4877 — skipping integration test")


async def _get_token():
    global _cached_token
    if _cached_token:
        return _cached_token
    async with httpx.AsyncClient(timeout=30.0) as c:
        res = await c.post(
            f"{BASE_URL}/auth/login",
            data={"username": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        assert res.status_code == 200, f"Login failed: {res.status_code} {res.text}"
        _cached_token = res.json()["access_token"]
        return _cached_token


@pytest.fixture
async def auth_token():
    """Obtain a JWT token by logging in as admin."""
    return await _get_token()


@pytest.fixture
async def headers(auth_token):
    """Authorization headers for authenticated requests."""
    return {
        "Authorization": f"Bearer {auth_token}",
        "Content-Type": "application/json",
    }


@pytest.fixture
async def client():
    """Per-test async HTTP client."""
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=60.0) as c:
        yield c
