import { ActivityLog, BotCommand, BotConfig, BotInfo, ChatSession, TelegramUpdate } from '../types/telegram.js';
import { telegramApi } from './telegramApi.js';
import { ticketscloudService } from './ticketscloudService.js';
import { encryptApiKey, decryptApiKey } from './cryptoUtils.js';

class TelegramBotEngine {
  private config: BotConfig = {
    token: process.env.TELEGRAM_BOT_TOKEN || '',
    isPollingActive: true,
    welcomeMessage: '👋 <b>Привет! Добро пожаловать в TicketsCloud Statistics!</b>\n\nЯ помогу отслеживать продажи билетов и финансовую статистику в реальном времени.\n\nИспользуйте меню для навигации или отправьте команду /stats.',
    pollingIntervalMs: 1500
  };

  private botInfo: BotInfo | null = null;
  private lastUpdateOffset: number = 0;
  private isPolling: boolean = false;
  private isProcessingLoop: boolean = false;
  private pollingTimer: NodeJS.Timeout | null = null;

  private logs: ActivityLog[] = [];
  private chatSessions: Map<number, ChatSession> = new Map();
  private commands: Map<string, BotCommand> = new Map();
  private userApiKeys: Map<number, string> = new Map();
  private awaitingKeyUsers: Set<number> = new Set();

  constructor() {
    this.initializeDefaultCommands();
    this.addLog('system', 'Telegram Bot Engine initialized', 'Ready to start');
    
    // Auto start polling on server boot
    this.startEngine();

    // Cleanup stale sessions once an hour
    setInterval(() => this.cleanupStaleSessions(), 1000 * 60 * 60);
  }

  private initializeDefaultCommands() {
    const defaultCmds: BotCommand[] = [
      {
        id: 'start',
        command: 'start',
        description: 'Главное меню и приветствие',
        responseType: 'text',
        responseText: '👋 <b>Добро пожаловать в TicketsCloud Statistics!</b>\n\nЯ помогу отслеживать продажи билетов и финансовую статистику в реальном времени.\n\nИспользуйте кнопки меню ниже или введите <code>/stats</code> для получения актуальной сводки.',
        buttons: [
          [
            { text: '📊 Статистика продаж', callback_data: 'btn_stats' }
          ],
          [
            { text: '🔑 Указать API-ключ', callback_data: 'prompt_set_key' },
            { text: '💬 Поддержка', callback_data: 'btn_support' }
          ]
        ],
        enabled: true
      },
      {
        id: 'stats',
        command: 'stats',
        description: 'Сводка статистики продаж TicketsCloud',
        responseType: 'ticketscloud_stats',
        responseText: '📊 Загрузка статистики TicketsCloud...',
        buttons: [
          [
            { text: '🔄 Обновить данные', callback_data: 'btn_stats' }
          ]
        ],
        enabled: true
      },
      {
        id: 'help',
        command: 'help',
        description: 'Справка и список команд',
        responseType: 'text',
        responseText: 'ℹ️ <b>Справка по командам:</b>\n\n' +
          '• <code>/start</code> — Главное меню и приветствие\n' +
          '• <code>/stats</code> — Сводка по продажам TicketsCloud\n' +
          '• <code>/setkey [КЛЮЧ]</code> — Указать ваш TicketsCloud API Key\n' +
          '• <code>/help</code> — Справка по работе с ботом',
        enabled: true
      }
    ];

    for (const c of defaultCmds) {
      this.commands.set(c.command.toLowerCase().replace(/^\//, ''), c);
    }
  }

  public addLog(
    type: ActivityLog['type'],
    title: string,
    details?: string,
    chatId?: number,
    username?: string,
    rawPayload?: any
  ) {
    const log: ActivityLog = {
      id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      timestamp: new Date().toISOString(),
      type,
      title,
      details,
      chatId,
      username,
      rawPayload
    };
    this.logs.unshift(log);
    if (this.logs.length > 500) {
      this.logs = this.logs.slice(0, 500);
    }
  }

  public async startEngine() {
    if (this.isPolling) return;

    if (!this.config.token) {
      this.addLog('error', 'Start Engine Failed', 'Telegram Bot Token is not set');
      return;
    }

    if (this.pollingTimer) {
      clearTimeout(this.pollingTimer);
      this.pollingTimer = null;
    }

    this.isPolling = true;
    this.config.isPollingActive = true;

    try {
      const webhookResponse = await fetch(
        `https://api.telegram.org/bot${this.config.token.trim()}/deleteWebhook`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ drop_pending_updates: false })
        }
      );

      const webhookResult = await webhookResponse.json() as any;

      if (!webhookResult.ok) {
        throw new Error(webhookResult.description || 'Не удалось отключить старый Telegram webhook');
      }
      this.botInfo = await telegramApi.getMe(this.config.token);
      this.addLog('system', 'Telegram Token Connected', `@${this.botInfo.username} (${this.botInfo.first_name})`);
      this.syncCommandsToTelegram().catch(() => {});
    } catch (err: any) {
      this.addLog('error', 'Failed to connect Telegram Bot Token', err.message);
    }

    this.pollLoop();
  }

  public stopEngine() {
    this.isPolling = false;
    this.config.isPollingActive = false;
    if (this.pollingTimer) {
      clearTimeout(this.pollingTimer);
      this.pollingTimer = null;
    }
    this.addLog('system', 'Bot Engine Polling Stopped');
  }

  private async pollLoop() {
    if (!this.isPolling || this.isProcessingLoop) return;

    this.isProcessingLoop = true;

    try {
      if (this.config.token) {
        const updates = await telegramApi.getUpdates(this.config.token, this.lastUpdateOffset, 3);
        
        for (const update of updates) {
          this.lastUpdateOffset = Math.max(this.lastUpdateOffset, update.update_id + 1);
          await this.handleUpdate(update);
        }
      }
    } catch (err: any) {
      if (!err.message?.includes('timeout') && !err.message?.includes('abort')) {
        this.addLog('error', 'Polling cycle error', err.message);
      }
    } finally {
      this.isProcessingLoop = false;
      if (this.isPolling) {
        this.pollingTimer = setTimeout(() => this.pollLoop(), this.config.pollingIntervalMs || 1500);
      }
    }
  }

  public async handleUpdate(update: TelegramUpdate) {
    if (update.message) {
      await this.handleMessage(update.message, update);
    } else if (update.callback_query) {
      await this.handleCallbackQuery(update.callback_query, update);
    }
  }

  private async handleMessage(msg: any, rawUpdate: TelegramUpdate) {
    const chatId = msg.chat.id;
    const user = msg.from;
    const text = msg.text?.trim() || '';
    const username = user?.username ? `@${user.username}` : user?.first_name || `User_${chatId}`;

    this.recordUserMessage(chatId, user, text, 'user');
    this.addLog('incoming_msg', `Message from ${username}`, text, chatId, username, rawUpdate);

    // 1. Ожидание ввода ключа
    if (this.awaitingKeyUsers.has(user.id) && !text.startsWith('/')) {
      this.userApiKeys.set(user.id, encryptApiKey(text)); 
      this.awaitingKeyUsers.delete(user.id);
      this.addLog('system', 'User set new TicketsCloud API Key (Encrypted)', undefined, chatId, username);

      await this.sendBotReply(
        chatId,
        '✅ <b>API-ключ успешно и безопасно сохранен!</b>\n\nНажмите кнопку ниже, чтобы загрузить статистику:',
        [
          [{ text: '📊 Посмотреть статистику', callback_data: 'btn_stats' }]
        ]
      );
      return;
    }

    // 2. Команда /setkey
    if (text.startsWith('/setkey')) {
      const key = text.replace('/setkey', '').trim();
      if (!key) {
        await this.sendBotReply(chatId, '✏️ Отправьте команду с ключом в формате:\n\n<code>/setkey ВАШ_API_КЛЮЧ</code>');
        return;
      }
      this.userApiKeys.set(user.id, encryptApiKey(key));
      this.awaitingKeyUsers.delete(user.id);
      await this.sendBotReply(
        chatId,
        '✅ <b>API-ключ успешно и безопасно сохранен!</b>',
        [
          [{ text: '📊 Посмотреть статистику', callback_data: 'btn_stats' }]
        ]
      );
      return;
    }

    // 3. Обработка команд
    if (text.startsWith('/')) {
      const parts = text.split(' ');
      const rawCmd = parts[0].substring(1).replace(/@.*/, '').toLowerCase();

      if (rawCmd === 'stats') {
        await this.sendTicketscloudStats(chatId, user.id);
        return;
      }

      const matchedCmd = this.commands.get(rawCmd);
      if (matchedCmd && matchedCmd.enabled) {
        this.addLog('command_exec', `Executed command /${rawCmd}`, undefined, chatId, username);
        
        if (matchedCmd.responseType === 'ticketscloud_stats' || matchedCmd.responseType === 'stats') {
          await this.sendTicketscloudStats(chatId, user.id);
        } else {
          await this.sendBotReply(chatId, matchedCmd.responseText || 'Команда выполнена', matchedCmd.buttons);
        }
        return;
      }

      await this.sendBotReply(
        chatId,
        `❓ Неизвестная команда <code>/${rawCmd}</code>. Отправьте <code>/help</code> для списка команд.`
      );
      return;
    }

    // Ответ по умолчанию
    const startCmd = this.commands.get('start');
    await this.sendBotReply(
      chatId,
      startCmd?.responseText || this.config.welcomeMessage,
      startCmd?.buttons
    );
  }

  private async handleCallbackQuery(cb: any, rawUpdate: TelegramUpdate) {
    const chatId = cb.message?.chat?.id;
    const data = cb.data;
    const user = cb.from;
    const username = user?.username ? `@${user.username}` : user?.first_name || `User_${chatId}`;

    this.addLog('command_exec', `Button clicked: ${data}`, `Click by ${username}`, chatId, username, rawUpdate);

    try {
      if (this.config.token) {
        await telegramApi.answerCallbackQuery(this.config.token, cb.id);
      }
    } catch (e) { /* ignore */ }

    if (data === 'btn_stats' || data === 'refresh_stats') {
      await this.sendTicketscloudStats(chatId, user.id);
      return;
    }

    if (data === 'prompt_set_key') {
      this.awaitingKeyUsers.add(user.id);
      await this.sendBotReply(
        chatId,
        '🔑 <b>Отправьте ваш TicketsCloud API Key</b>\n\nПросто пришлите его следующим сообщением в этот чат или отправьте команду:\n<code>/setkey ВАШ_КЛЮЧ</code>'
      );
      return;
    }

    if (data === 'btn_support') {
      await this.sendBotReply(
        chatId,
        '💬 <b>Служба поддержки TicketsCloud</b>\n\nПо всем вопросам обращайтесь по адресу: support@ticketscloud.com'
      );
      return;
    }
  }

  public async sendTicketscloudStats(chatId: number, userId: number = chatId) {
    const encryptedKey = this.userApiKeys.get(userId) || '';
    
    // 👇 ОТПРАВЛЯЕМ СТАТУС "ПЕЧАТАЕТ..."
    try {
      if (this.config.token) {
        await telegramApi.sendChatAction(this.config.token, chatId, 'typing');
      }
    } catch (e) { /* игнорируем ошибки статуса */ }

    // Расшифровываем ключ и запрашиваем статистику
    const realApiKey = decryptApiKey(encryptedKey); 
    const res = await ticketscloudService.getStats(realApiKey);

    const inlineKeyboard = res.reply_markup?.inline_keyboard;
    await this.sendBotReply(chatId, res.text, inlineKeyboard);
  }

  public async sendBotReply(
    chatId: number,
    text: string,
    buttons?: Array<Array<{ text: string; url?: string; callback_data?: string }>>
  ) {
    try {
      if (!this.config.token) return;

      const replyMarkup = buttons && buttons.length > 0 ? { inline_keyboard: buttons } : undefined;

      await telegramApi.sendMessage(this.config.token, chatId, text, {
        parseMode: 'HTML',
        replyMarkup
      });

      this.recordUserMessage(chatId, { id: chatId, is_bot: false, first_name: 'Chat' }, text, 'bot', buttons);
      this.addLog('outgoing_msg', `Sent message to Chat ID ${chatId}`, text, chatId);
    } catch (err: any) {
      this.addLog('error', `Failed to send message to ${chatId}`, err.message, chatId);
    }
  }

  private recordUserMessage(
    chatId: number,
    user: any,
    text: string,
    sender: 'user' | 'bot',
    buttons?: any
  ) {
    let session = this.chatSessions.get(chatId);
    if (!session) {
      session = {
        chatId,
        user,
        lastMessage: text,
        lastMessageTime: new Date().toLocaleTimeString(),
        messageCount: 0,
        messages: []
      };
      this.chatSessions.set(chatId, session);
    }

    session.lastMessage = text;
    session.lastMessageTime = new Date().toLocaleTimeString();
    session.messageCount += 1;
    (session as any)._lastActivityTimestamp = Date.now();

    session.messages.push({
      id: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      sender,
      text,
      timestamp: new Date().toLocaleTimeString(),
      buttons
    });

    if (session.messages.length > 30) {
      session.messages = session.messages.slice(-30);
    }
  }

  private cleanupStaleSessions() {
    const ONE_DAY_MS = 24 * 60 * 60 * 1000;
    const now = Date.now();

    for (const [chatId, session] of this.chatSessions.entries()) {
      const lastActivity = (session as any)._lastActivityTimestamp || 0;
      if (now - lastActivity > ONE_DAY_MS) {
        this.chatSessions.delete(chatId);
      }
    }
  }

  public async getStatus() {
    if (this.config.token && !this.botInfo) {
      try {
        this.botInfo = await telegramApi.getMe(this.config.token);
      } catch (e) { /* ignore */ }
    }

    return {
      config: this.config,
      botInfo: this.botInfo,
      isPollingActive: this.isPolling,
      totalLogs: this.logs.length,
      totalChats: this.chatSessions.size,
      totalCommands: this.commands.size
    };
  }

  public updateConfig(newConfig: Partial<BotConfig>) {
    const oldToken = this.config.token;
    this.config = { ...this.config, ...newConfig };

    if (newConfig.token && newConfig.token !== oldToken) {
      this.botInfo = null;
      this.addLog('system', 'Updated Telegram Bot Token', 'Re-verifying bot identity...');
      telegramApi.getMe(this.config.token)
        .then(info => {
          this.botInfo = info;
          this.addLog('system', 'New Bot Connected', `@${info.username} (${info.first_name})`);
          this.syncCommandsToTelegram().catch(() => {});
        })
        .catch(err => {
          this.addLog('error', 'Token verification error', err.message);
        });
    }

    if (newConfig.isPollingActive !== undefined) {
      if (newConfig.isPollingActive) {
        this.startEngine();
      } else {
        this.stopEngine();
      }
    }
  }

  public getLogs() {
    return this.logs;
  }

  public clearLogs() {
    this.logs = [];
  }

  public getChats() {
    return Array.from(this.chatSessions.values());
  }

  public getChat(chatId: number) {
    return this.chatSessions.get(chatId);
  }

  public getCommands() {
    return Array.from(this.commands.values());
  }

  public saveCommand(cmd: BotCommand) {
    const cleanName = cmd.command.replace(/^\//, '').toLowerCase().trim();
    this.commands.set(cleanName, { ...cmd, command: cleanName });
    this.addLog('system', `Updated command /${cleanName}`);
    this.syncCommandsToTelegram().catch(() => {});
  }

  public deleteCommand(commandName: string) {
    const clean = commandName.replace(/^\//, '').toLowerCase().trim();
    this.commands.delete(clean);
    this.addLog('system', `Deleted command /${clean}`);
    this.syncCommandsToTelegram().catch(() => {});
  }

  public async syncCommandsToTelegram() {
    if (!this.config.token) return false;
    const activeCmds = Array.from(this.commands.values()).filter(c => c.enabled);
    const list = activeCmds.map(c => ({
      command: c.command,
      description: c.description
    }));

    await telegramApi.setMyCommands(this.config.token, list);
    this.addLog('system', 'Synced Commands Menu to Telegram', `Updated ${list.length} commands in Telegram menu`);
    return true;
  }

  public async broadcastMessage(text: string, buttons?: any) {
    const chats = Array.from(this.chatSessions.keys());
    let successCount = 0;
    for (const chatId of chats) {
      try {
        await this.sendBotReply(chatId, text, buttons);
        successCount++;
      } catch (e) { /* ignore */ }
    }
    this.addLog('system', 'Broadcast Sent', `Delivered to ${successCount}/${chats.length} active chats`);
    return { successCount, totalCount: chats.length };
  }
}

export const botEngine = new TelegramBotEngine();
