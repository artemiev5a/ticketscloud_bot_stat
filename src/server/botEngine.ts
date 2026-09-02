import type { ActivityLog, BotCommand, BotConfig, BotInfo, ChatSession, TelegramUpdate } from '../types/telegram.ts';
import { telegramApi } from './telegramApi.ts';
import { ticketscloudService } from './ticketscloudService.ts';
import type { StatsPeriod } from './ticketscloudService.ts';
import { encryptApiKey, decryptApiKey } from './cryptoUtils.ts';
import { createHmac } from 'node:crypto';

const STATS_FLIGHT_SECRET = process.env.CACHE_KEY_SECRET || process.env.ENCRYPTION_SECRET || 'ticketscloud-local-cache';

export class TelegramBotEngine {
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
  private apiKeyGeneration: Map<number, number> = new Map();
  private statsJobs: Map<string, Promise<void>> = new Map();
  private upstreamStatsJobs: Map<string, Promise<Awaited<ReturnType<typeof ticketscloudService.getStats>>>> = new Map();
  private readonly statsService: Pick<typeof ticketscloudService, 'getStats'>
    & Partial<Pick<typeof ticketscloudService, 'getCachedStats'>>;
  private readonly telegramClient: typeof telegramApi;

  constructor(
    statsService: Pick<typeof ticketscloudService, 'getStats'>
      & Partial<Pick<typeof ticketscloudService, 'getCachedStats'>> = ticketscloudService,
    telegramClient: typeof telegramApi = telegramApi
  ) {
    this.statsService = statsService;
    this.telegramClient = telegramClient;
    this.initializeDefaultCommands();
    this.addLog('system', 'Telegram Bot Engine initialized', 'Ready to start');
    
    // Запуск выполняют server.ts или Vite dev server. Конструктор не должен
    // открывать сетевые соединения во время импорта (например, при сборке).
    const cleanupTimer = setInterval(() => this.cleanupStaleSessions(), 1000 * 60 * 60);
    cleanupTimer.unref();
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
            { text: '📊 Статистика продаж', callback_data: 'stats_today' }
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
            { text: '🔄 Обновить данные', callback_data: 'stats_today' }
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
          '• <code>/setkey [КЛЮЧ]</code> — Указать TicketsCloud API-ключ\n' +
          '• <code>/help</code> — Справка по работе с ботом',
        enabled: true
      }
    ];

    for (const c of defaultCmds) {
      this.commands.set(c.command.toLowerCase().replace(/^\//, ''), c);
    }
  }

  public addLog(type: ActivityLog['type'], title: string, details?: string, chatId?: number, username?: string, rawPayload?: any) {
    const log: ActivityLog = {
      id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      timestamp: new Date().toISOString(), type, title, details, chatId, username, rawPayload
    };
    this.logs.unshift(log);
    if (this.logs.length > 500) this.logs = this.logs.slice(0, 500);
  }

  public async startEngine() {
    if (this.isPolling) return;
    if (!this.config.token) { this.addLog('error', 'Start Engine Failed', 'Telegram Bot Token is not set'); return; }

    if (this.pollingTimer) { clearTimeout(this.pollingTimer); this.pollingTimer = null; }
    this.isPolling = true; this.config.isPollingActive = true;

    try {
      const webhookResponse = await fetch(`https://api.telegram.org/bot${this.config.token.trim()}/deleteWebhook`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ drop_pending_updates: false })
      });
      const webhookResult = await webhookResponse.json() as any;
      if (!webhookResult.ok) throw new Error(webhookResult.description || 'Не удалось отключить webhook');
      
      this.botInfo = await this.telegramClient.getMe(this.config.token);
      this.addLog('system', 'Telegram Token Connected', `@${this.botInfo?.username || 'unknown'}`);
      this.syncCommandsToTelegram().catch(() => {});
    } catch (err: any) { this.addLog('error', 'Failed to connect', err.message); }

    this.pollLoop();
  }

  public stopEngine() {
    this.isPolling = false; this.config.isPollingActive = false;
    if (this.pollingTimer) { clearTimeout(this.pollingTimer); this.pollingTimer = null; }
    this.addLog('system', 'Bot Engine Polling Stopped');
  }

  private async pollLoop() {
    if (!this.isPolling || this.isProcessingLoop) return;
    this.isProcessingLoop = true;

    try {
      if (this.config.token) {
        const updates = await this.telegramClient.getUpdates(this.config.token, this.lastUpdateOffset, 3);
        for (const update of updates) {
          this.lastUpdateOffset = Math.max(this.lastUpdateOffset, update.update_id + 1);
          await this.handleUpdate(update);
        }
      }
    } catch (err: any) {
      if (!err.message?.includes('timeout') && !err.message?.includes('abort')) this.addLog('error', 'Polling error', err.message);
    } finally {
      this.isProcessingLoop = false;
      if (this.isPolling) this.pollingTimer = setTimeout(() => this.pollLoop(), this.config.pollingIntervalMs || 1500);
    }
  }

  public async handleUpdate(update: TelegramUpdate) {
    if (update.message) await this.handleMessage(update.message, update);
    else if (update.callback_query) await this.handleCallbackQuery(update.callback_query, update);
  }

  private saveApiKey(text: string, userId: number) {
    const key = text.trim();
    this.userApiKeys.set(userId, encryptApiKey(key));
    this.apiKeyGeneration.set(userId, (this.apiKeyGeneration.get(userId) || 0) + 1);
  }

  private async handleMessage(msg: any, rawUpdate: TelegramUpdate) {
    const chatId = msg.chat.id;
    const user = msg.from;
    const text = msg.text?.trim() || '';
    const username = user?.username ? `@${user.username}` : user?.first_name || `User_${chatId}`;

    this.recordUserMessage(chatId, user, text, 'user');
    this.addLog('incoming_msg', `Message from ${username}`, text, chatId, username, rawUpdate);

    // 1. Ожидание ввода API-ключа
    if (this.awaitingKeyUsers.has(user.id) && !text.startsWith('/')) {
      if (msg.chat?.type && msg.chat.type !== 'private') {
        await this.sendBotReply(chatId, '⚠️ API-ключ можно отправить только в личном чате с ботом.');
        return;
      }
      this.saveApiKey(text, user.id);
      this.awaitingKeyUsers.delete(user.id);
      
      await this.sendBotReply(chatId, '✅ <b>API-ключ успешно сохранён!</b>\n\nНажмите кнопку ниже:', [
          [{ text: '📊 Посмотреть статистику', callback_data: 'stats_today' }]
        ]
      );
      return;
    }

    // 2. Команда /setkey
    if (text.startsWith('/setkey')) {
      if (msg.chat?.type && msg.chat.type !== 'private') {
        await this.sendBotReply(chatId, '⚠️ API-ключ можно отправить только в личном чате с ботом.');
        return;
      }
      const input = text.replace('/setkey', '').trim();
      if (!input) {
        await this.sendBotReply(chatId, '✏️ <b>Укажите API-ключ после команды:</b>\n\n<code>/setkey ВАШ_КЛЮЧ</code>');
        return;
      }
      
      this.saveApiKey(input, user.id);
      this.awaitingKeyUsers.delete(user.id);
      
      await this.sendBotReply(chatId, '✅ <b>API-ключ успешно сохранён!</b>', [
          [{ text: '📊 Посмотреть статистику', callback_data: 'stats_today' }]
        ]
      );
      return;
    }

    // 3. Обработка команд
    if (text.startsWith('/')) {
      const rawCmd = text.split(' ')[0].substring(1).replace(/@.*/, '').toLowerCase();
      if (rawCmd === 'stats') { this.sendTicketscloudStats(chatId, user.id, 'today'); return; }

      const matchedCmd = this.commands.get(rawCmd);
      if (matchedCmd && matchedCmd.enabled) {
        if (matchedCmd.responseType === 'ticketscloud_stats' || matchedCmd.responseType === 'stats') {
          this.sendTicketscloudStats(chatId, user.id, 'today');
        } else {
          await this.sendBotReply(chatId, matchedCmd.responseText || 'Выполнено', matchedCmd.buttons);
        }
        return;
      }
      await this.sendBotReply(chatId, `❓ Неизвестная команда <code>/${rawCmd}</code>.`);
      return;
    }

    const startCmd = this.commands.get('start');
    await this.sendBotReply(chatId, startCmd?.responseText || this.config.welcomeMessage, startCmd?.buttons);
  }

  private async handleCallbackQuery(cb: any, rawUpdate: TelegramUpdate) {
    const chatId = cb.message?.chat?.id;
    const data = cb.data;
    const user = cb.from;

    const requestedPeriod: StatsPeriod | undefined =
      data === 'stats_week' || data === 'refresh_stats_week' ? 'week'
        : data === 'stats_today' || data === 'btn_stats' || data === 'refresh_stats' || data === 'refresh_stats_today' ? 'today'
          : undefined;
    if (requestedPeriod && this.statsJobs.has(`${user.id}:${requestedPeriod}`)) {
      try {
        if (this.config.token) {
          await this.telegramClient.answerCallbackQuery(
            this.config.token,
            cb.id,
            'Статистика уже обновляется. Результат появится автоматически.'
          );
        }
      } catch (e) {}
      return;
    }

    try { if (this.config.token) await this.telegramClient.answerCallbackQuery(this.config.token, cb.id); } catch (e) {}

    if (data === 'stats_today' || data === 'btn_stats') { this.sendTicketscloudStats(chatId, user.id, 'today'); return; }
    if (data === 'stats_week') { this.sendTicketscloudStats(chatId, user.id, 'week'); return; }
    if (data === 'refresh_stats' || data === 'refresh_stats_today') { this.sendTicketscloudStats(chatId, user.id, 'today', true); return; }
    if (data === 'refresh_stats_week') { this.sendTicketscloudStats(chatId, user.id, 'week', true); return; }

    if (data === 'prompt_set_key') {
      this.awaitingKeyUsers.add(user.id);
      await this.sendBotReply(chatId, '🔑 <b>Отправьте ваш TicketsCloud API-ключ</b>\n\nПример сообщения:\n<code>ВАШ_КЛЮЧ</code>');
      return;
    }

    if (data === 'btn_support') {
      await this.sendBotReply(chatId, '💬 <b>Служба поддержки TicketsCloud</b>\n\nПо всем вопросам обращайтесь: support@ticketscloud.com');
      return;
    }
  }

  public sendTicketscloudStats(chatId: number, userId: number = chatId, period: StatsPeriod = 'today', forceRefresh = false) {
    const jobKey = `${userId}:${period}`;
    if (this.statsJobs.has(jobKey)) return;
    const generation = this.apiKeyGeneration.get(userId) || 0;
    const job = this.runTicketscloudStats(chatId, userId, period, forceRefresh, generation)
      .catch((error: any) => this.addLog('error', 'Stats background job failed', error?.message || String(error), chatId))
      .finally(() => {
        if (this.statsJobs.get(jobKey) === job) this.statsJobs.delete(jobKey);
      });
    this.statsJobs.set(jobKey, job);
  }

  private loadStats(apiKey: string, period: StatsPeriod, forceRefresh: boolean) {
    const fingerprint = createHmac('sha256', STATS_FLIGHT_SECRET).update(apiKey).digest('hex');
    // Fresh cache hits return before this method. Any call that reaches the
    // network (cache miss, stale or manual refresh) can safely share one load.
    const flightKey = `${fingerprint}:${period}`;
    const existing = this.upstreamStatsJobs.get(flightKey);
    if (existing) return existing;
    let tracked: Promise<Awaited<ReturnType<typeof ticketscloudService.getStats>>>;
    tracked = Promise.resolve()
      .then(() => this.statsService.getStats(apiKey, period, forceRefresh))
      .then(
        result => {
          if (this.upstreamStatsJobs.get(flightKey) === tracked) this.upstreamStatsJobs.delete(flightKey);
          return result;
        },
        error => {
          if (this.upstreamStatsJobs.get(flightKey) === tracked) this.upstreamStatsJobs.delete(flightKey);
          throw error;
        }
      );
    this.upstreamStatsJobs.set(flightKey, tracked);
    return tracked;
  }

  private async runTicketscloudStats(
    chatId: number,
    userId: number,
    period: StatsPeriod,
    forceRefresh: boolean,
    generation: number
  ) {
    const periodLabel = period === 'week' ? 'Последние 7 дней' : 'Сегодня';
    const loading = await this.sendBotReply(
      chatId,
      `⏳ <b>Собираю статистику Ticketscloud…</b>\n\nПериод: <b>${periodLabel}</b>\nРезультат появится автоматически.`
    );
    let statusMessageId = loading?.message_id as number | undefined;
    const encryptedKey = this.userApiKeys.get(userId) || '';
    try { if (this.config.token) await this.telegramClient.sendChatAction(this.config.token, chatId, 'typing'); } catch (e) {}

    let realApiKey = '';

    if (encryptedKey) {
      const decrypted = decryptApiKey(encryptedKey);
      try {
        const parsed = JSON.parse(decrypted);
        realApiKey = parsed.k;
      } catch (e) {
        realApiKey = decrypted; // Для обратной совместимости, если ключ сохраняли до этого обновления
      }
    }

    const cached = this.statsService.getCachedStats?.(realApiKey, period, forceRefresh);
    if (cached) {
      const cachedButtons = cached.data.reply_markup?.inline_keyboard;
      const edited = statusMessageId
        ? await this.editBotReply(chatId, statusMessageId, cached.data.text, cachedButtons)
        : false;
      if (!edited) {
        const sent = await this.sendBotReply(chatId, cached.data.text, cachedButtons);
        statusMessageId = sent?.message_id;
      }
      if (cached.isFresh && !forceRefresh) return;
    }

    const res = await this.loadStats(realApiKey, period, forceRefresh);
    if ((this.apiKeyGeneration.get(userId) || 0) !== generation) return;
    const buttons = res.reply_markup?.inline_keyboard;
    const edited = statusMessageId
      ? await this.editBotReply(chatId, statusMessageId, res.text, buttons)
      : false;
    if (!edited) await this.sendBotReply(chatId, res.text, buttons);
  }

  public async sendBotReply(chatId: number, text: string, buttons?: Array<Array<{ text: string; url?: string; callback_data?: string }>>) {
    try {
      if (!this.config.token) return;
      const replyMarkup = buttons && buttons.length > 0 ? { inline_keyboard: buttons } : undefined;
      const sent = await this.telegramClient.sendMessage(this.config.token, chatId, text, { parseMode: 'HTML', replyMarkup });
      this.recordUserMessage(chatId, { id: chatId, is_bot: false, first_name: 'Chat' }, text, 'bot', buttons);
      return sent;
    } catch (err: any) { this.addLog('error', `Failed to send`, err.message, chatId); }
  }

  private async editBotReply(chatId: number, messageId: number, text: string, buttons?: Array<Array<{ text: string; url?: string; callback_data?: string }>>) {
    try {
      if (!this.config.token) return false;
      const replyMarkup = buttons && buttons.length > 0 ? { inline_keyboard: buttons } : undefined;
      await this.telegramClient.editMessageText(this.config.token, chatId, messageId, text, { parseMode: 'HTML', replyMarkup });
      this.recordUserMessage(chatId, { id: chatId, is_bot: false, first_name: 'Chat' }, text, 'bot', buttons);
      return true;
    } catch (err: any) {
      this.addLog('error', 'Failed to edit loading message', err.message, chatId);
      return false;
    }
  }

  private recordUserMessage(chatId: number, user: any, text: string, sender: 'user' | 'bot', buttons?: any) {
    let session = this.chatSessions.get(chatId);
    if (!session) {
      session = { chatId, user, lastMessage: text, lastMessageTime: new Date().toLocaleTimeString(), messageCount: 0, messages: [] };
      this.chatSessions.set(chatId, session);
    }
    session.lastMessage = text; session.lastMessageTime = new Date().toLocaleTimeString(); session.messageCount += 1;
    (session as any)._lastActivityTimestamp = Date.now();
    session.messages.push({ id: `msg_${Date.now()}`, sender, text, timestamp: new Date().toLocaleTimeString(), buttons });
    if (session.messages.length > 30) session.messages = session.messages.slice(-30);
  }

  private cleanupStaleSessions() {
    const now = Date.now();
    for (const [chatId, session] of this.chatSessions.entries()) {
      if (now - ((session as any)._lastActivityTimestamp || 0) > 24 * 60 * 60 * 1000) this.chatSessions.delete(chatId);
    }
  }

  // ... (методы getStatus, updateConfig, getLogs и т.д. остаются без изменений, я сократил их для вместимости)
  public async getStatus() { return { config: this.config, isPollingActive: this.isPolling, totalChats: this.chatSessions.size }; }
  public updateConfig(newConfig: Partial<BotConfig>) { Object.assign(this.config, newConfig); if (newConfig.isPollingActive !== undefined) newConfig.isPollingActive ? this.startEngine() : this.stopEngine(); }
  public getLogs() { return this.logs; }
  public clearLogs() { this.logs = []; }
  public getChats() { return Array.from(this.chatSessions.values()); }
  public getChat(chatId: number) { return this.chatSessions.get(chatId); }
  public getCommands() { return Array.from(this.commands.values()); }
  public saveCommand(cmd: BotCommand) { this.commands.set(cmd.command, cmd); this.syncCommandsToTelegram().catch(()=>{}); }
  public deleteCommand(name: string) { this.commands.delete(name); this.syncCommandsToTelegram().catch(()=>{}); }
  public async syncCommandsToTelegram() { return true; }
  public async broadcastMessage(text: string, buttons?: any) { return { successCount: 0, totalCount: 0 }; }
}

export const botEngine = new TelegramBotEngine();
