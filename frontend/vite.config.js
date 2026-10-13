import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  base: '/fsm',
  plugins: [react(), tailwindcss()],
  server: {
    allowedHosts: ['demo.pharynxai.com'],
  },
});