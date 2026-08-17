import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MESSAGE_TYPES,
  TUNNEL_PATH,
  createRegisterMessage,
  createReadyMessage,
  createErrorMessage,
  createPingMessage,
  createPongMessage,
  createHttpRequest,
  createHttpResponse,
  createHttpResponseStart,
  createHttpResponseChunk,
  createHttpResponseEnd,
  filterHeaders,
} from '../src/index.js';

test('exports shared constants', () => {
  assert.equal(TUNNEL_PATH, '/tunnel');
  assert.equal(MESSAGE_TYPES.REGISTER, 'REGISTER');
  assert.equal(MESSAGE_TYPES.HTTP_RESPONSE_START, 'HTTP_RESPONSE_START');
});

test('createRegisterMessage carries token and subdomain', () => {
  const msg = createRegisterMessage({ token: 'secret', subdomain: 'app' });
  assert.deepEqual(msg, { type: 'REGISTER', token: 'secret', subdomain: 'app', host: undefined });
});

test('createHttpResponse uses base64 by default', () => {
  const msg = createHttpResponse({ id: '1', status: 200, headers: {}, body: 'aGk=' });
  assert.equal(msg.bodyEncoding, 'base64');
  assert.equal(msg.status, 200);
});

test('streaming response creators work', () => {
  assert.deepEqual(createHttpResponseStart({ id: '1', status: 200, headers: { a: 'b' } }), {
    type: 'HTTP_RESPONSE_START',
    id: '1',
    status: 200,
    headers: { a: 'b' },
  });
  assert.deepEqual(createHttpResponseChunk({ id: '1', body: 'aGk=' }), {
    type: 'HTTP_RESPONSE_CHUNK',
    id: '1',
    body: 'aGk=',
    bodyEncoding: 'base64',
  });
  assert.deepEqual(createHttpResponseEnd({ id: '1' }), {
    type: 'HTTP_RESPONSE_END',
    id: '1',
  });
});

test('filterHeaders removes hop-by-hop headers', () => {
  const result = filterHeaders({
    'Content-Type': 'text/plain',
    Connection: 'keep-alive',
    Upgrade: 'websocket',
    'X-Custom': 'yes',
  });
  assert.deepEqual(result, {
    'Content-Type': 'text/plain',
    'X-Custom': 'yes',
  });
});