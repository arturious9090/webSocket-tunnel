import WebSocket from 'ws';
import { TUNNEL_PATH, MESSAGE_TYPES, createRegisterMessage, createPongMessage } from '@ws-tunnel/protocol';
import { createLocalForwarder } from './local-forward.js';

function buildServerUrl(server) {
  if (/^wss?:\/\//i.test(server)) {
    return server;
  }
  // Accept a bare host like "tunnel.example.com" and default to wss://
  return `wss://${server}${TUNNEL_PATH}`;
}

function ensureTunnelPath(urlString) {
  const url = new URL(urlString);
  if (!url.pathname || url.pathname === '/') {
    url.pathname = TUNNEL_PATH;
  }
  return url.toString();
}

export async function startTunnel(config) {
  const log = (...args) => console.log('[client]', ...args);

  const base = buildServerUrl(config.server);
  const serverUrl = ensureTunnelPath(base);

  const forwarder = createLocalForwarder({
    host: config.localHost,
    port: config.localPort,
    log,
  });

  let retryCount = 0;
  let shouldReconnect = true;
  let currentWs = null;

  function scheduleReconnect() {
    if (!shouldReconnect) {
      return;
    }
    if (retryCount >= config.maxRetries) {
      log('max retries reached, giving up');
      return;
    }
    retryCount += 1;
    const delay = config.retryTime;
    log(`reconnecting in ${delay}ms (attempt ${retryCount}/${config.maxRetries})`);
    setTimeout(connect, delay);
  }

  async function connect() {
    log('connecting to', serverUrl);

    const ws = new WebSocket(serverUrl);
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
        const response = await forwarder.forwardRequestToLocal(message);
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(response));
        }
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