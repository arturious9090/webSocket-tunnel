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
- Автоматический выпуск и продление сертификата (Let's Encrypt, ACME DNS-01).
- DNS-only режим: `*.example.com` → публичный IP сервера (без прокси Cloudflare).
- Аутентификация клиентов по общему токену.
- Автопереподключение клиента и keepalive (ping/pong) для отключения мёртвых
  соединений.
- Два отдельных пакета: `@ws-tunnel/server` (VPS) и `@ws-tunnel/client` (локально).

## Структура

```
packages/
├── protocol/     # общие типы сообщений и константы протокола
├── server/       # публичный туннельный сервер
└── client/       # локальный туннельный клиент
```

## Предварительные требования

- Домен, делегированный на Cloudflare (DNS-зона в Cloudflare).
- Cloudflare API-токен с правами `Zone → DNS → Edit` для вашей зоны.

## Установка

```bash
npm install
```

Корневой `package.json` использует npm workspaces, поэтому зависимости всех
пакетов ставятся одной командой.

## Настройка сервера (VPS)

1. Скопируйте пример конфига и заполните его:

   ```bash
   cp tunnel-server.config.example.json tunnel-server.config.json
   ```

   ```json
   {
     "cloudflare": {
       "apiToken": "YOUR_CLOUDFLARE_API_TOKEN",
       "zoneId": "YOUR_CLOUDFLARE_ZONE_ID",
       "proxy": false
     },
     "domain": "example.com",
     "acme": {
       "email": "admin@example.com",
       "production": true
     },
     "authToken": "YOUR_SHARED_SECRET_TOKEN",
     "httpsPort": 443,
     "httpPort": 80,
     "publicIp": null,
     "certsDir": "./certs"
   }
   ```

   Параметры:
   | Поле | Описание |
   |---|---|
   | `cloudflare.apiToken` | API-токен Cloudflare (`Zone:DNS:Edit`) |
   | `cloudflare.zoneId` | ID зоны в Cloudflare |
   | `cloudflare.proxy` | `false` = DNS-only (grey cloud), `true` = прокси через Cloudflare |
   | `domain` | Базовый домен (например `example.com`) |
   | `acme.email` | Email для регистрации в Let's Encrypt |
   | `acme.production` | `true` — боевой CA, `false` — staging (для тестов) |
   | `authToken` | Общий секрет для аутентификации клиентов |
   | `httpsPort` | Порт HTTPS (обычно 443) |
   | `httpPort` | Порт HTTP для редиректа на HTTPS (обычно 80) |
   | `publicIp` | Публичный IP сервера (если `null` — определяется автоматически) |
   | `certsDir` | Куда сохранять сертификаты |

2. Убедитесь, что порты 80 и 443 открыты и доступны.

3. Запустите сервер:

   ```bash
   npm run server
   # или
   node packages/server/bin/tunnel-server.js
   ```

   При запуске сервер:
   - определяет публичный IP;
   - создаёт/обновляет A-запись `*.example.com` → публичный IP (DNS-only);
   - выпускает (или переиспользует) wildcard-сертификат и запускает HTTPS.

## Настройка клиента (локальная машина)

1. Скопируйте пример конфига:

   ```bash
   cp tunnel-client.config.example.json tunnel-client.config.json
   ```

   ```json
   {
     "server": "tunnel.example.com",
     "token": "YOUR_SHARED_SECRET_TOKEN",
     "subdomain": "app",
     "localHost": "localhost",
     "port": 3000,
     "maxRetries": 50,
     "retryTime": 500
   }
   ```

   | Поле | Описание |
   |---|---|
   | `server` | Адрес сервера (домен или `wss://...`) |
   | `token` | Тот же секрет, что в `authToken` на сервере |
   | `subdomain` | Поддомен (`app` → `app.example.com`) |
   | `localHost` | Хост локального сервиса |
   | `port` | Порт локального сервиса |
   | `maxRetries` | Максимум попыток переподключения |
   | `retryTime` | Задержка между попытками (мс) |

2. Запустите клиента:

   ```bash
   node packages/client/bin/tunnel-client.js
   ```

   Либо задайте параметры флагами:

   ```bash
   node packages/client/bin/tunnel-client.js \
     --server tunnel.example.com \
     --token YOUR_SHARED_SECRET_TOKEN \
     --subdomain app \
     --port 3000
   ```

   После успешной регистрации `https://app.example.com` будет вести на
   `localhost:3000`.

## Переменные окружения

Сервер:

| Переменная | Описание |
|---|---|
| `CLOUDFLARE_API_TOKEN` | API-токен Cloudflare |
| `CLOUDFLARE_ZONE_ID` | ID зоны Cloudflare |
| `TUNNEL_DOMAIN` | Базовый домен |
| `ACME_EMAIL` | Email для Let's Encrypt |
| `TUNNEL_AUTH_TOKEN` | Секрет аутентификации клиентов |
| `ACME_PRODUCTION` | `true`/`false` — боевой или staging CA |
| `HTTPS_PORT` | Порт HTTPS (по умолчанию 443) |
| `HTTP_PORT` | Порт HTTP (по умолчанию 80) |
| `PUBLIC_IP` | Публичный IP сервера |
| `CERTS_DIR` | Директория сертификатов |
| `TUNNEL_CONFIG` | Путь к JSON-конфигу сервера |

Клиент:

| Переменная | Описание |
|---|---|
| `TUNNEL_SERVER` | Адрес сервера |
| `TUNNEL_AUTH_TOKEN` | Секрет аутентификации |
| `TUNNEL_SUBDOMAIN` | Поддомен |
| `LOCAL_HTTP_HOST` | Хост локального сервиса |
| `LOCAL_HTTP_PORT` | Порт локального сервиса |
| `MAX_RETRIES` | Максимум попыток переподключения |
| `RETRY_TIME` | Задержка между попытками (мс) |
| `TUNNEL_CONFIG` | Путь к JSON-конфигу клиента |

## Протокол WS

Клиент подключается к `wss://<server>/tunnel` и первым сообщением отправляет
`REGISTER`.

**REGISTER** (клиент → сервер):

```json
{
  "type": "REGISTER",
  "token": "YOUR_SHARED_SECRET_TOKEN",
  "subdomain": "app"
}
```

**READY** (сервер → клиент):

```json
{
  "type": "READY",
  "host": "app.example.com"
}
```

**ERROR** (сервер → клиент):

```json
{
  "type": "ERROR",
  "message": "invalid auth token"
}
```

**HTTP_REQUEST** (сервер → клиент):

```json
{
  "type": "HTTP_REQUEST",
  "id": "uuid",
  "method": "GET",
  "url": "/hello",
  "headers": { "content-type": "application/json" },
  "body": "base64-encoded",
  "bodyEncoding": "base64"
}
```

**HTTP_RESPONSE** (клиент → сервер):

```json
{
  "type": "HTTP_RESPONSE",
  "id": "uuid",
  "status": 200,
  "headers": { "content-type": "application/json" },
  "body": "base64-encoded",
  "bodyEncoding": "base64"
}
```

**PING / PONG** — keepalive.