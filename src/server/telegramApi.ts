export const telegramApi = {
  async getMe(token: string) {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.description);
    return data.result;
  },

  async getUpdates(token: string, offset: number, timeout: number = 3) {
    const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates?offset=${offset}&timeout=${timeout}`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.description);
    return data.result;
  },

  async sendMessage(token: string, chatId: number, text: string, options: any = {}) {
    const payload = {
      chat_id: chatId,
      text,
      parse_mode: options.parseMode,
      reply_markup: options.replyMarkup
    };
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.description);
    return data.result;
  },

  async answerCallbackQuery(token: string, callbackQueryId: string, text?: string) {
    const payload: any = { callback_query_id: callbackQueryId };
    if (text) payload.text = text;
    const res = await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.description);
    return data.result;
  },

  async setMyCommands(token: string, commands: any[]) {
    const res = await fetch(`https://api.telegram.org/bot${token}/setMyCommands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commands })
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.description);
    return data.result;
  },

  // 👇 НАШ НОВЫЙ МЕТОД ДЛЯ СТАТУСА "ПЕЧАТАЕТ..."
  async sendChatAction(token: string, chatId: number, action: string = 'typing') {
    try {
      await fetch(`https://api.telegram.org/bot${token}/sendChatAction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, action })
      });
    } catch (e) {
      console.error('Ошибка отправки chat action:', e);
    }
  }
};
