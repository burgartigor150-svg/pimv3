"""
Test file for agent hello function.
"""
import unittest


def hello() -> str:
    """Return a greeting string."""
    return 'Hello from Claude agent'


class TestAgentHello(unittest.TestCase):
    """Tests for hello function."""
    
    def test_hello_returns_correct_string(self):
        """Test that hello() returns the expected string."""
        result = hello()
        self.assertEqual(result, 'Hello from Claude agent')
        self.assertIsInstance(result, str)
    
    def test_hello_not_empty(self):
        """Test that hello() returns a non-empty string."""
        result = hello()
        self.assertTrue(len(result) > 0)
    
    def test_hello_contains_claude(self):
        """Test that hello() contains 'Claude'."""
        result = hello()
        self.assertIn('Claude', result)
    
    def test_hello_contains_agent(self):
        """Test that hello() contains 'agent'."""
        result = hello()
        self.assertIn('agent', result)


if __name__ == '__main__':
    unittest.main()