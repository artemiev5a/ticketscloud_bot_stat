import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import express from 'express';
import 'dotenv/config';
import { defineConfig } from 'vite';
import { apiRouter } from './src/server/routes.js';
import { botEngine } from './src/server/botEngine.js';
import { validateSecurityConfig } from './src/server/securityConfig.js';

export default defineConfig({
  plugins: [react(), tailwindcss(), {
    name: 'telegram-bot-api',
    configureServer(server) {
      validateSecurityConfig();
      botEngine.startEngine();
      const app = express();
      app.use(express.json());
      app.use('/api', apiRouter);
      server.middlewares.use(app);
    }
  }]
});
