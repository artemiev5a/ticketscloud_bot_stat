import { createHmac } from 'node:crypto';
import { getCacheKeySecret } from './securityConfig.ts';

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
  total_count?: number;
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
  total_count?: number;
  refs?: {
    tickets?: Record<string, Ticket>;
  };
  reason?: string;
  message?: string;
  errors?: string[];
};

type EventStats = { title: string; orders: number; tickets: number; sales: number };
export type BotStatsResponse = {
  text: string;
  reply_markup?: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> };
};

export type CachedStatsSnapshot = {
  data: BotStatsResponse;
  isFresh: boolean;
  verifiedAt: number;
};

const API_BASE_URL = (process.env.TICKETSCLOUD_API_BASE_URL || 'https://ticketscloud.com').replace(/\/$/, '');
const ORDERS_PATH = '/v2/resources/orders';
const REFUNDS_PATH = '/v2/resources/refund_requests';
const PAGE_SIZE = 200;
const MAX_PAGES = 1_000;
// Страницы загружаются небольшими параллельными окнами. Верхняя граница
// защищает Ticketscloud API от слишком агрессивной конфигурации.
const PAGE_CONCURRENCY = Math.max(1, Math.min(8, Number(process.env.TICKETSCLOUD_PAGE_CONCURRENCY) || 4));
const CACHE_TODAY_TTL_MS = Math.max(30_000, Number(process.env.CACHE_TODAY_TTL_MS) || 120_000);
const CACHE_WEEK_TTL_MS = Math.max(30_000, Number(process.env.CACHE_WEEK_TTL_MS) || 300_000);
const CACHE_MAX_STALE_MS = Math.max(300_000, Number(process.env.CACHE_MAX_STALE_MS) || 1_800_000);
const CACHE_MAX_ENTRIES = Math.max(10, Number(process.env.CACHE_MAX_ENTRIES) || 1_000);
const CACHE_FORMULA_VERSION = 'orders-v5-full-pagination';
const API_REQUEST_TIMEOUT_MS = Math.max(5_000, Number(process.env.TICKETSCLOUD_REQUEST_TIMEOUT_MS) || 45_000);
// Длинный отчёт может состоять из десятков страниц. Ticketscloud иногда
// отвечает 504 на одной из них, хотя повтор того же запроса проходит успешно.
// Держим уже загруженные страницы в памяти и повторяем только упавшую.
const API_MAX_ATTEMPTS = Math.max(1, Math.min(8, Number(process.env.TICKETSCLOUD_MAX_ATTEMPTS) || 5));
const REPORT_TIME_ZONE = process.env.REPORT_TIME_ZONE || 'Europe/Moscow';
const ORDER_LOOKBACK_DAYS = Math.max(7, Number(process.env.ORDER_LOOKBACK_DAYS) || 90);
const DAY_MS = 24 * 60 * 60 * 1_000;
const cache = new Map<string, { data: BotStatsResponse; verifiedAt: number }>();

function cacheTtl(period: StatsPeriod): number {
  return period === 'today' ? CACHE_TODAY_TTL_MS : CACHE_WEEK_TTL_MS;
}

export function makeStatsCacheKey(apiKey: string, period: StatsPeriod, from: Date): string {
  const fingerprint = createHmac('sha256', getCacheKeySecret()).update(apiKey).digest('hex');
  return `${CACHE_FORMULA_VERSION}:${REPORT_TIME_ZONE}:${fingerprint}:${period}:${from.toISOString()}`;
}

function verifiedTime(timestamp: number): string {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: REPORT_TIME_ZONE,
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).format(new Date(timestamp));
}

function cachedResponse(
  entry: { data: BotStatsResponse; verifiedAt: number },
  state: 'fresh' | 'refreshing' | 'failed'
): BotStatsResponse {
  const time = verifiedTime(entry.verifiedAt);
  const footer = state === 'fresh'
    ? `✅ <i>Проверено: ${time} ${REPORT_TIME_ZONE}</i>`
    : state === 'refreshing'
      ? `⏳ <i>Обновляю данные… Показана проверенная версия от ${time} ${REPORT_TIME_ZONE}.</i>`
      : `⚠️ <i>Не удалось обновить. Показана проверенная версия от ${time} ${REPORT_TIME_ZONE}.</i>`;
  return { ...entry.data, text: `${entry.data.text}\n\n${footer}` };
}

function putCache(key: string, data: BotStatsResponse, verifiedAt: number): void {
  for (const [existingKey, entry] of cache) {
    if (verifiedAt - entry.verifiedAt > CACHE_MAX_STALE_MS) cache.delete(existingKey);
  }
  if (!cache.has(key) && cache.size >= CACHE_MAX_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey) cache.delete(oldestKey);
  }
  cache.delete(key);
  cache.set(key, { data, verifiedAt });
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function retryAfterMs(response: Response, attempt: number): number {
  const value = response.headers.get('retry-after');
  if (value) {
    const seconds = Number(value);
    if (Number.isFinite(seconds)) return Math.min(10_000, Math.max(0, seconds * 1_000));
    const at = Date.parse(value);
    if (Number.isFinite(at)) return Math.min(10_000, Math.max(0, at - Date.now()));
  }
  return Math.min(5_000, 500 * 2 ** (attempt - 1));
}

async function fetchApiPage<T>(
  apiKey: string,
  path: string,
  query: URLSearchParams,
  resource: 'Orders' | 'Refunds',
  page: number
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= API_MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(`${API_BASE_URL}${path}?${query}`, {
        headers: { Authorization: `key ${apiKey}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(API_REQUEST_TIMEOUT_MS)
      });
      const body = await response.json().catch(() => ({})) as T & {
        reason?: string;
        message?: string;
        errors?: string[];
      };
      if (response.ok) return body;

      const message = body.reason || body.message || body.errors?.join(', ') || `HTTP ${response.status}`;
      if (!isRetryableStatus(response.status) || attempt === API_MAX_ATTEMPTS) {
        throw new Error(`${resource}, страница ${page}: ${message}`);
      }
      await wait(retryAfterMs(response, attempt));
    } catch (error: any) {
      lastError = error;
      const isTimeout = error?.name === 'TimeoutError'
        || /aborted due to timeout|timed?\s*out|timeout/i.test(String(error?.message || error));
      // Ошибки HTTP уже содержат безопасный контекст и не должны повторно
      // оборачиваться как сетевые.
      if (String(error?.message || '').startsWith(`${resource}, страница`)) throw error;
      if (!isTimeout || attempt === API_MAX_ATTEMPTS) {
        if (isTimeout) {
          throw new Error(`${resource}, страница ${page}: API не ответил за ${Math.round(API_REQUEST_TIMEOUT_MS / 1_000)} сек. после ${attempt} попыток`);
        }
        throw new Error(`${resource}, страница ${page}: ошибка соединения с API`);
      }
      await wait(retryAfterMs(new Response(null), attempt));
    }
  }
  throw lastError;
}

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

type PagedRequest<TBody, TItem> = {
  apiKey: string;
  path: string;
  resource: 'Orders' | 'Refunds';
  baseQuery: Record<string, string>;
  rows: (body: TBody) => TItem[] | undefined;
  identity: (item: TItem) => string;
  collect?: (body: TBody) => void;
};

/**
 * Оценивает число страниц по первой странице. `total_count` используется
 * только для планирования размера окна; концом выборки остаётся пустая
 * страница, поэтому отсутствующая или заниженная оценка не обрезает отчёт.
 */
function estimatePages(totalCount: unknown, rowsOnFirstPage: number): number | undefined {
  const total = typeof totalCount === 'number' ? totalCount : Number(totalCount);
  if (!Number.isFinite(total) || total <= 0 || rowsOnFirstPage <= 0) return undefined;
  return Math.ceil(total / rowsOnFirstPage);
}

async function fetchAllPages<TBody, TItem>(request: PagedRequest<TBody, TItem>): Promise<TItem[]> {
  const { apiKey, path, resource, baseQuery, rows, identity, collect } = request;
  const items: TItem[] = [];
  const seen = new Set<string>();
  let nextPage = 1;
  let windowSize = 1;
  let plannedPages: number | undefined;

  const load = (page: number) => {
    const query = new URLSearchParams({ ...baseQuery, page_size: String(PAGE_SIZE), page: String(page) });
    return fetchApiPage<TBody>(apiKey, path, query, resource, page).then(body => ({ page, body }));
  };

  while (true) {
    if (nextPage > MAX_PAGES) throw new Error(`Превышен лимит страниц (${resource})`);
    const pages: number[] = [];
    for (let offset = 0; offset < windowSize && nextPage + offset <= MAX_PAGES; offset += 1) {
      pages.push(nextPage + offset);
    }

    const responses = await Promise.all(pages.map(load));
    // Порядок завершения параллельных запросов не должен влиять на результат.
    responses.sort((left, right) => left.page - right.page);

    let reachedEnd = false;
    for (const { page, body } of responses) {
      const data = rows(body);
      if (!Array.isArray(data)) throw new Error(`${resource} API вернул ответ неизвестного формата`);
      collect?.(body);

      if (data.length === 0) {
        reachedEnd = true;
        break;
      }

      let addedOnPage = 0;
      for (const item of data) {
        const key = identity(item);
        if (seen.has(key)) continue;
        seen.add(key);
        items.push(item);
        addedOnPage += 1;
      }
      if (addedOnPage === 0) {
        throw new Error(`${resource} API повторил страницу ${page}; полный отчёт не сформирован`);
      }

      if (page === 1) {
        plannedPages = estimatePages((body as { total_count?: number }).total_count, data.length);
      }
    }
    if (reachedEnd) break;

    nextPage += pages.length;
    if (plannedPages !== undefined) {
      const remaining = plannedPages - nextPage + 1;
      windowSize = Math.max(1, Math.min(PAGE_CONCURRENCY, remaining));
    } else {
      windowSize = Math.min(PAGE_CONCURRENCY, windowSize * 2);
    }
  }

  return items;
}

async function fetchOrders(apiKey: string, from: Date, to: Date): Promise<{ orders: Order[]; refs: NonNullable<OrdersResponse['refs']> }> {
  const refs: NonNullable<OrdersResponse['refs']> = { events: {}, meta_events: {}, venues: {} };
  const queryFrom = new Date(from.getTime() - ORDER_LOOKBACK_DAYS * DAY_MS);

  const orders = await fetchAllPages<OrdersResponse, Order>({
    apiKey,
    path: ORDERS_PATH,
    resource: 'Orders',
    baseQuery: { created_at: `${queryFrom.toISOString()},${to.toISOString()}` },
    rows: body => body.data,
    identity: order => order.id || JSON.stringify(order),
    collect: body => {
      Object.assign(refs.events!, body.refs?.events || {});
      Object.assign(refs.meta_events!, body.refs?.meta_events || {});
      Object.assign(refs.venues!, body.refs?.venues || {});
    }
  });

  return { orders, refs };
}

async function fetchRefunds(apiKey: string, from: Date, to: Date): Promise<{
  refunds: RefundRequest[];
  ticketRefs: Record<string, Ticket>;
}> {
  const ticketRefs: Record<string, Ticket> = {};

  const refunds = await fetchAllPages<RefundsResponse, RefundRequest>({
    apiKey,
    path: REFUNDS_PATH,
    resource: 'Refunds',
    baseQuery: {
      finished_at: `${from.toISOString()},${to.toISOString()}`,
      status: 'approved'
    },
    rows: body => body.data,
    identity: refund => refund.id || JSON.stringify(refund),
    collect: body => {
      Object.assign(ticketRefs, body.refs?.tickets || {});
    }
  });

  return { refunds, ticketRefs };
}

function dateLabel(date: Date): string {
  return new Intl.DateTimeFormat('ru-RU', { timeZone: REPORT_TIME_ZONE, day: 'numeric', month: 'long' }).format(date);
}

function periodTitle(period: StatsPeriod, from: Date, to: Date): string {
  return period === 'today' ? `Сегодня, ${dateLabel(to)}` : `Последние 7 дней: ${dateLabel(from)} — ${dateLabel(to)}`;
}

export const ticketscloudService = {
  getCachedStats(
    apiKey?: string,
    period: StatsPeriod = 'today',
    revalidating = false,
    now = Date.now()
  ): CachedStatsSnapshot | undefined {
    const normalizedKey = apiKey?.trim();
    if (!normalizedKey) return undefined;
    const { from } = periodRange(period, new Date(now));
    const entry = cache.get(makeStatsCacheKey(normalizedKey, period, from));
    if (!entry) return undefined;
    const age = Math.max(0, now - entry.verifiedAt);
    if (age > CACHE_MAX_STALE_MS) return undefined;
    const isFresh = age <= cacheTtl(period);
    return {
      data: cachedResponse(entry, revalidating || !isFresh ? 'refreshing' : 'fresh'),
      isFresh,
      verifiedAt: entry.verifiedAt
    };
  },

  async getStats(apiKey?: string, period: StatsPeriod = 'today', forceRefresh = false): Promise<BotStatsResponse> {
    const normalizedKey = apiKey?.trim();
    if (!normalizedKey) return {
      text: '⚠️ <b>API-ключ не указан!</b>',
      reply_markup: { inline_keyboard: [[{ text: '🔑 Указать API-ключ', callback_data: 'prompt_set_key' }]] }
    };

    const { from, to } = periodRange(period);
    const key = makeStatsCacheKey(normalizedKey, period, from);
    const cached = cache.get(key);
    const now = Date.now();
    if (!forceRefresh && cached && now - cached.verifiedAt <= cacheTtl(period)) {
      return cachedResponse(cached, 'fresh');
    }

    let fetched: Awaited<ReturnType<typeof fetchOrders>>;
    let fetchedRefunds: Awaited<ReturnType<typeof fetchRefunds>>;
    try {
      [fetched, fetchedRefunds] = await Promise.all([
        fetchOrders(normalizedKey, from, to),
        fetchRefunds(normalizedKey, from, to)
      ]);
    } catch (error: any) {
      if (cached && now - cached.verifiedAt <= CACHE_MAX_STALE_MS) {
        return cachedResponse(cached, 'failed');
      }
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
    const verifiedAt = Date.now();
    putCache(key, data, verifiedAt);
    return cachedResponse({ data, verifiedAt }, 'fresh');
  }
};
