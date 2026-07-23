# AILUU.CLO Store

Одностраничный магазин мусульманской женской одежды с PostgreSQL, учётом остатков, оформлением заказов и полной административной панелью через Telegram-бота.

## Архитектура

- **Frontend:** статическая адаптивная витрина без внешнего JavaScript-фреймворка.
- **API:** Node.js + Fastify.
- **Database:** PostgreSQL 16.
- **Telegram:** Telegraf, webhook или long polling.
- **Images:** постоянный Docker volume `uploads_data`.
- **Deployment:** Docker Compose + Nginx + HTTPS.

## Production-функции

- товары, настройки, заказы и остатки находятся в PostgreSQL;
- SQL-миграции выполняются последовательно и защищены advisory lock;
- заказ создаётся в транзакции, цены берутся только из базы;
- суммарный остаток проверяется даже при нескольких вариантах одного товара;
- повтор одинакового запроса не создаёт второй заказ и не списывает остаток дважды;
- Telegram-сессии переживают перезапуск приложения;
- Telegram updates обрабатываются идемпотентно;
- доступ к боту разрешён только ID администраторов;
- webhook защищён секретным заголовком Telegram;
- security headers, CSP, rate limiting и строгая валидация входных данных;
- `/health` проверяет процесс, `/ready` дополнительно проверяет PostgreSQL;
- непривилегированный пользователь внутри контейнера, read-only filesystem;
- резервное копирование PostgreSQL и загруженных фотографий;
- CI проверяет синтаксис, тесты, миграции, seed и полный smoke test заказа.

## Управление через Telegram

Команды:

- `/start` или `/menu` — главное меню;
- `/add` — пошагово добавить товар;
- `/products` — редактировать товары;
- `/orders` — просматривать заказы и менять статусы;
- `/settings` — менять тексты и контакты сайта;
- `/cancel` — отменить текущее действие.

Через бот можно менять название, текущую и старую цену, категорию, описание, размеры по росту, до 10 фотографий, остаток, порядок сортировки, видимость и отметку «Новинка».

## Первый запуск

### 1. Подготовить настройки

```bash
cp .env.example .env
nano .env
```

Обязательно заменить:

```env
POSTGRES_PASSWORD=СЛОЖНЫЙ_ПАРОЛЬ
DATABASE_URL=postgresql://ailuu:URL_ENCODED_PASSWORD@postgres:5432/ailuu
PUBLIC_BASE_URL=https://shop.example.kg
```

Для Telegram:

```env
TELEGRAM_BOT_TOKEN=токен_от_BotFather
TELEGRAM_ADMIN_IDS=123456789
ORDER_NOTIFICATION_CHAT_ID=123456789
TELEGRAM_MODE=webhook
TELEGRAM_WEBHOOK_SECRET=случайная_строка_не_короче_32_символов
```

Пока домен и HTTPS не готовы, можно использовать:

```env
TELEGRAM_MODE=polling
```

`TELEGRAM_ADMIN_IDS` поддерживает несколько ID через запятую.

### 2. Запустить

```bash
docker compose up -d --build
```

Проверка:

```bash
docker compose ps
curl http://127.0.0.1:3000/ready
docker compose logs -f app
```

При первом старте автоматически применяются миграции и один раз загружается стартовый каталог. Seed отмечается в базе и не возвращает демо-товары после их последующего удаления.

## Домен и HTTPS

1. Скопировать `nginx/ailuu.conf` в конфигурацию Nginx.
2. Заменить `shop.example.kg` на реальный домен.
3. Получить TLS-сертификат.
4. Проверить, что приложение доступно только на `127.0.0.1:3000`.
5. Установить `TRUST_PROXY=true` и `PUBLIC_BASE_URL=https://реальный-домен`.

После этого включить `TELEGRAM_MODE=webhook` и перезапустить приложение:

```bash
docker compose up -d --build app
```

## Миграции и seed вручную

```bash
docker compose exec app node scripts/migrate.js
docker compose exec app node scripts/seed.js
```

Уже применённый SQL-файл изменять нельзя. Для следующего изменения базы создайте новый файл в `migrations/`.

## Резервное копирование

Одноразовая резервная копия:

```bash
docker compose --profile backup run --rm backup
```

Будут сохранены два файла в `./backups`:

- `ailuu-db-*.sql.gz` — PostgreSQL;
- `ailuu-uploads-*.tar.gz` — фотографии.

Для ежедневного запуска добавьте эту команду в root cron или systemd timer. Скрипт удаляет локальные копии старше 30 дней. Для production храните вторую зашифрованную копию на отдельном хранилище.

Восстановление выполняется только на остановленном или подготовленном окружении:

```bash
DATABASE_URL='postgresql://...' UPLOADS_DIR='./data/uploads' \
  ./scripts/restore.sh backups/ailuu-db-DATE.sql.gz backups/ailuu-uploads-DATE.tar.gz
```

## Обновление

```bash
git pull
docker compose build --pull app
docker compose up -d app
docker compose logs --tail=100 app
curl http://127.0.0.1:3000/ready
```

Перед обновлением сначала создайте резервную копию.

## Локальный запуск без Docker

Нужны Node.js 20.10+ и PostgreSQL.

```bash
npm ci
cp .env.example .env
npm run migrate
npm run seed
npm start
```

Зависимости зафиксированы в `package-lock.json`; для воспроизводимых установок используйте только `npm ci`.

## Проверки

```bash
npm run check
npm test
npm run migrate
npm run seed
node scripts/smoke-test.js
```

## Важные ограничения

- текущая конфигурация рассчитана на один сервер с постоянным Docker volume для фотографий;
- для нескольких серверов фотографии нужно перенести в S3-совместимое объектное хранилище;
- не публикуйте PostgreSQL port наружу;
- не храните `.env`, токены, резервные копии и реальные данные покупателей в GitHub;
- Telegram webhook требует публичный HTTPS URL;
- перед реальными продажами заполните юридическую информацию, условия доставки, возврата и обработки персональных данных.
