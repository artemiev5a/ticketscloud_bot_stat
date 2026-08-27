import assert from 'node:assert/strict';
import test from 'node:test';
import { aggregateOrders, periodRange, ticketscloudService } from '../src/server/ticketscloudService.ts';

test('matches the dashboard week boundaries in Moscow time', () => {
  const range = periodRange('week', new Date('2026-08-27T07:27:00Z'));
  assert.equal(range.from.toISOString(), '2026-08-19T21:00:00.000Z');
  assert.equal(range.to.toISOString(), '2026-08-27T07:27:00.000Z');
});

test('uses full sales value and separates successful orders from refunds', () => {
  const stats = aggregateOrders([
    {
      status: 'done', event: 'event-a', values: { full: 659600, price: 644100, extra: 62210 },
      tickets: Array.from({ length: 207 }, () => ({ status: 'done', full: 1000 }))
    },
    {
      status: 'partially_refunded', event: 'event-a', values: { full: 0 },
      tickets: [
        { status: 'refunded', full: 6000 },
        { status: 'returned', full: 6000 },
        { status: 'canceled', full: 6000 }
      ]
    },
    {
      status: 'refunded', event: 'event-a', values: { full: 15500 },
      tickets: []
    }
  ], { events: { 'event-a': { title: 'LUMEN' } } });

  assert.equal(stats.sales, 659600);
  assert.equal(stats.serviceFees, 62210);
  assert.equal(stats.successfulOrders, 2);
  assert.equal(stats.ticketsSold, 210);
  assert.equal(stats.refunds, 33500);
  assert.equal(stats.ticketsRefunded, 3);
  assert.equal(stats.events.get('LUMEN')?.sales, 659600);
});

test('uses orders endpoint, key authentication and every page', async () => {
  const requests: Array<{ url: URL; authorization: string | null }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input.toString());
    requests.push({ url, authorization: new Headers(init?.headers).get('Authorization') });
    const page = Number(url.searchParams.get('page'));
    const now = new Date(Date.now() - 60_000).toISOString();
    const rows = page === 1
      // API может вернуть меньше запрошенного page_size и не прислать
      // надёжную pagination-секцию — всё равно проверяем следующую страницу.
      ? Array.from({ length: 20 }, (_, index) => ({
          id: `order-${index}`,
          status: 'done', event: `event-${index}`, done_at: now,
          values: { full: 100, price: 90 }, tickets: [{ status: 'done', full: 100 }]
        }))
      : page === 2
        ? [{ id: 'last-order', status: 'done', event: 'last-event', done_at: now, values: { full: 50 }, tickets: [] }]
        : [];
    return new Response(JSON.stringify({
      data: rows,
      refs: { events: { 'last-event': { title: 'Финальное событие' } } }
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;

  try {
    const result = await ticketscloudService.getStats(' organizer-key ', 'week');
    assert.equal(requests.length, 3);
    assert.equal(requests[0].url.pathname, '/v2/resources/orders');
    assert.equal(requests[0].url.searchParams.get('page_size'), '200');
    assert.ok(requests[0].url.searchParams.has('created_at'));
    assert.equal(requests[0].authorization, 'key organizer-key');
    assert.match(result.text, /2\s050,00 ₽/);
    assert.doesNotMatch(result.text, /Комиссия|Доход к выплате/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('does not call API without organizer key', async () => {
  const result = await ticketscloudService.getStats('');
  assert.match(result.text, /API-ключ не указан/);
});
