import React, { useState } from 'react';
import { ChatSession, TelegramInlineKeyboardButton } from '../types/telegram';
import { Send, User, Bot, Radio, Plus, Trash2, Megaphone, Link as LinkIcon, Sparkles } from 'lucide-react';

interface LiveChatsProps {
  chats: ChatSession[];
  onSendMessage: (chatId: number, text: string, buttons?: TelegramInlineKeyboardButton[][]) => Promise<void>;
  onBroadcast: (text: string, buttons?: TelegramInlineKeyboardButton[][]) => Promise<void>;
}

export const LiveChats: React.FC<LiveChatsProps> = ({
  chats,
  onSendMessage,
  onBroadcast
}) => {
  const [selectedChatId, setSelectedChatId] = useState<number | null>(chats[0]?.chatId || null);
  const [inputText, setInputText] = useState('');
  const [showBroadcastModal, setShowBroadcastModal] = useState(false);
  const [broadcastText, setBroadcastText] = useState('');
  const [isSending, setIsSending] = useState(false);

  // Inline buttons builder state
  const [buttonText, setButtonText] = useState('');
  const [buttonUrl, setButtonUrl] = useState('');
  const [customButtons, setCustomButtons] = useState<TelegramInlineKeyboardButton[]>([]);

  const activeChat = chats.find(c => c.chatId === selectedChatId) || chats[0];

  const handleAddButton = () => {
    if (!buttonText.trim()) return;
    setCustomButtons([...customButtons, { text: buttonText.trim(), url: buttonUrl.trim() || undefined }]);
    setButtonText('');
    setButtonUrl('');
  };

  const handleRemoveButton = (index: number) => {
    setCustomButtons(customButtons.filter((_, i) => i !== index));
  };

  const handleSendDirect = async () => {
    if (!inputText.trim() || !activeChat) return;
    setIsSending(true);
    const buttons = customButtons.length > 0 ? [customButtons] : undefined;
    await onSendMessage(activeChat.chatId, inputText.trim(), buttons);
    setInputText('');
    setCustomButtons([]);
    setIsSending(false);
  };

  const handleSendBroadcast = async () => {
    if (!broadcastText.trim()) return;
    setIsSending(true);
    const buttons = customButtons.length > 0 ? [customButtons] : undefined;
    await onBroadcast(broadcastText.trim(), buttons);
    setBroadcastText('');
    setCustomButtons([]);
    setShowBroadcastModal(false);
    setIsSending(false);
  };

  return (
    <div className="space-y-6">
      {/* Top Banner with Broadcast CTA */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-5 bg-slate-900 border border-slate-800 rounded-2xl">
        <div>
          <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
            <Radio className="w-5 h-5 text-blue-400" />
            <span>Живые чаты с пользователями Telegram</span>
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Отвечайте пользователям в реальном времени или отправляйте массовые рассылки всем активным чатам.
          </p>
        </div>

        <button
          onClick={() => setShowBroadcastModal(true)}
          className="px-5 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-semibold text-xs rounded-xl shadow-lg shadow-blue-500/20 transition flex items-center gap-2"
        >
          <Megaphone className="w-4 h-4" />
          <span>Массовая рассылка</span>
        </button>
      </div>

      {/* Main Chat Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[650px]">
        {/* Left Col: Users List */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col h-full">
          <h3 className="font-bold text-sm text-slate-200 mb-3 px-2 flex items-center justify-between">
            <span>Список пользователей</span>
            <span className="text-xs font-normal text-slate-500">Всего: {chats.length}</span>
          </h3>

          <div className="flex-1 overflow-y-auto space-y-2 pr-1">
            {chats.length === 0 ? (
              <div className="text-center py-12 text-slate-500 text-xs">
                <User className="w-8 h-8 mx-auto mb-2 opacity-40" />
                <span>Пока нет сообщений в боте.</span>
                <p className="mt-1 text-[11px] text-slate-600">
                  Напишите боту в Telegram или воспользуйтесь симулятором!
                </p>
              </div>
            ) : (
              chats.map((chat) => {
                const isSelected = activeChat?.chatId === chat.chatId;
                const username = chat.user?.username ? `@${chat.user.username}` : chat.user?.first_name || `User_${chat.chatId}`;

                return (
                  <button
                    key={chat.chatId}
                    onClick={() => setSelectedChatId(chat.chatId)}
                    className={`w-full text-left p-3 rounded-xl transition flex items-center gap-3 border ${
                      isSelected
                        ? 'bg-blue-600/10 border-blue-500/40 text-slate-100'
                        : 'bg-slate-950/60 border-slate-800/80 hover:bg-slate-800/60 text-slate-300'
                    }`}
                  >
                    <div className="w-10 h-10 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center font-bold text-sm text-blue-400 shrink-0">
                      {chat.user?.first_name ? chat.user.first_name[0].toUpperCase() : 'U'}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-xs truncate text-slate-200">{username}</span>
                        <span className="text-[10px] text-slate-500">{chat.lastMessageTime}</span>
                      </div>
                      <p className="text-xs text-slate-400 truncate mt-0.5">{chat.lastMessage}</p>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Right 2 Cols: Chat Transcript & Sender */}
        <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-2xl flex flex-col h-full overflow-hidden">
          {activeChat ? (
            <>
              {/* Chat Header */}
              <div className="p-4 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center font-bold text-blue-400 text-xs">
                    {activeChat.user?.first_name ? activeChat.user.first_name[0].toUpperCase() : 'U'}
                  </div>
                  <div>
                    <h4 className="font-bold text-xs text-slate-100">
                      {activeChat.user?.first_name} {activeChat.user?.last_name || ''}
                    </h4>
                    <p className="text-[11px] text-slate-400 font-mono">
                      Chat ID: {activeChat.chatId} {activeChat.user?.username && `• @${activeChat.user.username}`}
                    </p>
                  </div>
                </div>

                <span className="text-xs px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  {activeChat.messages.length} сообщений
                </span>
              </div>

              {/* Messages Container */}
              <div className="flex-1 p-4 overflow-y-auto space-y-3 bg-slate-950/40">
                {activeChat.messages.map((m) => {
                  const isUser = m.sender === 'user';
                  return (
                    <div
                      key={m.id}
                      className={`flex gap-2.5 max-w-[85%] ${isUser ? 'mr-auto' : 'ml-auto flex-row-reverse'}`}
                    >
                      <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 text-xs font-bold ${
                        isUser ? 'bg-slate-800 text-slate-300' : 'bg-blue-600 text-white'
                      }`}>
                        {isUser ? <User className="w-3.5 h-3.5" /> : <Bot className="w-3.5 h-3.5" />}
                      </div>

                      <div>
                        <div className={`p-3 rounded-2xl text-xs leading-relaxed whitespace-pre-wrap ${
                          isUser
                            ? 'bg-slate-800 text-slate-100 rounded-tl-none border border-slate-700'
                            : 'bg-blue-600 text-white rounded-tr-none shadow-md'
                        }`}>
                          {m.text}

                          {/* Render attached inline buttons if any */}
                          {m.buttons && m.buttons.length > 0 && (
                            <div className="mt-2.5 pt-2 border-t border-white/20 space-y-1">
                              {m.buttons.map((row, rIdx) => (
                                <div key={rIdx} className="flex gap-1.5 flex-wrap">
                                  {row.map((btn, bIdx) => (
                                    <span
                                      key={bIdx}
                                      className="px-2.5 py-1 bg-white/20 hover:bg-white/30 text-white font-medium rounded-md text-[10px] inline-flex items-center gap-1"
                                    >
                                      {btn.text} {btn.url && <LinkIcon className="w-2.5 h-2.5" />}
                                    </span>
                                  ))}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                        <span className={`text-[10px] text-slate-500 mt-1 block ${isUser ? 'text-left' : 'text-right'}`}>
                          {m.timestamp}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Inline Buttons Builder Toolbar */}
              {customButtons.length > 0 && (
                <div className="px-4 py-2 bg-slate-900 border-t border-slate-800 flex items-center gap-2 flex-wrap text-xs">
                  <span className="text-slate-400 text-[11px] font-semibold">Прикрепленные кнопки:</span>
                  {customButtons.map((btn, idx) => (
                    <span
                      key={idx}
                      className="px-2.5 py-1 rounded-lg bg-blue-500/10 border border-blue-500/30 text-blue-300 text-xs flex items-center gap-1.5"
                    >
                      <span>{btn.text}</span>
                      {btn.url && <LinkIcon className="w-3 h-3 text-blue-400" />}
                      <button onClick={() => handleRemoveButton(idx)} className="text-red-400 hover:text-red-300 ml-1">
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}

              {/* Input Form */}
              <div className="p-4 bg-slate-950 border-t border-slate-800 space-y-3">
                {/* Button Creator Drawer */}
                <div className="flex gap-2 text-xs">
                  <input
                    type="text"
                    value={buttonText}
                    onChange={(e) => setButtonText(e.target.value)}
                    placeholder="Текст кнопки (например: 'Купить билет')"
                    className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-blue-500"
                  />
                  <input
                    type="text"
                    value={buttonUrl}
                    onChange={(e) => setButtonUrl(e.target.value)}
                    placeholder="URL ссылки (необязательно)"
                    className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-blue-500"
                  />
                  <button
                    onClick={handleAddButton}
                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg border border-slate-700 font-medium text-xs flex items-center gap-1 shrink-0"
                  >
                    <Plus className="w-3.5 h-3.5 text-blue-400" />
                    <span>Кнопка</span>
                  </button>
                </div>

                <div className="flex gap-2">
                  <textarea
                    rows={2}
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    placeholder={`Напишите ответ пользователю ${activeChat.user?.first_name || ''}...`}
                    className="flex-1 bg-slate-900 border border-slate-800 rounded-xl p-3 text-xs text-slate-100 focus:outline-none focus:border-blue-500"
                  />
                  <button
                    onClick={handleSendDirect}
                    disabled={isSending || !inputText.trim()}
                    className="px-5 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-500 text-white font-semibold text-xs rounded-xl shadow-lg shadow-blue-500/20 transition flex items-center justify-center gap-2 shrink-0"
                  >
                    <Send className="w-4 h-4" />
                    <span>Отправить</span>
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-slate-500 text-xs">
              Выберите чат слева для начала общения.
            </div>
          )}
        </div>
      </div>

      {/* Broadcast Modal */}
      {showBroadcastModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="font-bold text-base text-slate-100 flex items-center gap-2">
                <Megaphone className="w-5 h-5 text-blue-400" />
                <span>Массовая рассылка пользователям</span>
              </h3>
              <button
                onClick={() => setShowBroadcastModal(false)}
                className="text-slate-400 hover:text-white font-bold"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3">
              <p className="text-xs text-slate-400">
                Сообщение будет отправлено всем активным пользователям Telegram ({chats.length} чатов).
              </p>

              <textarea
                rows={5}
                value={broadcastText}
                onChange={(e) => setBroadcastText(e.target.value)}
                placeholder="Текст рассылки (поддерживает Markdown/HTML)..."
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-slate-100 focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
              <button
                onClick={() => setShowBroadcastModal(false)}
                className="px-4 py-2 text-xs font-medium text-slate-400 hover:text-slate-200"
              >
                Отмена
              </button>
              <button
                onClick={handleSendBroadcast}
                disabled={isSending || !broadcastText.trim()}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs rounded-xl shadow-lg shadow-blue-500/20 transition flex items-center gap-2"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Запустить рассылку</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
