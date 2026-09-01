import assert from 'node:assert/strict';
import test from 'node:test';
import { aggregateOrders, makeStatsCacheKey, parseApiDate, periodRange, selectOrdersForRange, ticketscloudService } from '../src/server/ticketscloudService.ts';

test('matches the dashboard week boundaries in Moscow time', () => {
  const range = periodRange('week', new Date('2026-08-27T07:27:00Z'));
  assert.equal(range.from.toISOString(), '2026-08-19T21:00:00.000Z');
  assert.equal(range.to.toISOString(), '2026-08-27T07:27:00.000Z');
});

test('parses timezone-less API completion dates as Moscow time', () => {
  assert.equal(parseApiDate('2026-08-31 22:30:00')?.toISOString(), '2026-08-31T19:30:00.000Z');
  assert.equal(parseApiDate('2026-09-01T00:30:00Z')?.toISOString(), '2026-09-01T00:30:00.000Z');
});

test('matches the live MNR dashboard by excluding pre-period local timestamps', () => {
  const makeOrders = (count: number, ticketCount: number, sales: number, done_at: string, prefix: string) =>
    Array.from({ length: count }, (_, index) => ({
      id: `${prefix}-${index}`,
      status: 'done',
      done_at,
      event: 'lumen',
      values: { nominal: index === 0 ? sales : 0 },
      tickets: index === 0
        ? Array.from({ length: ticketCount }, (_, ticketIndex) => ({
            id: `${prefix}-ticket-${ticketIndex}`,
            nominal: ticketIndex === 0 ? sales : 0
          }))
        : []
    }));
  const apiOrders = [
    ...makeOrders(144, 222, 700_800, '2026-08-25 10:00:00', 'dashboard'),
    ...makeOrders(2, 5, 14_000, '2026-08-24 23:00:00', 'before-period')
  ];
  const selected = selectOrdersForRange(
    apiOrders,
    new Date('2026-08-24T21:00:00Z'),
    new Date('2026-09-01T13:56:54Z')
  );
  const stats = aggregateOrders(selected);

  assert.equal(stats.sales, 700_800);
  assert.equal(stats.successfulOrders, 144);
  assert.equal(stats.ticketsSold, 222);
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
  assert.equal(stats.events.get('annushka-moscow')?.sales, 75_500);
  assert.equal(stats.events.get('annushka-spb')?.sales, 42_000);
  assert.equal(stats.events.get('dolphin-spb')?.tickets, 31);
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

test('does not count an order that has done_at but is no longer done', () => {
  const stats = aggregateOrders([{
    id: 'rolled-back-order',
    status: 'cancelled',
    done_at: '2026-09-01T10:00:00Z',
    event: 'event-1',
    values: { nominal: 14_000 },
    tickets: Array.from({ length: 5 }, (_, index) => ({
      id: `rolled-back-ticket-${index}`,
      nominal: index === 0 ? 14_000 : 0
    }))
  }]);

  assert.equal(stats.sales, 0);
  assert.equal(stats.successfulOrders, 0);
  assert.equal(stats.ticketsSold, 0);
});

test('uses authoritative order nominal and ignores non-approved refunds', () => {
  const stats = aggregateOrders([{
    id: 'discounted-order', status: 'done', done_at: '2026-09-01 12:00:00', event: 'event-1',
    values: { nominal: 900, price: 1_000, full: 1_100 },
    tickets: [{ id: 't1', nominal: 500 }, { id: 't2', nominal: 500 }]
  }], undefined, [
    { id: 'approved', status: 'approved', refund_nominal: 100, tickets: ['t1'] },
    { id: 'pending', status: 'in_progress', refund_nominal: 900, tickets: ['t2'] },
    { id: 'legacy-negative', status: 'approved', delta: -50, tickets: [] }
  ]);

  assert.equal(stats.sales, 900);
  assert.equal(stats.refunds, 150);
  assert.equal(stats.ticketsRefunded, 1);
});

test('distinguishes sessions with the same title by date, time and city', () => {
  const orders = [
    { id: 'order-1', status: 'done', done_at: '2026-09-01T10:00:00Z', event: 'lumen-nsk', tickets: [{ nominal: 1_000 }] },
    { id: 'order-2', status: 'done', done_at: '2026-09-01T10:00:00Z', event: 'lumen-kzn', tickets: [{ nominal: 2_000 }] }
  ];
  const refs = {
    events: {
      'lumen-nsk': { title: { text: 'LUMEN' }, lifetime: { start: '2026-10-18 12:00:00' }, timezone: 'UTC', venue: 'venue-nsk' },
      'lumen-kzn': { title: { text: 'LUMEN' }, lifetime: { start: '2026-11-09 17:00:00' }, venue: 'venue-kzn' }
    },
    venues: {
      'venue-nsk': { city: { name: { ru: 'Новосибирск' }, timezone: 'Asia/Novosibirsk' } },
      'venue-kzn': { city: { name: { ru: 'Казань' } } }
    }
  };

  const stats = aggregateOrders(orders, refs);
  assert.equal(stats.events.size, 2);
  assert.equal(stats.events.get('lumen-nsk')?.title, 'LUMEN — 18.10.2026, 19:00, Новосибирск');
  assert.equal(stats.events.get('lumen-kzn')?.title, 'LUMEN — 09.11.2026, 20:00, Казань');
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
    // Живой Orders API обрезал выборку до одной страницы (200 записей),
    // когда ему передавали status=done. Загружаем все статусы и безопасно
    // фильтруем их после полной пагинации.
    assert.equal(orderRequests[0].url.searchParams.has('status'), false);
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

test('reports incomplete pagination instead of silently showing wrong totals', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(input.toString());
    if (url.pathname === '/v2/resources/refund_requests') {
      return new Response(JSON.stringify({ data: [], pagination: { total: 0 } }), {
        status: 200, headers: { 'Content-Type': 'application/json' }
      });
    }
    return new Response(JSON.stringify({
      data: [{ id: 'same-order', status: 'done', done_at: '2026-09-01 12:00:00', tickets: [] }],
      pagination: { total: 2 }
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;

  try {
    const result = await ticketscloudService.getStats('incomplete-pagination-key', 'today', true);
    assert.match(result.text, /повторил страницу 2/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('retries a timed out Orders page and identifies the resource', async () => {
  const originalFetch = globalThis.fetch;
  let orderAttempts = 0;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(input.toString());
    if (url.pathname === '/v2/resources/refund_requests') {
      return new Response(JSON.stringify({ data: [], pagination: { total: 0 } }), {
        status: 200, headers: { 'Content-Type': 'application/json' }
      });
    }
    orderAttempts += 1;
    if (orderAttempts === 1) {
      const error = new Error('The operation was aborted due to timeout');
      error.name = 'TimeoutError';
      throw error;
    }
    return new Response(JSON.stringify({ data: [], pagination: { total: 0 } }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });
  }) as typeof fetch;

  try {
    const result = await ticketscloudService.getStats('retry-timeout-key', 'today', true);
    assert.equal(orderAttempts, 2);
    assert.match(result.text, /За выбранный период продаж нет/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('does not stop on an unreliable page-local pagination total', async () => {
  const originalFetch = globalThis.fetch;
  let orderRequests = 0;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(input.toString());
    if (url.pathname === '/v2/resources/refund_requests') {
      return new Response(JSON.stringify({ data: [], pagination: { total: 0 } }), {
        status: 200, headers: { 'Content-Type': 'application/json' }
      });
    }
    orderRequests += 1;
    const page = Number(url.searchParams.get('page'));
    const now = new Date(Date.now() - 60_000).toISOString();
    const rows = page <= 2
      ? [{ id: `order-page-${page}`, status: 'done', done_at: now, values: { nominal: 100 }, tickets: [] }]
      : [];
    return new Response(JSON.stringify({
      data: rows,
      // Ticketscloud может сообщить размер фрагмента вместо общего total.
      pagination: { total: 1 }
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;

  try {
    const result = await ticketscloudService.getStats('known-total-key', 'today', true);
    assert.equal(orderRequests, 3);
    assert.match(result.text, /200,00 ₽/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('loads all 668 live-style orders without the broken server-side status filter', async () => {
  const originalFetch = globalThis.fetch;
  const orderPages: number[] = [];
  const now = new Date(Date.now() - 60_000).toISOString();
  const orders = Array.from({ length: 668 }, (_, index) => ({
    id: `large-order-${index}`,
    status: 'done',
    done_at: now,
    values: { nominal: 100 },
    tickets: [{ id: `large-ticket-${index}`, nominal: 100 }]
  }));

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(input.toString());
    if (url.pathname === '/v2/resources/refund_requests') {
      const refundPage = Number(url.searchParams.get('page'));
      return new Response(JSON.stringify({
        data: refundPage === 1
          ? [{ id: 'large-refund', status: 'approved', refund_nominal: 2_500, tickets: ['refund-ticket'] }]
          : [],
        refs: { tickets: {} },
        pagination: { total: 1 }
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    const page = Number(url.searchParams.get('page'));
    orderPages.push(page);
    // Воспроизводит живой дефект Ticketscloud: status=done ошибочно
    // ограничивал результат одной страницей и total=200.
    const hasBrokenFilter = url.searchParams.has('status');
    const rows = hasBrokenFilter
      ? orders.slice(0, 200)
      // Живой API запросил 200, но фактически отдавал короткие фрагменты
      // и на каждой странице сообщал page-local total=64.
      : orders.slice((page - 1) * 64, page * 64);
    return new Response(JSON.stringify({
      data: rows,
      pagination: { total: hasBrokenFilter ? 200 : 64 }
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;

  try {
    const result = await ticketscloudService.getStats('live-668-key', 'today', true);
    assert.deepEqual(orderPages, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    assert.match(result.text, /66\s800,00 ₽/);
    assert.match(result.text, /Успешных заказов: <b>668<\/b>/);
    assert.match(result.text, /Билетов: <b>668<\/b>/);
    assert.match(result.text, /2\s500,00 ₽<\/b> \(1 бил\.\)/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('serves only aggregate cache with timestamp and falls back after refresh failure', async () => {
  const originalFetch = globalThis.fetch;
  let orderRequests = 0;
  let refundRequests = 0;
  let failRefunds = false;
  const now = new Date(Date.now() - 60_000).toISOString();
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(input.toString());
    if (url.pathname === '/v2/resources/refund_requests') {
      refundRequests += 1;
      if (failRefunds) {
        return new Response(JSON.stringify({ reason: 'forbidden' }), {
          status: 403, headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response(JSON.stringify({ data: [], pagination: { total: 0 } }), {
        status: 200, headers: { 'Content-Type': 'application/json' }
      });
    }
    orderRequests += 1;
    const page = Number(url.searchParams.get('page'));
    return new Response(JSON.stringify({
      data: page === 1
        ? [{ id: 'cache-order', status: 'done', done_at: now, values: { nominal: 123 }, tickets: [] }]
        : [],
      pagination: { total: 1 }
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;

  try {
    const first = await ticketscloudService.getStats('aggregate-cache-secret', 'today', true);
    assert.match(first.text, /123,00 ₽/);
    assert.match(first.text, /Проверено:/);
    assert.equal(orderRequests, 2);
    assert.equal(refundRequests, 1);

    const second = await ticketscloudService.getStats('aggregate-cache-secret', 'today');
    assert.match(second.text, /123,00 ₽/);
    assert.equal(orderRequests, 2, 'fresh aggregate cache must avoid Orders API');
    assert.equal(refundRequests, 1, 'fresh aggregate cache must avoid Refunds API');

    const current = ticketscloudService.getCachedStats('aggregate-cache-secret', 'today');
    assert.ok(current?.isFresh);
    const stale = ticketscloudService.getCachedStats(
      'aggregate-cache-secret', 'today', false, current!.verifiedAt + 121_000
    );
    assert.equal(stale?.isFresh, false);
    assert.match(stale!.data.text, /Обновляю данные/);

    failRefunds = true;
    const fallback = await ticketscloudService.getStats('aggregate-cache-secret', 'today', true);
    assert.match(fallback.text, /123,00 ₽/);
    assert.match(fallback.text, /Не удалось обновить/);
    assert.doesNotMatch(fallback.text, /Не удалось получить статистику/);
    await ticketscloudService.getStats('aggregate-cache-secret', 'today', true);
    assert.equal(refundRequests, 3, 'failed refresh must not extend cache freshness');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('uses a deterministic HMAC cache key without exposing the API key', () => {
  const secret = 'ticketscloud-sensitive-api-key';
  const from = new Date('2026-08-31T21:00:00.000Z');
  const first = makeStatsCacheKey(secret, 'today', from);
  const second = makeStatsCacheKey(secret, 'today', from);
  assert.equal(first, second);
  assert.equal(first.includes(secret), false);
  assert.notEqual(first, makeStatsCacheKey(`${secret}-other`, 'today', from));
  assert.notEqual(first, makeStatsCacheKey(secret, 'week', from));
});

test('does not call API without organizer key', async () => {
  const result = await ticketscloudService.getStats('');
  assert.match(result.text, /API-ключ не указан/);
});
