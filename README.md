<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Ticketscloud Statistics Bot

Telegram-бот получает статистику из Ticketscloud по ключу каждого организатора.

## Запуск

1. Скопируйте `.env.example` в `.env` и укажите `TELEGRAM_BOT_TOKEN`, `ENCRYPTION_SECRET` и `CACHE_KEY_SECRET`.
2. Установите зависимости: `pnpm install` (или `npm install`).
3. Запустите: `pnpm dev` для разработки или `pnpm build && pnpm start` для продакшена.

Не записывайте ключ Ticketscloud в `.env`: организатор отправляет его боту в личном чате командой `/setkey ВАШ_КЛЮЧ` или через кнопку «Указать API-ключ». В групповых чатах бот ключи не принимает.

## Отчёт

Команда `/stats` запрашивает все страницы заказов и одобренных возвратов. Продажи рассчитываются по фактически оплаченной стоимости билетов (`nominal`) без сервисного сбора (`extra`) и с восстановлением возвращённых билетов. Возвраты выводятся отдельно. Период определяется по `done_at` в часовом поясе `Europe/Moscow`; его можно изменить переменной `REPORT_TIME_ZONE`.

Поскольку Orders API фильтрует выдачу по `created_at`, бот загружает заказы с запасом в 90 дней и затем применяет точный период по `done_at`. Запас можно изменить переменной `ORDER_LOOKBACK_DAYS`.

## Docker и деплой на сервер Ticketscloud

`compose.yaml` запускает только один контейнер бота, без PostgreSQL. Порт по умолчанию доступен лишь локально на сервере: `127.0.0.1:3000`. Внешний доступ следует настраивать через внутренний reverse proxy, потому что административные API проекта пока не имеют отдельной авторизации.

Перед первым деплоем администратор сервера должен:

1. Установить Docker Engine, Docker Compose v2 и `rsync`.
2. Создать каталог `<DEPLOY_PATH>/shared` и файл `<DEPLOY_PATH>/shared/.env` с правами `600`.
3. Добавить в `.env` как минимум `TELEGRAM_BOT_TOKEN`, `ENCRYPTION_SECRET` и `CACHE_KEY_SECRET`.

В GitHub Environment с именем `production` необходимо создать переменные:

- `DEPLOY_HOST` — адрес сервера;
- `DEPLOY_PORT` — SSH-порт, обычно `22`;
- `DEPLOY_USER` — отдельный непривилегированный пользователь деплоя;
- `DEPLOY_PATH` — абсолютный путь, например `/opt/ticketscloud-stat-bot`.

И секреты:

- `DEPLOY_SSH_PRIVATE_KEY` — приватный SSH-ключ пользователя деплоя;
- `DEPLOY_KNOWN_HOSTS` — заранее проверенная строка `known_hosts` сервера.

Workflow `.github/workflows/deploy.yml` срабатывает после push в `main` или вручную. Он проверяет типы, тесты и сборку, загружает отдельный релиз на сервер, собирает Docker-образ, ждёт успешный healthcheck и при ошибке возвращает предыдущий образ.

Без PostgreSQL API-ключи организаторов и кэш хранятся только в памяти и теряются при перезапуске контейнера. Масштабирование сервиса выше одного контейнера в этой конфигурации запрещено из-за Telegram long polling.
