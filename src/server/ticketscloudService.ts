type TicketscloudOrder = {
  id?: string;
  event?: string;
  tickets?: Array<{ full?: string | number; price?: string | number }>;
  values?: { full?: string | number; price?: string | number };
};

type TicketscloudOrdersResponse = {
  data?: TicketscloudOrder[];
  pagination?: { page?: number; page_size?: number; total?: number };
  refs?: { events?: Record<string, { title?: { text?: string } | string }> };
  reason?: string;
  message?: string;
};

const TICKETSCLOUD_ORDERS_URL = `${(process.env.TICKETSCLOUD_API_BASE_URL || 'https://api.ticketscloud.org').replace(/\/$/, '')}/v2/resources/orders`;const PAGE_SIZE = 200;

function startOfUtcDay(date = new Date()): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function asNumber(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function eventTitle(order: TicketscloudOrder, refs: TicketscloudOrdersResponse['refs']): string {
  const title = order.event ? refs?.events?.[order.event]?.title : undefined;
  if (typeof title === 'string') return title;
  return title?.text || (order.event ? `Мероприятие ${order.event}` : 'Мероприятие без названия');
}

function money(value: number): string {
  return value.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export const ticketscloudService = {
  /**
   * Returns sales completed during the current UTC day by default. Ticketscloud
   * expects `Authorization: key <API_KEY>` and returns orders in pages.
   */
  async getStats(apiKey?: string, range?: { from: Date; to: Date }): Promise<{ text: string; reply_markup?: any }> {
    if (!apiKey?.trim()) {
      return {
        text: '⚠️ <b>API-ключ не указан!</b>\n\nПривяжите ваш Ticketscloud API Key к этому чату для получения статистики.',
        reply_markup: { inline_keyboard: [[{ text: '🔑 Указать API-ключ', callback_data: 'prompt_set_key' }]] }
      };
    }

    const from = range?.from || startOfUtcDay();
    const to = range?.to || new Date(from.getTime() + 24 * 60 * 60 * 1000);
    if (Number.isNaN(from.valueOf()) || Number.isNaN(to.valueOf()) || to <= from) {
      throw new Error('Некорректный интервал статистики');
    }

    const orders: TicketscloudOrder[] = [];
    const refs: NonNullable<TicketscloudOrdersResponse['refs']> = { events: {} };
    let page = 1;
    let pageCount = 1;

    try {
      do {
        const query = new URLSearchParams({
          // `done` is the completed (paid) order status; cancelled and pending
          // reservations must not be included in a sales total.
          status: 'done',
          created_at: `${from.toISOString()},${to.toISOString()}`,
          page: String(page),
          page_size: String(PAGE_SIZE)
        });
        const response = await fetch(`${TICKETSCLOUD_ORDERS_URL}?${query}`, {
          headers: { Authorization: `key ${apiKey.trim()}`, Accept: 'application/json' },
          signal: AbortSignal.timeout(20_000)
        });
        const body = await response.json().catch(() => ({})) as TicketscloudOrdersResponse;
        if (!response.ok) {
          const detail = body.reason || body.message || `HTTP ${response.status}`;
          throw new Error(detail);
        }

        orders.push(...(Array.isArray(body.data) ? body.data : []));
        Object.assign(refs.events!, body.refs?.events || {});
        const total = body.pagination?.total ?? orders.length;
        const returnedPageSize = body.pagination?.page_size || PAGE_SIZE;
        pageCount = Math.max(1, Math.ceil(total / returnedPageSize));
        page += 1;
      } while (page <= pageCount);
    } catch (error: any) {
      return {
        text: `⚠️ <b>Не удалось получить статистику Ticketscloud</b>\n\n` +
          `API вернул: <code>${String(error.message || error).replace(/[<&>]/g, '')}</code>\n\n` +
          'Проверьте API-ключ и права на чтение заказов. Ключ передаётся только в заголовке Authorization.',
        reply_markup: { inline_keyboard: [[{ text: '🔑 Ввести другой API-ключ', callback_data: 'prompt_set_key' }], [{ text: '🔄 Повторить', callback_data: 'refresh_stats' }]] }
      };
    }

    const byEvent = new Map<string, { tickets: number; revenue: number }>();
    let totalTickets = 0;
    let totalRevenue = 0;
    for (const order of orders) {
      const tickets = Array.isArray(order.tickets) ? order.tickets : [];
      const ticketCount = tickets.length;
      // `values.full` is the documented full order amount. Use ticket sums only
      // for older responses that omit order-level values.
      const revenue = order.values?.full === undefined
        ? tickets.reduce((sum, ticket) => sum + asNumber(ticket.full ?? ticket.price), 0)
        : asNumber(order.values.full);
      totalTickets += ticketCount;
      totalRevenue += revenue;
      const title = eventTitle(order, refs);
      const event = byEvent.get(title) || { tickets: 0, revenue: 0 };
      event.tickets += ticketCount;
      event.revenue += revenue;
      byEvent.set(title, event);
    }

    const interval = `${from.toISOString().slice(0, 10)} 00:00 — ${to.toISOString().slice(0, 10)} 00:00 UTC`;
    const eventLines = Array.from(byEvent.entries())
      .sort((a, b) => b[1].revenue - a[1].revenue)
      .slice(0, 10)
      .map(([title, stats]) => `🔹 <b>${title.replace(/[<&>]/g, '')}</b>\n   • Билетов: <b>${stats.tickets}</b>\n   • Сумма: <b>${money(stats.revenue)} ₽</b>`);

    return {
      text: `📊 <b>СТАТИСТИКА TICKETSCLOUD</b>\n` +
        `Период: <code>${interval}</code>\n\n` +
        `🎟 Проданных билетов: <b>${totalTickets}</b>\n` +
        `💰 Сумма завершённых заказов: <b>${money(totalRevenue)} ₽</b>\n` +
        `🎪 Мероприятий с продажами: <b>${byEvent.size}</b>\n\n` +
        (eventLines.length ? `<b>По мероприятиям:</b>\n${eventLines.join('\n')}` : 'За этот период завершённых заказов нет.'),
      reply_markup: { inline_keyboard: [[{ text: '🔄 Обновить данные', callback_data: 'refresh_stats' }]] }
    };
  }
};
