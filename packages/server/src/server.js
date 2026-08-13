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
} from '@ws-tunnel/protocol';

import { ensureCertificate } from './acme.js';
import { resolvePublicIp } from './public-ip.js';
import { upsertARecord } from './cloudflare.js';
import { TunnelRegistry } from './registry.js';

const MAX_BODY_SIZE = Number(process.env.MAX_BODY_SIZE || 1024 * 1024);
const PING_INTERVAL_MS = 30_000;
const PING_TIMEOUT_MS = 10_000;

function log(...args) {
  console.log('[server]', ...args);
}

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
  // 1. Point the wildcard A record at this server (DNS-only).
  const publicIp = await resolvePublicIp(config);
  log(`ensuring wildcard A record *.${config.domain} -> ${publicIp}`);
  await upsertARecord({
    apiToken: config.cloudflare.apiToken,
    zoneId: config.cloudflare.zoneId,
    name: `*.${config.domain}`,
    content: publicIp,
    proxied: config.cloudflare.proxy,
  });

  // 2. Obtain (or reuse) the wildcard certificate.
  const { cert, key } = await ensureCertificate(config);

  const registry = new TunnelRegistry({ domain: config.domain });
  const pendingRequests = new Map(); // id -> { resolve, reject, ws }
  const aliveTimeouts = new Map(); // ws -> timeout

  // 3. HTTPS server (terminates TLS for browsers) + WebSocket for tunnels.
  const httpsServer = createHttpsServer({ cert, key });
  const wss = new WebSocketServer({ server: httpsServer, path: TUNNEL_PATH });

  function rejectPendingForWs(ws) {
    for (const [id, pending] of pendingRequests) {
      if (pending.ws === ws) {
        pending.reject(new Error('client disconnected'));
        pendingRequests.delete(id);
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
      log('client timed out (no pong)', ws.id);
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

  wss.on('connection', (ws) => {
    ws.id = randomUUID();
    ws.registered = false;
    ws.host = null;

    log('new tunnel connection', ws.id);

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

      if (message.type === MESSAGE_TYPES.HTTP_RESPONSE) {
        const pending = pendingRequests.get(message.id);
        if (pending) {
          pendingRequests.delete(message.id);
          pending.resolve(message);
        }
        return;
      }

      if (message.type === MESSAGE_TYPES.PING) {
        ws.send(JSON.stringify({ type: MESSAGE_TYPES.PONG }));
        return;
      }

      log(ws.id, 'unknown message type:', message.type);
    });

    ws.on('close', () => {
      log('tunnel connection closed', ws.id);
      clearAliveTimeout(ws);
      registry.unregister(ws);
      rejectPendingForWs(ws);
    });

    ws.on('error', (error) => {
      log('ws error', ws.id, error.message);
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

    if (message.token !== config.authToken) {
      sendError(ws, 'invalid auth token');
      ws.close(4003, 'authentication failed');
      return;
    }

    const subdomain = message.subdomain || null;
    const hostname = registry.register(ws, subdomain);

    ws.registered = true;
    ws.host = hostname;
    ws.subdomain = subdomain;

    log('tunnel registered', ws.id, '->', hostname);
    ws.send(JSON.stringify(createReadyMessage({ host: hostname })));
  }

  httpsServer.on('request', async (req, res) => {
    const hostHeader = req.headers.host || '';
    // Strip port (e.g. "app.example.com:443" or proxies may append :80)
    const hostname = hostHeader.split(':')[0].toLowerCase();

    const ws = registry.getByHostname(hostname);

    if (!ws) {
      res.writeHead(503, { 'Content-Type': 'text/plain' });
      res.end('no tunnel available for host: ' + hostname);
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

    let pending;
    const responsePromise = new Promise((resolve, reject) => {
      pending = { resolve, reject, ws };
      pendingRequests.set(id, pending);
    });

    ws.send(JSON.stringify(httpRequest), (error) => {
      if (error && pending) {
        pendingRequests.delete(id);
        pending.reject(error);
      }
    });

    try {
      const httpResponse = await responsePromise;
      const status = httpResponse.status || 200;
      const responseBody = httpResponse.body
        ? Buffer.from(httpResponse.body, httpResponse.bodyEncoding || 'base64')
        : Buffer.alloc(0);

      res.writeHead(status, httpResponse.headers || { 'Content-Type': 'text/plain' });
      res.end(responseBody);
    } catch (error) {
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'text/plain' });
      }
      res.end('tunnel error: ' + error.message);
    }
  });

  // 4. Plain HTTP server on port 80 -> redirect to HTTPS.
  const httpServer = createHttpServer((req, res) => {
    const host = req.headers.host || config.domain;
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

  httpServer.on('error', (error) => log('http redirect server error:', error.message));
  httpServer.listen(config.httpPort, () => {
    log('HTTP redirect listening on port', config.httpPort);
  });

  log('tunnel server listening on HTTPS port', config.httpsPort);
  log('base domain:', config.domain);
  log('WebSocket endpoint: wss://%s:%d%s', config.domain, config.httpsPort, TUNNEL_PATH);

  return { httpsServer, httpServer, wss, registry, close() {
    clearInterval(pingTimer);
    for (const timeout of aliveTimeouts.values()) {
      clearTimeout(timeout);
    }
    wss.close();
    httpsServer.close();
    httpServer.close();
  } };
}