import { readFileSync } from 'node:fs';
import WebSocket from 'ws';
import {
  TUNNEL_PATH,
  MESSAGE_TYPES,
  createRegisterMessage,
  createPongMessage,
} from '@arturious/web-socket-tunnel-protocol';
import { createLogger } from '@arturious/web-socket-tunnel-protocol/logger.js';
import {
  createHttpResponse,
  createHttpResponseStart,
  createHttpResponseChunk,
  createHttpResponseEnd,
} from './local-forward.js';
import { createLocalForwarder } from './local-forward.js';

function buildServerUrl(server) {
  // Accept a bare host like "tunnel.example.com" and default to wss://
  if (!/^wss?:\/\//i.test(server)) {
    server = `wss://${server}`;
  }
  return ensureTunnelPath(server);
}

function ensureTunnelPath(urlString) {
  const url = new URL(urlString);
  if (!url.pathname || url.pathname === '/') {
    url.pathname = TUNNEL_PATH;
  }
  return url.toString();
}

export async function startTunnel(config) {
  const log = createLogger('client');

  const serverUrl = buildServerUrl(config.server);

  const wsOptions = {};
  if (config.insecure) {
    wsOptions.rejectUnauthorized = false;
  }
  if (config.ca) {
    wsOptions.ca = readFileSync(config.ca);
  }

  const forwarder = createLocalForwarder({
    host: config.localHost,
    port: config.localPort,
    log,
  });

  let retryCount = 0;
  let shouldReconnect = true;
  let currentWs = null;

  function computeDelay(attempt) {
    const min = Math.max(0, config.retryMinDelayMs || 500);
    const max = Math.max(min, config.retryMaxDelayMs || 30_000);
    const exponential = min * 2 ** (attempt - 1);
    const capped = Math.min(exponential, max);
    // Add ±20% jitter to avoid thundering herd on the server.
    const jitter = capped * 0.2 * (Math.random() * 2 - 1);
    return Math.round(capped + jitter);
  }

  function scheduleReconnect() {
    if (!shouldReconnect) {
      return;
    }
    if (retryCount >= config.maxRetries) {
      log('max retries reached, giving up');
      shouldReconnect = false;
      process.exitCode = 1;
      return;
    }
    retryCount += 1;
    const delay = computeDelay(retryCount);
    log(`reconnecting in ${delay}ms (attempt ${retryCount}/${config.maxRetries})`);
    setTimeout(connect, delay);
  }

  function sendJsonOverWs(ws, message) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  function handleHttpRequestStreaming(ws, message) {
    forwarder.forwardRequestToLocalStream(message, {
      onStart(status, headers) {
        sendJsonOverWs(ws, createHttpResponseStart({ id: message.id, status, headers }));
      },
      onChunk(chunk) {
        sendJsonOverWs(
          ws,
          createHttpResponseChunk({
            id: message.id,
            body: chunk.length ? chunk.toString('base64') : null,
            bodyEncoding: 'base64',
          }),
        );
      },
      onEnd() {
        sendJsonOverWs(ws, createHttpResponseEnd({ id: message.id }));
      },
      onError(error) {
        log('local streaming request failed:', error.message);
        sendJsonOverWs(ws, createHttpResponseStart({ id: message.id, status: 502, headers: { 'Content-Type': 'text/plain' } }));
        sendJsonOverWs(
          ws,
          createHttpResponseChunk({
            id: message.id,
            body: Buffer.from('local request failed: ' + error.message).toString('base64'),
            bodyEncoding: 'base64',
          }),
        );
        sendJsonOverWs(ws, createHttpResponseEnd({ id: message.id }));
      },
    });
  }

  async function connect() {
    log('connecting to', serverUrl);

    const ws = new WebSocket(serverUrl, wsOptions);
    currentWs = ws;

    ws.on('open', () => {
      log('connected, registering');
      retryCount = 0;
      ws.send(
        JSON.stringify(
          createRegisterMessage({
            token: config.token,
            subdomain: config.subdomain,
          }),
        ),
      );
    });

    ws.on('message', async (data) => {
      let message;
      try {
        message = JSON.parse(data.toString());
      } catch {
        log('invalid JSON message from server');
        return;
      }

      if (message.type === MESSAGE_TYPES.READY) {
        log('tunnel ready:', message.host);
        log(`public URL: https://${message.host}`);
        log(`forwarding to http://${config.localHost}:${config.localPort}`);
        return;
      }

      if (message.type === MESSAGE_TYPES.ERROR) {
        log('server error:', message.message);
        // Terminal errors (bad token, missing host) are not retryable.
        const terminal = /token|auth|invalid/i.test(message.message || '');
        if (terminal) {
          shouldReconnect = false;
          ws.close();
        }
        return;
      }

      if (message.type === MESSAGE_TYPES.PING) {
        ws.send(JSON.stringify(createPongMessage()));
        return;
      }

      if (message.type === MESSAGE_TYPES.HTTP_REQUEST) {
        log('received HTTP_REQUEST', message.id, message.method, message.url);
        handleHttpRequestStreaming(ws, message);
        return;
      }

      log('unknown message type:', message.type);
    });

    ws.on('close', (code, reason) => {
      log('disconnected', code, reason.toString());
      if (ws === currentWs) {
        scheduleReconnect();
      }
    });

    ws.on('error', (error) => {
      log('ws error:', error.message);
    });
  }

  connect();

  return {
    close() {
      shouldReconnect = false;
      if (currentWs) {
        currentWs.close();
      }
    },
  };
}