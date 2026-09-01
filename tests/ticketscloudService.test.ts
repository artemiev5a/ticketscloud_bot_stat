import assert from 'node:assert/strict';
import test from 'node:test';
import { aggregateOrders, periodRange, ticketscloudService } from '../src/server/ticketscloudService.ts';

test('matches the dashboard week boundaries in Moscow time', () => {
  const range = periodRange('week', new Date('2026-08-27T07:27:00Z'));
  assert.equal(range.from.toISOString(), '2026-08-19T21:00:00.000Z');
  assert.equal(range.to.toISOString(), '2026-08-27T07:27:00.000Z');
});

test('matches dashboard sales, ticket count and distinct same-title events', () => {
  const successful = Array.from({ length: 82 }, (_, index) => ({
    id: `done-${index}`,
    status: 'done',
    event: index === 81 ? 'event-b' : 'event-a',
    values: index === 0
      ? { full: 406585.9, price: 382669, extra: 23916.9 }
      : { full: 0, price: 0, extra: 0 },
    tickets: index === 0 ? Array.from({ length: 175 }, () => ({ status: 'done', price: 1000 })) : []
  }));
  const stats = aggregateOrders([
    ...successful,
    { id: 'refunded-1', status: 'refunded', event: 'event-b', values: { price: 0 }, tickets: [{ status: 'refunded', price: 14998 }] }
  ], {
    events: {
      'event-a': { title: 'Одинаковое название', meta_event: 'meta-a' },
      'event-b': { title: 'Одинаковое название', meta_event: 'meta-b' }
    },
    meta_events: {
      'meta-a': { title: 'Одинаковое название' },
      'meta-b': { title: 'Одинаковое название' }
    }
  });

  assert.equal(stats.sales, 382669);
  assert.equal(stats.successfulOrders, 82);
  assert.equal(stats.ticketsSold, 176);
  assert.equal(stats.refunds, 14998);
  assert.equal(stats.ticketsRefunded, 1);
  assert.equal(stats.events.size, 2);
  assert.equal(stats.events.get('meta-a')?.title, 'Одинаковое название');
  assert.equal(stats.events.get('meta-b')?.title, 'Одинаковое название');
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
    assert.match(result.text, /1\s850,00 ₽/);
    assert.doesNotMatch(result.text, /Сервисный сбор/);
    assert.doesNotMatch(result.text, /Комиссия|Доход к выплате/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('does not call API without organizer key', async () => {
  const result = await ticketscloudService.getStats('');
  assert.match(result.text, /API-ключ не указан/);
});
