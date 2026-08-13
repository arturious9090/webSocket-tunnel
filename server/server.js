import { WebSocket, WebSocketServer } from 'ws';
import { createServer } from 'node:http';
import { v4 as uuidv4 } from 'uuid';

const WEB_SERVER_PORT = Number(process.env.WEB_SERVER_PORT || 8081);
const WEB_SOCKET_PORT = Number(process.env.WEB_SOCKET_PORT || 8080);
const MAX_BODY_SIZE = Number(process.env.MAX_BODY_SIZE || 1024 * 1024); // 1 MB by default

const availableHosts = (process.env.AVAILABLE_HOSTS || 'examplee-domain.com,example-domain.com')
  .split(',')
  .map((host) => host.trim())
  .filter(Boolean);

function log(...args) {
  console.log(...args);
}

function createHttpRequest({ id, method, url, headers, body, bodyEncoding }) {
  return {
    type: 'HTTP_REQUEST',
    id,
    method,
    url,
    headers,
    body: body || null,
    bodyEncoding: bodyEncoding || 'utf8',
  };
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

    req.on('end', () => {
      resolve(Buffer.concat(chunks));
    });

    req.on('error', reject);
  });
}

function main() {
  const wss = new WebSocketServer({ port: WEB_SOCKET_PORT });
  const server = createServer();
  const clients = new Map(); // ws.id -> ws
  const clientsHosts = new Map(); // host -> ws.id
  const pendingRequests = new Map(); // request id -> { resolve, reject, ws }

  function rejectPendingForWs(ws) {
    for (const [id, pending] of pendingRequests) {
      if (pending.ws === ws) {
        pending.reject(new Error('client disconnected'));
        pendingRequests.delete(id);
      }
    }
  }

  wss.on('connection', (ws) => {
    const clientId = uuidv4();
    ws.id = clientId;
    clients.set(ws.id, ws);

    const host = availableHosts.pop();
    if (host) {
      clientsHosts.set(host, ws.id);
      ws.host = host;
      log('new ws connection', clientId, '->', host);
    } else {
      ws.host = null;
      log('new ws connection', clientId, '(no host available)');
    }

    ws.on('message', (data) => {
      let message;
      try {
        message = JSON.parse(data.toString());
      } catch (error) {
        log(ws.id, ': invalid JSON message');
        return;
      }

      if (message.type === 'HTTP_RESPONSE') {
        const pending = pendingRequests.get(message.id);
        if (pending) {
          pendingRequests.delete(message.id);
          pending.resolve(message);
        }
      } else {
        log(ws.id, ':', data.toString());
      }
    });

    ws.on('close', () => {
      log('connection', ws.id, 'closed');
      if (ws.host) {
        clientsHosts.delete(ws.host);
        availableHosts.push(ws.host);
      }
      clients.delete(ws.id);
      rejectPendingForWs(ws);
    });

    ws.on('error', (error) => {
      log('ws error', ws.id, error);
    });
  });

  server.on('request', async (req, res) => {
    const host = req.headers.host;
    const wsId = clientsHosts.get(host);
    const ws = wsId ? clients.get(wsId) : null;

    if (!(ws instanceof WebSocket)) {
      res.writeHead(503, { 'Content-Type': 'text/plain' });
      res.end('no tunnel available for host');
      return;
    }

    let body;
    try {
      body = await readRequestBody(req);
    } catch (error) {
      res.writeHead(413, { 'Content-Type': 'text/plain' });
      res.end('request body too large');
      return;
    }

    const id = uuidv4();
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

  server.listen(WEB_SERVER_PORT, () => {
    log('HTTP server listening on port', WEB_SERVER_PORT);
    log('WebSocket server listening on port', WEB_SOCKET_PORT);
    log('Available hosts:', availableHosts.join(', ') || '(none)');
  });
}

main();