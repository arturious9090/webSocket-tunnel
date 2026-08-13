// Shared WebSocket message types used by both the tunnel server and client.

export const MESSAGE_TYPES = {
  REGISTER: 'REGISTER',
  READY: 'READY',
  ERROR: 'ERROR',
  PING: 'PING',
  PONG: 'PONG',
  HTTP_REQUEST: 'HTTP_REQUEST',
  HTTP_RESPONSE: 'HTTP_RESPONSE',
};

// Standard tunnel WebSocket path on the public server.
export const TUNNEL_PATH = '/tunnel';

// HTTP headers that should never be forwarded across the tunnel.
export const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

export function createRegisterMessage({ token, subdomain, host }) {
  return {
    type: MESSAGE_TYPES.REGISTER,
    token,
    subdomain,
    host,
  };
}

export function createReadyMessage({ host }) {
  return {
    type: MESSAGE_TYPES.READY,
    host,
  };
}

export function createErrorMessage({ message }) {
  return {
    type: MESSAGE_TYPES.ERROR,
    message,
  };
}

export function createPingMessage() {
  return { type: MESSAGE_TYPES.PING };
}

export function createPongMessage() {
  return { type: MESSAGE_TYPES.PONG };
}

export function createHttpRequest({ id, method, url, headers, body, bodyEncoding }) {
  return {
    type: MESSAGE_TYPES.HTTP_REQUEST,
    id,
    method,
    url,
    headers,
    body: body || null,
    bodyEncoding: bodyEncoding || 'utf8',
  };
}

export function createHttpResponse({ id, status, headers, body, bodyEncoding }) {
  return {
    type: MESSAGE_TYPES.HTTP_RESPONSE,
    id,
    status,
    headers,
    body: body || null,
    bodyEncoding: bodyEncoding || 'base64',
  };
}

export function filterHeaders(headers) {
  const result = {};
  for (const [key, value] of Object.entries(headers || {})) {
    if (!HOP_BY_HOP_HEADERS.has(String(key).toLowerCase())) {
      result[key] = value;
    }
  }
  return result;
}