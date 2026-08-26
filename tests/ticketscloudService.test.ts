import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeAnalyticsRow, ticketscloudService } from '../src/server/ticketscloudService.ts';

test('normalizes analytics response variants', () => {
  assert.deepEqual(normalizeAnalyticsRow(
    { meta_event: 'event-a', value: '1234.50', count: 12, orders_count: 4 },
    { meta_events: { 'event-a': { title: { text: 'Концерт' } } } }
  ), { title: 'Концерт', revenue: 1234.5, tickets: 12, orders: 4 });
});

test('uses analytics endpoint, done_at filter, auth and pagination', async () => {
  const requests: Array<{ url: URL; authorization: string | null }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input.toString());
    requests.push({ url, authorization: new Headers(init?.headers).get('Authorization') });
    const page = Number(url.searchParams.get('page'));
    const rows = page === 1
      ? Array.from({ length: 20 }, (_, index) => ({ meta_event: `event-${index}`, value: 100, count: 1 }))
      : [{ meta_event: 'last-event', value: 50, count: 2 }];
    return new Response(JSON.stringify({
      data: rows,
      pagination: { page, page_size: 20, total: 21 },
      refs: { meta_events: { 'last-event': { title: 'Финальное событие' } } }
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;

  try {
    const result = await ticketscloudService.getStats(' organizer-key ', 'week');
    assert.equal(requests.length, 2);
    assert.equal(requests[0].url.pathname, '/v2/services/analytics/org/group_by/meta_events');
    assert.equal(requests[0].url.searchParams.get('sort'), '-value');
    assert.equal(requests[0].url.searchParams.get('page_size'), '20');
    assert.match(requests[0].url.searchParams.get('done_at') || '', /^.+Z,.+Z$/);
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
