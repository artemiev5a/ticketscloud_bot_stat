import React, { useState } from 'react';
import { BotCommand, TelegramInlineKeyboardButton } from '../types/telegram';
import { Sparkles, Plus, Trash2, Edit3, RefreshCw, Code } from 'lucide-react';

interface CommandsManagerProps {
  commands: BotCommand[];
  onSaveCommand: (cmd: BotCommand) => Promise<void>;
  onDeleteCommand: (commandName: string) => Promise<void>;
  onSyncToTelegram: () => Promise<void>;
  isSyncing: boolean;
}

export const CommandsManager: React.FC<CommandsManagerProps> = ({
  commands,
  onSaveCommand,
  onDeleteCommand,
  onSyncToTelegram,
  isSyncing
}) => {
  const [editingCmd, setEditingCmd] = useState<Partial<BotCommand> | null>(null);
  const [commandInput, setCommandInput] = useState('');
  const [descriptionInput, setDescriptionInput] = useState('');
  const [responseType, setResponseType] = useState<'text' | 'stats' | 'custom'>('text');
  const [responseText, setResponseText] = useState('');

  // Button builder state
  const [btnText, setBtnText] = useState('');
  const [btnData, setBtnData] = useState('');
  const [buttonsList, setButtonsList] = useState<TelegramInlineKeyboardButton[]>([]);

  const handleOpenNewModal = () => {
    setEditingCmd({});
    setCommandInput('');
    setDescriptionInput('');
    setResponseType('text');
    setResponseText('');
    setButtonsList([]);
  };

  const handleEditClick = (cmd: BotCommand) => {
    setEditingCmd(cmd);
    setCommandInput(cmd.command);
    setDescriptionInput(cmd.description);
    setResponseType((cmd.responseType as any) || 'text');
    setResponseText(cmd.responseText || '');
    setButtonsList(cmd.buttons ? cmd.buttons.flat() : []);
  };

  const handleAddInlineButton = () => {
    if (!btnText.trim()) return;
    setButtonsList([...buttonsList, {
      text: btnText.trim(),
      callback_data: btnData.startsWith('http') ? undefined : (btnData.trim() || `btn_${Date.now()}`),
      url: btnData.startsWith('http') ? btnData.trim() : undefined
    }]);
    setBtnText('');
    setBtnData('');
  };

  const handleRemoveButton = (idx: number) => {
    setButtonsList(buttonsList.filter((_, i) => i !== idx));
  };

  const handleSave = async () => {
    const cleanCmd = commandInput.replace(/^\//, '').toLowerCase().trim();
    if (!cleanCmd) return;

    const formattedButtons = buttonsList.length > 0 ? [buttonsList] : undefined;

    const newCmd: BotCommand = {
      id: editingCmd?.id || `cmd_${Date.now()}`,
      command: cleanCmd,
      description: descriptionInput.trim() || 'Команда бота',
      responseType,
      responseText,
      buttons: formattedButtons,
      enabled: true
    };

    await onSaveCommand(newCmd);
    setEditingCmd(null);
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-5 bg-slate-900 border border-slate-800 rounded-2xl">
        <div>
          <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-purple-400" />
            <span>Управление командами и автоответами бота</span>
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Настройте меню Telegram-бота и создавайте собственные интерактивные автоответы.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={onSyncToTelegram}
            disabled={isSyncing}
            className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl border border-slate-700 transition flex items-center gap-2"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-blue-400 ${isSyncing ? 'animate-spin' : ''}`} />
            <span>Синхронизировать с Telegram</span>
          </button>

          <button
            onClick={handleOpenNewModal}
            className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs rounded-xl shadow-lg shadow-blue-500/20 transition flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            <span>Новая команда</span>
          </button>
        </div>
      </div>

      {/* Commands List Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {commands.map((cmd) => (
          <div
            key={cmd.id}
            className="bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-col justify-between space-y-4 hover:border-slate-700 transition"
          >
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-mono text-sm font-bold text-blue-400 bg-blue-500/10 px-3 py-1 rounded-lg border border-blue-500/20">
                  /{cmd.command}
                </span>
                <span className="text-[10px] uppercase font-bold text-slate-400 bg-slate-800 px-2 py-0.5 rounded">
                  {cmd.responseType}
                </span>
              </div>

              <h4 className="text-xs font-semibold text-slate-200 mt-2">{cmd.description}</h4>

              <p className="text-xs text-slate-400 leading-relaxed font-mono line-clamp-3 bg-slate-950 p-3 rounded-xl border border-slate-800/80">
                {cmd.responseText || '[Автоответ]'}
              </p>

              {/* Render Attached Inline Buttons Preview */}
              {cmd.buttons && cmd.buttons.length > 0 && (
                <div className="flex gap-1.5 flex-wrap pt-1">
                  {cmd.buttons.flat().map((btn, idx) => (
                    <span
                      key={idx}
                      className="px-2 py-0.5 bg-slate-800 border border-slate-700 text-slate-300 text-[10px] rounded"
                    >
                      🔘 {btn.text}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs">
              <button
                onClick={() => handleEditClick(cmd)}
                className="text-blue-400 hover:text-blue-300 font-medium flex items-center gap-1"
              >
                <Edit3 className="w-3.5 h-3.5" />
                <span>Редактировать</span>
              </button>

              {cmd.command !== 'start' && (
                <button
                  onClick={() => onDeleteCommand(cmd.command)}
                  className="text-red-400 hover:text-red-300 font-medium flex items-center gap-1"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Удалить</span>
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Edit / Create Modal */}
      {editingCmd !== null && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="font-bold text-base text-slate-100 flex items-center gap-2">
                <Code className="w-5 h-5 text-blue-400" />
                <span>{editingCmd.id ? 'Редактирование команды' : 'Создание новой команды'}</span>
              </h3>
              <button
                onClick={() => setEditingCmd(null)}
                className="text-slate-400 hover:text-white font-bold"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Команда (без слэша):</label>
                <div className="flex items-center bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 font-mono">
                  <span className="text-slate-500 mr-1">/</span>
                  <input
                    type="text"
                    value={commandInput}
                    onChange={(e) => setCommandInput(e.target.value)}
                    placeholder=" Например: report"
                    className="flex-1 bg-transparent focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Описание (для меню Telegram):</label>
                <input
                  type="text"
                  value={descriptionInput}
                  onChange={(e) => setDescriptionInput(e.target.value)}
                  placeholder="Например: Получить быстрый отчёт по мероприятию"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-slate-100 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Тип ответа:</label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { id: 'text', label: 'Статический текст' },
                    { id: 'stats', label: 'Статистика' },
                  ].map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setResponseType(t.id as any)}
                      className={`p-2 rounded-xl text-xs font-medium border text-center transition ${
                        responseType === t.id
                          ? 'bg-blue-600/20 text-blue-400 border-blue-500/40'
                          : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Текст ответа бота:</label>
                <textarea
                  rows={4}
                  value={responseText}
                  onChange={(e) => setResponseText(e.target.value)}
                  placeholder="Введите текст ответа..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-slate-100 focus:outline-none focus:border-blue-500 font-mono"
                />
              </div>

              {/* Inline Buttons Builder inside Modal */}
              <div className="space-y-2 pt-2 border-t border-slate-800">
                <label className="block text-xs font-medium text-slate-300">Прикрепить кнопки (Inline Keyboard):</label>
                <div className="flex gap-2 text-xs">
                  <input
                    type="text"
                    value={btnText}
                    onChange={(e) => setBtnText(e.target.value)}
                    placeholder="Текст на кнопке"
                    className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-100"
                  />
                  <input
                    type="text"
                    value={btnData}
                    onChange={(e) => setBtnData(e.target.value)}
                    placeholder="URL или callback_data"
                    className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-100"
                  />
                  <button
                    type="button"
                    onClick={handleAddInlineButton}
                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg border border-slate-700 text-xs font-medium"
                  >
                    +
                  </button>
                </div>

                {buttonsList.length > 0 && (
                  <div className="flex gap-1.5 flex-wrap pt-1">
                    {buttonsList.map((btn, i) => (
                      <span key={i} className="px-2 py-1 bg-blue-500/10 border border-blue-500/30 text-blue-300 rounded text-xs flex items-center gap-1">
                        {btn.text}
                        <button type="button" onClick={() => handleRemoveButton(i)} className="text-red-400 hover:text-red-300 ml-1">✕</button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setEditingCmd(null)}
                className="px-4 py-2 text-xs font-medium text-slate-400 hover:text-slate-200"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={handleSave}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs rounded-xl shadow-lg shadow-blue-500/20 transition"
              >
                Сохранить команду
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
