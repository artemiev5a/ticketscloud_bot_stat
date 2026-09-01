# Ticketscloud analytics reconciliation

## Verified live contract

Live verification on 2026-09-01 used the same organizer API key and the same
dashboard periods. No customer data, API keys, order IDs, or ticket IDs are
stored in this repository.

| Period | Dashboard | Raw API, `done_at` as UTC | Raw API, `done_at` as Moscow local |
| --- | ---: | ---: | ---: |
| Today | 56,700 / 12 orders / 19 tickets | 59,400 / 13 / 20 | **56,700 / 12 / 19** |
| Week | 700,800 / 144 orders / 222 tickets | 714,800 / 146 / 227 | **700,800 / 144 / 222** |

The raw response contained 1,171 orders: 165 `done`, 256 `cancelled`, 749
`expired`, and 1 `executed`. Every completed order had a timezone-less
`done_at`. For this analytics report, `done_at` is a Moscow wall-clock value.

Event timestamps use a different contract: timezone-less `lifetime.start` is
UTC and must be converted to the venue city timezone. Example: a raw 12:00
event start is displayed as 19:00 in Novosibirsk.

## Metric policy (`dashboard-sales-v1`)

- Include only orders whose current status is `done`.
- Assign a sale to a period by `done_at`, interpreted in the report timezone.
- Sales are gross nominal ticket value, excluding `extra`/service fees.
- Prefer `order.values.nominal`; if refund refs restore a ticket removed from
  the order, reconstruct the original gross amount from ticket nominals.
- Count all tickets belonging to an included completed order. Tickets are
  commonly returned with status `reserved` even for a completed order.
- Refunds are separate from gross sales: include only `approved` requests by
  `finished_at`, use the absolute `refund_nominal`, and count unique ticket IDs.
- Group by concrete event/session ID. Display title, local event time, and city.

## Regression oracles

- MNR/LUMEN live period: 700,800 / 144 / 222 for Week and 56,700 / 12 / 19
  for Today at the recorded snapshot.
- Matyukhina fixture: discounts and restored refunded tickets produce 391,169
  sales / 84 orders / 178 tickets / 14,998 refunds / 4 refunded tickets.

## Remaining product limitations

1. The report timezone is currently configured globally as `Europe/Moscow`.
   A multi-timezone product needs timezone configuration per organizer/key.
2. Orders API filters by `created_at`, not `done_at`; the current 90-day
   lookback cannot prove completeness for an order completed after a longer
   delay. A durable ledger or analytics-enabled endpoint is required.
3. Orders and refunds are not an atomic server-side snapshot. The bot now
   detects incomplete pagination, but rapidly changing pages can still require
   a retry/watermark strategy.
4. At least one additional non-Moscow organizer must be captured as a sanitized
   golden fixture before claiming universal timezone support.
5. API keys are currently kept only in process memory; persistence and admin
   route authentication require a separate security hardening pass.

## Release gate

Do not change timestamp, status, money, or refund semantics without:

1. a sanitized raw API fixture;
2. dashboard totals for exactly the same range and snapshot;
3. a per-order reconciliation showing the IDs/reasons behind any delta;
4. a regression test for the discovered case.
