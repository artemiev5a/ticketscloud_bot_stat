import assert from 'node:assert/strict';
import test from 'node:test';
import { TelegramBotEngine } from '../src/server/botEngine.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const nextTurn = () => new Promise<void>(resolve => setImmediate(resolve));

test('runs slow statistics in background and coalesces duplicate clicks', async () => {
  const firstStats = deferred<any>();
  let statsCalls = 0;
  const statsService = {
    getStats: () => {
      statsCalls += 1;
      if (statsCalls === 1) return firstStats.promise;
      return Promise.resolve({ text: 'SECOND-STATS' });
    }
  };
  const sent: Array<{ chatId: number; text: string }> = [];
  const edited: Array<{ chatId: number; messageId: number; text: string }> = [];
  const telegramClient = {
    getMe: async () => ({ id: 1, is_bot: true, first_name: 'Test bot' }),
    getUpdates: async () => [],
    sendMessage: async (_token: string, chatId: number, text: string) => {
      sent.push({ chatId, text });
      return { message_id: sent.length };
    },
    editMessageText: async (_token: string, chatId: number, messageId: number, text: string) => {
      edited.push({ chatId, messageId, text });
      return { message_id: messageId };
    },
    answerCallbackQuery: async () => ({}),
    setMyCommands: async () => ({}),
    sendChatAction: async () => undefined
  };
  const engine = new TelegramBotEngine(statsService as any, telegramClient as any);
  engine.updateConfig({ token: 'test-token' });

  await engine.handleUpdate({
    update_id: 1,
    message: { message_id: 1, chat: { id: 101 }, from: { id: 101, first_name: 'One' }, text: '/setkey key-one' }
  } as any);
  sent.length = 0;

  let firstHandled = false;
  const firstHandle = engine.handleUpdate({
    update_id: 2,
    callback_query: { id: 'callback-1', from: { id: 101, first_name: 'One' }, message: { chat: { id: 101 } }, data: 'stats_week' }
  } as any).then(() => { firstHandled = true; });
  await nextTurn();

  assert.equal(firstHandled, true, 'Telegram update must not wait for the Ticketscloud API');
  await firstHandle;
  assert.equal(statsCalls, 1);
  assert.equal(sent.filter(message => /Собираю статистику/.test(message.text)).length, 1);

  await engine.handleUpdate({
    update_id: 3,
    callback_query: { id: 'callback-2', from: { id: 101, first_name: 'One' }, message: { chat: { id: 101 } }, data: 'refresh_stats_week' }
  } as any);
  await nextTurn();
  assert.equal(statsCalls, 1, 'duplicate refresh must join the active job');
  assert.equal(sent.filter(message => /Собираю статистику/.test(message.text)).length, 1);

  await engine.handleUpdate({
    update_id: 4,
    message: { message_id: 4, chat: { id: 202 }, from: { id: 202, first_name: 'Two' }, text: '/help' }
  } as any);
  assert.ok(sent.some(message => message.chatId === 202 && /Справка/.test(message.text)));

  firstStats.resolve({ text: 'FINAL-STATS' });
  await nextTurn();
  await nextTurn();
  assert.equal(edited.filter(message => message.text === 'FINAL-STATS').length, 1);

  await engine.handleUpdate({
    update_id: 5,
    callback_query: { id: 'callback-3', from: { id: 101, first_name: 'One' }, message: { chat: { id: 101 } }, data: 'refresh_stats_week' }
  } as any);
  await nextTurn();
  assert.equal(statsCalls, 2, 'a completed job must be removable and refreshable');
});
