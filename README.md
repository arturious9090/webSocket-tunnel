# WebSocket Tunnel

Проброс HTTP-трафика с публичного сервера к локальной машине через WebSocket —
аналог Cloudflare Tunnel. Сервер сам выпускает wildcard-сертификат Let's Encrypt
через DNS-01 challenge (Cloudflare API), поэтому любой поддомен
(`app.example.com`) сразу доступен по HTTPS.

```
Браузер/curl
     │ HTTPS (на *.example.com)
     ▼
server (HTTPS :443, TLS + маршрутизация по Host)
     │ WebSocket (wss://example.com/tunnel, token auth)
     ▼
client (локальная машина) ──HTTP──▶ localhost:PORT
```

## Возможности

- Один wildcard-сертификат `*.example.com` — новые поддомены подключаются без
  выпуска отдельных сертификатов.
- Автоматический выпуск и продление сертификата (Let's Encrypt, ACME DNS-01)
  с горячей заменой без рестарта.
- DNS-only режим: `*.example.com` → публичный IP сервера (без прокси Cloudflare).
- Аутентификация клиентов: общий токен или отдельные per-client токены с
  ограничением поддоменов.
- Автопереподключение с экспоненциальным backoff и keepalive (ping/pong).
- Стриминг ответов (SSE и длинные ответы) без полной буферизации.
- Access-логи, статус-эндпоинт и per-tunnel счётчики запросов/ошибок.
- CLI с `--help`, `--version` и интерактивным мастером `init`.
- Docker-образы и systemd-юниты.

## Структура

```
packages/
├── protocol/     # общие типы сообщений, константы протокола, логгер
├── server/       # публичный туннельный сервер
└── client/       # локальный туннельный клиент
examples/         # демо локального HTTP-сервиса
deploy/systemd/   # примеры systemd-юнитов
```

## Предварительные требования

- Домен, делегированный на Cloudflare (DNS-зона в Cloudflare).
- Cloudflare API-токен с правами `Zone → DNS → Edit` для вашей зоны.
- Node.js ≥ 18.

## Установка

### Вариант 1 — из исходников (клон репозитория)

```bash
# 1. склонировать репозиторий
git clone https://github.com/arturious9090/webSocket-tunnel.git
cd webSocket-tunnel

# 2. установить зависимости всех пакетов (npm workspaces)
npm install

# 3. запустить
npm run server   # сервер (VPS)
npm run client   # клиент (локальная машина)

# или напрямую
node packages/server/bin/tunnel-server.js
node packages/client/bin/tunnel-client.js
```

### Вариант 2 — через npm (готовые пакеты)

```bash
npm install -g @arturious/web-socket-tunnel-server @arturious/web-socket-tunnel-client
# или локально в проект
npm install @arturious/web-socket-tunnel-client
```

После установки доступны команды `tunnel-server` и `tunnel-client`.

## Быстрый старт

### 1. Настройка сервера (VPS)

```bash
npm run server -- init
```

Мастер задаст вопросы и сгенерирует `tunnel-server.config.json` со случайным
`authToken`. Либо скопируйте и заполните пример:

```bash
cp tunnel-server.config.example.json tunnel-server.config.json
```

Запуск:

```bash
npm run server
# или
node packages/server/bin/tunnel-server.js
```

Параметры конфига сервера:

| Поле | Описание |
|---|---|
| `cloudflare.apiToken` | API-токен Cloudflare (`Zone:DNS:Edit`) |
| `cloudflare.zoneId` | ID зоны в Cloudflare |
| `cloudflare.proxy` | `false` = DNS-only (grey cloud), `true` = прокси через Cloudflare |
| `domain` | Базовый домен (например `example.com`) |
| `acme.email` | Email для регистрации в Let's Encrypt |
| `acme.production` | `true` — боевой CA, `false` — staging (для тестов) |
| `acme.challengeWaitMs` | Пауза (мс) перед валидацией DNS-01, чтобы TXT-запись успела распространиться |
| `authToken` | Общий секрет для аутентификации клиентов |
| `adminToken` | Токен для статус-эндпоинта (fallback: `authToken`) |
| `authTokens` | Per-client токены: `{ "token": { "subdomains": ["app"] } }` |
| `rateLimit.windowMs` | Окно rate-limit (мс) |
| `rateLimit.max` | Максимум запросов на окно (0 = выключено) |
| `httpsPort` | Порт HTTPS (обычно 443) |
| `httpPort` | Порт HTTP для редиректа на HTTPS (обычно 80) |
| `publicIp` | Публичный IP сервера (если `null` — определяется автоматически) |
| `certsDir` | Куда сохранять сертификаты |
| `requestTimeoutMs` | Таймаут ожидания ответа от клиента |

### 2. Настройка клиента (локальная машина)

```bash
npm run client -- init
```

Или создайте конфиг вручную:

```json
{
  "server": "tunnel.example.com",
  "token": "YOUR_SHARED_SECRET_TOKEN",
  "subdomain": "app",
  "localHost": "localhost",
  "port": 3000,
  "maxRetries": 50,
  "retryMinDelayMs": 500,
  "retryMaxDelayMs": 30000,
  "insecure": false,
  "ca": null
}
```

Запуск:

```bash
npm run client
# или с флагами
node packages/client/bin/tunnel-client.js \
  --server tunnel.example.com \
  --token YOUR_SHARED_SECRET_TOKEN \
  --subdomain app \
  --port 3000
# короткий сахар
node packages/client/bin/tunnel-client.js 3000
```

После успешной регистрации `https://app.example.com` ведёт на `localhost:3000`.

## CLI

### Сервер

```bash
tunnel-server init              # интерактивная настройка
tunnel-server --config <path>   # запуск с конфигом
tunnel-server --help            # справка
tunnel-server --version         # версия
```

### Клиент

```bash
tunnel-client init              # интерактивная настройка
tunnel-client [port]            # проброс localhost:[port]
tunnel-client --help
tunnel-client --version
```

## Переменные окружения

### Сервер

| Переменная | Описание |
|---|---|
| `CLOUDFLARE_API_TOKEN` | API-токен Cloudflare |
| `CLOUDFLARE_ZONE_ID` | ID зоны Cloudflare |
| `TUNNEL_DOMAIN` | Базовый домен |
| `ACME_EMAIL` | Email для Let's Encrypt |
| `TUNNEL_AUTH_TOKEN` | Секрет аутентификации клиентов |
| `TUNNEL_ADMIN_TOKEN` | Токен для статус-эндпоинта |
| `ACME_PRODUCTION` | `true`/`false` — боевой или staging CA |
| `CLOUDFLARE_PROXY` | `true`/`false` — проксировать DNS |
| `HTTPS_PORT` | Порт HTTPS (по умолчанию 443) |
| `HTTP_PORT` | Порт HTTP (по умолчанию 80) |
| `PUBLIC_IP` | Публичный IP сервера |
| `CERTS_DIR` | Директория сертификатов |
| `REQUEST_TIMEOUT_MS` | Таймаут запроса к клиенту |
| `MAX_WS_PAYLOAD` | Максимальный размер WS-сообщения от клиента (байт, по умолчанию 16777216) |
| `ACME_CHALLENGE_WAIT_MS` | Пауза перед валидацией DNS-01 (мс) |
| `RATE_LIMIT_WINDOW_MS` | Окно rate-limit |
| `RATE_LIMIT_MAX` | Максимум запросов на окно |
| `LOG_LEVEL` | `debug`/`info`/`warn`/`error` |
| `TUNNEL_CONFIG` | Путь к JSON-конфигу сервера |

### Клиент

| Переменная | Описание |
|---|---|
| `TUNNEL_SERVER` | Адрес сервера |
| `TUNNEL_AUTH_TOKEN` | Секрет аутентификации |
| `TUNNEL_SUBDOMAIN` | Поддомен |
| `LOCAL_HTTP_HOST` | Хост локального сервиса |
| `LOCAL_HTTP_PORT` | Порт локального сервиса |
| `MAX_RETRIES` | Максимум попыток переподключения |
| `RETRY_MIN_DELAY` | Минимальная задержка переподключения (мс) |
| `RETRY_MAX_DELAY` | Максимальная задержка переподключения (мс) |
| `TUNNEL_INSECURE` | `true` — не проверять TLS-сертификат сервера (только для тестов) |
| `TUNNEL_CA` | Путь к CA-сертификату для проверки сервера |
| `LOG_LEVEL` | `debug`/`info`/`warn`/`error` |
| `TUNNEL_CONFIG` | Путь к JSON-конфигу клиента |

## Статус и наблюдаемость

Сервер отдаёт статус на `https://<domain>/__tunnel/status` (требует заголовок
`Authorization: Bearer <adminToken>`):

```json
{
  "uptimeSec": 123,
  "tunnels": [
    {
      "hostname": "app.example.com",
      "subdomain": "app",
      "id": "uuid",
      "connectedAt": 1730000000000,
      "stats": { "requests": 10, "errors": 1 }
    }
  ],
  "activeTunnels": 1,
  "pendingRequests": 0
}
```

## Протокол WS

Клиент подключается к `wss://<server>/tunnel` и первым сообщением отправляет
`REGISTER`.

**REGISTER** (клиент → сервер):

```json
{ "type": "REGISTER", "token": "YOUR_SHARED_SECRET_TOKEN", "subdomain": "app" }
```

**READY** (сервер → клиент):

```json
{ "type": "READY", "host": "app.example.com" }
```

**ERROR** (сервер → клиент):

```json
{ "type": "ERROR", "message": "invalid auth token" }
```

**HTTP_REQUEST** (сервер → клиент):

```json
{ "type": "HTTP_REQUEST", "id": "uuid", "method": "GET", "url": "/hello", "headers": {}, "body": "base64", "bodyEncoding": "base64" }
```

Ответ клиента может быть:

- одним сообщением `HTTP_RESPONSE`, либо
- потоком `HTTP_RESPONSE_START` → `HTTP_RESPONSE_CHUNK`* → `HTTP_RESPONSE_END`
  (стриминг, SSE, длинные ответы).

**PING / PONG** — keepalive.

## Docker

Сервер:

```bash
cp .env.example .env   # задайте CLOUDFLARE_API_TOKEN, TUNNEL_DOMAIN и пр.
docker compose up -d --build
```

Клиентская часть запускается отдельно на локальной машине (через npm или
`node packages/client/bin/tunnel-client.js`).

## systemd

Скопируйте примеры в `/etc/systemd/system`, создайте env-файлы и включите:

```bash
cp deploy/systemd/tunnel-server.service.example /etc/systemd/system/tunnel-server.service
mkdir -p /etc/ws-tunnel
cp .env.example /etc/ws-tunnel/tunnel-server.env
systemctl daemon-reload
systemctl enable --now tunnel-server
```

## Тесты

```bash
npm test
```
