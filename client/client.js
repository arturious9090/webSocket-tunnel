import http from 'node:http';
import WebSocket from 'ws';

const WEB_SOCKET_URL = process.env.WEB_SOCKET_URL || 'ws://localhost:8080';
const LOCAL_HTTP_PORT = Number(process.env.LOCAL_HTTP_PORT || 8000);
const LOCAL_HTTP_HOST = process.env.LOCAL_HTTP_HOST || 'localhost';

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

function log(...args) {
  console.log(...args);
}

function filterHeaders(headers) {
  const result = {};
  for (const [key, value] of Object.entries(headers || {})) {
    if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
      result[key] = value;
    }
  }
  return result;
}

class WebSocketReconnectWrapper {
  constructor(address, protocols, options) {
    this.address = address;
    this.protocols = protocols;
    this.options = options;
    this._ws = undefined;
    this._activeListeners = { on: new Map(), once: new Map() };
    this._retryCount = 0;
    this._maxRetries = Number(process.env.MAX_RETRIES || 50);
    this._retryTime = Number(process.env.RETRY_TIME || 500);
    this._ready = this._createReadyPromise();
    this.connect();
  }

  _createReadyPromise() {
    let resolve;
    const promise = new Promise((r) => {
      resolve = r;
    });
    return { promise, resolve };
  }

  connect() {
    const ws = new WebSocket(this.address, this.protocols, this.options);
    this._ws = ws;

    // Re-attach active listeners to the new socket
    for (const [eventName, events] of this._activeListeners.on) {
      for (const handler of events) {
        ws.on(eventName, handler);
      }
    }
    for (const [eventName, events] of this._activeListeners.once) {
      for (const handler of events) {
        ws.once(eventName, handler);
      }
    }

    ws.once('open', () => {
      log('connected to', this.address);
      this._retryCount = 0;
      this._ready.resolve();
    });

    ws.once('close', (code, reason) => {
      log('connection closed', code, reason.toString());
      if (this._retryCount >= this._maxRetries) {
        log('max retries reached, giving up');
        this._ready.reject?.(new Error('connection error'));
        return;
      }
      this._retryCount += 1;
      // Create a fresh ready promise before reconnecting
      this._ready = this._createReadyPromise();
      setTimeout(() => this.connect(), this._retryTime);
    });

    ws.once('error', (error) => {
      if (error.name !== 'AggregateError') {
        log('ws error:', error.message);
      }
    });
  }

  async on(event, handler) {
    await this._ready.promise;
    if (!this._activeListeners.on.has(event)) {
      this._activeListeners.on.set(event, []);
    }
    this._activeListeners.on.get(event).push(handler);
    this._ws.on(event, handler);
  }

  async once(event, handler) {
    await this._ready.promise;
    if (!this._activeListeners.once.has(event)) {
      this._activeListeners.once.set(event, []);
    }
    this._activeListeners.once.get(event).push(handler);
    this._ws.once(event, handler);
  }

  async send(data) {
    await this._ready.promise;
    this._ws.send(data);
  }
}

function forwardRequestToLocal(httpRequest) {
  const { method, url, headers, body, bodyEncoding } = httpRequest;

  const requestBody = body
    ? Buffer.from(body, bodyEncoding || 'utf8')
    : null;

  const options = {
    host: LOCAL_HTTP_HOST,
    port: LOCAL_HTTP_PORT,
    path: url,
    method,
    headers: {
      ...filterHeaders(headers),
      ...(requestBody ? { 'content-length': requestBody.length } : {}),
    },
  };

  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const responseBody = Buffer.concat(chunks);
        resolve({
          type: 'HTTP_RESPONSE',
          id: httpRequest.id,
          status: res.statusCode,
          headers: filterHeaders(res.headers),
          body: responseBody.length ? responseBody.toString('base64') : null,
          bodyEncoding: 'base64',
        });
      });
    });

    req.on('error', (error) => {
      resolve({
        type: 'HTTP_RESPONSE',
        id: httpRequest.id,
        status: 502,
        headers: { 'Content-Type': 'text/plain' },
        body: Buffer.from('local request failed: ' + error.message).toString('base64'),
        bodyEncoding: 'base64',
      });
    });

    if (requestBody) {
      req.write(requestBody);
    }
    req.end();
  });
}

async function main() {
  const ws = new WebSocketReconnectWrapper(WEB_SOCKET_URL);

  ws.on('message', async (data) => {
    let message;
    try {
      message = JSON.parse(data.toString());
    } catch (error) {
      log('invalid JSON message');
      return;
    }

    if (message.type === 'HTTP_REQUEST') {
      log('received HTTP_REQUEST', message.id, message.method, message.url);
      const response = await forwardRequestToLocal(message);
      await ws.send(JSON.stringify(response));
    } else {
      log('unknown message:', data.toString());
    }
  });
}

main();