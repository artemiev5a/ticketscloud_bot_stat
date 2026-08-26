export type StatsPeriod = 'today' | 'week';

type Money = string | number;
type LocalizedTitle = string | { text?: string };

type AnalyticsRow = {
  meta_event?: string | { id?: string; title?: LocalizedTitle };
  key?: string;
  id?: string;
  title?: LocalizedTitle;
  name?: string;
  value?: Money;
  count?: Money;
  tickets?: Money;
  tickets_count?: Money;
  quantity?: Money;
  orders?: Money;
  orders_count?: Money;
  values?: { full?: Money; price?: Money; nominal?: Money; extra?: Money };
};

type AnalyticsResponse = {
  data?: AnalyticsRow[] | { items?: AnalyticsRow[]; results?: AnalyticsRow[] };
  results?: AnalyticsRow[];
  pagination?: { page?: number; page_size?: number; total?: number; pages?: number };
  refs?: { meta_events?: Record<string, { title?: LocalizedTitle; name?: string }> };
  reason?: string;
  message?: string;
  errors?: string[];
};

export type AnalyticsStats = { title: string; revenue: number; tickets: number; orders: number };

type BotStatsResponse = {
  text: string;
  reply_markup?: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> };
};

const API_BASE_URL = (process.env.TICKETSCLOUD_API_BASE_URL || 'https://ticketscloud.com').replace(/\/$/, '');
const ANALYTICS_PATH = '/v2/services/analytics/org/group_by/meta_events';
const PAGE_SIZE = 20;
const MAX_PAGES = 1_000;
const CACHE_TTL_MS = 30_000;
const REPORT_TIME_ZONE = process.env.REPORT_TIME_ZONE || 'Europe/Moscow';
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

function titleText(value: LocalizedTitle | undefined): string | undefined {
  return typeof value === 'string' ? value : value?.text;
}

function rowsFrom(body: AnalyticsResponse): AnalyticsRow[] {
  if (Array.isArray(body.data)) return body.data;
  if (Array.isArray(body.data?.items)) return body.data.items;
  if (Array.isArray(body.data?.results)) return body.data.results;
  return Array.isArray(body.results) ? body.results : [];
}

function metaEventId(row: AnalyticsRow): string | undefined {
  if (typeof row.meta_event === 'string') return row.meta_event;
  return row.meta_event?.id || row.key || row.id;
}

function rowTitle(row: AnalyticsRow, refs: AnalyticsResponse['refs']): string {
  const id = metaEventId(row);
  const ref = id ? refs?.meta_events?.[id] : undefined;
  return titleText(row.meta_event && typeof row.meta_event === 'object' ? row.meta_event.title : undefined)
    || titleText(row.title) || titleText(ref?.title) || row.name || ref?.name
    || (id ? `Мероприятие ${id}` : 'Мероприятие без названия');
}

export function normalizeAnalyticsRow(row: AnalyticsRow, refs?: AnalyticsResponse['refs']): AnalyticsStats {
  return {
    title: rowTitle(row, refs),
    revenue: asNumber(row.value ?? row.values?.full ?? row.values?.price ?? row.values?.nominal),
    tickets: asNumber(row.tickets_count ?? row.tickets ?? row.quantity ?? row.count),
    orders: asNumber(row.orders_count ?? row.orders)
  };
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
  return { from: zonedMidnightUtc(now, period === 'week' ? 6 : 0), to: now };
}

function apiDate(date: Date): string {
  return date.toISOString().replace('.000Z', 'Z');
}

function dateLabel(date: Date): string {
  return new Intl.DateTimeFormat('ru-RU', { timeZone: REPORT_TIME_ZONE, day: 'numeric', month: 'long' }).format(date);
}

function periodTitle(period: StatsPeriod, from: Date, to: Date): string {
  return period === 'today' ? `Сегодня, ${dateLabel(to)}` : `Последние 7 дней: ${dateLabel(from)} — ${dateLabel(to)}`;
}

async function fetchAllAnalytics(apiKey: string, from: Date, to: Date): Promise<AnalyticsStats[]> {
  const result: AnalyticsStats[] = [];
  let page = 1;
  while (page <= MAX_PAGES) {
    const query = new URLSearchParams({
      sort: '-value', done_at: `${apiDate(from)},${apiDate(to)}`,
      page_size: String(PAGE_SIZE), page: String(page)
    });
    const response = await fetch(`${API_BASE_URL}${ANALYTICS_PATH}?${query}`, {
      headers: { Authorization: `key ${apiKey}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(20_000)
    });
    const body = await response.json().catch(() => ({})) as AnalyticsResponse;
    if (!response.ok) throw new Error(body.reason || body.message || body.errors?.join(', ') || `HTTP ${response.status}`);

    const rows = rowsFrom(body);
    result.push(...rows.map(row => normalizeAnalyticsRow(row, body.refs)));
    const totalPages = body.pagination?.pages
      || (body.pagination?.total ? Math.ceil(body.pagination.total / (body.pagination.page_size || PAGE_SIZE)) : undefined);
    if (!(totalPages !== undefined ? page < totalPages : rows.length === PAGE_SIZE)) break;
    page += 1;
  }
  if (page > MAX_PAGES) throw new Error('Превышен лимит страниц аналитики');
  return result;
}

export const ticketscloudService = {
  async getStats(apiKey?: string, period: StatsPeriod = 'today'): Promise<BotStatsResponse> {
    const normalizedKey = apiKey?.trim();
    if (!normalizedKey) return {
      text: '⚠️ <b>API-ключ не указан!</b>',
      reply_markup: { inline_keyboard: [[{ text: '🔑 Указать API-ключ', callback_data: 'prompt_set_key' }]] }
    };

    const { from, to } = periodRange(period);
    const cacheKey = `${normalizedKey}_${period}_${apiDate(from).slice(0, 13)}`;
    const cached = cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return { ...cached.data, text: `${cached.data.text}\n\n<i>⚡ Данные из кэша (30 сек)</i>` };

    let stats: AnalyticsStats[];
    try {
      stats = await fetchAllAnalytics(normalizedKey, from, to);
    } catch (error: any) {
      return {
        text: `⚠️ <b>Не удалось получить статистику</b>\nAPI вернул: <code>${escapeHtml(error?.message || error)}</code>`,
        reply_markup: { inline_keyboard: [[{ text: '🔄 Повторить', callback_data: period === 'week' ? 'stats_week' : 'stats_today' }]] }
      };
    }

    const totalRevenue = stats.reduce((sum, item) => sum + item.revenue, 0);
    const totalTickets = stats.reduce((sum, item) => sum + item.tickets, 0);
    const totalOrders = stats.reduce((sum, item) => sum + item.orders, 0);
    const eventLines = stats.sort((a, b) => b.revenue - a.revenue).slice(0, 10).map(item => {
      const counts = [item.tickets > 0 ? `Билетов: <b>${item.tickets}</b>` : '', item.orders > 0 ? `Заказов: <b>${item.orders}</b>` : '']
        .filter(Boolean).join(' · ');
      return `🔹 <b>${escapeHtml(item.title)}</b>\n   • Оборот: <b>${money(item.revenue)} ₽</b>${counts ? `\n   • ${counts}` : ''}`;
    });

    let totals = `💳 Оборот: <b>${money(totalRevenue)} ₽</b>`;
    if (totalTickets > 0) totals += ` (${totalTickets} бил.)`;
    if (totalOrders > 0) totals += `\n🧾 Заказов: <b>${totalOrders}</b>`;
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
