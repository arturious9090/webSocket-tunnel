import test from 'node:test';
import assert from 'node:assert/strict';

import { TunnelRegistry } from '../src/registry.js';

function fakeWs(id) {
  return { id, close() {}, connectedAt: Date.now(), subdomain: null };
}

test('register maps subdomain to full hostname', () => {
  const registry = new TunnelRegistry({ domain: 'example.com' });
  const ws = fakeWs('a');
  const hostname = registry.register(ws, 'app');
  assert.equal(hostname, 'app.example.com');
  assert.equal(registry.getByHostname('app.example.com'), ws);
  assert.equal(registry.size, 1);
});

test('register normalizes malformed subdomain', () => {
  const registry = new TunnelRegistry({ domain: 'example.com' });
  const ws = fakeWs('e');
  const hostname = registry.register(ws, 'App.Tunnel 123');
  assert.equal(hostname, 'apptunnel123.example.com');
  assert.ok(registry.getByHostname('apptunnel123.example.com'));
});

test('register with no subdomain maps to apex', () => {
  const registry = new TunnelRegistry({ domain: 'example.com' });
  const ws = fakeWs('b');
  const hostname = registry.register(ws, null);
  assert.equal(hostname, 'example.com');
});

test('registering same host reassigns to new connection', () => {
  const registry = new TunnelRegistry({ domain: 'example.com' });
  const ws1 = fakeWs('1');
  const ws2 = fakeWs('2');
  registry.register(ws1, 'app');
  registry.register(ws2, 'app');
  assert.equal(registry.getByHostname('app.example.com'), ws2);
});

test('unregister removes mapping', () => {
  const registry = new TunnelRegistry({ domain: 'example.com' });
  const ws = fakeWs('c');
  registry.register(ws, 'app');
  registry.unregister(ws);
  assert.equal(registry.size, 0);
});

test('list returns active tunnels', () => {
  const registry = new TunnelRegistry({ domain: 'example.com' });
  const ws = fakeWs('d');
  ws.subdomain = 'app';
  registry.register(ws, 'app');
  const list = registry.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].hostname, 'app.example.com');
  assert.equal(list[0].subdomain, 'app');
});