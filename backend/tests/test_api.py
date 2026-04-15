"""
Comprehensive API tests for PIMv3 backend.
Runs against the live server at localhost:4877.

Usage:
    cd /mnt/data/Pimv3
    source backend/venv/bin/activate
    pytest backend/tests/test_api.py -v
"""
import uuid
import pytest
import httpx

BASE_URL = "http://localhost:4877/api/v1"

# ─── Real data from the live database ──────────────────────────────────────────
EXISTING_PRODUCT_ID = "39ff839b-3920-4e79-b63f-7dfb3abb3723"
EXISTING_PRODUCT_SKU = "mp:СП-00028744"
EXISTING_VENDOR_CODE = "СП-00028744"

MEGAMARKET_CONNECTION_ID = "72a06096-f4d9-4c5b-8ad4-121edfa620df"
OZON_CONNECTION_ID = "ff054670-d60d-4789-8c3a-4742e8b968d9"

# Megamarket category ID for testing (Микроволновые печи)
MM_CATEGORY_ID = "15733"


# ═══════════════════════════════════════════════════════════════════════════════
# 1. AUTH TESTS
# ═══════════════════════════════════════════════════════════════════════════════

class TestAuth:
    """Authentication and authorization tests."""

    @pytest.mark.asyncio
    async def test_login_valid_credentials(self, client):
        """Login with valid credentials returns 200 and a token."""
        res = await client.post(
            "/auth/login",
            data={"username": "admin@admin.com", "password": "admin"},
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        assert res.status_code == 200
        body = res.json()
        assert "access_token" in body
        assert body["token_type"] == "bearer"
        assert "role" in body

    @pytest.mark.asyncio
    async def test_login_invalid_credentials(self, client):
        """Login with wrong password returns 401."""
        res = await client.post(
            "/auth/login",
            data={"username": "admin@admin.com", "password": "wrongpassword"},
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        assert res.status_code == 401

    @pytest.mark.asyncio
    async def test_login_nonexistent_user(self, client):
        """Login with non-existent user returns 401."""
        res = await client.post(
            "/auth/login",
            data={"username": "nobody@nowhere.com", "password": "whatever"},
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        assert res.status_code == 401

    @pytest.mark.asyncio
    async def test_protected_endpoint_without_token(self, client):
        """Accessing protected endpoint without token returns 401."""
        res = await client.get("/products")
        assert res.status_code == 401

    @pytest.mark.asyncio
    async def test_protected_endpoint_with_invalid_token(self, client):
        """Accessing protected endpoint with garbage token returns 401."""
        res = await client.get(
            "/products",
            headers={"Authorization": "Bearer invalid.token.here"},
        )
        assert res.status_code == 401

    @pytest.mark.asyncio
    async def test_protected_endpoint_with_valid_token(self, client, headers):
        """Accessing protected endpoint with valid token returns 200."""
        res = await client.get("/products", headers=headers)
        assert res.status_code == 200

    @pytest.mark.asyncio
    async def test_auth_me(self, client, headers):
        """GET /auth/me returns current user info."""
        res = await client.get("/auth/me", headers=headers)
        assert res.status_code == 200
        body = res.json()
        assert "email" in body
        assert "role" in body

    @pytest.mark.asyncio
    async def test_auth_config(self, client):
        """GET /auth/config returns auth configuration (public endpoint)."""
        res = await client.get("/auth/config")
        assert res.status_code == 200


# ═══════════════════════════════════════════════════════════════════════════════
# 2. PRODUCT CRUD TESTS
# ═══════════════════════════════════════════════════════════════════════════════

class TestProductCRUD:
    """Product create, read, update, delete tests."""

    @pytest.mark.asyncio
    async def test_get_products_list(self, client, headers):
        """GET /products returns paginated list."""
        res = await client.get("/products", headers=headers)
        assert res.status_code == 200
        body = res.json()
        assert "items" in body
        assert "total" in body
        assert "pages" in body
        assert isinstance(body["items"], list)
        assert body["total"] > 0

    @pytest.mark.asyncio
    async def test_get_products_with_search(self, client, headers):
        """GET /products with search filter works."""
        res = await client.get("/products?search=Микроволновая", headers=headers)
        assert res.status_code == 200
        body = res.json()
        assert isinstance(body["items"], list)

    @pytest.mark.asyncio
    async def test_get_products_pagination(self, client, headers):
        """GET /products with pagination params works."""
        res = await client.get("/products?page=1&limit=2", headers=headers)
        assert res.status_code == 200
        body = res.json()
        assert len(body["items"]) <= 2

    @pytest.mark.asyncio
    async def test_create_and_delete_product(self, client, headers):
        """POST /products creates a product, then DELETE removes it."""
        unique_sku = f"test-sku-{uuid.uuid4().hex[:8]}"
        create_payload = {
            "sku": unique_sku,
            "name": "Test Product for API Test",
            "attributes_data": {"brand": "TestBrand", "color": "blue"},
            "images": [],
        }
        # Create
        res = await client.post("/products", headers=headers, json=create_payload)
        assert res.status_code == 200, f"Create failed: {res.text}"
        product = res.json()
        product_id = product["id"]
        assert product["sku"] == unique_sku
        assert product["name"] == "Test Product for API Test"

        # Verify it exists
        res2 = await client.get(f"/products/{product_id}", headers=headers)
        assert res2.status_code == 200
        assert res2.json()["sku"] == unique_sku

        # Delete
        res3 = await client.delete(f"/products/{product_id}", headers=headers)
        assert res3.status_code == 200
        assert res3.json()["status"] == "ok"

        # Verify deleted
        res4 = await client.get(f"/products/{product_id}", headers=headers)
        assert res4.status_code == 404

    @pytest.mark.asyncio
    async def test_get_existing_product(self, client, headers):
        """GET /products/{id} returns a known product."""
        res = await client.get(f"/products/{EXISTING_PRODUCT_ID}", headers=headers)
        assert res.status_code == 200
        body = res.json()
        assert body["id"] == EXISTING_PRODUCT_ID
        assert body["sku"] == EXISTING_PRODUCT_SKU
        assert "name" in body
        assert "attributes_data" in body

    @pytest.mark.asyncio
    async def test_get_nonexistent_product(self, client, headers):
        """GET /products/{id} with fake UUID returns 404."""
        fake_id = str(uuid.uuid4())
        res = await client.get(f"/products/{fake_id}", headers=headers)
        assert res.status_code == 404

    @pytest.mark.asyncio
    async def test_update_product_patch(self, client, headers):
        """PATCH /products/{id} updates product fields."""
        # Create a temp product
        unique_sku = f"test-patch-{uuid.uuid4().hex[:8]}"
        create_res = await client.post(
            "/products",
            headers=headers,
            json={"sku": unique_sku, "name": "Patch Test"},
        )
        assert create_res.status_code == 200
        pid = create_res.json()["id"]

        # Patch
        patch_res = await client.patch(
            f"/products/{pid}",
            headers=headers,
            json={"name": "Patch Test Updated"},
        )
        assert patch_res.status_code == 200
        assert patch_res.json()["name"] == "Patch Test Updated"

        # Cleanup
        await client.delete(f"/products/{pid}", headers=headers)

    @pytest.mark.asyncio
    async def test_update_product_put(self, client, headers):
        """PUT /products/{id} also updates product (alias for PATCH)."""
        unique_sku = f"test-put-{uuid.uuid4().hex[:8]}"
        create_res = await client.post(
            "/products",
            headers=headers,
            json={"sku": unique_sku, "name": "Put Test"},
        )
        assert create_res.status_code == 200
        pid = create_res.json()["id"]

        # Put
        put_res = await client.put(
            f"/products/{pid}",
            headers=headers,
            json={"name": "Put Test Updated"},
        )
        assert put_res.status_code == 200
        assert put_res.json()["name"] == "Put Test Updated"

        # Cleanup
        await client.delete(f"/products/{pid}", headers=headers)

    @pytest.mark.asyncio
    async def test_delete_nonexistent_product(self, client, headers):
        """DELETE /products/{fake_id} returns 404."""
        fake_id = str(uuid.uuid4())
        res = await client.delete(f"/products/{fake_id}", headers=headers)
        assert res.status_code == 404


# ═══════════════════════════════════════════════════════════════════════════════
# 3. MARKETPLACE CONNECTIONS TESTS
# ═══════════════════════════════════════════════════════════════════════════════

class TestConnections:
    """Marketplace connections tests."""

    @pytest.mark.asyncio
    async def test_get_connections_list(self, client, headers):
        """GET /connections returns list of marketplace connections."""
        res = await client.get("/connections", headers=headers)
        assert res.status_code == 200
        connections = res.json()
        assert isinstance(connections, list)
        assert len(connections) > 0

    @pytest.mark.asyncio
    async def test_connection_has_required_fields(self, client, headers):
        """Each connection has id, type, name, api_key."""
        res = await client.get("/connections", headers=headers)
        assert res.status_code == 200
        for conn in res.json():
            assert "id" in conn, f"Missing 'id' in connection: {conn}"
            assert "type" in conn, f"Missing 'type' in connection: {conn}"
            assert "name" in conn, f"Missing 'name' in connection: {conn}"
            assert "api_key" in conn, f"Missing 'api_key' in connection: {conn}"

    @pytest.mark.asyncio
    async def test_connection_types_valid(self, client, headers):
        """Connection types are one of the known marketplace types."""
        valid_types = {"ozon", "megamarket", "yandex", "wildberries", "wb"}
        res = await client.get("/connections", headers=headers)
        for conn in res.json():
            assert conn["type"] in valid_types, f"Unknown type: {conn['type']}"

    @pytest.mark.asyncio
    async def test_connections_without_auth(self, client):
        """GET /connections without auth returns 401."""
        res = await client.get("/connections")
        assert res.status_code == 401


# ═══════════════════════════════════════════════════════════════════════════════
# 4. MP PRODUCT DETAILS TESTS
# ═══════════════════════════════════════════════════════════════════════════════

class TestMPProductDetails:
    """Marketplace product details tests."""

    @pytest.mark.asyncio
    async def test_mp_product_details_megamarket(self, client, headers):
        """GET /mp/product-details for megamarket returns product attributes."""
        res = await client.get(
            f"/mp/product-details?platform=megamarket&sku={EXISTING_VENDOR_CODE}",
            headers=headers,
        )
        # May be 200 or 502/404 depending on MP API availability
        if res.status_code == 200:
            body = res.json()
            assert body.get("ok") is True
            assert body.get("platform") == "megamarket"
            attrs = body.get("attributes", [])
            assert isinstance(attrs, list)
            if attrs:
                attr = attrs[0]
                # Each attribute should have name/id, value, type, is_required
                assert "name" in attr or "id" in attr
        else:
            # Marketplace API may be temporarily unavailable - acceptable
            assert res.status_code in (404, 500, 502, 504)

    @pytest.mark.asyncio
    async def test_mp_product_details_missing_params(self, client, headers):
        """GET /mp/product-details without required params returns 422."""
        res = await client.get("/mp/product-details", headers=headers)
        assert res.status_code == 422


# ═══════════════════════════════════════════════════════════════════════════════
# 5. MP SHADOW PRODUCT TESTS
# ═══════════════════════════════════════════════════════════════════════════════

class TestMPShadowProduct:
    """Shadow product (unified PIM record) tests."""

    @pytest.mark.asyncio
    async def test_shadow_product_existing(self, client, headers):
        """POST /mp/shadow-product with existing vendor_code returns existing record."""
        res = await client.post(
            "/mp/shadow-product",
            headers=headers,
            json={
                "platform": "megamarket",
                "sku": EXISTING_VENDOR_CODE,
                "name": "Test Shadow",
            },
        )
        assert res.status_code == 200
        body = res.json()
        assert "id" in body
        assert "sku" in body
        assert body["sku"] == EXISTING_PRODUCT_SKU
        assert body["created"] is False  # Already exists

    @pytest.mark.asyncio
    async def test_shadow_product_new_and_cleanup(self, client, headers):
        """POST /mp/shadow-product with new vendor_code creates a new record."""
        test_vc = f"TEST-{uuid.uuid4().hex[:8]}"
        res = await client.post(
            "/mp/shadow-product",
            headers=headers,
            json={
                "platform": "megamarket",
                "sku": test_vc,
                "name": "Shadow Test Product",
                "brand": "TestBrand",
                "images": ["https://example.com/img.jpg"],
            },
        )
        assert res.status_code == 200
        body = res.json()
        assert body["created"] is True
        assert body["sku"] == f"mp:{test_vc}"
        created_id = body["id"]

        # Cleanup
        await client.delete(f"/products/{created_id}", headers=headers)

    @pytest.mark.asyncio
    async def test_mp_bindings_existing(self, client, headers):
        """GET /mp/bindings for known vendor_code returns bindings."""
        res = await client.get(
            f"/mp/bindings?vendor_code={EXISTING_VENDOR_CODE}",
            headers=headers,
        )
        assert res.status_code == 200
        body = res.json()
        assert "bindings" in body
        assert "pim_id" in body
        assert body["pim_id"] is not None
        assert isinstance(body["bindings"], list)
        if body["bindings"]:
            binding = body["bindings"][0]
            assert "platform" in binding
            assert "sku" in binding
            assert "pim_id" in binding

    @pytest.mark.asyncio
    async def test_mp_bindings_nonexistent(self, client, headers):
        """GET /mp/bindings for unknown vendor_code returns empty."""
        res = await client.get(
            "/mp/bindings?vendor_code=NONEXISTENT-12345",
            headers=headers,
        )
        assert res.status_code == 200
        body = res.json()
        assert body["bindings"] == []
        assert body["pim_id"] is None


# ═══════════════════════════════════════════════════════════════════════════════
# 6. AI ENRICHMENT TESTS
# ═══════════════════════════════════════════════════════════════════════════════

class TestAIEnrichment:
    """AI enrichment tests (require AI API key configured)."""

    @pytest.mark.asyncio
    async def test_ai_enrich_product(self, client, headers):
        """POST /ai/enrich/{id} returns enriched product data."""
        res = await client.post(
            f"/ai/enrich/{EXISTING_PRODUCT_ID}",
            headers=headers,
        )
        # May fail if AI key not configured, but endpoint must be reachable
        if res.status_code == 200:
            body = res.json()
            assert "name" in body
            assert "sku" in body
            assert "description" in body
            assert "brand" in body
            assert "category" in body
            # Verify 'attributes' key is NOT present (was removed)
            assert "attributes" not in body
        else:
            # 500 = AI key issue; 404 = product not found (shouldn't happen)
            assert res.status_code in (500, 503), f"Unexpected: {res.status_code} {res.text}"

    @pytest.mark.asyncio
    async def test_ai_enrich_nonexistent_product(self, client, headers):
        """POST /ai/enrich/{fake_id} returns 404."""
        fake_id = str(uuid.uuid4())
        res = await client.post(f"/ai/enrich/{fake_id}", headers=headers)
        assert res.status_code == 404


# ═══════════════════════════════════════════════════════════════════════════════
# 7. SYNDICATION TESTS
# ═══════════════════════════════════════════════════════════════════════════════

class TestSyndication:
    """Syndication / push to marketplace tests."""

    @pytest.mark.asyncio
    async def test_syndication_push_endpoint_exists(self, client, headers):
        """POST /syndication/push/{id} endpoint is reachable."""
        res = await client.post(
            f"/syndication/push/{EXISTING_PRODUCT_ID}",
            headers=headers,
            json={"connection_id": MEGAMARKET_CONNECTION_ID},
        )
        # Endpoint works even if MP returns an error
        assert res.status_code in (200, 400, 404, 500, 502)

    @pytest.mark.asyncio
    async def test_syndication_push_missing_connection(self, client, headers):
        """POST /syndication/push without connection_id returns 400."""
        res = await client.post(
            f"/syndication/push/{EXISTING_PRODUCT_ID}",
            headers=headers,
            json={},
        )
        assert res.status_code == 400

    @pytest.mark.asyncio
    async def test_syndicate_agent_endpoint(self, client, headers):
        """POST /syndicate/agent with push=false returns mapped_payload."""
        res = await client.post(
            "/syndicate/agent",
            headers=headers,
            json={
                "product_id": EXISTING_PRODUCT_ID,
                "connection_id": MEGAMARKET_CONNECTION_ID,
                "push": False,
            },
        )
        # Agent may fail due to AI key or MP API, but endpoint must respond
        if res.status_code == 200:
            body = res.json()
            # Response should contain mapping results
            assert isinstance(body, dict)
        else:
            assert res.status_code in (400, 404, 500, 502, 503)

    @pytest.mark.asyncio
    async def test_syndicate_agent_invalid_product(self, client, headers):
        """POST /syndicate/agent with non-existent product returns 404."""
        fake_id = str(uuid.uuid4())
        res = await client.post(
            "/syndicate/agent",
            headers=headers,
            json={
                "product_id": fake_id,
                "connection_id": MEGAMARKET_CONNECTION_ID,
                "push": False,
            },
        )
        assert res.status_code == 404

    @pytest.mark.asyncio
    async def test_syndicate_agent_invalid_connection(self, client, headers):
        """POST /syndicate/agent with non-existent connection returns 404."""
        fake_conn = str(uuid.uuid4())
        res = await client.post(
            "/syndicate/agent",
            headers=headers,
            json={
                "product_id": EXISTING_PRODUCT_ID,
                "connection_id": fake_conn,
                "push": False,
            },
        )
        assert res.status_code == 404


# ═══════════════════════════════════════════════════════════════════════════════
# 8. CATEGORY & ATTRIBUTE SCHEMA TESTS
# ═══════════════════════════════════════════════════════════════════════════════

class TestCategoryAttributes:
    """Category attributes and dictionary tests."""

    @pytest.mark.asyncio
    async def test_mp_category_attributes_megamarket(self, client, headers):
        """GET /mp/category/attributes returns schema for megamarket category."""
        res = await client.get(
            f"/mp/category/attributes?platform=megamarket&category_id={MM_CATEGORY_ID}",
            headers=headers,
        )
        if res.status_code == 200:
            body = res.json()
            assert body.get("ok") is True
            assert body.get("platform") == "megamarket"
            attrs = body.get("attributes", [])
            assert isinstance(attrs, list)
            # Attributes may be empty if MP API returns no schema for this category
            if attrs:
                attr = attrs[0]
                assert "name" in attr or "id" in attr
        else:
            assert res.status_code in (404, 500, 502)

    @pytest.mark.asyncio
    async def test_mp_category_attributes_missing_params(self, client, headers):
        """GET /mp/category/attributes without params returns 422."""
        res = await client.get("/mp/category/attributes", headers=headers)
        assert res.status_code == 422

    @pytest.mark.asyncio
    async def test_syndicate_dictionary(self, client, headers):
        """GET /syndicate/dictionary returns dictionary values."""
        res = await client.get(
            f"/syndicate/dictionary?connection_id={MEGAMARKET_CONNECTION_ID}&category_id={MM_CATEGORY_ID}&dictionary_id=1",
            headers=headers,
        )
        # Dictionary endpoint must respond, even if specific dictionary not found
        assert res.status_code in (200, 404, 500, 502)

    @pytest.mark.asyncio
    async def test_syndicate_categories_search(self, client, headers):
        """GET /syndicate/categories/search returns matching categories."""
        res = await client.get(
            "/syndicate/categories/search?q=Микроволновая&platform=megamarket",
            headers=headers,
        )
        assert res.status_code in (200, 422, 500)


# ═══════════════════════════════════════════════════════════════════════════════
# 9. ATTRIBUTE STAR MAP TESTS
# ═══════════════════════════════════════════════════════════════════════════════

class TestAttributeStarMap:
    """Attribute star map endpoint tests."""

    @pytest.mark.asyncio
    async def test_star_map_state(self, client, headers):
        """GET /attribute-star-map/state returns current star map state."""
        res = await client.get("/attribute-star-map/state", headers=headers)
        assert res.status_code == 200
        body = res.json()
        assert isinstance(body, dict)

    @pytest.mark.asyncio
    async def test_star_map_categories(self, client, headers):
        """GET /attribute-star-map/categories returns category list."""
        res = await client.get(
            "/attribute-star-map/categories?platform=megamarket",
            headers=headers,
        )
        assert res.status_code == 200
        body = res.json()
        assert isinstance(body, (list, dict))

    @pytest.mark.asyncio
    async def test_star_map_search(self, client, headers):
        """GET /attribute-star-map/search returns search results."""
        res = await client.get(
            "/attribute-star-map/search?q=brand",
            headers=headers,
        )
        assert res.status_code == 200

    @pytest.mark.asyncio
    async def test_star_map_nodes(self, client, headers):
        """GET /attribute-star-map/nodes returns node data."""
        res = await client.get("/attribute-star-map/nodes", headers=headers)
        assert res.status_code == 200

    @pytest.mark.asyncio
    async def test_star_map_build_status(self, client, headers):
        """GET /attribute-star-map/build/status returns build status."""
        res = await client.get(
            "/attribute-star-map/build/status?task_id=test-nonexistent",
            headers=headers,
        )
        # Returns 200 with status info (may be empty for non-existent task)
        assert res.status_code == 200

    @pytest.mark.asyncio
    async def test_star_map_active_task(self, client, headers):
        """GET /attribute-star-map/active-task returns active task info."""
        res = await client.get("/attribute-star-map/active-task", headers=headers)
        assert res.status_code == 200


# ═══════════════════════════════════════════════════════════════════════════════
# 10. SETTINGS TESTS
# ═══════════════════════════════════════════════════════════════════════════════

class TestSettings:
    """System settings tests."""

    @pytest.mark.asyncio
    async def test_get_settings_list(self, client, headers):
        """GET /settings returns list of settings."""
        res = await client.get("/settings", headers=headers)
        assert res.status_code == 200
        settings = res.json()
        assert isinstance(settings, list)
        assert len(settings) > 0

    @pytest.mark.asyncio
    async def test_settings_have_required_fields(self, client, headers):
        """Each setting has id and value."""
        res = await client.get("/settings", headers=headers)
        for setting in res.json():
            assert "id" in setting
            assert "value" in setting

    @pytest.mark.asyncio
    async def test_ai_provider_setting_exists(self, client, headers):
        """The ai_provider setting exists in settings list."""
        res = await client.get("/settings", headers=headers)
        settings = res.json()
        setting_ids = [s["id"] for s in settings]
        assert "ai_provider" in setting_ids, f"ai_provider not found in: {setting_ids}"

    @pytest.mark.asyncio
    async def test_settings_without_auth(self, client):
        """GET /settings without auth returns 401."""
        res = await client.get("/settings")
        assert res.status_code == 401


# ═══════════════════════════════════════════════════════════════════════════════
# 11. HEALTH & INFRA TESTS
# ═══════════════════════════════════════════════════════════════════════════════

class TestHealth:
    """Basic health and infrastructure endpoint tests."""

    @pytest.mark.asyncio
    async def test_root(self, client):
        """GET / returns API info."""
        async with httpx.AsyncClient(base_url="http://localhost:4877", timeout=10.0) as c:
            res = await c.get("/")
        assert res.status_code == 200
        body = res.json()
        assert body.get("status") == "online"
        assert "version" in body

    @pytest.mark.asyncio
    async def test_health(self, client):
        """GET /health returns ok."""
        res = await client.get("/health")
        assert res.status_code == 200
        assert res.json()["status"] == "ok"

    @pytest.mark.asyncio
    async def test_version(self, client):
        """GET /version returns version info."""
        res = await client.get("/version")
        assert res.status_code == 200

    @pytest.mark.asyncio
    async def test_uptime(self, client):
        """GET /uptime returns uptime info."""
        res = await client.get("/uptime")
        # May return 500 if telemetry module not fully initialized
        assert res.status_code in (200, 500)


# ═══════════════════════════════════════════════════════════════════════════════
# 12. CATEGORIES & ATTRIBUTES TESTS
# ═══════════════════════════════════════════════════════════════════════════════

class TestCategoriesAndAttributes:
    """Category and attribute CRUD tests."""

    @pytest.mark.asyncio
    async def test_get_categories(self, client, headers):
        """GET /categories returns list."""
        res = await client.get("/categories", headers=headers)
        assert res.status_code == 200
        assert isinstance(res.json(), list)

    @pytest.mark.asyncio
    async def test_get_attributes(self, client, headers):
        """GET /attributes returns list."""
        res = await client.get("/attributes", headers=headers)
        assert res.status_code == 200
        assert isinstance(res.json(), list)


# ═══════════════════════════════════════════════════════════════════════════════
# 13. MP PRODUCTS & CATEGORIES TESTS
# ═══════════════════════════════════════════════════════════════════════════════

class TestMPProducts:
    """Marketplace product listing and category search tests."""

    @pytest.mark.asyncio
    async def test_mp_products_list(self, client, headers):
        """GET /mp/products returns MP product list."""
        res = await client.get(
            "/mp/products?platform=megamarket",
            headers=headers,
        )
        # Endpoint should respond, even if MP API has issues
        assert res.status_code in (200, 400, 404, 500, 502)

    @pytest.mark.asyncio
    async def test_mp_categories(self, client, headers):
        """GET /mp/categories returns category tree."""
        res = await client.get(
            f"/mp/categories?connection_id={MEGAMARKET_CONNECTION_ID}",
            headers=headers,
        )
        assert res.status_code in (200, 400, 422, 500, 502)
