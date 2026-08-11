import React, { useState } from 'react';
import { ActivityLog } from '../types/telegram';
import { Terminal, Search, Trash2, RefreshCw, AlertCircle, MessageSquare, Bot, Code } from 'lucide-react';

interface LogsConsoleProps {
  logs: ActivityLog[];
  onClearLogs: () => Promise<void>;
  onRefreshLogs: () => Promise<void>;
}

export const LogsConsole: React.FC<LogsConsoleProps> = ({
  logs,
  onClearLogs,
  onRefreshLogs
}) => {
  const [filterType, setFilterType] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedLog, setSelectedLog] = useState<ActivityLog | null>(null);

  const filteredLogs = logs.filter((log) => {
    if (filterType !== 'all' && log.type !== filterType) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (
        log.title.toLowerCase().includes(q) ||
        (log.details && log.details.toLowerCase().includes(q)) ||
        (log.username && log.username.toLowerCase().includes(q))
      );
    }
    return true;
  });

  const getTypeBadge = (type: ActivityLog['type']) => {
    switch (type) {
      case 'incoming_msg':
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-500/10 text-blue-400 border border-blue-500/20">ВХОДЯЩЕЕ</span>;
      case 'outgoing_msg':
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">ИСХОДЯЩЕЕ</span>;
      case 'command_exec':
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-500/10 text-purple-400 border border-purple-500/20">КОМАНДА</span>;
      case 'error':
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-red-500/10 text-red-400 border border-red-500/20">ОШИБКА</span>;
      default:
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-400 border border-slate-700">СИСТЕМА</span>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-5 bg-slate-900 border border-slate-800 rounded-2xl">
        <div>
          <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
            <Terminal className="w-5 h-5 text-indigo-400" />
            <span>Журнал событий и логов Telegram API</span>
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Отслеживайте сетевые запросы, входящие обновления Telegram и генерацию ответов ИИ.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={onRefreshLogs}
            className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl border border-slate-700 transition flex items-center gap-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5 text-blue-400" />
            <span>Обновить</span>
          </button>

          <button
            onClick={onClearLogs}
            className="px-3.5 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs font-semibold rounded-xl border border-red-500/30 transition flex items-center gap-1.5"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Очистить логи</span>
          </button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-slate-900 border border-slate-800 p-4 rounded-2xl">
        {/* Type Tabs */}
        <div className="flex gap-1.5 overflow-x-auto w-full sm:w-auto scrollbar-none text-xs">
          {[
            { id: 'all', label: 'Все события' },
            { id: 'incoming_msg', label: 'Входящие' },
            { id: 'outgoing_msg', label: 'Исходящие' },
            { id: 'command_exec', label: 'Команды' },
            { id: 'error', label: 'Ошибки' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setFilterType(tab.id)}
              className={`px-3 py-1.5 rounded-lg font-medium whitespace-nowrap transition ${
                filterType === tab.id
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Search Field */}
        <div className="relative w-full sm:w-64">
          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-2.5" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Поиск по логам..."
            className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-blue-500"
          />
        </div>
      </div>

      {/* Logs Table / Stream List */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-lg">
        <div className="divide-y divide-slate-800/80 font-mono text-xs">
          {filteredLogs.length === 0 ? (
            <div className="p-12 text-center text-slate-500">
              Логи отсутствуют или не найдены по запросу.
            </div>
          ) : (
            filteredLogs.map((log) => (
              <div
                key={log.id}
                onClick={() => setSelectedLog(selectedLog?.id === log.id ? null : log)}
                className="p-4 hover:bg-slate-800/50 transition cursor-pointer space-y-1.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    {getTypeBadge(log.type)}
                    <span className="font-bold text-slate-200">{log.title}</span>
                    {log.username && (
                      <span className="text-blue-400 font-semibold text-[11px]">{log.username}</span>
                    )}
                  </div>

                  <span className="text-[10px] text-slate-500 shrink-0">
                    {new Date(log.timestamp).toLocaleTimeString()}
                  </span>
                </div>

                {log.details && (
                  <p className="text-slate-400 text-xs leading-relaxed truncate">
                    {log.details}
                  </p>
                )}

                {/* Expanded Raw JSON View */}
                {selectedLog?.id === log.id && log.rawPayload && (
                  <div className="mt-3 p-3 bg-slate-950 rounded-xl border border-slate-800 overflow-x-auto text-[11px] text-slate-300">
                    <div className="font-bold text-xs text-blue-400 mb-1 flex items-center gap-1">
                      <Code className="w-3.5 h-3.5" />
                      <span>Raw Telegram Update Payload:</span>
                    </div>
                    <pre>{JSON.stringify(log.rawPayload, null, 2)}</pre>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
