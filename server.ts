import express from 'express';
import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';
import { apiRouter } from './src/server/routes.js';
import { botEngine } from './src/server/botEngine.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json());

// API эндпоинты
app.use('/api', apiRouter);

// Раздача статики фронтенда (в продакшене)
app.use(express.static(path.join(__dirname, 'dist')));

// Fallback для SPA (React Router)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// Запуск движка бота
botEngine.startEngine();

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Сервер TicketsCloud Statistic Bot запущен на http://0.0.0.0:${PORT}`);
});

// Корректное завершение работы при остановке сервера (Graceful Shutdown)
const shutdown = () => {
  console.log('\n⏳ Остановка сервера и бота...');
  botEngine.stopEngine();
  server.close(() => {
    console.log('✅ Сервер успешно остановлен.');
    process.exit(0);
  });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
