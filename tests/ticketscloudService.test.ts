import assert from 'node:assert/strict';
import test from 'node:test';
import { aggregateOrders, periodRange, ticketscloudService } from '../src/server/ticketscloudService.ts';

test('matches the dashboard week boundaries in Moscow time', () => {
  const range = periodRange('week', new Date('2026-08-27T07:27:00Z'));
  assert.equal(range.from.toISOString(), '2026-08-19T21:00:00.000Z');
  assert.equal(range.to.toISOString(), '2026-08-27T07:27:00.000Z');
});

test('matches Matyukhina dashboard with discounts and restored refunded tickets', () => {
  const makeOrders = (event: string, count: number, ticketCount: number, nominal: number, price = nominal) =>
    Array.from({ length: count }, (_, index) => ({
      id: `${event}-order-${index}`,
      status: 'done',
      done_at: '2026-09-01T10:00:00Z',
      event,
      values: { nominal: index === 0 ? nominal : 0, price: index === 0 ? price : 0 },
      tickets: index === 0
        ? Array.from({ length: ticketCount }, (_, ticketIndex) => ({
            id: `${event}-ticket-${ticketIndex}`,
            nominal: ticketIndex === 0 ? nominal : 0,
            price: ticketIndex === 0 ? price : 0
          }))
        : []
    }));

  const annushkaMoscow = makeOrders('annushka-moscow', 17, 60, 75_500, 135_500);
  const annushkaSpb = makeOrders('annushka-spb', 17, 51, 42_000, 102_000);
  const dolphin = makeOrders('dolphin-spb', 19, 30, 123_970);
  dolphin[0].tickets![0] = { id: 'dolphin-refund-present', nominal: 3_999, price: 3_999 };
  dolphin[0].tickets![1] = { id: 'dolphin-active', nominal: 119_971, price: 119_971 };
  annushkaSpb[0].tickets![0].id = 'annushka-refund-1';
  annushkaSpb[0].tickets![1].id = 'annushka-refund-2';

  const orders = [
    ...annushkaMoscow,
    ...dolphin,
    ...annushkaSpb,
    ...makeOrders('rasteryayev-spb', 17, 18, 90_000),
    ...makeOrders('avia', 8, 9, 23_000),
    ...makeOrders('rasteryayev-novgorod', 2, 3, 18_000),
    ...makeOrders('rasteryayev-crimea', 2, 3, 7_200),
    ...makeOrders('dolphin-yaroslavl', 1, 2, 5_000),
    ...makeOrders('dolphin-other', 1, 1, 3_500)
  ];
  const refs = {
    events: Object.fromEntries([
      ['annushka-moscow', 'annushka-meta-a'], ['annushka-spb', 'annushka-meta-b'],
      ['dolphin-spb', 'dolphin-meta-a'], ['rasteryayev-spb', 'rasteryayev-meta-a'],
      ['avia', 'avia-meta'], ['rasteryayev-novgorod', 'rasteryayev-meta-b'],
      ['rasteryayev-crimea', 'rasteryayev-meta-c'], ['dolphin-yaroslavl', 'dolphin-meta-b'],
      ['dolphin-other', 'dolphin-meta-c']
    ].map(([event, meta_event]) => [event, { title: event, meta_event }])),
    meta_events: {
      'annushka-meta-a': { title: 'аннушкаа. Презентация альбома' },
      'annushka-meta-b': { title: 'аннушкаа. Презентация альбома' }
    }
  };
  const refunds = [
    { id: 'refund-dolphin', status: 'approved', order: 'dolphin-spb-order-0', refund_nominal: 6_998, tickets: ['dolphin-refund-present', 'dolphin-refund-missing'] },
    { id: 'refund-annushka', status: 'approved', order: 'annushka-spb-order-0', refund_nominal: 8_000, tickets: ['annushka-refund-1', 'annushka-refund-2'] }
  ];
  const stats = aggregateOrders(orders, refs, refunds, {
    'dolphin-refund-missing': { id: 'dolphin-refund-missing', nominal: 2_999, price: 2_999 }
  });

  assert.equal(stats.sales, 391_169);
  assert.equal(stats.successfulOrders, 84);
  assert.equal(stats.ticketsSold, 178);
  assert.equal(stats.refunds, 14_998);
  assert.equal(stats.ticketsRefunded, 4);
  assert.equal(stats.events.get('annushka-meta-a')?.sales, 75_500);
  assert.equal(stats.events.get('annushka-meta-b')?.sales, 42_000);
  assert.equal(stats.events.get('dolphin-meta-a')?.tickets, 31);
});

test('does not count an order without done_at even when its status is done', () => {
  const stats = aggregateOrders([{
    id: 'unfinished-order',
    status: 'done',
    created_at: '2026-09-01T10:00:00Z',
    event: 'event-1',
    values: { nominal: 14_000 },
    tickets: Array.from({ length: 5 }, (_, index) => ({
      id: `unfinished-ticket-${index}`,
      nominal: index === 0 ? 14_000 : 0
    }))
  }]);

  assert.equal(stats.sales, 0);
  assert.equal(stats.successfulOrders, 0);
  assert.equal(stats.ticketsSold, 0);
});

test('uses orders endpoint, key authentication and every page', async () => {
  const requests: Array<{ url: URL; authorization: string | null }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input.toString());
    requests.push({ url, authorization: new Headers(init?.headers).get('Authorization') });
    const page = Number(url.searchParams.get('page'));
    if (url.pathname === '/v2/resources/refund_requests') {
      return new Response(JSON.stringify({ data: [], refs: { tickets: {} } }), {
        status: 200, headers: { 'Content-Type': 'application/json' }
      });
    }
    const now = new Date(Date.now() - 60_000).toISOString();
    const rows = page === 1
      // API может вернуть меньше запрошенного page_size и не прислать
      // надёжную pagination-секцию — всё равно проверяем следующую страницу.
      ? Array.from({ length: 20 }, (_, index) => ({
          id: `order-${index}`,
          status: 'done', event: `event-${index}`, done_at: now,
          values: { full: 100, price: 100, nominal: 90 }, tickets: [{ status: 'done', full: 100, price: 100, nominal: 90 }]
        }))
      : page === 2
        ? [{ id: 'last-order', status: 'done', event: 'last-event', done_at: now, values: { full: 50, nominal: 50 }, tickets: [] }]
        : [];
    return new Response(JSON.stringify({
      data: rows,
      refs: { events: { 'last-event': { title: 'Финальное событие' } } }
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;

  try {
    const result = await ticketscloudService.getStats(' organizer-key ', 'week');
    const orderRequests = requests.filter(request => request.url.pathname === '/v2/resources/orders');
    const refundRequests = requests.filter(request => request.url.pathname === '/v2/resources/refund_requests');
    assert.equal(orderRequests.length, 3);
    assert.equal(refundRequests.length, 1);
    assert.equal(orderRequests[0].url.searchParams.get('page_size'), '200');
    assert.equal(orderRequests[0].url.searchParams.has('with_refunded_tickets'), false);
    assert.ok(orderRequests[0].url.searchParams.has('created_at'));
    assert.equal(orderRequests[0].authorization, 'key organizer-key');
    assert.equal(refundRequests[0].url.searchParams.get('status'), 'approved');
    assert.ok(refundRequests[0].url.searchParams.has('finished_at'));
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
