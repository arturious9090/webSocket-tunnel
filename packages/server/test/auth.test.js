import test from 'node:test';
import assert from 'node:assert/strict';

import { authorizeToken, isSubdomainAllowed } from '../src/auth.js';

test('authorizeToken matches shared authToken', () => {
  const config = { authToken: 'shared', authTokens: null };
  assert.ok(authorizeToken(config, 'shared'));
  assert.equal(authorizeToken(config, 'wrong'), null);
});

test('authorizeToken matches per-client tokens and ignores shared when configured', () => {
  const config = {
    authToken: 'shared',
    authTokens: {
      tokenA: { subdomains: ['app'] },
    },
  };
  const rule = authorizeToken(config, 'tokenA');
  assert.ok(rule);
  assert.deepEqual(rule.subdomains, ['app']);
  assert.equal(authorizeToken(config, 'shared'), null);
});

test('isSubdomainAllowed allows when no restriction', () => {
  assert.equal(isSubdomainAllowed({ subdomains: null }, 'anything'), true);
  assert.equal(isSubdomainAllowed({ subdomains: [] }, 'anything'), true);
});

test('isSubdomainAllowed enforces restricted list', () => {
  const rule = { subdomains: ['app'] };
  assert.equal(isSubdomainAllowed(rule, 'app'), true);
  assert.equal(isSubdomainAllowed(rule, 'staging'), false);
});