# PIMv3 Code Conventions

## Python / FastAPI (backend)

- **Async everywhere**: all route handlers and service functions use `async def` + `await`
- **Error handling**: raise `fastapi.HTTPException(status_code=..., detail="...")` in routes; services return `{"ok": bool, "error": str}` dicts
- **Logging**: `log = logging.getLogger(__name__)` at module top; use `log.info/warning/error`
- **DB sessions**: use `async with AsyncSessionLocal() as session:` or inject via `Depends(get_db)`
- **Models**: SQLAlchemy ORM in `backend/models.py`; all IDs are `uuid.uuid4()` strings
- **Imports order**: stdlib → third-party → `from backend.xxx import ...`
- **Type hints**: always on function signatures; use `Dict[str, Any]`, `List[str]`, `Optional[str]`
- **Constants**: UPPER_SNAKE_CASE at module level
- **Comments**: Russian is fine
- **No print()**: use `log.xxx()` instead

## Marketplace adapters

- All adapters inherit `MarketplaceAdapter` from `backend/services/adapters.py`
- Must implement: `push_product`, `pull_product`, `search_categories`, `get_category_schema`, `get_dictionary`
- Auth headers built in adapter's `__init__` or helper method
- All HTTP calls via `httpx.AsyncClient` (not `requests`)

## React / TypeScript (frontend)

- **API calls**: use axios instance from `frontend/src/lib/api.ts` (baseURL=/api/v1)
- **Components**: functional with hooks, no class components
- **Styling**: Tailwind CSS utility classes
- **State**: local `useState`/`useEffect`; no Redux
- **Types**: define interfaces for API response shapes

## Git

- Branch names: `auto/fix-{id}` for agent tasks, `feat/xxx` for features
- Commit messages: lowercase, imperative mood, prefixed: `feat:`, `fix:`, `refactor:`
- Never commit `.env`, `venv/`, `node_modules/`, `__pycache__/`
