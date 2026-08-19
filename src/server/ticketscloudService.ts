export type StatsPeriod = 'today' | 'week';

type Money = string | number;

type Ticket = {
  status?: string;
  price?: Money;
  full?: Money;
  nominal?: Money;
  [key: string]: any;
};

type Order = {
  status?: string;
  event?: string;
  created_at?: string;
  done_at?: string;
  tickets?: Ticket[];
  values?: { full?: Money; price?: Money; nominal?: Money; extra?: Money; discount?: Money; };
};

type OrdersResponse = {
  data?: Order[];
  pagination?: { page_size?: number; total?: number };
  refs?: { events?: Record<string, { title?: string | { text?: string } }> };
  reason?: string; message?: string; errors?: string[];
};

const API_URL = `${(process.env.TICKETSCLOUD_API_BASE_URL || 'https://ticketscloud.com').replace(/\/$/, '')}/v2/resources/orders`;
const PAGE_SIZE = 200;
const MAX_ORDERS_LIMIT = 20000;
const DAY_MS = 24 * 60 * 60 * 1000;
const UTC_OFFSET_HOURS = Number(process.env.REPORT_UTC_OFFSET_HOURS || 3);

function number(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value !== 'string') return 0;
  const parsed = Number(value.replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
}

function rub(value: number): string {
  return value.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function safe(value: string): string { return value.replace(/[<>&]/g, ''); }

function periodRange(period: StatsPeriod, now = new Date()) {
  const offset = UTC_OFFSET_HOURS * 60 * 60 * 1000;
  const localNow = new Date(now.getTime() + offset);
  const daysBack = period === 'week' ? 6 : 0;
  const localStart = Date.UTC(localNow.getUTCFullYear(), localNow.getUTCMonth(), localNow.getUTCDate() - daysBack);
  return { from: new Date(localStart - offset), to: now };
}

function dateLabel(date: Date): string {
  return new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', day: 'numeric', month: 'long' }).format(date);
}

function titleFor(period: StatsPeriod, from: Date, to: Date): string {
  return period === 'today' ? `Сегодня, ${dateLabel(to)}` : `Последние 7 дней: ${dateLabel(from)} — ${dateLabel(to)}`;
}

function eventName(order: Order, refs: OrdersResponse['refs']): string {
  const title = order.event ? refs?.events?.[order.event]?.title : undefined;
  if (typeof title === 'string') return title;
  return title?.text || 'Мероприятие без названия';
}

const cache = new Map<string, { data: { text: string; reply_markup?: any }; expiresAt: number }>();
const CACHE_TTL_MS = 30 * 1000;

export const ticketscloudService = {
  // 👇 Обрати внимание, сюда добавлен параметр commissionRate
  async getStats(apiKey?: string, period: StatsPeriod = 'today', commissionRate: number = 0): Promise<{ text: string; reply_markup?: any }> {
    if (!apiKey?.trim()) {
      return { text: '⚠️ <b>API-ключ не указан!</b>', reply_markup: { inline_keyboard: [[{ text: '🔑 Указать API-ключ', callback_data: 'prompt_set_key' }]] } };
    }

    // Добавляем комиссию в ключ кэша, чтобы при смене комиссии кэш сбрасывался
    const cacheKey = `${apiKey.trim()}_${period}_${commissionRate}`;
    const now = Date.now();
    const cachedItem = cache.get(cacheKey);

    if (cachedItem && cachedItem.expiresAt > now) {
      return { ...cachedItem.data, text: cachedItem.data.text + '\n\n<i>⚡ Данные из кэша (30 сек)</i>' };
    }

    const { from, to } = periodRange(period);
    const queryFrom = new Date(from.getTime() - (14 * DAY_MS));
    
    const orders: Order[] = [];
    const refs: NonNullable<OrdersResponse['refs']> = { events: {} };
    let page = 1;
    let hasMorePages = true;

    try {
      while (hasMorePages && orders.length < MAX_ORDERS_LIMIT) {
        const query = new URLSearchParams({
          status: 'done,partially_refunded', 
          created_at: `${queryFrom.toISOString()},${to.toISOString()}`,
          page: String(page),
          page_size: String(PAGE_SIZE)
        });

        const response = await fetch(`${API_URL}?${query}`, {
          headers: { Authorization: `key ${apiKey.trim()}`, Accept: 'application/json' },
          signal: AbortSignal.timeout(20_000)
        });

        const body = await response.json().catch(() => ({})) as OrdersResponse;
        if (!response.ok) throw new Error(body.reason || body.message || body.errors?.join(', ') || `HTTP ${response.status}`);

        const fetchedOrders = Array.isArray(body.data) ? body.data : [];
        orders.push(...fetchedOrders);
        Object.assign(refs.events!, body.refs?.events || {});
        
        if (fetchedOrders.length === PAGE_SIZE) page += 1;
        else hasMorePages = false;
      }
    } catch (error: any) {
      return {
        text: `⚠️ <b>Не удалось получить статистику</b>\nAPI вернул: <code>${safe(String(error.message || error))}</code>`,
        reply_markup: { inline_keyboard: [[{ text: '🔄 Повторить', callback_data: period === 'week' ? 'stats_week' : 'stats_today' }]] }
      };
    }

    const selected = orders.filter(order => {
      const value = order.done_at || order.created_at;
      if (!value) return false;
      const completed = new Date(value);
      if (Number.isNaN(completed.valueOf())) return false;
      return completed >= from && completed <= to;
    });

    let validTicketsCount = 0;
    let grossSales = 0;
    const events = new Map<string, { orders: number; tickets: number; sales: number }>();

    for (const order of selected) {
      const orderTickets = Array.isArray(order.tickets) ? order.tickets : [];
      let orderGross = 0;
      let ticketsInOrder = 0;

      for (const t of orderTickets) {
        if (t.status === 'refunded' || t.status === 'returned' || t.status === 'canceled') continue;
        ticketsInOrder++;
        orderGross += number(t.price ?? t.full ?? 0);
      }

      if (orderTickets.length === 0 && order.status === 'done') {
        orderGross = number(order.values?.price ?? order.values?.nominal);
        ticketsInOrder = 1;
      }

      if (ticketsInOrder > 0) {
        validTicketsCount += ticketsInOrder;
        grossSales += orderGross;

        const name = eventName(order, refs);
        const stat = events.get(name) || { orders: 0, tickets: 0, sales: 0 };
        stat.orders += 1;
        stat.tickets += ticketsInOrder;
        stat.sales += orderGross;
        events.set(name, stat);
      }
    }

    // 👇 МАТЕМАТИКА КОМИССИИ 👇
    const commissionSum = grossSales * (commissionRate / 100);
    const netSales = grossSales - commissionSum;

    // Формируем блок текста о деньгах
    let moneyText = `💳 Оборот (Грязными): <b>${rub(grossSales)} ₽</b>\n`;
    if (commissionRate > 0) {
      moneyText += `📉 Комиссия (${commissionRate}%): <b>- ${rub(commissionSum)} ₽</b>\n`;
      moneyText += `💰 Чистый доход (к выплате): <b>${rub(netSales)} ₽</b>\n\n`;
    } else {
      moneyText += `<i>*Укажите % комиссии через команду /setkey чтобы видеть чистый доход</i>\n\n`;
    }

    const eventLines = Array.from(events.entries())
      .sort((a, b) => b[1].sales - a[1].sales)
      .slice(0, 10)
      .map(([name, stat]) =>
        `🔹 <b>${safe(name)}</b>\n   • Оборот: <b>${rub(stat.sales)} ₽</b>\n   • Заказов: <b>${stat.orders}</b>\n   • Билетов: <b>${stat.tickets}</b>`
      );

    const resultData = {
      text:
        `📊 <b>${titleFor(period, from, to)}</b>\n\n` +
        moneyText +
        `🛒 Успешных заказов: <b>${events.size > 0 ? Array.from(events.values()).reduce((acc, v) => acc + v.orders, 0) : 0}</b>\n` +
        `🎟 Билетов на руках: <b>${validTicketsCount}</b>\n\n` +
        (eventLines.length ? `<b>По мероприятиям:</b>\n${eventLines.join('\n\n')}` : 'За выбранный период продаж нет.'),
      reply_markup: {
        inline_keyboard: [
          [
            { text: period === 'today' ? '✅ Сегодня' : '📊 Сегодня', callback_data: 'stats_today' },
            { text: period === 'week' ? '✅ 7 дней' : '📅 7 дней', callback_data: 'stats_week' }
          ],
          [{ text: '🔄 Обновить', callback_data: period === 'week' ? 'stats_week' : 'stats_today' }]
        ]
      }
    };

    cache.set(cacheKey, { data: resultData, expiresAt: Date.now() + CACHE_TTL_MS });
    return resultData;
  }
};
