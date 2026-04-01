"""
backend/services/agent_task_templates.py

Predefined task templates for common operations.
"""

import os
import logging
from typing import Dict, Any, List, Optional

log = logging.getLogger(__name__)

# Built-in templates dict. Each template:
# {"id": str, "name": str, "task_type": str,
#  "title_tpl": str, "description_tpl": str, "tags": List[str]}
# title_tpl and description_tpl support {name}, {model}, {endpoint}, {table} placeholders

BUILT_IN_TEMPLATES: List[Dict[str, Any]] = [
    {
        "id": "add-crud",
        "name": "Add CRUD endpoint",
        "task_type": "backend",
        "title_tpl": "Add CRUD for {model}",
        "description_tpl": (
            "Create full CRUD API endpoints for the `{model}` model.\n\n"
            "Tasks:\n"
            "- [ ] Create SQLAlchemy model in `models/{model}.py` (if not exists)\n"
            "- [ ] Create Pydantic schemas: `{model}Create`, `{model}Update`, `{model}Read`\n"
            "- [ ] Implement repository layer in `repositories/{model}_repo.py`\n"
            "- [ ] Add router `routers/{model}.py` with GET/POST/PUT/DELETE endpoints\n"
            "- [ ] Register router in `main.py`\n"
            "- [ ] Write pytest tests covering all endpoints"
        ),
        "tags": ["backend", "api", "crud"],
    },
    {
        "id": "add-test",
        "name": "Add tests for endpoint",
        "task_type": "testing",
        "title_tpl": "Add tests for {endpoint}",
        "description_tpl": (
            "Write comprehensive pytest tests for the `{endpoint}` endpoint.\n\n"
            "Coverage targets:\n"
            "- [ ] Happy path (valid input → expected response)\n"
            "- [ ] Validation errors (422 responses)\n"
            "- [ ] Auth/permission checks (401, 403)\n"
            "- [ ] Edge cases and boundary values\n"
            "- [ ] Mocking external dependencies (Redis, external APIs)\n"
            "Target coverage: ≥90% for the relevant service/router module."
        ),
        "tags": ["testing", "pytest", "backend"],
    },
    {
        "id": "fix-n-plus-one",
        "name": "Fix N+1 query problem",
        "task_type": "performance",
        "title_tpl": "Fix N+1 queries in {model}",
        "description_tpl": (
            "Investigate and fix N+1 query problem for `{model}` related queries.\n\n"
            "Steps:\n"
            "- [ ] Enable SQLAlchemy query logging and identify N+1 patterns\n"
            "- [ ] Add `selectinload` / `joinedload` for relevant relationships\n"
            "- [ ] Add database indexes if missing\n"
            "- [ ] Write benchmark test: assert total queries ≤ expected threshold\n"
            "- [ ] Document the fix in the PR description"
        ),
        "tags": ["performance", "database", "sqlalchemy"],
    },
    {
        "id": "add-migration",
        "name": "Add Alembic migration",
        "task_type": "database",
        "title_tpl": "Add migration for {table}",
        "description_tpl": (
            "Create an Alembic migration for changes to the `{table}` table.\n\n"
            "Checklist:\n"
            "- [ ] Run `alembic revision --autogenerate -m 'describe change'`\n"
            "- [ ] Review generated migration — autogenerate is not always correct\n"
            "- [ ] Ensure `downgrade()` is properly implemented (not just `pass`)\n"
            "- [ ] Add `server_default` for any new NOT NULL columns\n"
            "- [ ] Test upgrade and downgrade on a copy of production data\n"
            "- [ ] Run `agent_alembic_safety.check_migration_safety()` before merging"
        ),
        "tags": ["database", "alembic", "migration"],
    },
    {
        "id": "add-react-page",
        "name": "Add React page",
        "task_type": "frontend",
        "title_tpl": "Add React page for {name}",
        "description_tpl": (
            "Create a new React page component for `{name}`.\n\n"
            "Tasks:\n"
            "- [ ] Create `pages/{name}.tsx` with proper TypeScript types\n"
            "- [ ] Add route in `App.tsx` / router configuration\n"
            "- [ ] Connect to API via React Query hook in `hooks/use{name}.ts`\n"
            "- [ ] Add loading skeleton and error boundary\n"
            "- [ ] Ensure mobile-responsive layout\n"
            "- [ ] Write Cypress or React Testing Library tests"
        ),
        "tags": ["frontend", "react", "typescript"],
    },
    {
        "id": "fix-bug",
        "name": "Fix bug",
        "task_type": "bugfix",
        "title_tpl": "Fix: {name}",
        "description_tpl": (
            "## Bug description\n{name}\n\n"
            "## Steps to reproduce\n1. ...\n\n"
            "## Expected behaviour\n...\n\n"
            "## Actual behaviour\n...\n\n"
            "## Fix checklist\n"
            "- [ ] Identify root cause\n"
            "- [ ] Write a failing test that reproduces the bug\n"
            "- [ ] Implement fix\n"
            "- [ ] Confirm test now passes\n"
            "- [ ] Check for similar issues elsewhere in the codebase"
        ),
        "tags": ["bugfix"],
    },
    {
        "id": "add-auth-check",
        "name": "Add authorization check",
        "task_type": "security",
        "title_tpl": "Add auth check to {endpoint}",
        "description_tpl": (
            "Add proper authentication and authorization to `{endpoint}`.\n\n"
            "Tasks:\n"
            "- [ ] Identify required roles/permissions for the endpoint\n"
            "- [ ] Add `Depends(get_current_user)` / `Depends(require_role(...))` dependency\n"
            "- [ ] Return 401 for unauthenticated requests\n"
            "- [ ] Return 403 for authenticated but unauthorized requests\n"
            "- [ ] Write tests for both 401 and 403 scenarios\n"
            "- [ ] Update OpenAPI docs with security scheme"
        ),
        "tags": ["security", "auth", "backend"],
    },
    {
        "id": "refactor-service",
        "name": "Refactor service layer",
        "task_type": "refactoring",
        "title_tpl": "Refactor {name} service",
        "description_tpl": (
            "Refactor the `{name}` service for improved maintainability.\n\n"
            "Goals:\n"
            "- [ ] Extract business logic from router into service layer\n"
            "- [ ] Remove duplicated code (DRY)\n"
            "- [ ] Add proper type hints to all public functions\n"
            "- [ ] Replace `print()` calls with structured logging\n"
            "- [ ] Ensure all functions have docstrings\n"
            "- [ ] Run `mypy` and `ruff` — zero warnings allowed\n"
            "- [ ] Maintain or improve test coverage"
        ),
        "tags": ["refactoring", "backend", "code-quality"],
    },
    {
        "id": "add-celery-task",
        "name": "Add Celery background task",
        "task_type": "backend",
        "title_tpl": "Add Celery task: {name}",
        "description_tpl": (
            "Implement a Celery background task for `{name}`.\n\n"
            "Tasks:\n"
            "- [ ] Create task in `tasks/{name}.py` with `@celery_app.task(bind=True)`\n"
            "- [ ] Add retry logic: `self.retry(exc=exc, countdown=60, max_retries=3)`\n"
            "- [ ] Use structured logging — no print()\n"
            "- [ ] Add task to beat schedule if periodic\n"
            "- [ ] Write unit test with mocked dependencies\n"
            "- [ ] Document expected execution time and resource usage"
        ),
        "tags": ["backend", "celery", "async"],
    },
    {
        "id": "security-audit",
        "name": "Security audit for endpoint",
        "task_type": "security",
        "title_tpl": "Security audit: {endpoint}",
        "description_tpl": (
            "Perform a security audit of `{endpoint}` and related code.\n\n"
            "Checklist:\n"
            "- [ ] SQL injection: all queries use ORM or parameterized statements\n"
            "- [ ] Input validation: Pydantic schemas enforce correct types and limits\n"
            "- [ ] Authentication: endpoint requires valid JWT / session\n"
            "- [ ] Authorization: ownership/role checks are present\n"
            "- [ ] Secrets: no credentials in source code or logs\n"
            "- [ ] Rate limiting: endpoint is protected from abuse\n"
            "- [ ] Dependency check: `pip-audit` shows no known CVEs\n"
            "- [ ] Document findings in PR description"
        ),
        "tags": ["security", "audit", "backend"],
    },
]

_BUILT_IN_IDS: set = {t["id"] for t in BUILT_IN_TEMPLATES}


def _get_redis_client():  # type: ignore[return]
    """Lazily import and return a Redis client from the application context."""
    try:
        import redis  # type: ignore[import-untyped]

        redis_url = os.environ.get("REDIS_URL", "redis://localhost:6379/0")
        return redis.from_url(redis_url, decode_responses=True)
    except ImportError:
        log.warning("redis package not installed; custom templates unavailable")
        return None


def list_templates() -> List[Dict[str, Any]]:
    """Return all available templates (built-in + custom from Redis)."""
    templates: List[Dict[str, Any]] = list(BUILT_IN_TEMPLATES)

    redis_client = _get_redis_client()
    if redis_client is None:
        return templates

    try:
        import json

        cursor = 0
        while True:
            cursor, keys = redis_client.scan(
                cursor=cursor, match="agent:templates:*", count=100
            )
            for key in keys:
                raw = redis_client.get(key)
                if raw:
                    try:
                        custom = json.loads(raw)
                        templates.append(custom)
                    except (ValueError, TypeError) as exc:
                        log.warning("Could not parse template at key %s: %s", key, exc)
            if cursor == 0:
                break
    except Exception as exc:  # noqa: BLE001
        log.error("Redis error while listing custom templates: %s", exc)

    log.debug("list_templates: returned %d templates total", len(templates))
    return templates


def get_template(template_id: str) -> Optional[Dict[str, Any]]:
    """Get template by ID."""
    # Check built-ins first (O(n) but n is small)
    for tmpl in BUILT_IN_TEMPLATES:
        if tmpl["id"] == template_id:
            return tmpl

    # Check Redis
    redis_client = _get_redis_client()
    if redis_client is None:
        log.debug("get_template(%s): not found in built-ins, Redis unavailable", template_id)
        return None

    try:
        import json

        raw = redis_client.get(f"agent:templates:{template_id}")
        if raw:
            return json.loads(raw)
    except Exception as exc:  # noqa: BLE001
        log.error("Redis error in get_template(%s): %s", template_id, exc)

    log.debug("get_template(%s): not found", template_id)
    return None


def render_template(template_id: str, variables: Dict[str, str]) -> Dict[str, Any]:
    """Render template with variables.
    Returns {"title": str, "description": str, "task_type": str}
    Uses str.format_map() with variables.
    """
    tmpl = get_template(template_id)
    if tmpl is None:
        raise ValueError(f"Template '{template_id}' not found")

    try:
        title = tmpl["title_tpl"].format_map(variables)
        description = tmpl["description_tpl"].format_map(variables)
    except KeyError as exc:
        raise ValueError(
            f"Missing required variable {exc} for template '{template_id}'"
        ) from exc

    return {
        "title": title,
        "description": description,
        "task_type": tmpl.get("task_type", "generic"),
        "tags": tmpl.get("tags", []),
        "template_id": template_id,
    }


def create_task_from_template(
    template_id: str,
    variables: Dict[str, str],
    requested_by: str = "user",
) -> Dict[str, Any]:
    """Render template and call create_agent_task() from agent_task_console.
    Returns task creation result.
    """
    rendered = render_template(template_id, variables)

    try:
        from backend.services.agent_task_console import create_agent_task  # type: ignore[import]
    except ImportError as exc:
        log.error("Cannot import create_agent_task: %s", exc)
        return {"ok": False, "error": f"agent_task_console not available: {exc}"}

    log.info(
        "create_task_from_template: template=%s requested_by=%s title=%r",
        template_id,
        requested_by,
        rendered["title"],
    )

    result: Dict[str, Any] = create_agent_task(
        title=rendered["title"],
        description=rendered["description"],
        task_type=rendered["task_type"],
        tags=rendered.get("tags", []),
        requested_by=requested_by,
        metadata={"template_id": template_id, "variables": variables},
    )
    return result


def save_custom_template(template: Dict[str, Any]) -> Dict[str, Any]:
    """Save a custom template to Redis hash agent:templates:{id}."""
    required_keys = {"id", "name", "task_type", "title_tpl", "description_tpl"}
    missing = required_keys - set(template.keys())
    if missing:
        return {"ok": False, "error": f"Missing required fields: {sorted(missing)}"}

    template_id: str = template["id"]
    if template_id in _BUILT_IN_IDS:
        return {
            "ok": False,
            "error": f"Cannot overwrite built-in template '{template_id}'",
        }

    redis_client = _get_redis_client()
    if redis_client is None:
        return {"ok": False, "error": "Redis is not available"}

    import json

    key = f"agent:templates:{template_id}"
    try:
        redis_client.set(key, json.dumps(template))
        log.info("Saved custom template: %s", template_id)
        return {"ok": True, "template_id": template_id, "key": key}
    except Exception as exc:  # noqa: BLE001
        log.error("Redis error saving template %s: %s", template_id, exc)
        return {"ok": False, "error": str(exc)}


def delete_custom_template(template_id: str) -> Dict[str, Any]:
    """Delete custom template (only custom ones, not built-in)."""
    if template_id in _BUILT_IN_IDS:
        return {
            "ok": False,
            "error": f"Cannot delete built-in template '{template_id}'",
        }

    redis_client = _get_redis_client()
    if redis_client is None:
        return {"ok": False, "error": "Redis is not available"}

    key = f"agent:templates:{template_id}"
    try:
        deleted = redis_client.delete(key)
        if deleted == 0:
            log.warning("delete_custom_template: key not found: %s", key)
            return {"ok": False, "error": f"Template '{template_id}' not found in Redis"}
        log.info("Deleted custom template: %s", template_id)
        return {"ok": True, "template_id": template_id}
    except Exception as exc:  # noqa: BLE001
        log.error("Redis error deleting template %s: %s", template_id, exc)
        return {"ok": False, "error": str(exc)}
