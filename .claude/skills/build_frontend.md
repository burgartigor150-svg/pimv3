# Build and Deploy Frontend
```bash
# If editing locally, scp first:
scp /tmp/SomePage.tsx myserver:/mnt/data/Pimv3/frontend/src/pages/SomePage.tsx

# Build:
ssh myserver "cd /mnt/data/Pimv3/frontend && npm run build 2>&1 | tail -5"
```
Frontend serves from dist/ via nginx. No restart needed after build.
