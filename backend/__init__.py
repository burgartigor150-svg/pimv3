# Makes `backend` a package so tests can use `from backend.xxx` with PYTHONPATH=repo root.

def hello(name: str = "World") -> str:
    """
    Возвращает приветственное сообщение.
    
    Args:
        name: Имя для приветствия (по умолчанию "World")
    
    Returns:
        Строка приветствия
    """
    return f"Hello, {name}!"


def hello_from_agent() -> str:
    """
    Возвращает приветственное сообщение от агента.
    Создано в рамках задачи по созданию тестового файла.
    
    Returns:
        str: Приветственное сообщение от агента
    """
    return "Hello from agent!"


def hello() -> str:
    """
    Функция hello() для тестового файла test_agent_hello.py.
    Создана в соответствии с задачей.
    
    Returns:
        str: Приветственное сообщение
    """
    return "Hello from test_agent_hello.py function!"
