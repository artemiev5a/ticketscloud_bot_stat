export type StatsPeriod = 'today' | 'week';

type TicketscloudOrder = {
  id?: string;
  event?: string;
  created_at?: string;
  done_at?: string;
  tickets?: Array<{
    full?: string | number;
    price?: string | number;
    nominal?: string | number;
    extra?: string | number;
    discount?: string | number;
  }>;
  values?: {
    full?: string | number;
    price?: string | number;
    nominal?: string | number;
    extra?: string | number;
    discount?: string | number;
  };
};

type TicketscloudOrdersResponse = {
  data?: TicketscloudOrder[];
  pagination?: {
    page?: number;
    page_size?: number;
    total?: number;
  };
  refs?: {
    events?: Record<
      string,
      {
        title?: {
          text?: string;
        } | string;
      }
    >;
  };
  reason?: string;
  message?: string;
  errors?: string[];
};

const TICKETSCLOUD_ORDERS_URL =
  `${(process.env.TICKETSCLOUD_API_BASE_URL || 'https://ticketscloud.com')
    .replace(/\/$/, '')}/v2/resources/orders`;

const PAGE_SIZE = 200;
const REPORT_TIMEZONE = process.env.REPORT_TIMEZONE || 'Europe/Moscow';
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function asNumber(value: unknown): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === 'string') {
    const normalized = value
      .replace(/\s/g, '')
      .replace(',', '.');

    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function money(value: number): string {
  return value.toLocaleString('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function escapeHtml(value: string): string {
  return value.replace(/[<>&]/g, '');
}

function getZonedDateParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);

  const values = Object.fromEntries(
    parts
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, Number(part.value)])
  );

  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second
  };
}

function zonedMidnightToUtc(
  year: number,
  month: number,
  day: number,
  timeZone: string
): Date {
  const guess = Date.UTC(year, month - 1, day, 0, 0, 0);
  let result = guess;

  for (let attempt = 0; attempt < 2; attempt++) {
    const parts = getZonedDateParts(new Date(result), timeZone);

    const representedAsUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second
    );

    result += guess - representedAsUtc;
  }

  return new Date(result);
}

function getPeriodRange(period: StatsPeriod, now = new Date()) {
  const today = getZonedDateParts(now, REPORT_TIMEZONE);
  const daysBack = period === 'week' ? 6 : 0;

  const startCalendarDate = new Date(
    Date.UTC(today.year, today.month - 1, today.day - daysBack)
  );

 
