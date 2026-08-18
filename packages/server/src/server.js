import { createServer as createHttpsServer } from 'node:https';
import { createServer as createHttpServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';

import { TUNNEL_PATH } from '@ws-tunnel/protocol';
import {
  MESSAGE_TYPES,
  createReadyMessage,
  createErrorMessage,
  createPingMessage,
  createHttpRequest,
  filterHeaders,
} from '@ws-tunnel/protocol';
import { createLogger } from '@ws-tunnel/protocol/logger.js';

import { ensureCertificate } from './acme.js';
import { resolvePublicIp } from './public-ip.js';
import { upsertARecord } from './cloudflare.js';
import { TunnelRegistry } from './registry.js';
import { authorizeToken, isSubdomainAllowed, safeEqual } from './auth.js';

const log = createLogger('server');

const MAX_BODY_SIZE = Number(process.env.MAX_BODY_SIZE || 1024 * 1024);
const MAX_WS_PAYLOAD = Number(process.env.MAX_WS_PAYLOAD || 16 * 1024 * 1024);
const PING_INTERVAL_MS = 30_000;
const PING_TIMEOUT_MS = 10_000;
const CERT_RENEW_CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12h
const SHUTDOWN_GRACE_MS = 5_000;
const STATUS_PATH = '/__tunnel/status';

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_SIZE) {
        reject(new Error('request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function readJsonMessage(data) {
  try {
    return JSON.parse(data.toString());
  } catch {
    return null;
  }
}

export async function startServer(config) {
  const startedAt = Date.now();

  // 1. Point the wildcard A record at this server (DNS-only).
  const publicIp = await resolvePublicIp(config);
  log.info(`ensuring wildcard A record *.${config.domain} -> ${publicIp}`);
  await upsertARecord({
    apiToken: config.cloudflare.apiToken,
    zoneId: config.cloudflare.zoneId,
    name: `*.${config.domain}`,
    content: publicIp,
    proxied: config.cloudflare.proxy,
  });

  // 2. Obtain (or reuse) the wildcard certificate.
  let activeCert = await ensureCertificate(config);

  const registry = new TunnelRegistry({ domain: config.domain });
  const pendingRequests = new Map(); // id -> pending state
  const aliveTimeouts = new Map(); // ws -> timeout
  const requestTimeoutMs = Number.isFinite(config.requestTimeoutMs)
    ? config.requestTimeoutMs
    : 30_000;
  const tunnelStats = new Map(); // hostname -> { requests, errors }
  const rateBuckets = new Map(); // key -> { windowStart, count }

  function bumpStats(hostname, key) {
    const stats = tunnelStats.get(hostname) || { requests: 0, errors: 0 };
    stats[key] += 1;
    tunnelStats.set(hostname, stats);
  }

  function isRateLimited(key) {
    if (!Number.isFinite(config.rateLimit?.max) || config.rateLimit.max <= 0) {
      return false;
    }
    const windowMs = config.rateLimit.windowMs || 60_000;
    const now = Date.now();
    const bucket = rateBuckets.get(key);
    if (!bucket || now - bucket.windowStart >= windowMs) {
      rateBuckets.set(key, { windowStart: now, count: 1 });
      return false;
    }
    bucket.count += 1;
    return bucket.count > config.rateLimit.max;
  }

  // 3. HTTPS server (terminates TLS for browsers) + WebSocket for tunnels.
  const httpsServer = createHttpsServer({ cert: activeCert.cert, key: activeCert.key });
  const wss = new WebSocketServer({
    server: httpsServer,
    path: TUNNEL_PATH,
    maxPayload: MAX_WS_PAYLOAD,
  });

  function clearPendingTimer(pending) {
    if (pending && pending.timer) {
      clearTimeout(pending.timer);
      pending.timer = null;
    }
  }

  function failPending(pending, error) {
    if (!pending) {
      return;
    }
    clearPendingTimer(pending);
    if (!pending.settled) {
      pending.settled = true;
      pending.reject(error);
    }
  }

  function rejectPendingForWs(ws) {
    for (const [id, pending] of pendingRequests) {
      if (pending.ws === ws) {
        pendingRequests.delete(id);
        failPending(pending, new Error('client disconnected'));
      }
    }
  }

  function clearAliveTimeout(ws) {
    const timeout = aliveTimeouts.get(ws);
    if (timeout) {
      clearTimeout(timeout);
      aliveTimeouts.delete(ws);
    }
  }

  function armAliveTimeout(ws) {
    clearAliveTimeout(ws);
    const timeout = setTimeout(() => {
      log.warn('client timed out (no pong)', ws.id);
      ws.terminate();
    }, PING_TIMEOUT_MS);
    aliveTimeouts.set(ws, timeout);
  }

  const pingTimer = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.readyState === WebSocket.OPEN && ws.registered) {
        ws.send(JSON.stringify(createPingMessage()));
        armAliveTimeout(ws);
      }
    }
  }, PING_INTERVAL_MS);

  function handleResponseMessage(ws, message) {
    const pending = pendingRequests.get(message.id);
    if (!pending || pending.ws !== ws) {
      return;
    }

    if (message.type === MESSAGE_TYPES.HTTP_RESPONSE) {
      // Single-shot response (legacy clients). Write it via the streaming
      // machinery so the browser still receives a complete HTTP response.
      clearPendingTimer(pending);
      pendingRequests.delete(message.id);
      pending.status = message.status || 200;
      pending.headers = message.headers || { 'Content-Type': 'text/plain' };
      if (message.body) {
        pending.writeChunk(message);
      }
      pending.end();
      if (!pending.settled) {
        pending.settled = true;
        pending.resolve(message);
      }
      return;
    }

    if (message.type === MESSAGE_TYPES.HTTP_RESPONSE_START) {
      pending.status = message.status || 200;
      pending.headers = message.headers || { 'Content-Type': 'text/plain' };
      return;
    }

    if (message.type === MESSAGE_TYPES.HTTP_RESPONSE_CHUNK) {
      if (pending.started) {
        pending.writeChunk(message);
      } else {
        pending.chunks.push(message);
      }
      return;
    }

    if (message.type === MESSAGE_TYPES.HTTP_RESPONSE_END) {
      clearPendingTimer(pending);
      pendingRequests.delete(message.id);
      pending.end();
      if (!pending.settled) {
        pending.settled = true;
        pending.resolve({ status: pending.status, headers: pending.headers });
      }
    }
  }

  wss.on('connection', (ws) => {
    ws.id = randomUUID();
    ws.registered = false;
    ws.host = null;
    ws.connectedAt = Date.now();

    log.info('new tunnel connection', ws.id);

    ws.on('message', (data) => {
      const message = readJsonMessage(data);
      if (!message) {
        sendError(ws, 'invalid JSON message');
        return;
      }

      if (!ws.registered) {
        handleRegistration(ws, message);
        return;
      }

      if (message.type === MESSAGE_TYPES.PONG) {
        clearAliveTimeout(ws);
        return;
      }

      if (
        message.type === MESSAGE_TYPES.HTTP_RESPONSE ||
        message.type === MESSAGE_TYPES.HTTP_RESPONSE_START ||
        message.type === MESSAGE_TYPES.HTTP_RESPONSE_CHUNK ||
        message.type === MESSAGE_TYPES.HTTP_RESPONSE_END
      ) {
        handleResponseMessage(ws, message);
        return;
      }

      if (message.type === MESSAGE_TYPES.PING) {
        ws.send(JSON.stringify({ type: MESSAGE_TYPES.PONG }));
        return;
      }

      log.debug(ws.id, 'unknown message type:', message.type);
    });

    ws.on('close', () => {
      log.info('tunnel connection closed', ws.id);
      clearAliveTimeout(ws);
      if (ws.host) {
        tunnelStats.delete(ws.host);
        rateBuckets.delete(ws.host);
      }
      registry.unregister(ws);
      rejectPendingForWs(ws);
    });

    ws.on('error', (error) => {
      log.warn('ws error', ws.id, error.message);
    });
  });

  function sendError(ws, message) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(createErrorMessage({ message })));
    }
  }

  function handleRegistration(ws, message) {
    if (message.type !== MESSAGE_TYPES.REGISTER) {
      sendError(ws, 'expected REGISTER message first');
      ws.close(4002, 'registration required');
      return;
    }

    const rule = authorizeToken(config, message.token);
    if (!rule) {
      sendError(ws, 'invalid auth token (does not match server authToken/authTokens)');
      ws.close(4003, 'authentication failed');
      return;
    }

    const subdomain = message.subdomain || null;
    if (!isSubdomainAllowed(rule, subdomain)) {
      sendError(ws, `subdomain not allowed for this token: ${subdomain || '<apex>'}`);
      ws.close(4004, 'subdomain not allowed');
      return;
    }

    const hostname = registry.register(ws, subdomain);

    ws.registered = true;
    ws.host = hostname;
    ws.subdomain = subdomain;

    log.info('tunnel registered', ws.id, '->', hostname);
    ws.send(JSON.stringify(createReadyMessage({ host: hostname })));
  }

  function handleStatusRequest(res) {
    const tunnels = registry.list().map((entry) => ({
      ...entry,
      stats: tunnelStats.get(entry.hostname) || { requests: 0, errors: 0 },
    }));

    const payload = {
      uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
      tunnels,
      activeTunnels: tunnels.length,
      pendingRequests: pendingRequests.size,
      version: process.env.npm_package_version || '0.1.0',
    };

    const body = JSON.stringify(payload, null, 2);
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
    });
    res.end(body);
  }

  function createStreamingPending({ res, ws, hostname }) {
    const pending = {
      ws,
      hostname,
      started: false,
      settled: false,
      status: null,
      headers: null,
      chunks: [],
      timer: null,
      // Called by the single-shot path; not used by the streaming path.
      resolve() {},
      reject() {},
      writeChunk(message) {
        if (!this.started) {
          this.flushStart();
        }
        if (message.body) {
          res.write(Buffer.from(message.body, message.bodyEncoding || 'base64'));
        }
      },
      flushStart() {
        this.started = true;
        const status = this.status || 200;
        const headers = filterHeaders(this.headers || { 'Content-Type': 'text/plain' });
        res.writeHead(status, headers);
        // Flush any chunks that arrived before headers were written.
        for (const chunkMessage of this.chunks) {
          this.writeChunk(chunkMessage);
        }
        this.chunks = [];
      },
      end() {
        if (!this.started) {
          this.flushStart();
        }
        if (!res.writableEnded) {
          res.end();
        }
      },
    };
    return pending;
  }

  httpsServer.on('request', async (req, res) => {
    const requestStartedAt = Date.now();
    const hostHeader = req.headers.host || '';
    // Strip port (e.g. "app.example.com:443" or proxies may append :80)
    const hostname = hostHeader.split(':')[0].toLowerCase();

    // Status endpoint (admin-only, guarded by adminToken below). Denies access
    // whenever no admin token is configured, and compares in constant time.
    if (req.url === STATUS_PATH || req.url?.startsWith(`${STATUS_PATH}?`)) {
      const authHeader = req.headers.authorization || '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
      if (config.adminToken && token && safeEqual(token, config.adminToken)) {
        handleStatusRequest(res);
      } else {
        res.writeHead(401, { 'Content-Type': 'text/plain' });
        res.end('unauthorized');
      }
      return;
    }

    const ws = registry.getByHostname(hostname);

    if (!ws) {
      res.writeHead(503, { 'Content-Type': 'text/plain' });
      res.end('no tunnel available for host: ' + hostname);
      return;
    }

    if (isRateLimited(hostname)) {
      res.writeHead(429, { 'Content-Type': 'text/plain' });
      res.end('too many requests');
      return;
    }

    let body;
    try {
      body = await readRequestBody(req);
    } catch {
      res.writeHead(413, { 'Content-Type': 'text/plain' });
      res.end('request body too large');
      return;
    }

    const id = randomUUID();
    const httpRequest = createHttpRequest({
      id,
      method: req.method,
      url: req.url,
      headers: req.headers,
      body: body.length ? body.toString('base64') : null,
      bodyEncoding: 'base64',
    });

    // Streaming pending: writes chunks directly to res as they arrive.
    let pending = createStreamingPending({ res, ws, hostname });
    const donePromise = new Promise((resolve, reject) => {
      pending.resolve = resolve;
      pending.reject = reject;
    });
    pendingRequests.set(id, pending);

    pending.timer = setTimeout(() => {
      if (pendingRequests.get(id) !== pending) {
        return;
      }
      pendingRequests.delete(id);
      failPending(pending, new Error('request timed out'));
    }, requestTimeoutMs);

    ws.send(JSON.stringify(httpRequest), (error) => {
      if (error && pending) {
        pendingRequests.delete(id);
        failPending(pending, error);
      }
    });

    let statusCode = 500;
    try {
      await donePromise;
      // Status/headers are written by handleResponseMessage as soon as the
      // first response message arrives.
      statusCode = pending.status || 200;
      bumpStats(hostname, 'requests');
    } catch (error) {
      const isTimeout = /timed out/i.test(error.message || '');
      statusCode = isTimeout ? 504 : 502;
      if (!res.headersSent) {
        res.writeHead(statusCode, { 'Content-Type': 'text/plain' });
      }
      if (!res.writableEnded) {
        res.end('tunnel error: ' + error.message);
      }
      bumpStats(hostname, 'errors');
    }

    const durationMs = Date.now() - requestStartedAt;
    log.info(
      'access',
      `${hostname} ${req.method} ${req.url} -> ${statusCode} (${durationMs}ms)`,
    );
  });

  // 4. Plain HTTP server on port 80 -> redirect to HTTPS.
  const httpServer = createHttpServer((req, res) => {
    const hostHeader = req.headers.host || config.domain;
    const host = hostHeader.split(':')[0];
    res.writeHead(301, {
      Location: `https://${host}${req.url}`,
      'Content-Type': 'text/plain',
    });
    res.end('redirecting to https');
  });

  await new Promise((resolve, reject) => {
    httpsServer.once('error', reject);
    httpsServer.listen(config.httpsPort, resolve);
  });

  httpServer.on('error', (error) => log.warn('http redirect server error:', error.message));
  httpServer.listen(config.httpPort, () => {
    log.info('HTTP redirect listening on port', config.httpPort);
  });

  log.info('tunnel server listening on HTTPS port', config.httpsPort);
  log.info('base domain:', config.domain);
  log.info('WebSocket endpoint: wss://%s:%d%s', config.domain, config.httpsPort, TUNNEL_PATH);
  if (config.adminToken) {
    log.info(`status endpoint: https://${config.domain}${STATUS_PATH} (Authorization: Bearer <adminToken>)`);
  }

  // 5. Periodically check whether the certificate is close to expiry and
  //    hot-reload a freshly issued certificate into the running TLS server.
  const renewTimer = setInterval(async () => {
    try {
      const renewed = await ensureCertificate(config);
      if (renewed.expiresAt !== activeCert.expiresAt) {
        activeCert = renewed;
        httpsServer.setSecureContext({ cert: renewed.cert, key: renewed.key });
        log.info('renewed certificate hot-loaded into HTTPS server');
      }
    } catch (error) {
      log.warn('certificate renewal check failed:', error.message);
    }
  }, CERT_RENEW_CHECK_INTERVAL_MS);

  let closed = false;
  async function close(signal) {
    if (closed) {
      return;
    }
    closed = true;
    log.info(`shutting down${signal ? ` (${signal})` : ''}...`);

    clearInterval(pingTimer);
    clearInterval(renewTimer);

    for (const timeout of aliveTimeouts.values()) {
      clearTimeout(timeout);
    }
    for (const pending of pendingRequests.values()) {
      failPending(pending, new Error('server shutting down'));
    }

    for (const ws of wss.clients) {
      try {
        ws.close(1001, 'server shutting down');
      } catch {
        /* ignore */
      }
    }

    const forceTimer = setTimeout(() => {
      log.error('graceful shutdown timed out, forcing exit');
      process.exit(1);
    }, SHUTDOWN_GRACE_MS);
    forceTimer.unref();

    await new Promise((resolve) => wss.close(resolve));
    await new Promise((resolve) => httpsServer.close(resolve));
    await new Promise((resolve) => httpServer.close(resolve));

    clearTimeout(forceTimer);
    log.info('shutdown complete');
  }

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      close(signal).then(() => process.exit(0));
    });
  }

  return {
    httpsServer,
    httpServer,
    wss,
    registry,
    close,
  };
}