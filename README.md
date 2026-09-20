# Florify 🌷

AI-ассистент приёма заказов для цветочного магазина. Один статический HTML-файл (чистый JS, без сборки) на фронтенде + [Supabase](https://supabase.com) как бэкенд: все данные (заказы, клиенты, склад, списания) хранятся в Postgres и переживают обновление страницы.

Собран для демонстрации на защите курса.

## Экраны

- **Заказы** — вставьте сообщение клиента в поле сверху и нажмите «Распознать ИИ»: запрос уходит в Claude API (`api/parse-order.js`), который вытаскивает состав букета, бюджет, дату/время доставки, адрес, имя и телефон клиента, канал (WhatsApp/Instagram). Поля можно поправить руками перед созданием заказа. Ниже — канбан-доска (Новый → В сборке → Передан курьеру → Доставлен) с перетаскиванием карточек между колонками.
- **Клиенты** — таблица клиентов с количеством заказов, форма добавления нового клиента.
- **Склад** — остатки цветов, +/− для изменения количества, бейдж «мало» при остатке < 10 шт.
- **Списания** — форма списания (цветок, количество, причина), история списаний; при добавлении автоматически уменьшает остаток на складе.
- **Сводка** — 4 метрики, посчитанные из текущего состояния: заказов сегодня, выручка за неделю, списано за месяц, позиций с низким остатком.

## Технологии

Фронтенд — самодостаточный HTML-файл: чистый JavaScript (без фреймворков и сборки), CSS-переменные для темы, шрифты Manrope + Golos Text из Google Fonts, [supabase-js](https://supabase.com/docs/reference/javascript) с CDN. Бэкенд — Supabase (Postgres + автогенерируемый REST API) и две serverless-функции на Vercel: `api/config.js` отдаёт публичные ключи Supabase из переменных окружения (чтобы они не были прописаны в исходнике страницы), `api/parse-order.js` вызывает [Claude API](https://docs.claude.com/) (`@anthropic-ai/sdk`, модель `claude-haiku-4-5`, `temperature: 0`) для извлечения полей заказа из текста переписки.

## Настройка Claude API

1. Получить API-ключ на [console.anthropic.com](https://console.anthropic.com/settings/keys).
2. Добавить его в `.env.local` (см. `.env.example`) как `ANTHROPIC_API_KEY=sk-ant-...`.
3. На Vercel добавить ту же переменную в Project Settings → Environment Variables.

## Настройка Supabase

1. Создать проект на [supabase.com](https://supabase.com).
2. Открыть **SQL Editor** и выполнить целиком файл [`supabase/schema.sql`](supabase/schema.sql) — он создаёт таблицы `orders`, `clients`, `inventory`, `write_offs` и включает RLS-политики, разрешающие доступ anon-ключу (в приложении нет авторизации).
3. Скопировать `Project URL` и `anon`/`publishable` ключ из Project Settings → API.
4. Заполнить `.env.local` (см. `.env.example`):
   ```
   SUPABASE_URL=https://xxxxx.supabase.co
   SUPABASE_ANON_KEY=sb_publishable_xxxxx
   ```

## Запуск локально

Проект использует serverless-функцию (`api/config.js`), поэтому обычный `python -m http.server` / двойной клик по `index.html` больше не подойдут — нужен Vercel CLI, который поднимает и статику, и `/api`, и сам подхватывает `.env.local`:

```bash
npm i -g vercel
vercel dev
```

## Деплой на Vercel

1. Импортировать репозиторий на [vercel.com](https://vercel.com/new).
2. В Project Settings → Environment Variables добавить `SUPABASE_URL`, `SUPABASE_ANON_KEY` и `ANTHROPIC_API_KEY` (те же значения, что в `.env.local`) — `.env.local` в репозиторий не попадает и на проде не читается.
3. Deploy. Framework preset — Other, build command не нужен.

## Палитра

| Роль | Цвет |
| --- | --- |
| Тёмный бордовый (акцент/заголовки) | `#6D2E46` |
| Пыльная роза (вторичный текст) | `#A26769` |
| Кремовый фон | `#ECE2D0` |
| Янтарный акцент (кнопки) | `#F2A65A` |

## Примечание

Данные (заказы, клиенты, склад, списания) реально сохраняются в Supabase, а «Распознавание ИИ» — реальный вызов Claude API: поля, явно не упомянутые в тексте, модель возвращает как `null` и ничего не придумывает.
