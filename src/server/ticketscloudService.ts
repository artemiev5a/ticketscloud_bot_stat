export type StatsPeriod = 'today' | 'week';

type Money = string | number;
type LocalizedTitle = string | { text?: string };
type LocalizedName = string | { default?: string; ru?: string; en?: string };

type Ticket = {
  id?: string;
  status?: string;
  full?: Money;
  price?: Money;
  nominal?: Money;
  restoredFromRefund?: boolean;
};

type Order = {
  id?: string;
  status?: string;
  event?: string;
  meta_event?: string;
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
  refs?: {
    events?: Record<string, {
      title?: LocalizedTitle;
      name?: string;
      meta_event?: string;
      lifetime?: { start?: string; finish?: string };
      timezone?: string;
      venue?: string;
    }>;
    meta_events?: Record<string, { title?: LocalizedTitle; name?: string }>;
    venues?: Record<string, {
      name?: string;
      city?: { name?: LocalizedName; timezone?: string };
    }>;
  };
  reason?: string;
  message?: string;
  errors?: string[];
};

type RefundRequest = {
  id?: string;
  status?: string;
  created_at?: string;
  finished_at?: string;
  refund_nominal?: Money;
  delta?: Money;
  event?: string;
  order?: string;
  tickets?: string[];
};

type RefundsResponse = {
  data?: RefundRequest[];
  pagination?: { page?: number; page_size?: number; total?: number; pages?: number };
  refs?: {
    tickets?: Record<string, Ticket>;
  };
  reason?: string;
  message?: string;
  errors?: string[];
};

type EventStats = { title: string; orders: number; tickets: number; sales: number };
type BotStatsResponse = {
  text: string;
  reply_markup?: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> };
};

const API_BASE_URL = (process.env.TICKETSCLOUD_API_BASE_URL || 'https://ticketscloud.com').replace(/\/$/, '');
const ORDERS_PATH = '/v2/resources/orders';
const REFUNDS_PATH = '/v2/resources/refund_requests';
const PAGE_SIZE = 200;
const MAX_PAGES = 1_000;
const CACHE_TTL_MS = 30_000;
const REPORT_TIME_ZONE = process.env.REPORT_TIME_ZONE || 'Europe/Moscow';
const ORDER_LOOKBACK_DAYS = Math.max(7, Number(process.env.ORDER_LOOKBACK_DAYS) || 90);
const DAY_MS = 24 * 60 * 60 * 1_000;
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

export function parseApiDate(value?: string): Date | undefined {
  if (!value) return undefined;
  const local = value.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (local) {
    // Orders API возвращает done_at без offset. Это локальное время отчёта,
    // поэтому нельзя оставлять разбор часовому поясу процесса Railway.
    const wallClockUtc = new Date(Date.UTC(
      Number(local[1]), Number(local[2]) - 1, Number(local[3]),
      Number(local[4]), Number(local[5]), Number(local[6] || 0)
    ));
    return new Date(wallClockUtc.getTime() - timeZoneOffsetMs(wallClockUtc));
  }

  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? undefined : date;
}

export function periodRange(period: StatsPeriod, now = new Date()): { from: Date; to: Date } {
  // Кабинет TicketsCloud для «Недели» показывает интервал от полуночи
  // семь суток назад до текущего момента (на экране видны обе граничные даты).
  return { from: zonedMidnightUtc(now, period === 'week' ? 7 : 0), to: now };
}

function titleText(value: LocalizedTitle | undefined): string | undefined {
  return typeof value === 'string' ? value : value?.text;
}

function localizedName(value?: LocalizedName): string {
  if (typeof value === 'string') return value;
  return value?.ru || value?.default || value?.en || '';
}

function eventStart(value?: string, timeZone?: string): string {
  if (!value) return '';
  // В отличие от done_at, lifetime.start приходит как UTC даже без суффикса.
  // Это подтверждено живым payload: 12:00 -> 19:00 в Новосибирске.
  const hasOffset = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value);
  const normalized = hasOffset ? value : `${value.replace(' ', 'T')}Z`;
  const date = new Date(normalized);
  if (Number.isNaN(date.valueOf())) return '';
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: timeZone || REPORT_TIME_ZONE,
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  }).format(date);
}

function eventIdentity(order: Order, refs: OrdersResponse['refs']): { key: string; title: string } {
  const eventRef = order.event ? refs?.events?.[order.event] : undefined;
  const metaEventId = order.meta_event || eventRef?.meta_event;
  const metaEventRef = metaEventId ? refs?.meta_events?.[metaEventId] : undefined;
  const baseTitle = titleText(metaEventRef?.title) || metaEventRef?.name
    || titleText(eventRef?.title) || eventRef?.name
    || (metaEventId ? `Мероприятие ${metaEventId}` : order.event ? `Мероприятие ${order.event}` : 'Мероприятие без названия');
  const venue = eventRef?.venue ? refs?.venues?.[eventRef.venue] : undefined;
  // Часовой пояс города площадки надёжнее общего timezone события: start
  // может приходить в UTC, а кабинет показывает локальное время площадки.
  const start = eventStart(eventRef?.lifetime?.start, venue?.city?.timezone || eventRef?.timezone);
  const city = localizedName(venue?.city?.name);
  const details = [start, city].filter(Boolean).join(', ');
  return {
    key: order.event || metaEventId || baseTitle,
    title: details ? `${baseTitle} — ${details}` : baseTitle
  };
}

function orderSales(order: Order): number {
  // В TicketsCloud `price` — цена до скидки, `nominal` — фактически
  // оплаченная стоимость билета, а `full = nominal + extra`. Кабинет в
  // колонке «Продажи» суммирует nominal и не включает extra.
  const tickets = Array.isArray(order.tickets) ? order.tickets : [];
  // После возврата Orders API может убрать билет и уменьшить values.nominal.
  // Восстановленный из refund refs билет нужен для исходного gross turnover.
  if (tickets.some(ticket => ticket.restoredFromRefund)) {
    return tickets.reduce((sum, ticket) => sum + asNumber(ticket.nominal ?? ticket.price), 0);
  }
  if (order.values?.nominal !== undefined) return asNumber(order.values.nominal);
  if (tickets.length > 0) return tickets.reduce((sum, ticket) => sum + asNumber(ticket.nominal ?? ticket.price), 0);
  return asNumber(order.values?.price ?? order.values?.full);
}

function isCompletedSale(order: Order): boolean {
  // Кабинет считает только заказы, которые сейчас завершены. done_at может
  // сохраниться у отменённого/откаченного заказа, поэтому одной даты мало.
  if (order.status?.toLowerCase() !== 'done') return false;
  return Boolean(parseApiDate(order.done_at));
}

export function selectOrdersForRange(orders: Order[], from: Date, to: Date): Order[] {
  return orders.filter(order => {
    if (!isCompletedSale(order)) return false;
    const completedAt = parseApiDate(order.done_at);
    return Boolean(completedAt && completedAt >= from && completedAt <= to);
  });
}

function restoreRefundedTickets(
  orders: Order[],
  refunds: RefundRequest[],
  refundTicketRefs?: Record<string, Ticket>
): Order[] {
  const byOrder = new Map(orders.filter(order => order.id).map(order => [order.id!, order]));
  for (const refund of refunds) {
    const order = refund.order ? byOrder.get(refund.order) : undefined;
    if (!order) continue;
    const tickets = Array.isArray(order.tickets) ? [...order.tickets] : [];
    const present = new Set(tickets.map(ticket => ticket.id).filter(Boolean));
    for (const ticketId of refund.tickets || []) {
      if (present.has(ticketId)) continue;
      const ticket = refundTicketRefs?.[ticketId];
      if (!ticket) throw new Error(`API не вернул данные возвращённого билета ${ticketId}`);
      tickets.push({ ...ticket, id: ticket.id || ticketId, restoredFromRefund: true });
      present.add(ticketId);
    }
    order.tickets = tickets;
  }
  return orders;
}

export function aggregateOrders(
  orders: Order[],
  refs?: OrdersResponse['refs'],
  refunds: RefundRequest[] = [],
  refundTicketRefs?: Record<string, Ticket>
) {
  const approvedRefunds = refunds.filter(refund => !refund.status || refund.status.toLowerCase() === 'approved');
  restoreRefundedTickets(orders, approvedRefunds, refundTicketRefs);
  let sales = 0;
  let successfulOrders = 0;
  let ticketsSold = 0;
  const refundAmount = approvedRefunds.reduce(
    (sum, refund) => sum + Math.abs(asNumber(refund.refund_nominal ?? refund.delta)), 0
  );
  const refundedTicketIds = new Set(approvedRefunds.flatMap(refund => refund.tickets || []));
  const events = new Map<string, EventStats>();

  for (const order of orders) {
    const tickets = Array.isArray(order.tickets) ? order.tickets : [];
    if (isCompletedSale(order)) {
      const amount = orderSales(order);
      successfulOrders += 1;
      sales += amount;
      ticketsSold += tickets.length;

      const identity = eventIdentity(order, refs);
      const event = events.get(identity.key) || { title: identity.title, orders: 0, tickets: 0, sales: 0 };
      event.orders += 1;
      event.tickets += tickets.length;
      event.sales += amount;
      events.set(identity.key, event);
    }
  }

  return {
    sales,
    successfulOrders,
    ticketsSold,
    refunds: refundAmount,
    ticketsRefunded: refundedTicketIds.size,
    events
  };
}

async function fetchOrders(apiKey: string, from: Date, to: Date): Promise<{ orders: Order[]; refs: NonNullable<OrdersResponse['refs']> }> {
  const orders: Order[] = [];
  const refs: NonNullable<OrdersResponse['refs']> = { events: {}, meta_events: {}, venues: {} };
  const queryFrom = new Date(from.getTime() - ORDER_LOOKBACK_DAYS * DAY_MS);
  const seenOrders = new Set<string>();
  let expectedTotal: number | undefined;
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
    if (!Array.isArray(body.data)) throw new Error('Orders API вернул ответ неизвестного формата');
    if (Number.isFinite(body.pagination?.total)) expectedTotal = body.pagination!.total;

    const rows = body.data;
    Object.assign(refs.events!, body.refs?.events || {});
    Object.assign(refs.meta_events!, body.refs?.meta_events || {});
    Object.assign(refs.venues!, body.refs?.venues || {});

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
  if (expectedTotal !== undefined && orders.length < expectedTotal) {
    throw new Error(`Orders API вернул не все страницы: ${orders.length} из ${expectedTotal}`);
  }
  return { orders, refs };
}

async function fetchRefunds(apiKey: string, from: Date, to: Date): Promise<{
  refunds: RefundRequest[];
  ticketRefs: Record<string, Ticket>;
}> {
  const refunds: RefundRequest[] = [];
  const ticketRefs: Record<string, Ticket> = {};
  const seen = new Set<string>();
  let expectedTotal: number | undefined;
  let page = 1;

  while (page <= MAX_PAGES) {
    const query = new URLSearchParams({
      finished_at: `${from.toISOString()},${to.toISOString()}`,
      status: 'approved',
      page_size: String(PAGE_SIZE),
      page: String(page)
    });
    const response = await fetch(`${API_BASE_URL}${REFUNDS_PATH}?${query}`, {
      headers: { Authorization: `key ${apiKey}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(20_000)
    });
    const body = await response.json().catch(() => ({})) as RefundsResponse;
    if (!response.ok) throw new Error(body.reason || body.message || body.errors?.join(', ') || `HTTP ${response.status}`);
    if (!Array.isArray(body.data)) throw new Error('Refunds API вернул ответ неизвестного формата');
    if (Number.isFinite(body.pagination?.total)) expectedTotal = body.pagination!.total;

    const rows = body.data;
    Object.assign(ticketRefs, body.refs?.tickets || {});
    let addedOnPage = 0;
    for (const refund of rows) {
      const identity = refund.id || JSON.stringify(refund);
      if (seen.has(identity)) continue;
      seen.add(identity);
      refunds.push(refund);
      addedOnPage += 1;
    }
    if (rows.length === 0 || addedOnPage === 0) break;
    page += 1;
  }
  if (page > MAX_PAGES) throw new Error('Превышен лимит страниц возвратов');
  if (expectedTotal !== undefined && refunds.length < expectedTotal) {
    throw new Error(`Refunds API вернул не все страницы: ${refunds.length} из ${expectedTotal}`);
  }
  return { refunds, ticketRefs };
}

function dateLabel(date: Date): string {
  return new Intl.DateTimeFormat('ru-RU', { timeZone: REPORT_TIME_ZONE, day: 'numeric', month: 'long' }).format(date);
}

function periodTitle(period: StatsPeriod, from: Date, to: Date): string {
  return period === 'today' ? `Сегодня, ${dateLabel(to)}` : `Последние 7 дней: ${dateLabel(from)} — ${dateLabel(to)}`;
}

export const ticketscloudService = {
  async getStats(apiKey?: string, period: StatsPeriod = 'today', forceRefresh = false): Promise<BotStatsResponse> {
    const normalizedKey = apiKey?.trim();
    if (!normalizedKey) return {
      text: '⚠️ <b>API-ключ не указан!</b>',
      reply_markup: { inline_keyboard: [[{ text: '🔑 Указать API-ключ', callback_data: 'prompt_set_key' }]] }
    };

    const { from, to } = periodRange(period);
    const cacheKey = `${normalizedKey}_${period}_${from.toISOString().slice(0, 13)}`;
    const cached = cache.get(cacheKey);
    if (!forceRefresh && cached && cached.expiresAt > Date.now()) return { ...cached.data, text: `${cached.data.text}\n\n<i>⚡ Данные из кэша (30 сек)</i>` };

    let fetched: Awaited<ReturnType<typeof fetchOrders>>;
    let fetchedRefunds: Awaited<ReturnType<typeof fetchRefunds>>;
    try {
      [fetched, fetchedRefunds] = await Promise.all([
        fetchOrders(normalizedKey, from, to),
        fetchRefunds(normalizedKey, from, to)
      ]);
    } catch (error: any) {
      return {
        text: `⚠️ <b>Не удалось получить статистику</b>\nAPI вернул: <code>${escapeHtml(error?.message || error)}</code>`,
        reply_markup: { inline_keyboard: [[{ text: '🔄 Повторить', callback_data: period === 'week' ? 'stats_week' : 'stats_today' }]] }
      };
    }

    const selected = selectOrdersForRange(fetched.orders, from, to);
    const stats = aggregateOrders(selected, fetched.refs, fetchedRefunds.refunds, fetchedRefunds.ticketRefs);
    const sortedEvents = [...stats.events.entries()].sort((a, b) => b[1].sales - a[1].sales);
    const eventLines = sortedEvents.slice(0, 10)
      .map(([, event]) => `🔹 <b>${escapeHtml(event.title)}</b>\n   • Продажи: <b>${money(event.sales)} ₽</b>\n   • Заказов: <b>${event.orders}</b> · Билетов: <b>${event.tickets}</b>`);
    const hiddenEvents = sortedEvents.slice(10).map(([, event]) => event);
    if (hiddenEvents.length) {
      eventLines.push(`▫️ <b>Другие события: ${hiddenEvents.length}</b>\n`
        + `   • Продажи: <b>${money(hiddenEvents.reduce((sum, event) => sum + event.sales, 0))} ₽</b>\n`
        + `   • Заказов: <b>${hiddenEvents.reduce((sum, event) => sum + event.orders, 0)}</b>`
        + ` · Билетов: <b>${hiddenEvents.reduce((sum, event) => sum + event.tickets, 0)}</b>`);
    }

    let totals = `💳 Продажи: <b>${money(stats.sales)} ₽</b>\n`
      + `🛒 Успешных заказов: <b>${stats.successfulOrders}</b>\n`
      + `🎟 Билетов: <b>${stats.ticketsSold}</b>`;
    if (stats.refunds !== 0) totals += `\n↩️ Возвраты: <b>- ${money(stats.refunds)} ₽</b> (${stats.ticketsRefunded} бил.)`;

    const data: BotStatsResponse = {
      text: `📊 <b>${periodTitle(period, from, to)}</b>\n\n${totals}\n\n`
        + (eventLines.length ? `<b>По мероприятиям:</b>\n${eventLines.join('\n\n')}` : 'За выбранный период продаж нет.'),
      reply_markup: { inline_keyboard: [
        [{ text: period === 'today' ? '✅ Сегодня' : '📊 Сегодня', callback_data: 'stats_today' },
          { text: period === 'week' ? '✅ 7 дней' : '📅 7 дней', callback_data: 'stats_week' }],
        [{ text: '🔄 Обновить', callback_data: period === 'week' ? 'refresh_stats_week' : 'refresh_stats_today' }]
      ] }
    };
    cache.set(cacheKey, { data, expiresAt: Date.now() + CACHE_TTL_MS });
    return data;
  }
};
