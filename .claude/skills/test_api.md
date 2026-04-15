# Test API Endpoint
```python
# Write test script to /tmp/test_X.py, scp to server, run with venv python:
scp /tmp/test_X.py myserver:/tmp/test_X.py
ssh myserver "/mnt/data/Pimv3/backend/venv/bin/python3 /tmp/test_X.py 2>/dev/null"
```
Always use venv python. Suppress stderr (2>/dev/null) to avoid debug noise.
Login: POST /api/v1/auth/login data={'username': 'admin@admin.com', 'password': 'admin'}
