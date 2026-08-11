import React from 'react';
import { Bot, ExternalLink, Activity, Sparkles, RefreshCw, Radio } from 'lucide-react';
import { BotConfig, BotInfo } from '../types/telegram';

interface NavbarProps {
  botInfo: BotInfo | null;
  config: BotConfig | null;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onTogglePolling: (active: boolean) => void;
  onSyncMenu: () => void;
  isSyncing: boolean;
}

export const Navbar: React.FC<NavbarProps> = ({
  botInfo,
  config,
  activeTab,
  setActiveTab,
  onTogglePolling,
  onSyncMenu,
  isSyncing
}) => {
  const isPolling = config?.isPollingActive ?? true;

  return (
    <header className="bg-slate-900 border-b border-slate-800 sticky top-0 z-50 text-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Left: Brand / Bot identity */}
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center text-white shadow-lg shadow-blue-500/20">
              <Bot className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h1 className="font-bold text-lg text-slate-100 tracking-tight">
                  {botInfo?.first_name || 'Ticketscloud Statistics'}
                </h1>
                <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400 font-mono border border-blue-500/30">
                  @{botInfo?.username || 'TC_STATS_BOT'}
                </span>
              </div>
              <p className="text-xs text-slate-400 flex items-center gap-1.5 mt-0.5">
                {botInfo?.id && <span className="font-mono text-slate-500">ID: {botInfo.id}</span>}
                <span>•</span>
                <a
                  href={`https://t.me/${botInfo?.username || 'TC_STATS_BOT'}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-blue-400 hover:text-blue-300 inline-flex items-center gap-0.5 hover:underline"
                >
                  Открыть в Telegram <ExternalLink className="w-3 h-3" />
                </a>
              </p>
            </div>
          </div>

          {/* Right: Controls & Status */}
          <div className="flex items-center space-x-3">
            {/* Sync Menu Button */}
            <button
              onClick={onSyncMenu}
              disabled={isSyncing}
              title="Синхронизировать меню команд с приложением Telegram"
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-blue-400 ${isSyncing ? 'animate-spin' : ''}`} />
              <span>Меню в Telegram</span>
            </button>

            {/* Polling Toggle Badge */}
            <button
              onClick={() => onTogglePolling(!isPolling)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold border transition ${
                isPolling
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20'
                  : 'bg-amber-500/10 text-amber-400 border-amber-500/30 hover:bg-amber-500/20'
              }`}
            >
              <Radio className={`w-3.5 h-3.5 ${isPolling ? 'animate-pulse text-emerald-400' : 'text-amber-400'}`} />
              <span>{isPolling ? 'Бот активен' : 'Остановлен'}</span>
            </button>
          </div>
        </div>

        {/* Tab Navigation Bar */}
        <nav className="flex space-x-1 border-t border-slate-800/80 pt-2 pb-1 overflow-x-auto scrollbar-none">
          {[
            { id: 'overview', label: 'Управление и Настройки', icon: Activity },
            { id: 'chats', label: 'Живые чаты & Рассылки', icon: Radio },
            { id: 'commands', label: 'Команды и Автоответы', icon: Sparkles },
            { id: 'simulator', label: 'Симулятор Бота', icon: Bot },
            { id: 'logs', label: 'Логи событий', icon: ExternalLink },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition ${
                  isActive
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>
      </div>
    </header>
  );
};
