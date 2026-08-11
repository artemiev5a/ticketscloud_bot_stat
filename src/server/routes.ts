import { Router } from 'express';
import { botEngine } from './botEngine.js';

export const apiRouter = Router();

// 1. Получить статус бота (работает ли поллинг, сколько сессий)
apiRouter.get('/bot/status', async (req, res) => {
  try {
    const status = await botEngine.getStatus();
    res.json({ ok: true, result: status });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 2. Обновить конфиг (включить/выключить бота, сменить токен)
apiRouter.post('/bot/config', (req, res) => {
  try {
    botEngine.updateConfig(req.body);
    res.json({ ok: true, message: 'Config updated' });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 3. Переключатель поллинга (ВКЛ/ВЫКЛ)
apiRouter.post('/bot/toggle', (req, res) => {
  try {
    const { active } = req.body;
    botEngine.updateConfig({ isPollingActive: !!active });
    res.json({ ok: true, active: !!active });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 4. Получить логи активности (кто что нажимал)
apiRouter.get('/bot/logs', (req, res) => {
  res.json({ ok: true, logs: botEngine.getLogs() });
});

// Очистить логи
apiRouter.post('/bot/clear-logs', (req, res) => {
  botEngine.clearLogs();
  res.json({ ok: true });
});

// 5. Получить список всех чатов (пользователей)
apiRouter.get('/bot/chats', (req, res) => {
  res.json({ ok: true, chats: botEngine.getChats() });
});

// Получить историю конкретного чата
apiRouter.get('/bot/chats/:chatId', (req, res) => {
  const chatId = parseInt(req.params.chatId, 10);
  const chat = botEngine.getChat(chatId);
  if (!chat) {
    return res.status(404).json({ ok: false, error: 'Chat not found' });
  }
  res.json({ ok: true, chat });
});

// 6. Отправить прямое сообщение пользователю (например, из админки)
apiRouter.post('/bot/send-message', async (req, res) => {
  try {
    const { chatId, text, buttons } = req.body;
    if (!chatId || !text) {
      return res.status(400).json({ ok: false, error: 'chatId and text are required' });
    }
    await botEngine.sendBotReply(Number(chatId), text, buttons);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 7. Сделать рассылку всем пользователям бота
apiRouter.post('/bot/broadcast', async (req, res) => {
  try {
    const { text, buttons } = req.body;
    if (!text) {
      return res.status(400).json({ ok: false, error: 'text is required' });
    }
    const result = await botEngine.broadcastMessage(text, buttons);
    res.json({ ok: true, result });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 8. Управление командами (Меню бота)
apiRouter.get('/bot/commands', (req, res) => {
  res.json({ ok: true, commands: botEngine.getCommands() });
});

apiRouter.post('/bot/commands', (req, res) => {
  try {
    botEngine.saveCommand(req.body);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

apiRouter.delete('/bot/commands/:name', (req, res) => {
  try {
    botEngine.deleteCommand(req.params.name);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Синхронизировать меню команд с Telegram (кнопка Menu слева от ввода текста)
apiRouter.post('/bot/sync-commands', async (req, res) => {
  try {
    await botEngine.syncCommandsToTelegram();
    res.json({ ok: true, message: 'Commands menu synced to Telegram app!' });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 9. Симулятор для веб-интерфейса (чтобы тестить бота прямо на сайте)
apiRouter.post('/bot/simulate-update', async (req, res) => {
  try {
    const { text, username = 'SimulatorUser', chatId = 999123 } = req.body;
    const update = {
      update_id: Math.floor(Math.random() * 100000),
      message: {
        message_id: Math.floor(Math.random() * 10000),
        from: {
          id: chatId,
          is_bot: false,
          first_name: username,
          username: username
        },
        chat: {
          id: chatId,
          type: 'private' as const,
          first_name: username,
          username: username
        },
        date: Math.floor(Date.now() / 1000),
        text
      }
    };
    await botEngine.handleUpdate(update);
    res.json({ ok: true, update });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});