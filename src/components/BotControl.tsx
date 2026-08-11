import React, { useState, useEffect } from 'react';
import { BotConfig, BotInfo } from '../types/telegram';
import { 
  Key, 
  MessageSquare, 
  Users, 
  CheckCircle2, 
  BarChart3, 
  Sliders, 
  Bot, 
  RefreshCw, 
  Power,
  Save,
  Activity
} from 'lucide-react';

interface BotControlProps {
  config: BotConfig;
  botInfo: BotInfo | null;
  totalLogs: number;
  totalChats: number;
  totalCommands: number;
  onUpdateConfig: (newConfig: Partial<BotConfig>) => void;
  onRefreshStatus: () => void;
}

export const BotControl: React.FC<BotControlProps> = ({
  config,
  botInfo,
  totalLogs,
  totalChats,
  totalCommands,
  onUpdateConfig,
  onRefreshStatus
}) => {
  const [token, setToken] = useState(config.token || '');
  const [welcomeMsg, setWelcomeMsg] = useState(config.welcomeMessage || '');
  const [pollingInterval, setPollingInterval] = useState(config.pollingIntervalMs || 1500);
  const [isSaved, setIsSaved] = useState(false);

  useEffect(() => {
    setToken(config.token || '');
    setWelcomeMsg(config.welcomeMessage || '');
    setPollingInterval(config.pollingIntervalMs || 1500);
  }, [config]);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    onUpdateConfig({
      token,
      welcomeMessage: welcomeMsg,
      pollingIntervalMs: Number(pollingInterval)
    });
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 2500);
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-400 font-medium">Статус бота</p>
            <div className="flex items-center gap-2 mt-1">
              <span className={`w-2.5 h-2.5 rounded-full ${config.isPollingActive ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`} />
              <p className="text-lg font-semibold text-white">
                {config.isPollingActive ? 'Активен' : 'Остановлен'}
              </p>
            </div>
          </div>
          <div className={`p-3 rounded-lg ${config.isPollingActive ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
            <Power className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-400 font-medium">Активных чатов</p>
            <p className="text-2xl font-bold text-white mt-1">{totalChats}</p>
          </div>
          <div className="p-3 bg-blue-500/10 text-blue-400 rounded-lg">
            <Users className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-400 font-medium">Команд в боте</p>
            <p className="text-2xl font-bold text-white mt-1">{totalCommands}</p>
          </div>
          <div className="p-3 bg-indigo-500/10 text-indigo-400 rounded-lg">
            <BarChart3 className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-400 font-medium">Записей в логах</p>
            <p className="text-2xl font-bold text-white mt-1">{totalLogs}</p>
          </div>
          <div className="p-3 bg-amber-500/10 text-amber-400 rounded-lg">
            <Activity className="w-6 h-6" />
          </div>
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-blue-600/20 text-blue-400 rounded-lg">
              <Bot className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">
                {botInfo ? `@${botInfo.username}` : 'Бот не подключен'}
              </h2>
              <p className="text-xs text-slate-400">
                {botInfo ? botInfo.first_name : 'Укажите токен бота ниже'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onRefreshStatus}
            className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 rounded-lg transition cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Обновить статус
          </button>
        </div>

        <form onSubmit={handleSave} className="mt-6 space-y-6">
          <div className="grid grid-cols-1 gap-6">
            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-slate-300 mb-2">
                <Key className="w-4 h-4 text-blue-400" />
                Telegram Bot Token
              </label>
              <input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="8826111653:AAE-..."
                className="w-full px-4 py-2.5 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 placeholder-slate-600 focus:outline-none focus:border-blue-500 font-mono text-sm"
              />
            </div>

          </div>

          <div>
            <label className="flex items-center gap-2 text-sm font-medium text-slate-300 mb-2">
              <MessageSquare className="w-4 h-4 text-emerald-400" />
              Приветственное сообщение (/start)
            </label>
            <textarea
              rows={3}
              value={welcomeMsg}
              onChange={(e) => setWelcomeMsg(e.target.value)}
              placeholder="👋 Добро пожаловать в бот статистики TicketsCloud!"
              className="w-full px-4 py-2.5 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 placeholder-slate-600 focus:outline-none focus:border-emerald-500 text-sm"
            />
          </div>

          <div>
            <label className="flex items-center gap-2 text-sm font-medium text-slate-300 mb-2">
              <Sliders className="w-4 h-4 text-indigo-400" />
              Интервал Long Polling: {pollingInterval} мс
            </label>
            <input
              type="range"
              min={500}
              max={5000}
              step={250}
              value={pollingInterval}
              onChange={(e) => setPollingInterval(Number(e.target.value))}
              className="w-full accent-indigo-500 cursor-pointer"
            />
            <div className="flex justify-between text-xs text-slate-500 mt-1">
              <span>500 мс</span>
              <span>1500 мс (рекомендуется)</span>
              <span>5000 мс</span>
            </div>
          </div>

          <div className="pt-2 flex items-center justify-between border-t border-slate-800">
            <button
              type="submit"
              className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-medium text-sm rounded-lg transition shadow-lg shadow-blue-600/20 cursor-pointer"
            >
              <Save className="w-4 h-4" />
              Сохранить настройки
            </button>

            {isSaved && (
              <span className="flex items-center gap-1.5 text-xs text-emerald-400 bg-emerald-500/10 px-3 py-1.5 rounded-lg border border-emerald-500/20">
                <CheckCircle2 className="w-4 h-4" />
                Настройки сохранены!
              </span>
            )}
          </div>
        </form>
      </div>
    </div>
  );
};
