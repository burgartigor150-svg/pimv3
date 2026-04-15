# Restart PIMv3 Backend
```bash
ssh myserver "sudo systemctl restart pimv3-backend.service"
# Wait and verify:
sleep 5
ssh myserver "systemctl status pimv3-backend.service | head -5"
```
Do NOT use kill/nohup — systemd manages the process.
