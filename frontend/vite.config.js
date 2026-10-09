import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/fsm',
  plugins: [react()],
  server: {
    allowedHosts: ['demo.pharynxai.com'],
  },
});