export type StatsPeriod = 'today' | 'week';

type Money = string | number;
type LocalizedTitle = string | { text?: string };

type Ticket = {
  status?: string;
  full?: Money;
  price?: Money;
  nominal?: Money;
};

type Order = {
  id?: string;
  status?: string;
  event?: string;
  created_at?: string;
  done_at?: string;
  tickets?: Ticket[];
  values?: {
    full?: Money;
    price?: Money;
    nominal?: Money;
    extra?: Money;
  };
};

type OrdersResponse = {
  data?: Order[];
  pagination?: { page?: number; page_size?: number; total?: number; pages?: number };
  refs?: { events?: Record<string, { title?: LocalizedTitle; name?: string }> };
  reason?: string;
  message?: string;
  errors?: string[];
};

type EventStats = { orders: number; tickets: number; sales: number };
type BotStatsResponse = {
  text: string;
  reply_markup?: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> };
};

const API_BASE_URL = (process.env.TICKETSCLOUD_API_BASE_URL || 'https://ticketscloud.com').replace(/\/$/, '');
const ORDERS_PATH = '/v2/resources/orders';
const PAGE_SIZE = 200;
const MAX_PAGES = 1_000;
const CACHE_TTL_MS = 30_000;
const REPORT_TIME_ZONE = process.env.REPORT_TIME_ZONE || 'Europe/Moscow';
const ORDER_LOOKBACK_DAYS = Math.max(7, Number(process.env.ORDER_LOOKBACK_DAYS) || 90);
const DAY_MS = 24 * 60 * 60 * 1_000;
const SUCCESSFUL_ORDER_STATUSES = new Set(['done', 'partially_refunded']);
const REFUNDED_ORDER_STATUSES = new Set(['refunded', 'returned']);
const REFUNDED_TICKET_STATUSES = new Set(['refunded', 'returned', 'canceled', 'cancelled']);
const cache = new Map<string, { data: BotStatsResponse; expiresAt: number }>();

function asNumber(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value !== 'string') return 0;
  const parsed = Number(value.replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
}

function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function money(value: number): string {
  return value.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function zonedParts(date: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: REPORT_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(part => part.type === type)?.value);
  return { year: value('year'), month: value('month'), day: value('day') };
}

function timeZoneOffsetMs(date: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: REPORT_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(part => part.type === type)?.value);
  return Date.UTC(value('year'), value('month') - 1, value('day'), value('hour'), value('minute'), value('second')) - date.getTime();
}

function zonedMidnightUtc(date: Date, daysBack: number): Date {
  const { year, month, day } = zonedParts(date);
  const localMidnightAsUtc = new Date(Date.UTC(year, month - 1, day - daysBack));
  return new Date(localMidnightAsUtc.getTime() - timeZoneOffsetMs(localMidnightAsUtc));
}

export function periodRange(period: StatsPeriod, now = new Date()): { from: Date; to: Date } {
  // Кабинет TicketsCloud для «Недели» показывает интервал от полуночи
  // семь суток назад до текущего момента (на экране видны обе граничные даты).
  return { from: zonedMidnightUtc(now, period === 'week' ? 7 : 0), to: now };
}

function titleText(value: LocalizedTitle | undefined): string | undefined {
  return typeof value === 'string' ? value : value?.text;
}

function eventTitle(order: Order, refs: OrdersResponse['refs']): string {
  const ref = order.event ? refs?.events?.[order.event] : undefined;
  return titleText(ref?.title) || ref?.name || (order.event ? `Мероприятие ${order.event}` : 'Мероприятие без названия');
}

function orderSales(order: Order): number {
  // `values.full` соответствует колонке «Продажи» в кабинете. Остальные
  // поля нужны лишь для обратной совместимости со старыми ответами API.
  return asNumber(order.values?.full ?? order.values?.price ?? order.values?.nominal);
}

function ticketRefund(ticket: Ticket): number {
  return asNumber(ticket.full ?? ticket.price ?? ticket.nominal);
}

export function aggregateOrders(orders: Order[], refs?: OrdersResponse['refs']) {
  let sales = 0;
  let serviceFees = 0;
  let successfulOrders = 0;
  let ticketsSold = 0;
  let refunds = 0;
  let ticketsRefunded = 0;
  const events = new Map<string, EventStats>();

  for (const order of orders) {
    const status = order.status?.toLowerCase() || '';
    const tickets = Array.isArray(order.tickets) ? order.tickets : [];

    if (SUCCESSFUL_ORDER_STATUSES.has(status)) {
      const amount = orderSales(order);
      successfulOrders += 1;
      sales += amount;
      serviceFees += asNumber(order.values?.extra);
      ticketsSold += tickets.length;

      const title = eventTitle(order, refs);
      const event = events.get(title) || { orders: 0, tickets: 0, sales: 0 };
      event.orders += 1;
      event.tickets += tickets.length;
      event.sales += amount;
      events.set(title, event);
    }

    const refundedTickets = tickets.filter(ticket => REFUNDED_TICKET_STATUSES.has(ticket.status?.toLowerCase() || ''));
    if (refundedTickets.length > 0) {
      ticketsRefunded += refundedTickets.length;
      refunds += refundedTickets.reduce((sum, ticket) => sum + ticketRefund(ticket), 0);
    } else if (REFUNDED_ORDER_STATUSES.has(status)) {
      // Некоторые варианты Orders API отмечают возврат только на уровне заказа.
      ticketsRefunded += tickets.length;
      refunds += orderSales(order);
    }
  }

  return { sales, serviceFees, successfulOrders, ticketsSold, refunds, ticketsRefunded, events };
}

async function fetchOrders(apiKey: string, from: Date, to: Date): Promise<{ orders: Order[]; refs: NonNullable<OrdersResponse['refs']> }> {
  const orders: Order[] = [];
  const refs: NonNullable<OrdersResponse['refs']> = { events: {} };
  const queryFrom = new Date(from.getTime() - ORDER_LOOKBACK_DAYS * DAY_MS);
  const seenOrders = new Set<string>();
  let page = 1;

  while (page <= MAX_PAGES) {
    const query = new URLSearchParams({
      created_at: `${queryFrom.toISOString()},${to.toISOString()}`,
      page_size: String(PAGE_SIZE),
      page: String(page)
    });
    const response = await fetch(`${API_BASE_URL}${ORDERS_PATH}?${query}`, {
      headers: { Authorization: `key ${apiKey}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(20_000)
    });
    const body = await response.json().catch(() => ({})) as OrdersResponse;
    if (!response.ok) throw new Error(body.reason || body.message || body.errors?.join(', ') || `HTTP ${response.status}`);

    const rows = Array.isArray(body.data) ? body.data : [];
    Object.assign(refs.events!, body.refs?.events || {});

    let addedOnPage = 0;
    for (const order of rows) {
      // Не полагаемся на неодинаковые варианты `pagination` в Orders API:
      // запрашиваем следующую страницу до пустого ответа. Защита от повторов
      // останавливает цикл, даже если API проигнорирует параметр `page`.
      const identity = order.id || JSON.stringify(order);
      if (seenOrders.has(identity)) continue;
      seenOrders.add(identity);
      orders.push(order);
      addedOnPage += 1;
    }
    if (rows.length === 0 || addedOnPage === 0) break;
    page += 1;
  }
  if (page > MAX_PAGES) throw new Error('Превышен лимит страниц заказов');
  return { orders, refs };
}

function dateLabel(date: Date): string {
  return new Intl.DateTimeFormat('ru-RU', { timeZone: REPORT_TIME_ZONE, day: 'numeric', month: 'long' }).format(date);
}

function periodTitle(period: StatsPeriod, from: Date, to: Date): string {
  return period === 'today' ? `Сегодня, ${dateLabel(to)}` : `Последние 7 дней: ${dateLabel(from)} — ${dateLabel(to)}`;
}

export const ticketscloudService = {
  async getStats(apiKey?: string, period: StatsPeriod = 'today'): Promise<BotStatsResponse> {
    const normalizedKey = apiKey?.trim();
    if (!normalizedKey) return {
      text: '⚠️ <b>API-ключ не указан!</b>',
      reply_markup: { inline_keyboard: [[{ text: '🔑 Указать API-ключ', callback_data: 'prompt_set_key' }]] }
    };

    const { from, to } = periodRange(period);
    const cacheKey = `${normalizedKey}_${period}_${from.toISOString().slice(0, 13)}`;
    const cached = cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return { ...cached.data, text: `${cached.data.text}\n\n<i>⚡ Данные из кэша (30 сек)</i>` };

    let fetched: Awaited<ReturnType<typeof fetchOrders>>;
    try {
      fetched = await fetchOrders(normalizedKey, from, to);
    } catch (error: any) {
      return {
        text: `⚠️ <b>Не удалось получить статистику</b>\nAPI вернул: <code>${escapeHtml(error?.message || error)}</code>`,
        reply_markup: { inline_keyboard: [[{ text: '🔄 Повторить', callback_data: period === 'week' ? 'stats_week' : 'stats_today' }]] }
      };
    }

    const selected = fetched.orders.filter(order => {
      const value = order.done_at || order.created_at;
      if (!value) return false;
      const completedAt = new Date(value);
      return !Number.isNaN(completedAt.valueOf()) && completedAt >= from && completedAt <= to;
    });
    const stats = aggregateOrders(selected, fetched.refs);
    const eventLines = [...stats.events.entries()]
      .sort((a, b) => b[1].sales - a[1].sales)
      .slice(0, 10)
      .map(([title, event]) => `🔹 <b>${escapeHtml(title)}</b>\n   • Продажи: <b>${money(event.sales)} ₽</b>\n   • Заказов: <b>${event.orders}</b> · Билетов: <b>${event.tickets}</b>`);

    let totals = `💳 Продажи: <b>${money(stats.sales)} ₽</b>\n`
      + `🛒 Успешных заказов: <b>${stats.successfulOrders}</b>\n`
      + `🎟 Билетов: <b>${stats.ticketsSold}</b>`;
    if (stats.serviceFees !== 0) totals += `\n🧾 Сервисный сбор: <b>${money(stats.serviceFees)} ₽</b>`;
    if (stats.refunds !== 0) totals += `\n↩️ Возвраты: <b>- ${money(stats.refunds)} ₽</b> (${stats.ticketsRefunded} бил.)`;

    const data: BotStatsResponse = {
      text: `📊 <b>${periodTitle(period, from, to)}</b>\n\n${totals}\n\n`
        + (eventLines.length ? `<b>По мероприятиям:</b>\n${eventLines.join('\n\n')}` : 'За выбранный период продаж нет.'),
      reply_markup: { inline_keyboard: [
        [{ text: period === 'today' ? '✅ Сегодня' : '📊 Сегодня', callback_data: 'stats_today' },
          { text: period === 'week' ? '✅ 7 дней' : '📅 7 дней', callback_data: 'stats_week' }],
        [{ text: '🔄 Обновить', callback_data: period === 'week' ? 'stats_week' : 'stats_today' }]
      ] }
    };
    cache.set(cacheKey, { data, expiresAt: Date.now() + CACHE_TTL_MS });
    return data;
  }
};
