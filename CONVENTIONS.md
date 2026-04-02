# PIMv3 Development Standards
# Читается агентами автоматически. Соблюдение обязательно.

## БЫСТРЫЕ ПРАВИЛА ДЛЯ АГЕНТОВ

1. **Прочитай файл перед правкой** — никогда не пиши вслепую
2. **Один файл = один атомарный коммит** — не трогай лишнее
3. **Запусти тесты после изменений** — `python3 -m pytest backend/tests/ -x -q`
4. **Проверь синтаксис** — `python3 -m py_compile path/to/file.py`
5. **Не дублируй код** — проверь есть ли уже похожая функция

---

## Python / FastAPI (backend)

### Структура

- Backend код: `backend/` — FastAPI routes в `main.py`, сервисы в `backend/services/`
- Тесты: `backend/tests/test_*.py`
- Модели БД: `backend/models.py` (SQLAlchemy ORM)
- Конфиг: переменные среды через `os.getenv()`

### Обязательно

```python
# Логирование — только так, не print()
log = logging.getLogger(__name__)
log.info("message")
log.error("error %s", e)

# Async везде
async def my_endpoint(...):
    result = await some_service(...)
    return result

# DB сессии
async with AsyncSessionLocal() as session:
    result = await session.execute(...)

# HTTP запросы — только httpx, не requests
async with httpx.AsyncClient(timeout=30) as client:
    resp = await client.get(url, headers=headers)
    resp.raise_for_status()

# Возврат ошибок из сервисов
return {"ok": False, "error": "description"}

# Исключения в роутах
raise HTTPException(status_code=404, detail="Not found")
```

### Нельзя

- `print()` — только `log.xxx()`
- `import requests` — только `httpx`
- Функции длиннее 100 строк — разбивай на части
- Глобальные переменные изменяемого состояния (кроме `log`)
- Голые `except: pass` — всегда логируй ошибку

### Типы

```python
from typing import Dict, Any, List, Optional, Tuple
# Всегда указывай типы в сигнатурах
async def process(task_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
```

### Новый endpoint

```python
@app.get("/api/v1/my-resource/{id}", response_model=...)
async def get_my_resource(
    id: str,
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    ...
```

---

## React / TypeScript (frontend)

### Структура

- Страницы: `frontend/src/pages/`
- Компоненты: `frontend/src/components/`
- API: `frontend/src/lib/api.ts` (axios с baseURL=/api/v1)
- Стили: Tailwind CSS

### Обязательно

```typescript
// API вызовы — только через api.ts
import api from '@/lib/api'
const { data } = await api.get('/my-resource')

// Типы для API ответов
interface MyResource {
  id: string
  name: string
}

// Компоненты — функциональные
const MyComponent: React.FC<Props> = ({ prop1, prop2 }) => {
  const [data, setData] = useState<MyResource[]>([])
  // ...
}
```

### После правки frontend

```bash
# Проверь компиляцию (не запускай полный build — долго)
cd /mnt/data/Pimv3/frontend && npx tsc --noEmit 2>&1 | head -30
```

---

## Тестирование

### Запуск тестов

```bash
# Быстрая проверка после изменений
python3 -m pytest backend/tests/ -x -q 2>&1 | tail -20

# Конкретный файл
python3 -m pytest backend/tests/test_smoke_backend.py -v
```

### Написание тестов

```python
# Файл: backend/tests/test_<feature>.py
import pytest

@pytest.mark.asyncio
async def test_my_feature():
    result = await my_function(arg)
    assert result["ok"] is True
    assert "data" in result
```

- Тест должен быть в `backend/tests/`
- Имя файла: `test_<module_name>.py`
- Тест к каждой новой функции

---

## Git стандарты

### Коммиты

```
feat: добавить endpoint создания продукта
fix: исправить ошибку 500 при пустом запросе
refactor: вынести логику парсинга в отдельную функцию
test: добавить тест для adapter.push_product
chore: обновить зависимости
```

- Одна фича / один баг = один коммит
- Сообщение: `<тип>: <что сделано>` (строчные буквы)

### Ветки

- Агент-задачи: `auto/fix-{task_id[:8]}`
- Фичи: `feat/short-name`
- Никогда не коммить в main напрямую

---

## Marketplace адаптеры

Все адаптеры в `backend/services/adapters.py`, наследуют `MarketplaceAdapter`:

```python
class MyMarketAdapter(MarketplaceAdapter):
    def __init__(self, api_key: str):
        self.api_key = api_key

    async def push_product(self, product: Dict[str, Any]) -> Dict[str, Any]:
        ...

    async def pull_product(self, query: str) -> Dict[str, Any]:
        ...
```

Обязательные методы: `push_product`, `pull_product`, `search_categories`, `get_category_schema`, `get_dictionary`

---

## Агентам: порядок работы

1. `read_file` — прочитай файл который правишь
2. `shell("grep -n 'function_name' path/to/file.py")` — найди нужное место
3. `write_file` / `patch_file` — внеси изменение
4. `shell("python3 -m py_compile backend/file.py")` — проверь синтаксис
5. `shell("python3 -m pytest backend/tests/ -x -q")` — прогони тесты
6. `task_done` — только после успешных тестов

Не вызывай `task_done` если тесты падают!

