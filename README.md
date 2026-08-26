<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Ticketscloud Statistics Bot

Telegram-бот получает статистику из Ticketscloud по ключу каждого организатора.

## Запуск

1. Скопируйте `.env.example` в `.env` и укажите только `TELEGRAM_BOT_TOKEN`.
2. Установите зависимости: `pnpm install` (или `npm install`).
3. Запустите: `pnpm dev` для разработки или `pnpm build && pnpm start` для продакшена.

Не записывайте ключ Ticketscloud в `.env`: организатор отправляет его боту в личном чате командой `/setkey ВАШ_КЛЮЧ` или через кнопку «Указать API-ключ». Ключ хранится только в памяти работающего процесса и не передаётся другим пользователям.

## Отчёт

Команда `/stats` запрашивает агрегированную аналитику по мероприятиям через `GET https://ticketscloud.com/v2/services/analytics/org/group_by/meta_events`. Период передаётся фильтром `done_at`, результаты сортируются по обороту (`sort=-value`), а все страницы загружаются с `page_size=20`. По умолчанию границы суток рассчитываются в часовом поясе `Europe/Moscow`; его можно изменить переменной `REPORT_TIME_ZONE`.

Для совпадения с личным кабинетом выбирайте тот же период завершения продаж (`done_at`) и тот же часовой пояс. API-ключ организатора должен иметь право доступа к Analytics API v2.
