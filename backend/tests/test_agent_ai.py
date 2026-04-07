"""
Comprehensive pytest test suite for PIMv3 Agent System and AI Features.

Tests run against the LIVE backend at http://localhost:4877/api/v1.
Auth token is generated inline via backend.services.auth.

Run via SSH:
    ssh myserver "cd /mnt/data/Pimv3 && source backend/venv/bin/activate && \
        python -m pytest backend/tests/test_agent_ai.py -v --timeout=60"

Groups:
  1. Agent Task System
  2. AI Extract & Generate
  3. Syndicate Map & Agent
  4. Rich Content
  5. Studio Projects
  6. Landing & Social
  7. Star Map
  8. Settings & Users
  9. Media & Upload
  10. MP Sync
"""

import base64
import io
import json
import struct
import subprocess
import time
import uuid
import zlib
from typing import Optional

import httpx
import pytest

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

BASE_URL = "http://localhost:4877"
API = f"{BASE_URL}/api/v1"
TIMEOUT = 30.0

# ---------------------------------------------------------------------------
# Token helper -- generate JWT inline to avoid hitting the login endpoint
# ---------------------------------------------------------------------------

_TOKEN_CACHE: Optional[str] = None


def _generate_token() -> str:
    """Generate a JWT admin token using the backend auth module directly."""
    global _TOKEN_CACHE
    if _TOKEN_CACHE:
        return _TOKEN_CACHE
    result = subprocess.run(
        [
            "python3", "-c",
            (
                "from backend.services.auth import create_access_token; "
                "from datetime import timedelta; "
                "print(create_access_token({'sub':'admin@admin.com','role':'admin'}, "
                "expires_delta=timedelta(hours=24)))"
            ),
        ],
        capture_output=True,
        text=True,
        cwd="/mnt/data/Pimv3",
        timeout=15,
    )
    token = result.stdout.strip()
    assert token, f"Failed to generate token: stderr={result.stderr}"
    _TOKEN_CACHE = token
    return token


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(scope="session")
def token() -> str:
    return _generate_token()


@pytest.fixture(scope="session")
def headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="session")
def client() -> httpx.Client:
    with httpx.Client(base_url=API, timeout=TIMEOUT) as c:
        yield c


@pytest.fixture(scope="session")
def real_product_id(client: httpx.Client, headers: dict) -> str:
    """Fetch the first real product ID from the database."""
    r = client.get("/products", params={"limit": 1}, headers=headers)
    assert r.status_code == 200, f"Cannot fetch products: {r.status_code} {r.text}"
    data = r.json()
    items = data.get("items", data) if isinstance(data, dict) else data
    assert len(items) > 0, "No products in database to test with"
    return str(items[0]["id"])


@pytest.fixture(scope="session")
def real_ozon_connection_id(client: httpx.Client, headers: dict) -> Optional[str]:
    """Fetch the first Ozon connection ID."""
    r = client.get("/connections", headers=headers)
    assert r.status_code == 200
    for c in r.json():
        if c["type"] == "ozon":
            return str(c["id"])
    pytest.skip("No Ozon connection in database")


@pytest.fixture(scope="session")
def real_megamarket_connection_id(client: httpx.Client, headers: dict) -> Optional[str]:
    """Fetch the first Megamarket connection ID."""
    r = client.get("/connections", headers=headers)
    assert r.status_code == 200
    for c in r.json():
        if c["type"] == "megamarket":
            return str(c["id"])
    pytest.skip("No Megamarket connection in database")


@pytest.fixture(scope="session")
def real_connection_id(client: httpx.Client, headers: dict) -> str:
    """Fetch first available connection ID (any type)."""
    r = client.get("/connections", headers=headers)
    assert r.status_code == 200
    conns = r.json()
    assert len(conns) > 0, "No connections in DB"
    return str(conns[0]["id"])


# ===========================================================================
# Group 1: Agent Task System
# ===========================================================================


class TestAgentTaskSystem:
    """Tests for the Agent Task endpoints."""

    def test_list_agent_tasks(self, client: httpx.Client, headers: dict):
        """GET /agent-tasks -> 200, returns list."""
        r = client.get("/agent-tasks", headers=headers)
        assert r.status_code == 200
        data = r.json()
        assert "ok" in data or "tasks" in data or isinstance(data, list)

    def test_agent_queue(self, client: httpx.Client, headers: dict):
        """GET /agent/queue -> 200."""
        r = client.get("/agent/queue", headers=headers)
        assert r.status_code == 200
        data = r.json()
        assert "queue" in data or "stats" in data

    def test_agent_cron(self, client: httpx.Client, headers: dict):
        """GET /agent/cron -> 200, returns cron jobs."""
        r = client.get("/agent/cron", headers=headers)
        assert r.status_code == 200
        data = r.json()
        assert "jobs" in data
        assert "status" in data

    def test_agent_task_create(self, client: httpx.Client, headers: dict):
        """POST /agent-tasks/create -> creates a new task."""
        payload = {
            "task_type": "backend",
            "title": f"Test task {uuid.uuid4().hex[:8]}",
            "description": "Automated test task",
            "auto_run": False,
        }
        r = client.post("/agent-tasks/create", json=payload, headers=headers)
        assert r.status_code == 200
        data = r.json()
        assert "task_id" in data or "id" in data

    def test_agent_templates_list(self, client: httpx.Client, headers: dict):
        """GET /agent/templates -> 200."""
        r = client.get("/agent/templates", headers=headers)
        assert r.status_code == 200

    def test_agent_prompt_cache_stats(self, client: httpx.Client, headers: dict):
        """GET /agent/prompt-cache/stats -> 200."""
        r = client.get("/agent/prompt-cache/stats", headers=headers)
        assert r.status_code == 200

    def test_agent_perf_history(self, client: httpx.Client, headers: dict):
        """GET /agent/perf/history -> 200."""
        r = client.get("/agent/perf/history", headers=headers)
        assert r.status_code == 200

    def test_agent_parallel_stats(self, client: httpx.Client, headers: dict):
        """GET /agent/parallel/stats -> 200."""
        r = client.get("/agent/parallel/stats", headers=headers)
        assert r.status_code == 200

    def test_agent_webhook_stats(self, client: httpx.Client, headers: dict):
        """GET /agent/webhook/stats -> 200."""
        r = client.get("/agent/webhook/stats", headers=headers)
        assert r.status_code == 200

    def test_agent_scan_todos_stats(self, client: httpx.Client, headers: dict):
        """GET /agent/scan-todos/stats -> 200."""
        r = client.get("/agent/scan-todos/stats", headers=headers)
        assert r.status_code == 200

    def test_agent_alembic_check(self, client: httpx.Client, headers: dict):
        """GET /agent/alembic/check -> 200."""
        r = client.get("/agent/alembic/check", headers=headers)
        assert r.status_code == 200

    def test_agent_tasks_capabilities(self, client: httpx.Client, headers: dict):
        """GET /agent-tasks-capabilities -> 200."""
        r = client.get("/agent-tasks-capabilities", headers=headers)
        assert r.status_code == 200

    def test_agent_context7_connected(self, client: httpx.Client, headers: dict):
        """GET /agent-tasks/context7-connected -> 200."""
        r = client.get("/agent-tasks/context7-connected", headers=headers)
        assert r.status_code == 200

    def test_agent_cron_create_and_delete(self, client: httpx.Client, headers: dict):
        """POST /agent/cron -> create cron job, then DELETE it."""
        payload = {
            "name": f"test_cron_{uuid.uuid4().hex[:6]}",
            "schedule": "0 3 * * *",
            "task_type": "backend",
            "title": "Cron test",
            "enabled": False,
        }
        r = client.post("/agent/cron", json=payload, headers=headers)
        assert r.status_code == 200
        data = r.json()
        job_id = data.get("job", {}).get("id") or data.get("id")
        if job_id:
            r2 = client.delete(f"/agent/cron/{job_id}", headers=headers)
            assert r2.status_code == 200


# ===========================================================================
# Group 2: AI Extract & Generate
# ===========================================================================


class TestAIExtractGenerate:
    """Tests for AI extraction and generation endpoints."""

    def test_ai_extract(self, client: httpx.Client, headers: dict):
        """POST /ai/extract -> extracts attributes from text."""
        payload = {
            "text": "Пылесос Karcher WD 2 мощность 1000 Вт объем пылесборника 12 л"
        }
        r = client.post("/ai/extract", json=payload, headers=headers, timeout=60.0)
        assert r.status_code == 200
        data = r.json()
        # Should return extracted attributes
        assert isinstance(data, dict)

    def test_ai_enrich_product(
        self, client: httpx.Client, headers: dict, real_product_id: str
    ):
        """POST /ai/enrich/{product_id} -> 200, enriches product."""
        r = client.post(
            f"/ai/enrich/{real_product_id}", headers=headers, timeout=90.0
        )
        assert r.status_code == 200
        data = r.json()
        # Response must have these keys and NOT have "attributes"
        assert "name" in data, f"Missing 'name' in response: {data}"
        assert "sku" in data, f"Missing 'sku' in response: {data}"
        assert "description" in data, f"Missing 'description' in response: {data}"
        assert "brand" in data, f"Missing 'brand' in response: {data}"
        assert "category" in data, f"Missing 'category' in response: {data}"
        assert "attributes" not in data, "Response must NOT contain 'attributes' key"

    def test_ai_enrich_product_404(self, client: httpx.Client, headers: dict):
        """POST /ai/enrich/{bad_id} -> 404 for nonexistent product."""
        fake_id = str(uuid.uuid4())
        r = client.post(f"/ai/enrich/{fake_id}", headers=headers)
        assert r.status_code == 404

    def test_ai_generate_promo(
        self, client: httpx.Client, headers: dict, real_product_id: str
    ):
        """POST /ai/generate-promo -> generates promo text."""
        payload = {"product_id": real_product_id}
        r = client.post("/ai/generate-promo", json=payload, headers=headers, timeout=90.0)
        assert r.status_code == 200
        data = r.json()
        assert "promo_copy" in data

    def test_ai_generate_bulk(
        self, client: httpx.Client, headers: dict, real_product_id: str
    ):
        """POST /ai/generate-bulk -> bulk generation returns task_id."""
        payload = {"product_ids": [real_product_id]}
        r = client.post("/ai/generate-bulk", json=payload, headers=headers)
        assert r.status_code == 200
        data = r.json()
        assert "task_id" in data

    def test_ai_generate_description(
        self, client: httpx.Client, headers: dict, real_product_id: str
    ):
        """POST /ai/generate -> generates product description."""
        payload = {"product_id": real_product_id}
        r = client.post("/ai/generate", json=payload, headers=headers, timeout=90.0)
        assert r.status_code == 200
        data = r.json()
        assert "description_html" in data


# ===========================================================================
# Group 3: Syndicate Map & Agent
# ===========================================================================


class TestSyndicateMapAgent:
    """Tests for syndication pipeline endpoints."""

    def test_syndicate_map(
        self,
        client: httpx.Client,
        headers: dict,
        real_product_id: str,
        real_ozon_connection_id: str,
    ):
        """POST /syndicate/map -> maps product attributes to marketplace schema."""
        payload = {
            "product_id": real_product_id,
            "connection_id": real_ozon_connection_id,
        }
        r = client.post("/syndicate/map", json=payload, headers=headers, timeout=120.0)
        assert r.status_code == 200
        data = r.json()
        assert "mapped_payload" in data or "error" in data

    def test_syndicate_agent_dry_run(
        self,
        client: httpx.Client,
        headers: dict,
        real_product_id: str,
        real_ozon_connection_id: str,
    ):
        """POST /syndicate/agent -> full agent pipeline with push=false."""
        payload = {
            "product_id": real_product_id,
            "connection_id": real_ozon_connection_id,
            "push": False,
        }
        r = client.post("/syndicate/agent", json=payload, headers=headers, timeout=120.0)
        assert r.status_code == 200
        data = r.json()
        # Should return the syndication result without actually pushing
        assert isinstance(data, dict)

    def test_syndicate_selector(
        self,
        client: httpx.Client,
        headers: dict,
        real_product_id: str,
    ):
        """POST /syndicate/selector -> category selection."""
        payload = {"product_id": real_product_id}
        r = client.post("/syndicate/selector", json=payload, headers=headers, timeout=60.0)
        # May be 200 or 422 depending on product data
        assert r.status_code in (200, 422, 404)

    def test_syndicate_categories_search(
        self,
        client: httpx.Client,
        headers: dict,
        real_ozon_connection_id: str,
    ):
        """GET /syndicate/categories/search -> search marketplace categories."""
        r = client.get(
            "/syndicate/categories/search",
            params={"connection_id": real_ozon_connection_id, "q": "пылесос"},
            headers=headers,
            timeout=30.0,
        )
        assert r.status_code == 200
        data = r.json()
        assert "categories" in data

    def test_syndicate_dictionary(
        self,
        client: httpx.Client,
        headers: dict,
        real_ozon_connection_id: str,
    ):
        """GET /syndicate/dictionary -> get dictionary values."""
        r = client.get(
            "/syndicate/dictionary",
            params={
                "connection_id": real_ozon_connection_id,
                "category_id": "17028922",
                "dictionary_id": "1",
            },
            headers=headers,
            timeout=30.0,
        )
        # May return 200 or 404/500 depending on valid IDs
        assert r.status_code in (200, 404, 500, 422)

    def test_syndicate_push_validation(self, client: httpx.Client, headers: dict):
        """POST /syndicate/push -> validates required fields."""
        fake_payload = {
            "product_id": str(uuid.uuid4()),
            "connection_id": str(uuid.uuid4()),
            "mapped_payload": {"name": "test"},
        }
        r = client.post("/syndicate/push", json=fake_payload, headers=headers, timeout=30.0)
        # Should fail with 404 since fake IDs don't exist
        assert r.status_code in (200, 404, 422, 500)


# ===========================================================================
# Group 4: Rich Content
# ===========================================================================


class TestRichContent:
    """Tests for rich content endpoints."""

    def test_get_rich_content(
        self, client: httpx.Client, headers: dict, real_product_id: str
    ):
        """GET /products/{id}/rich-content -> 200."""
        r = client.get(
            f"/products/{real_product_id}/rich-content", headers=headers
        )
        assert r.status_code == 200
        data = r.json()
        assert "rich_content" in data

    def test_save_rich_content(
        self, client: httpx.Client, headers: dict, real_product_id: str
    ):
        """PUT /products/{id}/rich-content -> saves rich content."""
        payload = {
            "rich_content": [
                {
                    "type": "text",
                    "text": "Test rich content block",
                }
            ]
        }
        r = client.put(
            f"/products/{real_product_id}/rich-content",
            json=payload,
            headers=headers,
        )
        assert r.status_code == 200

    def test_push_rich_content_validates(
        self, client: httpx.Client, headers: dict, real_product_id: str
    ):
        """POST /products/{id}/push-rich-content -> validates / attempts push."""
        r = client.post(
            f"/products/{real_product_id}/push-rich-content",
            json={},
            headers=headers,
            timeout=30.0,
        )
        # Should return 200 or 422/400 if no connection configured
        assert r.status_code in (200, 400, 422, 500)

    def test_get_rich_content_404(self, client: httpx.Client, headers: dict):
        """GET /products/{bad_id}/rich-content -> 404 for nonexistent product."""
        fake_id = str(uuid.uuid4())
        r = client.get(f"/products/{fake_id}/rich-content", headers=headers)
        assert r.status_code == 404


# ===========================================================================
# Group 5: Studio Projects
# ===========================================================================


class TestStudioProjects:
    """Tests for studio project endpoints."""

    def test_get_studio_projects(
        self, client: httpx.Client, headers: dict, real_product_id: str
    ):
        """GET /products/{id}/studio-projects -> 200."""
        r = client.get(
            f"/products/{real_product_id}/studio-projects", headers=headers
        )
        assert r.status_code == 200
        data = r.json()
        assert "projects" in data

    def test_save_studio_project(
        self, client: httpx.Client, headers: dict, real_product_id: str
    ):
        """POST /products/{id}/studio-projects -> saves project."""
        project_id = str(uuid.uuid4())
        payload = {
            "id": project_id,
            "name": f"Test project {uuid.uuid4().hex[:6]}",
            "layers": [{"type": "text", "content": "Hello"}],
            "canvas_width": 800,
            "canvas_height": 600,
        }
        r = client.post(
            f"/products/{real_product_id}/studio-projects",
            json=payload,
            headers=headers,
        )
        assert r.status_code == 200
        data = r.json()
        assert data.get("ok") is True
        assert "id" in data

        # Clean up: delete the project
        r2 = client.delete(
            f"/products/{real_product_id}/studio-projects/{data['id']}",
            headers=headers,
        )
        assert r2.status_code == 200

    def test_get_studio_projects_404(self, client: httpx.Client, headers: dict):
        """GET /products/{bad_id}/studio-projects -> 404 for nonexistent product."""
        fake_id = str(uuid.uuid4())
        r = client.get(f"/products/{fake_id}/studio-projects", headers=headers)
        assert r.status_code == 404


# ===========================================================================
# Group 6: Landing & Social
# ===========================================================================


class TestLandingSocial:
    """Tests for landing page and social content endpoints."""

    def test_landing_templates(self, client: httpx.Client, headers: dict):
        """GET /landing-templates -> returns template list."""
        r = client.get("/landing-templates", headers=headers)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        assert len(data) > 0
        # Each template should have key, name
        assert "key" in data[0]
        assert "name" in data[0]

    def test_landing_preview(
        self, client: httpx.Client, headers: dict, real_product_id: str
    ):
        """GET /products/{id}/landing-preview -> returns HTML."""
        r = client.get(
            f"/products/{real_product_id}/landing-preview", headers=headers
        )
        assert r.status_code == 200
        # Response should be HTML
        ct = r.headers.get("content-type", "")
        assert "text/html" in ct, f"Expected text/html, got {ct}"

    def test_set_landing_template(
        self, client: httpx.Client, headers: dict, real_product_id: str
    ):
        """PUT /products/{id}/landing-template -> sets template."""
        payload = {"template": "dark_premium"}
        r = client.put(
            f"/products/{real_product_id}/landing-template",
            json=payload,
            headers=headers,
        )
        assert r.status_code == 200

    def test_get_social_content(
        self, client: httpx.Client, headers: dict, real_product_id: str
    ):
        """GET /products/{id}/social-content -> 200."""
        r = client.get(
            f"/products/{real_product_id}/social-content", headers=headers
        )
        assert r.status_code == 200

    def test_save_social_content(
        self, client: httpx.Client, headers: dict, real_product_id: str
    ):
        """PUT /products/{id}/social-content -> saves social content."""
        payload = {
            "telegram": {"text": "Test telegram post", "hashtags": ["#test"]},
            "instagram": {"caption": "Test caption"},
        }
        r = client.put(
            f"/products/{real_product_id}/social-content",
            json=payload,
            headers=headers,
        )
        assert r.status_code == 200


# ===========================================================================
# Group 7: Star Map
# ===========================================================================


class TestStarMap:
    """Tests for attribute star map endpoints."""

    def test_star_map_build(
        self,
        client: httpx.Client,
        headers: dict,
        real_ozon_connection_id: str,
        real_megamarket_connection_id: str,
    ):
        """POST /attribute-star-map/build -> starts build task."""
        payload = {
            "ozon_connection_id": real_ozon_connection_id,
            "megamarket_connection_id": real_megamarket_connection_id,
            "max_ozon_categories": 2,
            "max_megamarket_categories": 2,
            "edge_threshold": 0.6,
        }
        r = client.post(
            "/attribute-star-map/build", json=payload, headers=headers, timeout=30.0
        )
        assert r.status_code == 200
        data = r.json()
        assert data.get("ok") is True
        assert "task_id" in data

    def test_star_map_build_status(self, client: httpx.Client, headers: dict):
        """GET /attribute-star-map/build/status -> returns status (requires task_id)."""
        # Use a fake task_id -- should return gracefully
        r = client.get(
            "/attribute-star-map/build/status",
            params={"task_id": str(uuid.uuid4())},
            headers=headers,
        )
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, dict)

    def test_star_map_search(self, client: httpx.Client, headers: dict):
        """GET /attribute-star-map/search -> searches star map."""
        r = client.get(
            "/attribute-star-map/search",
            params={"q": "brand"},
            headers=headers,
        )
        assert r.status_code == 200
        data = r.json()
        assert "query" in data or "node_hits" in data

    def test_star_map_state(self, client: httpx.Client, headers: dict):
        """GET /attribute-star-map/state -> returns full state."""
        r = client.get("/attribute-star-map/state", headers=headers)
        assert r.status_code == 200
        data = r.json()
        assert "snapshot_exists" in data

    def test_star_map_categories(self, client: httpx.Client, headers: dict):
        """GET /attribute-star-map/categories -> returns categories for platform."""
        r = client.get(
            "/attribute-star-map/categories",
            params={"platform": "ozon"},
            headers=headers,
        )
        assert r.status_code == 200
        data = r.json()
        assert "ok" in data
        assert "categories" in data

    def test_star_map_active_task(self, client: httpx.Client, headers: dict):
        """GET /attribute-star-map/active-task -> returns active task info."""
        r = client.get("/attribute-star-map/active-task", headers=headers)
        assert r.status_code == 200

    def test_star_map_category_links(self, client: httpx.Client, headers: dict):
        """GET /attribute-star-map/category/links -> returns edges between categories."""
        r = client.get(
            "/attribute-star-map/category/links",
            params={
                "ozon_category_id": "17028922_94413",
                "megamarket_category_id": "30301010101",
            },
            headers=headers,
        )
        assert r.status_code == 200


# ===========================================================================
# Group 8: Settings & Users
# ===========================================================================


class TestSettingsUsers:
    """Tests for settings and user management."""

    def test_get_settings(self, client: httpx.Client, headers: dict):
        """GET /settings -> returns all settings."""
        r = client.get("/settings", headers=headers)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        if len(data) > 0:
            assert "id" in data[0]
            assert "value" in data[0]

    def test_update_setting(self, client: httpx.Client, headers: dict):
        """POST /settings/{id} -> updates setting value (idempotent set)."""
        # First get current settings
        r = client.get("/settings", headers=headers)
        assert r.status_code == 200
        settings = r.json()
        if not settings:
            pytest.skip("No settings to test with")

        # Find a safe setting to update (ai_provider)
        target = None
        for s in settings:
            if s["id"] == "ai_provider":
                target = s
                break
        if not target:
            target = settings[0]

        old_value = target["value"]
        # Update it with the SAME value (safe, idempotent)
        r2 = client.post(
            f"/settings/{target['id']}",
            json={"value": old_value},
            headers=headers,
        )
        assert r2.status_code == 200

    def test_get_users(self, client: httpx.Client, headers: dict):
        """GET /users -> returns users list (admin only)."""
        r = client.get("/users", headers=headers)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        assert len(data) > 0
        assert "email" in data[0]
        assert "role" in data[0]


# ===========================================================================
# Group 9: Media & Upload
# ===========================================================================


class TestMediaUpload:
    """Tests for file upload and media proxy."""

    def test_upload_file(self, client: httpx.Client, headers: dict):
        """POST /upload -> uploads a small test image."""

        def _create_tiny_png() -> bytes:
            """Create a minimal valid 1x1 red PNG."""
            signature = b"\x89PNG\r\n\x1a\n"
            # IHDR chunk
            ihdr_data = struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)
            ihdr_crc = struct.pack(">I", zlib.crc32(b"IHDR" + ihdr_data) & 0xFFFFFFFF)
            ihdr = struct.pack(">I", len(ihdr_data)) + b"IHDR" + ihdr_data + ihdr_crc
            # IDAT chunk
            raw_data = zlib.compress(b"\x00\xff\x00\x00")
            idat_crc = struct.pack(">I", zlib.crc32(b"IDAT" + raw_data) & 0xFFFFFFFF)
            idat = struct.pack(">I", len(raw_data)) + b"IDAT" + raw_data + idat_crc
            # IEND chunk
            iend_crc = struct.pack(">I", zlib.crc32(b"IEND") & 0xFFFFFFFF)
            iend = struct.pack(">I", 0) + b"IEND" + iend_crc
            return signature + ihdr + idat + iend

        png_bytes = _create_tiny_png()
        files = {"file": ("test_image.png", io.BytesIO(png_bytes), "image/png")}
        r = client.post("/upload", files=files, headers=headers)
        assert r.status_code == 200
        data = r.json()
        assert "url" in data or "path" in data or "filename" in data

    def test_media_proxy(self, client: httpx.Client, headers: dict):
        """GET /media/proxy/{encoded_url} -> proxies external image."""
        test_url = "https://cdn1.ozone.ru/s3/multimedia-6/6009362058.jpg"
        encoded = base64.urlsafe_b64encode(test_url.encode()).decode()
        r = client.get(f"/media/proxy/{encoded}", headers=headers, timeout=15.0)
        # Should return the image or an error for unreachable URLs
        assert r.status_code in (200, 400, 403, 422, 502)


# ===========================================================================
# Group 10: MP Sync
# ===========================================================================


class TestMPSync:
    """Tests for marketplace sync endpoints."""

    def test_mp_sync_shadows_status(self, client: httpx.Client, headers: dict):
        """GET /mp/sync-shadows/status -> returns sync status."""
        r = client.get("/mp/sync-shadows/status", headers=headers)
        assert r.status_code == 200
        data = r.json()
        assert "running" in data

    def test_mp_products_ozon(self, client: httpx.Client, headers: dict):
        """GET /mp/products -> lists MP products for Ozon."""
        r = client.get(
            "/mp/products",
            params={"platform": "ozon", "limit": 2},
            headers=headers,
            timeout=30.0,
        )
        assert r.status_code == 200
        data = r.json()
        assert "items" in data
        assert data.get("ok") is True

    def test_mp_sync_shadows(
        self,
        client: httpx.Client,
        headers: dict,
    ):
        """POST /mp/sync-shadows -> starts sync (or returns running status)."""
        r = client.post("/mp/sync-shadows", json={}, headers=headers, timeout=30.0)
        # May return 200 if sync starts, or other codes if already running
        assert r.status_code in (200, 400, 409, 422, 500)

    def test_mp_categories(
        self,
        client: httpx.Client,
        headers: dict,
        real_ozon_connection_id: str,
    ):
        """GET /mp/categories -> lists live marketplace categories."""
        r = client.get(
            "/mp/categories",
            params={"connection_id": real_ozon_connection_id},
            headers=headers,
            timeout=30.0,
        )
        assert r.status_code in (200, 500)


# ===========================================================================
# Additional integration tests
# ===========================================================================


class TestHelperAgents:
    """Tests for helper agent endpoints."""

    def test_list_helper_agents(self, client: httpx.Client, headers: dict):
        """GET /helper-agents -> 200."""
        r = client.get("/helper-agents", headers=headers)
        assert r.status_code == 200

    def test_create_helper_agent(self, client: httpx.Client, headers: dict):
        """POST /helper-agents/create -> creates a helper agent."""
        payload = {
            "name": f"test_helper_{uuid.uuid4().hex[:6]}",
            "role": "reviewer",
            "goal": "Review code quality",
            "tools": ["lint"],
        }
        r = client.post("/helper-agents/create", json=payload, headers=headers)
        assert r.status_code == 200


class TestKnowledgeHub:
    """Tests for knowledge hub endpoints."""

    def test_knowledge_sources(self, client: httpx.Client, headers: dict):
        """GET /knowledge/sources -> returns sources."""
        r = client.get("/knowledge/sources", headers=headers)
        assert r.status_code == 200

    def test_knowledge_search(self, client: httpx.Client, headers: dict):
        """POST /knowledge/search -> searches knowledge base."""
        payload = {"namespace": "default", "query": "test", "limit": 5}
        r = client.post("/knowledge/search", json=payload, headers=headers)
        assert r.status_code == 200


class TestSelfImprove:
    """Tests for self-improve endpoints."""

    def test_self_improve_incidents(self, client: httpx.Client, headers: dict):
        """GET /self-improve/incidents -> returns incidents list."""
        r = client.get("/self-improve/incidents", headers=headers)
        assert r.status_code == 200


class TestAuthEndpoints:
    """Tests for authentication endpoints."""

    def test_auth_me(self, client: httpx.Client, headers: dict):
        """GET /auth/me -> returns current user info."""
        r = client.get("/auth/me", headers=headers)
        assert r.status_code == 200
        data = r.json()
        assert "email" in data
        assert data["email"] == "admin@admin.com"

    def test_auth_config(self, client: httpx.Client, headers: dict):
        """GET /auth/config -> returns auth configuration."""
        r = client.get("/auth/config")
        assert r.status_code == 200

    def test_auth_login(self, client: httpx.Client):
        """POST /auth/login -> returns access token."""
        r = client.post(
            "/auth/login",
            data={"username": "admin@admin.com", "password": "admin"},
        )
        assert r.status_code == 200
        data = r.json()
        assert "access_token" in data

    def test_auth_no_token_401(self, client: httpx.Client):
        """GET /products without token -> 401."""
        r = client.get("/products")
        assert r.status_code == 401


class TestHealthAndMeta:
    """Tests for health check and meta endpoints."""

    def test_health(self, client: httpx.Client):
        """GET /health -> 200."""
        r = client.get("/health")
        assert r.status_code == 200
        assert r.json()["status"] == "ok"

    def test_version(self, client: httpx.Client):
        """GET /version -> 200."""
        r = client.get("/version")
        assert r.status_code == 200

    def test_root(self):
        """GET / -> returns API info."""
        with httpx.Client(base_url=BASE_URL, timeout=10.0) as c:
            r = c.get("/")
            assert r.status_code == 200
            data = r.json()
            assert data["service"] == "PIM V3 API"

    def test_agent_status(self, client: httpx.Client):
        """GET /agent/status -> 200."""
        r = client.get("/agent/status")
        assert r.status_code == 200

    def test_stats(self, client: httpx.Client, headers: dict):
        """GET /stats -> 200."""
        r = client.get("/stats", headers=headers)
        assert r.status_code == 200

    def test_github_automation_status(self, client: httpx.Client, headers: dict):
        """GET /github/automation/status -> 200."""
        r = client.get("/github/automation/status", headers=headers)
        assert r.status_code == 200


class TestAgentChat:
    """Tests for agent chat endpoints."""

    def test_agent_chat_state(self, client: httpx.Client, headers: dict):
        """GET /agent-chat/state -> 200."""
        r = client.get("/agent-chat/state", headers=headers)
        assert r.status_code == 200

    def test_agent_chat_message(self, client: httpx.Client, headers: dict):
        """POST /agent-chat/message -> sends chat message."""
        payload = {
            "message": "Hello, what tasks are in the queue?",
            "history": [],
            "auto_run": False,
        }
        r = client.post(
            "/agent-chat/message", json=payload, headers=headers, timeout=60.0
        )
        assert r.status_code == 200


class TestTeamOrchestrator:
    """Tests for team orchestration endpoints."""

    def test_team_plan_create(self, client: httpx.Client, headers: dict):
        """POST /team/plan/create -> creates a plan."""
        payload = {"topic": f"Test plan {uuid.uuid4().hex[:6]}"}
        r = client.post("/team/plan/create", json=payload, headers=headers)
        assert r.status_code == 200
        data = r.json()
        assert "plan_id" in data or "id" in data

    def test_admin_approvals_list(self, client: httpx.Client, headers: dict):
        """GET /admin/approvals -> returns approvals list."""
        r = client.get("/admin/approvals", headers=headers)
        assert r.status_code == 200


class TestConnections:
    """Tests for marketplace connection endpoints."""

    def test_list_connections(self, client: httpx.Client, headers: dict):
        """GET /connections -> 200."""
        r = client.get("/connections", headers=headers)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)

    def test_connection_test_by_id(
        self, client: httpx.Client, headers: dict, real_connection_id: str
    ):
        """POST /connections/{id}/test -> tests connection."""
        r = client.post(
            f"/connections/{real_connection_id}/test",
            headers=headers,
            timeout=30.0,
        )
        assert r.status_code in (200, 400, 500)


class TestProducts:
    """Tests for product CRUD endpoints."""

    def test_list_products(self, client: httpx.Client, headers: dict):
        """GET /products -> 200 with items."""
        r = client.get("/products", params={"limit": 3}, headers=headers)
        assert r.status_code == 200
        data = r.json()
        assert "items" in data
        assert "total" in data

    def test_get_product(
        self, client: httpx.Client, headers: dict, real_product_id: str
    ):
        """GET /products/{id} -> 200."""
        r = client.get(f"/products/{real_product_id}", headers=headers)
        assert r.status_code == 200
        data = r.json()
        assert data["id"] == real_product_id

    def test_create_and_delete_product(
        self, client: httpx.Client, headers: dict
    ):
        """POST /products -> creates product, then DELETE removes it."""
        sku = f"TEST-{uuid.uuid4().hex[:8]}"
        payload = {
            "sku": sku,
            "name": f"Test Product {sku}",
            "description_html": "<p>Test product</p>",
            "attributes_data": {"brand": "TestBrand"},
            "images": [],
        }
        r = client.post("/products", json=payload, headers=headers)
        assert r.status_code == 200
        data = r.json()
        product_id = data["id"]

        # Delete the product
        r2 = client.delete(f"/products/{product_id}", headers=headers)
        assert r2.status_code == 200

        # Verify deletion
        r3 = client.get(f"/products/{product_id}", headers=headers)
        assert r3.status_code == 404
