"""
Test file for agent hello function.
Created as part of the task to create backend/test_agent_hello.py.
"""


def hello() -> str:
    """
    Returns a greeting string.
    
    Returns:
        str: Greeting message
    """
    return "Hello from test_agent_hello.py function!"


def hello_with_name(name: str = "World") -> str:
    """
    Returns a personalized greeting.
    
    Args:
        name: Name to greet (default: "World")
    
    Returns:
        str: Personalized greeting message
    """
    return f"Hello, {name}!"


def hello_from_agent() -> str:
    """
    Returns a greeting from the agent.
    
    Returns:
        str: Greeting from agent
    """
    return "Hello from Claude agent!"


if __name__ == "__main__":
    # Simple test when run directly
    print("Testing hello functions:")
    print(f"hello() = {hello()}")
    print(f"hello_with_name() = {hello_with_name()}")
    print(f"hello_with_name('Alice') = {hello_with_name('Alice')}")
    print(f"hello_from_agent() = {hello_from_agent()}")
