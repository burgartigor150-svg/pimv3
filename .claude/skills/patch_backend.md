# Patch Backend Code Remotely
Write a Python patch script that:
1. Reads the file
2. Finds exact old text
3. Replaces with new text
4. Writes back

```python
cat > /tmp/patch_X.py << 'PYEOF'
with open('/mnt/data/Pimv3/backend/main.py', 'r') as f:
    content = f.read()
old = '''exact old text'''
new = '''new text'''
if old in content:
    content = content.replace(old, new, 1)
    with open('/mnt/data/Pimv3/backend/main.py', 'w') as f:
        f.write(content)
    print("OK")
else:
    print("ERROR")
PYEOF
scp /tmp/patch_X.py myserver:/tmp/patch_X.py
ssh myserver "python3 /tmp/patch_X.py" < /dev/null 2>&1
```
Always use `< /dev/null 2>&1` to prevent SSH hanging.
After patch: restart via systemd.
