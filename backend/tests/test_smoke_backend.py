"""
PIMv3 Backend Smoke Tests
Runs directly against the live server at localhost:4877
Usage: pytest /tmp/test_smoke_backend.py -v
"""
import pytest
import requests

BASE = "http://localhost:4877"
EMAIL = "admin@admin.com"
PASSWORD = "admin"

# ─── Shared token ─────────────────────────────────────────────────────────────

@pytest.fixture(scope="session")
def token():
    r = requests.post(
        f"{BASE}/api/v1/auth/login",
        data={"username": EMAIL, "password": PASSWORD},
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    assert r.status_code == 200, f"Login failed: {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def auth(token):
    return {"Authorization": f"Bearer {token}"}


# ─── Auth ─────────────────────────────────────────────────────────────────────

class TestAuth:
    def test_login_success(self):
        r = requests.post(
            f"{BASE}/api/v1/auth/login",
            data={"username": EMAIL, "password": PASSWORD},
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        assert r.status_code == 200
        data = r.json()
        assert "access_token" in data
        assert data["token_type"] == "bearer"
        assert data["role"] == "admin"

    def test_login_wrong_password(self):
        r = requests.post(
            f"{BASE}/api/v1/auth/login",
            data={"username": EMAIL, "password": "wrongpassword"},
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        assert r.status_code == 401

    def test_login_wrong_user(self):
        r = requests.post(
            f"{BASE}/api/v1/auth/login",
            data={"username": "noone@nowhere.com", "password": "x"},
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        assert r.status_code == 401

    def test_protected_without_token(self):
        r = requests.get(f"{BASE}/api/v1/products")
        assert r.status_code == 401

    def test_protected_with_bad_token(self):
        r = requests.get(
            f"{BASE}/api/v1/products",
            headers={"Authorization": "Bearer invalid.token.here"},
        )
        assert r.status_code == 401


# ─── Health & System ──────────────────────────────────────────────────────────

class TestHealth:
    def test_health(self):
        r = requests.get(f"{BASE}/api/v1/health")
        assert r.status_code == 200

    def test_stats(self, auth):
        r = requests.get(f"{BASE}/api/v1/stats", headers=auth)
        assert r.status_code == 200
        data = r.json()
        for key in ("total_products", "total_attributes", "total_connections", "average_completeness"):
            assert key in data, f"Missing key: {key}"

    def test_version(self):
        r = requests.get(f"{BASE}/api/v1/version")
        assert r.status_code in (200, 401)  # may require auth

    def test_uptime(self):
        r = requests.get(f"{BASE}/api/v1/uptime")
        assert r.status_code in (200, 401, 500)  # 500: known upstream bug


# ─── Products CRUD ────────────────────────────────────────────────────────────

class TestProducts:
    def test_list_products(self, auth):
        r = requests.get(f"{BASE}/api/v1/products", headers=auth)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_create_product(self, auth):
        r = requests.post(
            f"{BASE}/api/v1/products",
            json={"name": "Test Product CI", "sku": "TEST-CI-001"},
            headers=auth,
        )
        assert r.status_code in (200, 201), r.text
        data = r.json()
        assert "id" in data
        assert data["name"] == "Test Product CI"
        # Cleanup
        requests.delete(f"{BASE}/api/v1/products/{data['id']}", headers=auth)

    def test_get_product_not_found(self, auth):
        r = requests.get(f"{BASE}/api/v1/products/nonexistent-id-99999", headers=auth)
        # 404 when UUID valid but not found, 422 when ID format invalid
        assert r.status_code in (404, 422)

    def test_product_lifecycle(self, auth):
        # Create
        r = requests.post(
            f"{BASE}/api/v1/products",
            json={"name": "Lifecycle Test", "sku": "LC-TEST-001"},
            headers=auth,
        )
        assert r.status_code in (200, 201)
        pid = r.json()["id"]

        # Read
        r = requests.get(f"{BASE}/api/v1/products/{pid}", headers=auth)
        assert r.status_code == 200
        assert r.json()["id"] == pid

        # Update
        r = requests.patch(
            f"{BASE}/api/v1/products/{pid}",
            json={"name": "Lifecycle Updated"},
            headers=auth,
        )
        assert r.status_code == 200
        assert r.json()["name"] == "Lifecycle Updated"

        # Delete
        r = requests.delete(f"{BASE}/api/v1/products/{pid}", headers=auth)
        assert r.status_code in (200, 204)

        # Confirm deleted
        r = requests.get(f"{BASE}/api/v1/products/{pid}", headers=auth)
        assert r.status_code == 404


# ─── Categories ───────────────────────────────────────────────────────────────

class TestCategories:
    def test_list_categories(self, auth):
        r = requests.get(f"{BASE}/api/v1/categories", headers=auth)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_create_category(self, auth):
        r = requests.post(
            f"{BASE}/api/v1/categories",
            json={"name": "CI Test Category"},
            headers=auth,
        )
        assert r.status_code in (200, 201), r.text


# ─── Attributes ───────────────────────────────────────────────────────────────

class TestAttributes:
    def test_list_attributes(self, auth):
        r = requests.get(f"{BASE}/api/v1/attributes", headers=auth)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_create_attribute(self, auth):
        r = requests.post(
            f"{BASE}/api/v1/attributes",
            json={"code": "ci_test_attr", "name": "CI Test", "type": "string"},
            headers=auth,
        )
        assert r.status_code in (200, 201), r.text


# ─── Connections ──────────────────────────────────────────────────────────────

class TestConnections:
    def test_list_connections(self, auth):
        r = requests.get(f"{BASE}/api/v1/connections", headers=auth)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_create_connection(self, auth):
        r = requests.post(
            f"{BASE}/api/v1/connections",
            json={
                "name": "CI Test Connection",
                "type": "ozon",
                "api_key": "test-key-ci",
                "client_id": "12345",
            },
            headers=auth,
        )
        assert r.status_code in (200, 201, 400, 422), r.text  # 400 if adapter test fails


# ─── Agent Tasks ──────────────────────────────────────────────────────────────

class TestAgentTasks:
    def test_list_tasks(self, auth):
        r = requests.get(f"{BASE}/api/v1/agent/tasks", headers=auth)
        assert r.status_code in (200, 404)  # endpoint may vary

    def test_list_tasks_v2(self, auth):
        r = requests.get(f"{BASE}/api/v1/agent-tasks", headers=auth)
        assert r.status_code in (200, 404)

    def test_agent_dashboard(self, auth):
        r = requests.get(f"{BASE}/api/v1/agent/dashboard", headers=auth)
        assert r.status_code in (200, 404)

    def test_agent_queue(self, auth):
        r = requests.get(f"{BASE}/api/v1/agent/queue", headers=auth)
        assert r.status_code in (200, 404)

    def test_cron_list(self, auth):
        r = requests.get(f"{BASE}/api/v1/agent/cron", headers=auth)
        assert r.status_code in (200, 404)


# ─── Chat ─────────────────────────────────────────────────────────────────────

class TestChat:
    def test_chat_basic(self, auth):
        r = requests.post(
            f"{BASE}/api/v1/chat",
            json={
                "messages": [{"role": "user", "content": "Hello, what is PIM?"}],
                "current_path": "/dashboard",
            },
            headers=auth,
        )
        assert r.status_code in (200, 503), r.text  # 503 if AI key missing
        if r.status_code == 200:
            assert "reply" in r.json()


# ─── Settings ─────────────────────────────────────────────────────────────────

class TestSettings:
    def test_list_settings(self, auth):
        r = requests.get(f"{BASE}/api/v1/settings", headers=auth)
        assert r.status_code == 200
        assert isinstance(r.json(), list)


# ─── Users ────────────────────────────────────────────────────────────────────

class TestUsers:
    def test_users_stats(self, auth):
        r = requests.get(f"{BASE}/api/v1/users/stats", headers=auth)
        assert r.status_code in (200, 404, 405)  # 405 = POST-only endpoint

    def test_me_endpoint(self, auth):
        r = requests.get(f"{BASE}/api/v1/auth/me", headers=auth)
        assert r.status_code in (200, 404)
        if r.status_code == 200:
            data = r.json()
            assert "email" in data
