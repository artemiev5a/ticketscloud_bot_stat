export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export interface TelegramChat {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
}

export interface TelegramInlineKeyboardButton {
  text: string;
  url?: string;
  callback_data?: string;
}

export interface TelegramInlineKeyboardMarkup {
  inline_keyboard: TelegramInlineKeyboardButton[][];
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
  reply_markup?: TelegramInlineKeyboardMarkup;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: {
    id: string;
    from: TelegramUser;
    message?: TelegramMessage;
    data?: string;
  };
}

export interface BotInfo {
  id: number;
  is_bot: boolean;
  first_name: string;
  username: string;
  can_join_groups?: boolean;
  can_read_all_group_messages?: boolean;
  supports_inline_queries?: boolean;
}

export interface BotCommand {
  id: string;
  command: string; // e.g. "start" or "/start"
  description: string;
  responseType: 'text' | 'stats' | 'ticketscloud_stats' | 'custom';
  responseText?: string;
  buttons?: TelegramInlineKeyboardButton[][];
  enabled: boolean;
}

export interface BotConfig {
  token: string;
  isPollingActive: boolean;
  welcomeMessage: string;
  pollingIntervalMs: number;
}

export interface ActivityLog {
  id: string;
  timestamp: string;
  type: 'incoming_msg' | 'outgoing_msg' | 'command_exec' | 'error' | 'system';
  title: string;
  details?: string;
  chatId?: number;
  username?: string;
  rawPayload?: any;
}

export interface ChatSession {
  chatId: number;
  user: TelegramUser;
  lastMessage: string;
  lastMessageTime: string;
  messageCount: number;
  _lastActivityTimestamp?: number; // Нужно для очистки старых сессий в botEngine
  messages: Array<{
    id: string;
    sender: 'user' | 'bot';
    text: string;
    timestamp: string;
    buttons?: TelegramInlineKeyboardButton[][];
  }>;
}
