import { BotInfo, TelegramInlineKeyboardMarkup, TelegramUpdate } from '../types/telegram.js';

export class TelegramApiService {
  private baseUrl(token: string): string {
    const cleanToken = token.trim();
    return `https://api.telegram.org/bot${cleanToken}`;
  }

  async getMe(token: string): Promise<BotInfo> {
    const url = `${this.baseUrl(token)}/getMe`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    const data = await res.json() as any;
    if (!data.ok) {
      throw new Error(data.description || 'Failed to fetch bot info from Telegram API');
    }
    return data.result as BotInfo;
  }

  async getUpdates(token: string, offset: number = 0, timeoutSec: number = 5): Promise<TelegramUpdate[]> {
    const url = `${this.baseUrl(token)}/getUpdates?offset=${offset}&timeout=${timeoutSec}&allowed_updates=["message","callback_query"]`;
    const res = await fetch(url, { signal: AbortSignal.timeout((timeoutSec + 5) * 1000) });
    const data = await res.json() as any;
    if (!data.ok) {
      throw new Error(data.description || 'Failed to fetch updates from Telegram API');
    }
    return (data.result || []) as TelegramUpdate[];
  }

  async sendMessage(
    token: string,
    chatId: number | string,
    text: string,
    options?: {
      parseMode?: 'HTML' | 'Markdown' | 'MarkdownV2';
      replyMarkup?: TelegramInlineKeyboardMarkup;
      disableWebPagePreview?: boolean;
    }
  ): Promise<any> {
    const url = `${this.baseUrl(token)}/sendMessage`;
    const body: any = {
      chat_id: chatId,
      text: text,
      parse_mode: options?.parseMode || 'HTML',
      disable_web_page_preview: options?.disableWebPagePreview ?? true
    };

    if (options?.replyMarkup) {
      body.reply_markup = options.replyMarkup;
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000)
    });

    const data = await res.json() as any;
    if (!data.ok) {
      // Спасательный круг: Если HTML-разметка сломалась, Telegram вернет ошибку. Отправляем без разметки как fallback.
      if (options?.parseMode && data.description?.includes('can\'t parse entities')) {
        console.warn(`[Telegram API] Ошибка парсинга HTML, отправляю обычным текстом для чата ${chatId}`);
        return this.sendMessage(token, chatId, text, { ...options, parseMode: undefined });
      }
      throw new Error(data.description || 'Failed to send message via Telegram API');
    }
    return data.result;
  }

  async setMyCommands(token: string, commands: Array<{ command: string; description: string }>): Promise<boolean> {
    const url = `${this.baseUrl(token)}/setMyCommands`;
    // Очищаем команды (Telegram требует нижний регистр, без слэшей, 1-32 символа)
    const formattedCommands = commands
      .map(c => ({
        command: c.command.replace(/^\//, '').toLowerCase().trim(),
        description: c.description.slice(0, 256) || 'Bot Command'
      }))
      .filter(c => c.command.length >= 1 && c.command.length <= 32);

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commands: formattedCommands }),
      signal: AbortSignal.timeout(10000)
    });

    const data = await res.json() as any;
    if (!data.ok) {
      throw new Error(data.description || 'Failed to sync commands to Telegram');
    }
    return true;
  }

  async answerCallbackQuery(token: string, callbackQueryId: string, text?: string): Promise<boolean> {
    const url = `${this.baseUrl(token)}/answerCallbackQuery`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        callback_query_id: callbackQueryId,
        text: text || ''
      }),
      signal: AbortSignal.timeout(5000)
    });
    const data = await res.json() as any;
    return data.ok === true;
  }
}

export const telegramApi = new TelegramApiService();