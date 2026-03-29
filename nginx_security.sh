cat << 'EOF' | sudo tee /etc/nginx/sites-available/pim.conf
server {
    listen 80;
    server_name pim.giper.fm.postobot.online;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name pim.giper.fm.postobot.online;

    ssl_certificate /etc/letsencrypt/live/pim.giper.fm.postobot.online/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/pim.giper.fm.postobot.online/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    # Security Headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header Referrer-Policy "no-referrer-when-downgrade" always;

    location /api/ {
        proxy_pass http://127.0.0.1:4877;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        proxy_pass http://127.0.0.1:4876;
        proxy_set_header Host localhost;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
EOF
sudo systemctl restart pim-backend
sudo systemctl reload nginx
