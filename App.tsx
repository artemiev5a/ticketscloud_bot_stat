import React, { useState, useEffect } from 'react';
import { Navbar } from './components/Navbar';
import { BotControl } from './components/BotControl';
import { LiveChats } from './components/LiveChats';
import { CommandsManager } from './components/CommandsManager';
import { BotSimulator } from './components/BotSimulator';
import { LogsConsole } from './components/LogsConsole';
import { ActivityLog, BotCommand, BotConfig, BotInfo, ChatSession } from './types/telegram';

export default function App() {
  const [activeTab, setActiveTab] = useState<string>('overview');
  const [botInfo, setBotInfo] = useState<BotInfo | null>(null);
  
  // Убрали настройки ИИ (aiAutoReplyEnabled и aiSystemPrompt), так как мы перешли на строгую аналитику
  const [config, setConfig] = useState<BotConfig>({
    token: '',
    isPollingActive: true,
    welcomeMessage: '👋 Добро пожаловать в бот статистики TicketsCloud!',
    pollingIntervalMs: 1500
  });

  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [chats, setChats] = useState<ChatSession[]>([]);
  const [commands, setCommands] = useState<BotCommand[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [totalLogsCount, setTotalLogsCount] = useState(0);

  // Fetch status & data
  const fetchBotStatus = async () => {
    try {
      const res = await fetch('/api/bot/status');
      const data = await res.json();
      if (data.ok && data.result) {
        if (data.result.botInfo) setBotInfo(data.result.botInfo);
        if (data.result.config) setConfig(data.result.config);
        setTotalLogsCount(data.result.totalLogs || 0);
      }
    } catch (e) { /* ignore */ }
  };

  const fetchLogs = async () => {
    try {
      const res = await fetch('/api/bot/logs');
      const data = await res.json();
      if (data.ok && data.logs) {
        setLogs(data.logs);
      }
    } catch (e) { /* ignore */ }
  };

  const fetchChats = async () => {
    try {
      const res = await fetch('/api/bot/chats');
      const data = await res.json();
      if (data.ok && data.chats) {
        setChats(data.chats);
      }
    } catch (e) { /* ignore */ }
  };

  const fetchCommands = async () => {
    try {
      const res = await fetch('/api/bot/commands');
      const data = await res.json();
      if (data.ok && data.commands) {
        setCommands(data.commands);
      }
    } catch (e) { /* ignore */ }
  };

  // Initial load and periodic polling
  useEffect(() => {
    fetchBotStatus();
    fetchLogs();
    fetchChats();
    fetchCommands();

    const interval = setInterval(() => {
      fetchBotStatus();
      fetchLogs();
      fetchChats();
    }, 2500);

    return () => clearInterval(interval);
  }, []);

  // Handlers
  const handleUpdateConfig = async (newConfig: Partial<BotConfig>) => {
    try {
      await fetch('/api/bot/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newConfig)
      });
      fetchBotStatus();
    } catch (e) { /* ignore */ }
  };

  const handleTogglePolling = async (active: boolean) => {
    try {
      await fetch('/api/bot/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active })
      });
      fetchBotStatus();
    } catch (e) { /* ignore */ }
  };

  const handleSendMessage = async (chatId: number, text: string, buttons?: any) => {
    await fetch('/api/bot/send-message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId, text, buttons })
    });
    fetchChats();
    fetchLogs();
  };

  const handleBroadcast = async (text: string, buttons?: any) => {
    await fetch('/api/bot/broadcast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, buttons })
    });
    fetchChats();
    fetchLogs();
  };

  const handleSaveCommand = async (cmd: BotCommand) => {
    await fetch('/api/bot/commands', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cmd)
    });
    fetchCommands();
  };

  const handleDeleteCommand = async (commandName: string) => {
    await fetch(`/api/bot/commands/${commandName}`, {
      method: 'DELETE'
    });
    fetchCommands();
  };

  const handleSyncToTelegram = async () => {
    setIsSyncing(true);
    try {
      await fetch('/api/bot/sync-commands', { method: 'POST' });
      fetchLogs();
    } catch (e) { /* ignore */ }
    setIsSyncing(false);
  };

  const handleSimulateMessage = async (text: string) => {
    await fetch('/api/bot/simulate-update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });
    fetchChats();
    fetchLogs();
  };

  const handleClearLogs = async () => {
    await fetch('/api/bot/clear-logs', { method: 'POST' });
    fetchLogs();
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans antialiased selection:bg-blue-600 selection:text-white">
      {/* Header Bar */}
      <Navbar
        botInfo={botInfo}
        config={config}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onTogglePolling={handleTogglePolling}
        onSyncMenu={handleSyncToTelegram}
        isSyncing={isSyncing}
      />

      {/* Main App Container */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {activeTab === 'overview' && (
          <BotControl
            config={config}
            botInfo={botInfo}
            totalLogs={totalLogsCount}
            totalChats={chats.length}
            totalCommands={commands.length}
            onUpdateConfig={handleUpdateConfig}
            onRefreshStatus={fetchBotStatus}
          />
        )}

        {activeTab === 'chats' && (
          <LiveChats
            chats={chats}
            onSendMessage={handleSendMessage}
            onBroadcast={handleBroadcast}
          />
        )}

        {activeTab === 'commands' && (
          <CommandsManager
            commands={commands}
            onSaveCommand={handleSaveCommand}
            onDeleteCommand={handleDeleteCommand}
            onSyncToTelegram={handleSyncToTelegram}
            isSyncing={isSyncing}
          />
        )}

        {activeTab === 'simulator' && (
          <BotSimulator
            botInfo={botInfo}
            onSimulateMessage={handleSimulateMessage}
          />
        )}

        {activeTab === 'logs' && (
          <LogsConsole
            logs={logs}
            onClearLogs={handleClearLogs}
            onRefreshLogs={fetchLogs}
          />
        )}
      </main>
    </div>
  );
}
