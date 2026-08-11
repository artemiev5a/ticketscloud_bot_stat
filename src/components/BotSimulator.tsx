import React, { useState } from 'react';
import { Bot, Send, User, Sparkles, Radio, Smartphone, RefreshCw } from 'lucide-react';
import { BotInfo } from '../types/telegram';

interface BotSimulatorProps {
  botInfo: BotInfo | null;
  onSimulateMessage: (text: string) => Promise<void>;
}

export const BotSimulator: React.FC<BotSimulatorProps> = ({
  botInfo,
  onSimulateMessage
}) => {
  const [messages, setMessages] = useState<Array<{
    id: string;
    sender: 'user' | 'bot';
    text: string;
    timestamp: string;
    buttons?: Array<Array<{ text: string; url?: string; callback_data?: string }>>;
  }>>([
    {
      id: 'welcome',
      sender: 'bot',
      text: '👋 Добро пожаловать в встроенный симулятор Telegram-бота!\n\nВведите команду или любое сообщение в поле ниже, чтобы протестировать реакцию вашего бота @TC_STATS_BOT.',
      timestamp: new Date().toLocaleTimeString(),
      buttons: [
        [
          { text: '📊 /stats', callback_data: 'btn_stats' },
          { text: '🎟️ /tickets', callback_data: 'btn_tickets' }
        ],
        [
          { text: '🤖 /ai', callback_data: 'btn_ai_prompt' },
          { text: '❓ /help', callback_data: 'btn_support' }
        ]
      ]
    }
  ]);

  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);

  const handleSend = async (customText?: string) => {
    const textToSend = customText || input.trim();
    if (!textToSend) return;

    const userMsg = {
      id: `sim_user_${Date.now()}`,
      sender: 'user' as const,
      text: textToSend,
      timestamp: new Date().toLocaleTimeString()
    };

    setMessages((prev) => [...prev, userMsg]);
    if (!customText) setInput('');
    setIsSending(true);

    try {
      await onSimulateMessage(textToSend);

      // Poll latest response after brief pause
      setTimeout(async () => {
        try {
          const res = await fetch('/api/bot/chats/999123');
          const data = await res.json();
          if (data.ok && data.chat?.messages) {
            const latestMessages = data.chat.messages;
            const formatted = latestMessages.map((m: any) => ({
              id: m.id,
              sender: m.sender as 'user' | 'bot',
              text: m.text,
              timestamp: m.timestamp,
              buttons: m.buttons
            }));
            setMessages(formatted);
          }
        } catch (e) { /* ignore */ }
        setIsSending(false);
      }, 800);
    } catch (err) {
      setIsSending(false);
    }
  };

  const handleButtonClick = (btn: { text: string; callback_data?: string; url?: string }) => {
    if (btn.url) {
      window.open(btn.url, '_blank');
      return;
    }
    if (btn.callback_data) {
      if (btn.callback_data === 'btn_stats') {
        handleSend('/stats');
      } else if (btn.callback_data === 'btn_tickets') {
        handleSend('/tickets');
      } else if (btn.callback_data === 'btn_ai_prompt') {
        handleSend('/ai Как повысить продажи билетов?');
      } else {
        handleSend(`/command ${btn.callback_data}`);
      }
    } else {
      handleSend(btn.text);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-5 bg-slate-900 border border-slate-800 rounded-2xl">
        <div>
          <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
            <Smartphone className="w-5 h-5 text-emerald-400" />
            <span>Интерактивный симулятор Telegram Mini App</span>
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Тестируйте команды, ответы ИИ и кнопки бота прямо в браузере.
          </p>
        </div>

        <button
          onClick={() => setMessages([])}
          className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-xl border border-slate-700 transition flex items-center gap-2"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Очистить чат</span>
        </button>
      </div>

      {/* Telegram Phone Simulator Frame */}
      <div className="max-w-md mx-auto bg-slate-950 border-4 border-slate-800 rounded-[36px] overflow-hidden shadow-2xl flex flex-col h-[640px] relative">
        {/* Phone Speaker Notch */}
        <div className="w-32 h-4 bg-slate-900 mx-auto rounded-b-xl flex items-center justify-center shrink-0">
          <div className="w-8 h-1 bg-slate-700 rounded-full" />
        </div>

        {/* Telegram App Header */}
        <div className="bg-slate-900/90 backdrop-blur-md px-4 py-3 border-b border-slate-800 flex items-center gap-3 shrink-0">
          <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center text-white font-bold text-xs shadow-md">
            <Bot className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-bold text-xs text-slate-100 truncate">
              {botInfo?.first_name || 'Ticketscloud statistics'}
            </h3>
            <p className="text-[10px] text-blue-400 font-mono flex items-center gap-1">
              <span>bot</span> • <span>@{botInfo?.username || 'TC_STATS_BOT'}</span>
            </p>
          </div>
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
        </div>

        {/* Telegram Chat Message History */}
        <div className="flex-1 p-4 overflow-y-auto space-y-3 bg-[radial-gradient(#1e293b_1px,transparent_1px)] [background-size:16px_16px]">
          {messages.map((m) => {
            const isUser = m.sender === 'user';
            return (
              <div
                key={m.id}
                className={`flex gap-2 max-w-[88%] ${isUser ? 'ml-auto flex-row-reverse' : 'mr-auto'}`}
              >
                <div className={`p-3 rounded-2xl text-xs leading-relaxed ${
                  isUser
                    ? 'bg-blue-600 text-white rounded-tr-none shadow-md'
                    : 'bg-slate-900 text-slate-100 border border-slate-800 rounded-tl-none shadow-md'
                }`}>
                  <p className="whitespace-pre-wrap">{m.text}</p>

                  {/* Render buttons */}
                  {m.buttons && m.buttons.length > 0 && (
                    <div className="mt-2.5 pt-2 border-t border-slate-800/80 space-y-1.5">
                      {m.buttons.map((row, rIdx) => (
                        <div key={rIdx} className="grid grid-cols-2 gap-1.5">
                          {row.map((btn, bIdx) => (
                            <button
                              key={bIdx}
                              onClick={() => handleButtonClick(btn)}
                              className="w-full py-1.5 px-2 bg-slate-800/90 hover:bg-slate-700 text-blue-400 font-medium rounded-lg text-[11px] border border-slate-700/80 active:scale-95 transition truncate text-center"
                            >
                              {btn.text}
                            </button>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}

                  <span className={`text-[9px] mt-1 block ${isUser ? 'text-blue-200 text-right' : 'text-slate-500 text-left'}`}>
                    {m.timestamp}
                  </span>
                </div>
              </div>
            );
          })}

          {isSending && (
            <div className="mr-auto bg-slate-900 p-3 rounded-2xl rounded-tl-none text-xs text-slate-400 border border-slate-800 flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 text-blue-400 animate-spin" />
              <span>Бот печатает ответ...</span>
            </div>
          )}
        </div>

        {/* Quick Commands Chips */}
        <div className="p-2 bg-slate-900/90 border-t border-slate-800 flex gap-1.5 overflow-x-auto scrollbar-none text-[11px] shrink-0">
          {['/start', '/stats', '/tickets', '/ai как дела?', '/help'].map((cmd) => (
            <button
              key={cmd}
              onClick={() => handleSend(cmd)}
              className="px-2.5 py-1 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 font-mono whitespace-nowrap transition border border-slate-700"
            >
              {cmd}
            </button>
          ))}
        </div>

        {/* Phone Input Bar */}
        <div className="p-3 bg-slate-900 border-t border-slate-800 flex gap-2 items-center shrink-0">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder="Написать сообщение..."
            className="flex-1 bg-slate-950 border border-slate-800 rounded-full px-4 py-2 text-xs text-slate-100 focus:outline-none focus:border-blue-500"
          />
          <button
            onClick={() => handleSend()}
            disabled={isSending || !input.trim()}
            className="w-8 h-8 rounded-full bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 text-white flex items-center justify-center transition shadow-md shrink-0"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
