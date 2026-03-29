import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
    plugins: [react()],
    server: {
        host: '0.0.0.0',
        port: 4876,
        strictPort: true,
        allowedHosts: true,
        proxy: {
            '/api': 'http://127.0.0.1:4877',
            '/uploads': 'http://127.0.0.1:4877'
        }
    }
});
